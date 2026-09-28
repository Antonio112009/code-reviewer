import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config/schema';
import { costOf } from '../src/models/pricing';
import { withCachePoint } from '../src/providers/ai-sdk-agent';
import { AnthropicProvider } from '../src/providers/anthropic';
import { BedrockProvider } from '../src/providers/bedrock';
import { detectProviders } from '../src/providers/detect';
import type { AgentTask } from '../src/providers/types';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-direct-'));
  writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = a / 0;\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const USAGE = {
  inputTokens: { total: 9_000, noCache: 1_000, cacheRead: 6_000, cacheWrite: 2_000 },
  outputTokens: { total: 300, text: 300, reasoning: 0 },
};

function toolCall(toolName: string, input: unknown, id: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
    usage: USAGE,
    warnings: [],
  };
}

/** Reads a file once, submits an empty review, then answers with a one-line summary. */
function readThenSubmit() {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      n++;
      if (n === 1) return toolCall('read_file', { path: 'app.js' }, 'c1');
      if (n === 2) return toolCall('submit_findings', { findings: [] }, 'c2');
      return {
        content: [{ type: 'text', text: 'No defects found.' }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    kind: 'findings',
    label: 'c001',
    instructions: 'review',
    prompt: 'code',
    reasoning: 'medium',
    readTools: true,
    root: dir,
    git: false,
    maxSteps: 5,
    timeoutMs: 30_000,
    ...over,
  };
}

/** Provider options per prompt message of a model call (system first). */
function markers(call: LanguageModelV4CallOptions, key: string): boolean[] {
  return call.prompt.map((m) => Boolean((m.providerOptions as Record<string, unknown> | undefined)?.[key]));
}

describe('Anthropic API provider', () => {
  it('lets the API cache the prompt of every step and reports cache reads and writes', async () => {
    const model = readThenSubmit();
    const provider = new AnthropicProvider(
      'anthropic',
      { type: 'anthropic', defaultModel: 'claude-sonnet-5' },
      () => model,
    );
    const result = await provider.run(task());
    expect(model.doGenerateCalls).toHaveLength(3);
    for (const call of model.doGenerateCalls) {
      expect(call.providerOptions?.anthropic).toMatchObject({ cacheControl: { type: 'ephemeral' } });
    }
    expect(result.submission.calls).toBe(1);
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.usage).toMatchObject({
      inputTokens: 3_000,
      cachedInputTokens: 18_000,
      cacheWriteTokens: 6_000,
      outputTokens: 900,
      requests: 3,
    });
    expect(result.reads).toEqual(['app.js']);
  });

  it('needs an API key, and says so', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        new AnthropicProvider('anthropic', { type: 'anthropic', defaultModel: 'claude-sonnet-5' }).run(
          task(),
        ),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/);
      const status = detectProviders(DEFAULT_CONFIG).find((s) => s.id === 'anthropic');
      expect(status).toMatchObject({ available: false, detail: 'ANTHROPIC_API_KEY is not set' });
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      expect(detectProviders(DEFAULT_CONFIG).find((s) => s.id === 'anthropic')?.available).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('Bedrock prompt caching', () => {
  it('puts cache points on the instructions and the newest message of each step (Anthropic models)', async () => {
    const model = readThenSubmit();
    const provider = new BedrockProvider('bedrock', { type: 'bedrock', region: 'us-east-1' }, () => model);
    await provider.run(task({ model: 'global.anthropic.claude-sonnet-5' }));
    const [first, second] = model.doGenerateCalls;
    expect(markers(first!, 'bedrock')).toEqual([true, true]); // system, prompt
    // second step: system, prompt, assistant tool call, tool result — only the newest message is marked
    expect(markers(second!, 'bedrock')).toEqual([true, false, false, true]);
  });

  it('leaves models without prompt caching alone', async () => {
    const model = readThenSubmit();
    const provider = new BedrockProvider('bedrock', { type: 'bedrock', region: 'us-east-1' }, () => model);
    await provider.run(task({ model: 'amazon.nova-pro-v1:0' }));
    for (const call of model.doGenerateCalls) expect(markers(call, 'bedrock').every((m) => !m)).toBe(true);
  });

  it('moves the marker instead of piling markers up, keeping other options', () => {
    const marker = { bedrock: { cachePoint: { type: 'default' } } };
    const messages: ModelMessage[] = [
      { role: 'user', content: 'a', providerOptions: { ...marker, other: { keep: true } } },
      { role: 'assistant', content: 'b', providerOptions: marker },
      { role: 'user', content: 'c' },
    ];
    expect(withCachePoint(messages, marker).map((m) => m.providerOptions)).toEqual([
      { other: { keep: true } },
      undefined,
      marker,
    ]);
  });
});

describe('cache write pricing', () => {
  it('defaults to 1.25× the input price', () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 };
    expect(costOf({ provider: 'anthropic', usage }, { anthropic: { input: 3 } })?.amount).toBeCloseTo(3.75);
    expect(costOf({ provider: 'anthropic', usage }, { anthropic: { input: 3, cacheWrite: 6 } })?.amount).toBe(
      6,
    );
  });
});
