import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BedrockProvider } from '../src/providers/bedrock';
import type { AgentTask } from '../src/providers/types';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-bedrock-'));
  writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = a / 0;\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const USAGE = {
  inputTokens: { total: 1_000, noCache: 400, cacheRead: 600, cacheWrite: 0 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
};

function toolCall(toolName: string, input: unknown, id: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
    usage: USAGE,
    warnings: [],
  };
}

const FINDING = {
  file: 'app.js',
  startLine: 2,
  endLine: 2,
  severity: 'major',
  category: 'bug',
  title: 'Division by zero',
  description: 'b is Infinity because a is divided by zero',
  confidence: 0.9,
};

/** A model that keeps reading files; it submits only when `read_file` is no longer offered. */
function curiousModel() {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      n++;
      const names = (options.tools ?? []).map((t) => t.name);
      if (!names.includes('read_file')) return toolCall('submit_findings', { findings: [FINDING] }, `c${n}`);
      return toolCall('read_file', { path: 'app.js' }, `c${n}`);
    },
  });
}

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    kind: 'findings',
    label: 'c001',
    instructions: 'review',
    prompt: 'code',
    model: 'test-model',
    reasoning: 'medium',
    readTools: true,
    root: dir,
    git: false,
    maxSteps: 4,
    timeoutMs: 30_000,
    ...over,
  };
}

describe('BedrockProvider tool loop', () => {
  it('offers only the submit tool on the last step and asks for the findings so far', async () => {
    const model = curiousModel();
    const provider = new BedrockProvider('bedrock', { type: 'bedrock', region: 'us-east-1' }, () => model);
    const result = await provider.run(task());
    expect(model.doGenerateCalls).toHaveLength(4);
    const last = model.doGenerateCalls[3]!;
    expect((last.tools ?? []).map((t) => t.name)).toEqual(['submit_findings']);
    expect(JSON.stringify(last.prompt)).toMatch(/Stop here: this is the last step/);
    expect(result.submission.findings).toEqual([FINDING]);
    expect(result.salvaged).toBe('this is the last step');
    expect(result.toolUsage).toEqual({ read_file: 3, submit_findings: 1 });
    // cached input is reported apart from the uncached part
    expect(result.usage).toMatchObject({ inputTokens: 1_600, cachedInputTokens: 2_400, requests: 4 });
  });

  it('reports a step limit like an agent when salvage is off', async () => {
    const model = curiousModel();
    const provider = new BedrockProvider('bedrock', { type: 'bedrock', region: 'us-east-1' }, () => model);
    const result = await provider.run(task({ salvage: false }));
    expect(result.submission.calls).toBe(0);
    expect(result.stopReason).toBe('max_turn_requests');
    expect(result.salvaged).toBeUndefined();
  });
});
