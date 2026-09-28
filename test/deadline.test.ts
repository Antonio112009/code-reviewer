import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic';
import { ActivityDeadline } from '../src/providers/deadline';
import type { AgentTask } from '../src/providers/types';

describe('ActivityDeadline', () => {
  it('extends only while the model is busy, by a quarter of the base time, up to the cap', () => {
    const d = new ActivityDeadline(400_000, 150_000, 0);
    expect(d.at).toBe(400_000);
    expect(d.tryExtend(400_000)).toBe(false); // never busy
    d.touch(380_000);
    expect(d.tryExtend(400_000)).toBe(true);
    expect(d.at).toBe(500_000); // + 100 s (a quarter)
    d.touch(490_000);
    expect(d.tryExtend(500_000)).toBe(true);
    expect(d.at).toBe(550_000); // the remaining 50 s of the cap
    d.touch(549_000);
    expect(d.tryExtend(550_000)).toBe(false); // cap reached
    expect(d.extendedMs).toBe(150_000);
  });

  it('does not extend a model idle for more than a minute, and never without a cap', () => {
    const d = new ActivityDeadline(300_000, 150_000, 0);
    d.touch(200_000);
    expect(d.tryExtend(300_000)).toBe(false);
    const off = new ActivityDeadline(300_000, 0, 0);
    off.touch(299_000);
    expect(off.tryExtend(300_000)).toBe(false);
  });
});

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-deadline-'));
  writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const call = (toolName: string, input: unknown, id: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls', raw: 'tool_use' },
  usage: USAGE,
  warnings: [],
});
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

/** Answers after `delayMs` per step: reads `reads` times, then submits. */
function slowModel(delayMs: number, reads: number) {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      await sleep(delayMs, abortSignal);
      n++;
      if (n <= reads) return call('read_file', { path: 'app.js' }, `r${n}`);
      if (n === reads + 1) return call('submit_findings', { findings: [] }, 's');
      return {
        content: [{ type: 'text', text: 'done' }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

const task = (over: Partial<AgentTask>): AgentTask => ({
  kind: 'findings',
  label: 'c001',
  instructions: 'review',
  prompt: 'code',
  reasoning: 'medium',
  readTools: true,
  root: dir,
  git: false,
  maxSteps: 10,
  timeoutMs: 400,
  salvage: false,
  ...over,
});

describe('extending a task while the model calls tools', () => {
  const provider = (model: MockLanguageModelV4) =>
    new AnthropicProvider('anthropic', { type: 'anthropic', defaultModel: 'm' }, () => model);

  it('lets a model that keeps reading finish past its base time', async () => {
    // 4 steps of 150 ms: 600 ms against a 400 ms limit
    const result = await provider(slowModel(150, 3)).run(task({ extendMs: 30_000 }));
    expect(result.submission.calls).toBe(1);
    expect(result.toolUsage).toMatchObject({ read_file: 3 });
  });

  it('still stops on time without the extension, or when the model is idle', async () => {
    await expect(provider(slowModel(150, 3)).run(task({}))).rejects.toThrow(/timed out/);
    await expect(provider(slowModel(600, 0)).run(task({ extendMs: 30_000 }))).rejects.toThrow(/timed out/);
  });
});
