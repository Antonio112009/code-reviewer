import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { costOf } from '../src/models/pricing';
import { AnthropicProvider } from '../src/providers/anthropic';
import { BatchTimeout, batchParams, runBatchTask } from '../src/providers/anthropic-batch';
import type { AgentTask } from '../src/providers/types';

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

const task = (over: Partial<AgentTask> = {}): AgentTask => ({
  kind: 'findings',
  label: 'sweep-1',
  instructions: 'Review the change.',
  prompt: 'diff --git a/x b/x',
  reasoning: 'medium',
  readTools: false,
  root: '/r',
  git: false,
  maxSteps: 3,
  timeoutMs: 60_000,
  batch: true,
  ...over,
});

const finding = {
  file: 'src/a.ts',
  startLine: 2,
  endLine: 2,
  severity: 'major',
  category: 'bug',
  title: 'Division by zero',
  description: 'parts may be 0 and the division is unchecked.',
  failurePath: 'split(1, 0) → 1 / 0 → Infinity returned',
  confidence: 0.8,
};

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** A fake Message Batches API: `polls` status checks before the batch ends, then one JSONL result. */
function fakeBatches(opts: { polls: number; result?: unknown; never?: boolean }) {
  const calls: Call[] = [];
  let checks = 0;
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (method === 'POST' && url.endsWith('/batches'))
      return json({ id: 'b1', processing_status: 'in_progress' });
    if (method === 'POST' && url.endsWith('/cancel'))
      return json({ id: 'b1', processing_status: 'canceling' });
    if (url.endsWith('/results')) return new Response(`${JSON.stringify(opts.result)}\n`, { status: 200 });
    checks++;
    const ended = !opts.never && checks > opts.polls;
    return json({
      id: 'b1',
      processing_status: ended ? 'ended' : 'in_progress',
      results_url: ended ? 'https://api.anthropic.com/v1/messages/batches/b1/results' : null,
    });
  };
  return { fetch, calls };
}

const succeeded = (content: unknown[]) => ({
  custom_id: 'task',
  result: {
    type: 'succeeded',
    message: {
      model: 'claude-sonnet-5-5',
      stop_reason: 'tool_use',
      content,
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0 },
    },
  },
});

describe('the Message Batches API path', () => {
  it('sends the instructions, prompt, submit tool and adaptive thinking, and reads the submission', async () => {
    const api = fakeBatches({
      polls: 2,
      result: succeeded([
        { type: 'thinking', thinking: '' },
        { type: 'tool_use', id: 't1', name: 'submit_findings', input: { findings: [finding] } },
      ]),
    });
    const result = await runBatchTask(task(), {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      apiKey: 'k',
      maxWaitMs: 60_000,
      fetch: api.fetch,
      sleep: async () => {},
    });
    expect(result.submission.findings).toEqual([expect.objectContaining({ title: 'Division by zero' })]);
    expect(result.usage).toMatchObject({ inputTokens: 1000, outputTokens: 200, requests: 1, batch: true });
    expect(result.toolUsage).toEqual({ submit_findings: 1 });
    const created = api.calls[0]!;
    expect(created.method).toBe('POST');
    const params = (created.body as { requests: Array<{ params: Record<string, unknown> }> }).requests[0]!
      .params;
    expect(params).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'Review the change.',
      messages: [{ role: 'user', content: 'diff --git a/x b/x' }],
      tool_choice: { type: 'auto' },
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    });
    expect((params.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['submit_findings']);
    expect(api.calls.filter((c) => c.method === 'GET').length).toBe(4); // 3 status checks + the results
  });

  it('cancels a batch that is not answered in time and says so', async () => {
    const api = fakeBatches({ polls: 0, never: true });
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      await expect(
        runBatchTask(task(), {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-5-5',
          apiKey: 'k',
          maxWaitMs: 30_000,
          fetch: api.fetch,
          sleep: async (ms) => {
            now += ms;
          },
        }),
      ).rejects.toBeInstanceOf(BatchTimeout);
    } finally {
      Date.now = realNow;
    }
    expect(api.calls.some((c) => c.url.endsWith('/b1/cancel'))).toBe(true);
  });

  it('refuses tasks with read tools, and prices batch tokens at half', () => {
    expect(() => batchParams(task({ readTools: true }), 'm')).toThrow(/read tools/);
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    const full = costOf({ provider: 'anthropic', model: 'claude-sonnet-5-5', usage }, {});
    const half = costOf(
      { provider: 'anthropic', model: 'claude-sonnet-5-5', usage: { ...usage, batch: true } },
      {},
    );
    expect(full?.amount).toBeGreaterThan(0);
    expect(half?.amount).toBeCloseTo((full?.amount ?? 0) / 2);
  });

  it('falls back to a regular request when the batch times out', async () => {
    const api = fakeBatches({ polls: 0, never: true });
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'k';
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const provider = new AnthropicProvider(
        'anthropic',
        { type: 'anthropic', defaultModel: 'claude-sonnet-5-5' },
        () =>
          new MockLanguageModelV4({
            doGenerate: async () => ({
              content: [{ type: 'text', text: 'no findings' }],
              finishReason: { unified: 'stop' as const, raw: 'end_turn' },
              usage: USAGE,
              warnings: [],
            }),
          }) as never,
        {
          fetch: api.fetch,
          maxWaitMs: 1_000,
          sleep: async (ms) => {
            now += ms;
          },
        },
      );
      const result = await provider.run(task());
      expect(result.warnings[0]).toMatch(/sweep-1: the batch was not answered.*regular request/);
      expect(result.usage?.batch).toBeUndefined();
    } finally {
      Date.now = realNow;
      restoreKey(saved);
    }
  });

  it('falls back to a regular request when the batch request fails', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'k';
    try {
      const provider = new AnthropicProvider(
        'anthropic',
        { type: 'anthropic', defaultModel: 'claude-haiku-4-5' },
        () => regularModel() as never,
        {
          fetch: fakeBatches({
            polls: 0,
            result: {
              custom_id: 'task',
              result: { type: 'errored', error: { type: 'invalid_request_error', message: 'adaptive' } },
            },
          }).fetch,
          sleep: async () => {},
        },
      );
      const result = await provider.run(task());
      expect(result.warnings[0]).toMatch(/sweep-1: the batch failed \(.*errored.*\); answered by a regular/);
      expect(result.usage?.batch).toBeUndefined();
    } finally {
      restoreKey(saved);
    }
  });

  it('cancels the batch when the task is aborted, and does not fall back', async () => {
    const api = fakeBatches({ polls: 0, never: true });
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'k';
    const stop = new AbortController();
    let cancelSignal: AbortSignal | undefined;
    try {
      const provider = new AnthropicProvider(
        'anthropic',
        { type: 'anthropic', defaultModel: 'claude-sonnet-5-5' },
        () => regularModel() as never,
        {
          fetch: async (url, init) => {
            if (url.endsWith('/cancel')) cancelSignal = init.signal ?? undefined;
            return api.fetch(url, init);
          },
          sleep: async (_ms, signal) => {
            stop.abort(new Error('stopped'));
            signal?.throwIfAborted();
          },
        },
      );
      await expect(provider.run(task({ signal: stop.signal }))).rejects.toThrow('stopped');
    } finally {
      restoreKey(saved);
    }
    expect(api.calls.some((c) => c.url.endsWith('/b1/cancel'))).toBe(true);
    expect(cancelSignal?.aborted).toBe(false);
  });
});

function regularModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'no findings' }],
      finishReason: { unified: 'stop' as const, raw: 'end_turn' },
      usage: USAGE,
      warnings: [],
    }),
  });
}

function restoreKey(saved: string | undefined): void {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
}
