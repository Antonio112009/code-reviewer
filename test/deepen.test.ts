import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../src/config/schema';
import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/registry';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import { deepenAdviceText } from '../src/report/common';
import { DEEPEN_COST_FACTOR, deepenAdvice } from '../src/review/advice';
import { dedupeFindings } from '../src/review/dedupe';
import { runReview } from '../src/review/pipeline';
import { critiqueFindingIdentity } from '../src/review/prompts';
import type { ChunkRecord, Finding, ReportedFinding, RunRecord } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;

beforeAll(() => {
  repo = makeRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
  repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    // a.ts has a finding (the mock reports BUG lines); b.ts has none
    'src/a.ts': 'export const a = 1;\nexport const x = a / 0; // BUG(major): division by zero\n',
    'src/b.ts': 'export const b = 2;\nexport const y = b + 1;\n',
  });
  repo.commit('feature');
  repo.git('checkout', '-q', 'main');
});

afterAll(() => repo.cleanup());

const extra = (over: Partial<ReportedFinding>): ReportedFinding => ({
  file: 'src/a.ts',
  startLine: 2,
  endLine: 2,
  severity: 'major',
  category: 'bug',
  title: 'Result exported before validation',
  description: 'The exported constant is computed at import time and never validated.',
  failurePath: 'import a.ts → x computed → Infinity exported',
  confidence: 0.7,
  ...over,
});

/** The mock provider, except that a second pass (`-deepen` task) gets `second` added to its answer. */
class DeepenProvider implements Provider {
  readonly id = 'mock';
  readonly kind = 'mock' as const;
  readonly tasks: AgentTask[] = [];
  private readonly mock = new MockProvider('mock');

  constructor(private readonly second: ReportedFinding[] | Error) {}

  async run(task: AgentTask): Promise<AgentResult> {
    this.tasks.push(task);
    const result = await this.mock.run(task);
    if (!task.label.endsWith('-deepen')) return result;
    if (this.second instanceof Error) throw this.second;
    return {
      ...result,
      submission: { ...result.submission, findings: [...(result.submission.findings ?? []), ...this.second] },
    };
  }

  async dispose(): Promise<void> {}
}

async function review(provider: Provider, adjust: (c: Config) => void = () => {}) {
  const config = testConfig((c) => {
    c.review.selfCritique = false;
    c.review.maxChunkTokens = 60; // one chunk per file
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
  return outcome.run!;
}

describe('second pass (review.deepen)', () => {
  it('reviews every chunk again at high reasoning, independently, and keeps what either pass found', async () => {
    const provider = new DeepenProvider([extra({})]);
    const run = await review(provider, (c) => {
      c.review.deepen = true;
    });
    const second = provider.tasks.filter((t) => t.label.endsWith('-deepen'));
    // every chunk (the test config packs both files into one)
    expect(second).toHaveLength(run.chunks.length);
    for (const s of second) {
      const first = provider.tasks.find((t) => s.label === `${t.label}-deepen`)!;
      // the same task, told nothing about the first pass, reasoning harder than the route's
      expect(s.prompt).toBe(first.prompt);
      expect(s.instructions).toBe(first.instructions);
      expect(first.reasoning).toBe('low');
      expect(s.reasoning).toBe('high');
    }
    // the mock repeats "division by zero": kept once, as reported by both passes; the new one by one pass
    expect(run.findings.map((f) => [f.title, f.passes]).sort()).toEqual([
      ['Result exported before validation', 1],
      ['division by zero', 2],
    ]);
    // recorded per chunk: what the second pass added
    expect(run.chunks.map((c) => c.deepened)).toEqual([1]);
  });

  it('keeps the first pass when the second fails', async () => {
    const run = await review(new DeepenProvider(new Error('agent crashed')), (c) => {
      c.review.deepen = true;
    });
    expect(run.findings.map((f) => f.title)).toEqual(['division by zero']);
    expect(run.status).toBe('completed');
  });

  it('is off by default', async () => {
    const provider = new DeepenProvider([extra({})]);
    const run = await review(provider);
    expect(provider.tasks.some((t) => t.label.endsWith('-deepen'))).toBe(false);
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0]!.passes).toBeUndefined();
  });

  it('tells the critic which findings both passes reported', () => {
    const f = { ...extra({}), id: 'f1', skills: [], source: { chunkIds: [], provider: 'mock' } } as Finding;
    expect(critiqueFindingIdentity(f)).not.toHaveProperty('reportedBy');
    expect(critiqueFindingIdentity({ ...f, passes: 2 })).toMatchObject({
      reportedBy: 'both independent review passes',
    });
    expect(critiqueFindingIdentity({ ...f, passes: 1 })).toMatchObject({
      reportedBy: 'one of two independent review passes',
    });
  });
});

describe('dedupe on one span', () => {
  const finding = (title: string): Finding =>
    ({
      id: title,
      file: 'a.c',
      startLine: 10,
      endLine: 30,
      severity: 'major',
      category: 'bug',
      title,
      description: 'x'.repeat(20),
      confidence: 0.8,
      skills: [],
      source: { chunkIds: ['c1'], provider: 'mock' },
    }) as Finding;

  it('keeps different defects of one function and merges the same one worded differently', () => {
    const distinct = dedupeFindings([
      finding('Missing NULL check for GetObjectClass result'),
      finding('JNI local reference leak of the class object'),
    ]);
    expect(distinct.unique).toHaveLength(2);
    const same = dedupeFindings([
      finding('Off-by-one in average loop yields NaN'),
      finding('average loop reads past the end of the array'),
    ]);
    expect(same.unique).toHaveLength(1);
  });
});

describe('suggesting a second pass', () => {
  it('suggests --deepen after a run with findings, not after one that took it', async () => {
    const plain = await review(new DeepenProvider([extra({})]));
    expect(plain.advice?.deepen?.chunks.length).toBeGreaterThan(0);
    const deepened = await review(new DeepenProvider([extra({})]), (c) => {
      c.review.deepen = true;
    });
    expect(deepened.advice).toBeUndefined();
  });

  it('a re-run with --deepen pays only for the second pass', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'cr-deepen-cache-'));
    const saved = process.env.CODE_REVIEWER_CACHE_DIR;
    process.env.CODE_REVIEWER_CACHE_DIR = cacheDir;
    try {
      const cached = (c: Config) => {
        c.cache.enabled = true;
      };
      const first = new DeepenProvider([extra({})]);
      await review(first, cached);
      expect(first.tasks.some((t) => t.label.endsWith('-deepen'))).toBe(false);

      const again = new DeepenProvider([extra({})]);
      const run = await review(again, (c) => {
        cached(c);
        c.review.deepen = true;
      });
      // the first pass from the cache: the model only takes the second pass
      expect(again.tasks.length).toBeGreaterThan(0);
      expect(again.tasks.every((t) => t.label.endsWith('-deepen'))).toBe(true);
      expect(run.findings.map((f) => f.title)).toContain('Result exported before validation');
      // second passes are not counted as cached chunks
      expect(run.cache).toMatchObject({ hits: run.chunks.length, misses: 0 });

      const third = new DeepenProvider([extra({})]);
      const run3 = await review(third, (c) => {
        cached(c);
        c.review.deepen = true;
      });
      expect(third.tasks).toEqual([]);
      expect(run3.findings.map((f) => f.title).sort()).toEqual(run.findings.map((f) => f.title).sort());
    } finally {
      process.env.CODE_REVIEWER_CACHE_DIR = saved;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  const chunk = (id: string, findings: number, amount?: number): ChunkRecord =>
    ({
      id,
      files: [`${id}.ts`],
      tokens: 10,
      skills: [],
      status: 'done',
      findings,
      ...(amount === undefined ? {} : { cost: { amount, currency: 'USD' } }),
    }) as ChunkRecord;
  const run = (chunks: ChunkRecord[]) => ({ status: 'completed', chunks }) as unknown as RunRecord;

  it('estimates the second pass over every reviewed chunk, after a run with findings', () => {
    const advice = deepenAdvice(run([chunk('c1', 2, 0.3), chunk('c2', 0, 0.5), chunk('c3', 1, 0.1)]), false);
    expect(advice?.chunks).toEqual(['c1', 'c2', 'c3']);
    expect(advice?.estimatedCost?.amount).toBeCloseTo(0.9 * DEEPEN_COST_FACTOR);
    // a chunk answered from the cache has no cost: no estimate rather than a wrong one
    expect(deepenAdvice(run([chunk('c1', 1, 0.3), chunk('c2', 1)]), false)?.estimatedCost).toBeUndefined();
    expect(deepenAdvice(run([chunk('c1', 0, 0.3)]), false)).toBeUndefined();
    expect(deepenAdvice(run([chunk('c1', 1, 0.3)]), true)).toBeUndefined();
  });

  it('says what a second pass covers, costs and reuses', () => {
    const advice = { deepen: { chunks: ['c1', 'c3'], estimatedCost: { amount: 0.44, currency: 'USD' } } };
    const text = deepenAdviceText({ advice })!;
    expect(text).toMatch(/re-run with --deepen for an independent second pass over the 2 chunks/);
    expect(text).toMatch(/\(about \$0\.44\d* more\)\.$/);
    expect(deepenAdviceText({ advice, cache: { hits: 0, misses: 2 } as never })).toContain(
      'the first pass comes from the cache',
    );
    expect(deepenAdviceText({})).toBeUndefined();
  });
});
