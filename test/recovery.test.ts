import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { splitChunk } from '../src/chunking/chunker';
import type { Config } from '../src/config/schema';
import { CostMeter, costOf, formatMoney, priceFor } from '../src/models/pricing';
import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/registry';
import { mayAskForMore, salvagePrompt, salvageReason, salvageTimeoutMs } from '../src/providers/salvage';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import {
  failureKindOf,
  NoPayloadError,
  sumUsage,
  UnfinishedTurnError,
  usageOrEstimate,
} from '../src/review/execute';
import { runReview } from '../src/review/pipeline';
import type { Chunk, ChunkPart } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;

beforeAll(() => {
  repo = makeRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
  repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    'src/a.ts': 'export const a = 1;\nexport const x = a / 0; // BUG(major): division by zero\n',
    'src/b.ts': 'export const b = 2;\nexport const y = b.foo.bar; // BUG(major): reads a missing property\n',
  });
  repo.commit('feature');
  repo.git('checkout', '-q', 'main');
});

afterAll(() => repo.cleanup());

/** Delegates to the mock provider, except for the tasks `fail` answers (with a result or an error). */
class ScriptedProvider implements Provider {
  readonly id = 'mock';
  readonly kind = 'mock' as const;
  readonly tasks: AgentTask[] = [];
  private readonly mock = new MockProvider('mock');

  constructor(
    private readonly fail: (task: AgentTask, n: number) => Partial<AgentResult> | Error | undefined,
    private readonly usage: 'mock' | 'none' = 'mock',
  ) {}

  async run(task: AgentTask): Promise<AgentResult> {
    this.tasks.push(task);
    const scripted = this.fail(task, this.tasks.length);
    if (scripted instanceof Error) throw scripted;
    if (scripted) return { submission: { calls: 0 }, text: '', toolCalls: 0, warnings: [], ...scripted };
    const result = await this.mock.run(task);
    return this.usage === 'none' ? { ...result, usage: undefined } : result;
  }

  async dispose(): Promise<void> {}
}

async function review(provider: Provider, adjust: (c: Config) => void = () => {}) {
  const config = testConfig((c) => {
    c.review.selfCritique = false;
    c.output.formats = [];
    adjust(c);
  });
  const registry = new ProviderRegistry(config, silentLogger);
  (registry as unknown as { instances: Map<string, Provider> }).instances.set('mock', provider);
  const outcome = await runReview({
    command: 'review',
    cwd: repo.root,
    base: 'main',
    head: 'feature',
    config,
    logger: silentLogger,
    providers: registry,
    skipPreflight: true,
  });
  return { run: outcome.run!, runDir: outcome.runDir! };
}

const files = (task: AgentTask) => [...task.prompt.matchAll(/^## File: (\S+)/gm)].length;

describe('chunk recovery', () => {
  it('splits a chunk that ran out of steps and reviews the halves', async () => {
    const provider = new ScriptedProvider((task) =>
      task.kind === 'findings' && files(task) > 1 ? { stopReason: 'max_turn_requests' } : undefined,
    );
    const { run, runDir } = await review(provider);
    expect(run.status).toBe('completed');
    expect(run.chunks).toHaveLength(1);
    const rec = run.chunks[0]!;
    expect(rec.status).toBe('done');
    expect(rec.recovery).toEqual([`${rec.id}: step-limit — split into ${rec.id}.1 + ${rec.id}.2`]);
    expect(run.findings.map((f) => f.file).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(run.findings.every((f) => f.source.chunkIds[0] === rec.id)).toBe(true);
    // the failed attempt still counts
    expect(rec.usage?.requests).toBe(3);
    expect(run.usage.requests).toBe(3);
    for (const id of [`${rec.id}.1`, `${rec.id}.2`]) {
      expect(existsSync(path.join(runDir, 'chunks', `${id}.json`)), id).toBe(true);
    }
  });

  it('retries a timed-out single-part chunk once, with twice the time', async () => {
    const provider = new ScriptedProvider((task, n) =>
      task.kind === 'findings' && n === 1
        ? { stopReason: 'cancelled', interruptedBy: 'timeout', warnings: ['timed out after 1s — cancelled'] }
        : undefined,
    );
    const { run } = await review(provider, (c) => {
      c.review.exclude = ['src/b.ts'];
    });
    const [first, second] = provider.tasks;
    expect(second!.timeoutMs).toBe(first!.timeoutMs * 2);
    const rec = run.chunks[0]!;
    expect(rec.status).toBe('done');
    expect(rec.recovery?.[0]).toMatch(/timeout — retried with \d+s/);
    expect(run.findings).toHaveLength(1);
  });

  it('gives up with a failure kind when nothing can fix it', async () => {
    const provider = new ScriptedProvider((task) =>
      task.kind === 'findings' ? { stopReason: 'max_tokens' } : undefined,
    );
    const { run } = await review(provider, (c) => {
      c.review.exclude = ['src/b.ts'];
    });
    expect(provider.tasks.filter((t) => t.kind === 'findings')).toHaveLength(1);
    expect(run.status).toBe('failed');
    expect(run.chunks[0]).toMatchObject({ status: 'failed', failure: 'output-limit' });
    expect(run.warnings.join('\n')).toMatch(/failed \(output-limit\)/);
  });

  it('reports which parts of a split chunk failed', async () => {
    const provider = new ScriptedProvider((task) =>
      task.kind === 'findings' && (files(task) > 1 || /^## File: src\/b\.ts/m.test(task.prompt))
        ? { stopReason: 'max_turn_requests' }
        : undefined,
    );
    const { run } = await review(provider);
    const rec = run.chunks[0]!;
    expect(rec).toMatchObject({ status: 'failed', failure: 'step-limit' });
    expect(rec.error).toMatch(/^1 of 2 parts failed/);
    expect(run.status).toBe('failed');
    expect(run.findings.map((f) => f.file)).toEqual(['src/a.ts']);
  });

  it('records a reply without payload as no-output', async () => {
    const provider = new ScriptedProvider((task) =>
      task.kind === 'findings' ? { text: 'Looks fine to me.', stopReason: 'end_turn' } : undefined,
    );
    const { run, runDir } = await review(provider);
    expect(run.chunks[0]).toMatchObject({ status: 'failed', failure: 'no-output' });
    // what the model said instead is kept for debugging
    const artifact = JSON.parse(
      readFileSync(path.join(runDir, 'chunks', `${run.chunks[0]!.id}-failed.json`), 'utf8'),
    );
    expect(artifact).toMatchObject({
      failure: 'no-output',
      reply: expect.stringContaining('Looks fine to me.'),
    });
  });
});

describe('cost', () => {
  it('prices reported tokens with the configured pricing', async () => {
    const { run } = await review(new ScriptedProvider(() => undefined), (c) => {
      c.pricing = { mock: { input: 3, output: 15 } };
    });
    const u = run.usage;
    expect(u.requests).toBe(1);
    expect(u.estimated).toBeUndefined();
    expect(run.cost).toMatchObject({ currency: 'USD', basis: ['priced'], unknownTasks: 0, unpriced: [] });
    expect(run.cost!.amount).toBeCloseTo((u.inputTokens * 3 + u.outputTokens * 15) / 1e6, 10);
    expect(run.chunks[0]!.cost?.amount).toBeCloseTo(run.cost!.amount, 10);
  });

  it('estimates tokens a provider does not report, and says when the cost is unknown', async () => {
    const { run } = await review(new ScriptedProvider(() => undefined, 'none'));
    expect(run.usage.estimated).toBe(true);
    expect(run.usage.inputTokens).toBeGreaterThan(0);
    expect(run.cost).toMatchObject({ amount: 0, basis: [], unknownTasks: 1, unpriced: ['mock:mock'] });
  });
});

describe('pricing', () => {
  const pricing = {
    claude: { request: 0.5 },
    sonnet: { input: 3, output: 15 },
    'bedrock:SONNET': { input: 2, output: 10, cachedInput: 0.2, currency: 'EUR' },
  };

  it('picks the most specific price', () => {
    expect(priceFor(pricing, 'bedrock', 'sonnet')).toBe(pricing['bedrock:SONNET']);
    expect(priceFor(pricing, 'claude', 'sonnet')).toBe(pricing.sonnet);
    expect(priceFor(pricing, 'claude', 'opus')).toBe(pricing.claude);
    expect(priceFor(pricing, 'codex', undefined)).toBeUndefined();
  });

  it('prefers a reported cost, then prices tokens or requests', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 500_000, requests: 2 };
    expect(
      costOf(
        {
          provider: 'bedrock',
          model: 'sonnet',
          usage: { ...usage, reportedCost: { amount: 1, currency: 'USD' } },
        },
        pricing,
      ),
    ).toEqual({ amount: 1, currency: 'USD', basis: 'reported' });
    expect(costOf({ provider: 'bedrock', model: 'sonnet', usage }, pricing)).toEqual({
      amount: 2 + 0.1 + 1,
      currency: 'EUR',
      basis: 'priced',
    });
    expect(
      costOf({ provider: 'claude', model: 'opus', usage: { ...usage, estimated: true } }, pricing),
    ).toEqual({
      amount: 1,
      currency: 'USD',
      basis: 'priced',
    });
    expect(
      costOf({ provider: 'x', model: 'sonnet', usage: { ...usage, estimated: true } }, pricing)?.basis,
    ).toBe('estimated');
    expect(costOf({ provider: 'codex', usage }, pricing)).toBeUndefined();
  });

  it('keeps one currency per run and lists what has no price', () => {
    const meter = new CostMeter(pricing);
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    expect(meter.add([{ provider: 'claude', model: 'sonnet', usage }])).toEqual({
      amount: 3,
      currency: 'USD',
    });
    meter.add([
      { provider: 'bedrock', model: 'sonnet', usage },
      { provider: 'codex', model: 'gpt', usage },
    ]);
    expect(meter.summary()).toEqual({
      amount: 3,
      currency: 'USD',
      basis: ['priced'],
      unknownTasks: 2,
      unpriced: ['bedrock:sonnet', 'codex:gpt'],
    });
    expect(new CostMeter({}).summary()).toBeUndefined();
  });

  it('formats small and large amounts', () => {
    expect(formatMoney({ amount: 0.00312, currency: 'USD' })).toBe('$0.0031');
    expect(formatMoney({ amount: 0.42, currency: 'USD' })).toBe('$0.420');
    expect(formatMoney({ amount: 12.5, currency: 'EUR' })).toBe('€12.50');
    expect(formatMoney({ amount: 3, currency: 'CHF' })).toBe('3.00 CHF');
  });
});

describe('usage accounting', () => {
  const task = { instructions: 'review this', prompt: 'const a = 1;' } as AgentTask;

  it('estimates missing token counts and counts every call as a request', () => {
    expect(usageOrEstimate({ inputTokens: 5, outputTokens: 1 }, task, 'x')).toEqual({
      inputTokens: 5,
      outputTokens: 1,
      requests: 1,
    });
    const estimated = usageOrEstimate(undefined, task, 'no findings');
    expect(estimated).toMatchObject({ estimated: true, requests: 1 });
    expect(estimated.inputTokens).toBeGreaterThan(0);
    const reported = usageOrEstimate(
      {
        inputTokens: 0,
        outputTokens: 0,
        estimated: true,
        requests: 2,
        reportedCost: { amount: 1, currency: 'USD' },
      },
      task,
      '',
    );
    expect(reported).toMatchObject({
      requests: 2,
      reportedCost: { amount: 1, currency: 'USD' },
      estimated: true,
    });
  });

  it('sums usage; a reported cost only when every part has one', () => {
    const cost = { amount: 0.5, currency: 'USD' };
    expect(
      sumUsage([
        { inputTokens: 1, outputTokens: 2, requests: 1, reportedCost: cost },
        { inputTokens: 3, outputTokens: 4, requests: 2, reportedCost: cost, estimated: true },
      ]),
    ).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      requests: 3,
      estimated: true,
      reportedCost: { amount: 1, currency: 'USD' },
    });
    expect(
      sumUsage([
        { inputTokens: 1, outputTokens: 0, reportedCost: cost },
        { inputTokens: 1, outputTokens: 0 },
      ]).reportedCost,
    ).toBeUndefined();
  });

  it('classifies failures', () => {
    expect(failureKindOf(new UnfinishedTurnError('x', 'step-limit'))).toBe('step-limit');
    expect(failureKindOf(new NoPayloadError('x'))).toBe('no-output');
    expect(failureKindOf(new Error('prompt is too long: 250000 tokens > 200000 maximum'))).toBe(
      'context-limit',
    );
    expect(failureKindOf(new Error('boom'))).toBe('error');
    const controller = new AbortController();
    controller.abort();
    expect(failureKindOf(new Error('boom'), controller.signal)).toBe('aborted');
  });
});

describe('salvage helpers', () => {
  it('asks for an early answer only for limits and our own interruptions', () => {
    expect(salvageReason('max_turn_requests', undefined)).toBe('the step limit was reached');
    expect(salvageReason('max_tokens', undefined)).toBe('the answer hit the output token limit');
    expect(salvageReason('cancelled', 'timeout')).toBe('the time limit was reached');
    expect(salvageReason('cancelled', 'stalled')).toBe('no progress was made for a while');
    expect(salvageReason('end_turn', undefined)).toBeUndefined();
    expect(salvageReason('refusal', undefined)).toBeUndefined();
    expect(salvageReason('cancelled', undefined)).toBeUndefined();
  });

  it('bounds the extra turn', () => {
    expect(salvageTimeoutMs(200)).toBe(200);
    expect(salvageTimeoutMs(60_000)).toBe(30_000);
    expect(salvageTimeoutMs(240_000)).toBe(60_000);
    expect(salvageTimeoutMs(900_000)).toBe(90_000);
  });

  it('names the submit tool of the task', () => {
    expect(salvagePrompt('findings', 'the step limit was reached')).toMatch(/`submit_findings`/);
    expect(salvagePrompt('verdicts', 'the step limit was reached')).toMatch(/`submit_verdicts`.*uncertain/);
  });

  it('asks a review that already submitted findings for the rest, but not a critique', () => {
    expect(mayAskForMore('findings', false)).toBe(true);
    expect(mayAskForMore('findings', true)).toBe(true);
    expect(mayAskForMore('verdicts', false)).toBe(true);
    expect(mayAskForMore('verdicts', true)).toBe(false);
    expect(salvagePrompt('findings', 'the time limit was reached', true)).toMatch(/not submitted yet/);
    expect(salvagePrompt('findings', 'the time limit was reached')).not.toMatch(/not submitted yet/);
  });
});

describe('splitChunk', () => {
  const part = (p: string, tokens: number, index?: number): ChunkPart => ({
    path: p,
    language: 'typescript',
    status: 'modified',
    text: `## File: ${p}`,
    tokens,
    role: 'review',
    ...(index ? { part: { index, total: 3 } } : {}),
  });
  const chunk = (parts: ChunkPart[]): Chunk => ({
    id: 'c002',
    index: 1,
    parts,
    tokens: parts.reduce((s, p) => s + p.tokens, 0),
    files: [...new Set(parts.map((p) => p.path))],
    contextFiles: ['ctx.ts'],
    languages: ['typescript'],
    mentions: ['gone.ts'],
  });

  it('cuts at the file boundary closest to the middle and drops read-only context', () => {
    const halves = splitChunk(
      chunk([
        part('a.ts', 100),
        part('b.ts', 300),
        part('c.ts', 350),
        { ...part('ctx.ts', 50), role: 'context' },
      ]),
    )!;
    expect(halves.map((h) => [h.id, h.files, h.tokens])).toEqual([
      ['c002.1', ['a.ts', 'b.ts'], 400],
      ['c002.2', ['c.ts'], 350],
    ]);
    expect(halves[0].mentions).toEqual(['gone.ts']);
    expect(halves[1].mentions).toEqual([]);
    expect(halves.every((h) => h.contextFiles?.length === 0)).toBe(true);
  });

  it('splits the windows of a single file, and nothing below two parts', () => {
    const halves = splitChunk(
      chunk([part('big.ts', 100, 1), part('big.ts', 100, 2), part('big.ts', 100, 3)]),
    )!;
    expect(halves.map((h) => h.parts.length)).toEqual([1, 2]);
    expect(splitChunk(chunk([part('a.ts', 100)]))).toBeUndefined();
  });
});
