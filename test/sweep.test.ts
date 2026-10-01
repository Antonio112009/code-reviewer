import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../src/config/schema';
import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/registry';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import { stagesLabel } from '../src/report/common';
import { runReview } from '../src/review/pipeline';
import { reportedLines, SWEEP_SOURCE, sweepParts } from '../src/review/sweep';
import type { Chunk, Finding, ReportedFinding } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;

beforeAll(() => {
  repo = makeRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
  repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    // the mock reports BUG lines: a.ts has a finding, b.ts none
    'src/a.ts': 'export const a = 1;\nexport const x = a / 0; // BUG(major): division by zero\n',
    'src/b.ts': 'export const b = 2;\nexport const y = b + 1;\n',
  });
  repo.commit('feature');
  repo.git('checkout', '-q', 'main');
});

afterAll(() => repo.cleanup());

const extra = (over: Partial<ReportedFinding>): ReportedFinding => ({
  file: 'src/b.ts',
  startLine: 2,
  endLine: 2,
  severity: 'major',
  category: 'bug',
  title: 'y is computed from the old b',
  description: 'The exported value is computed at import time from a constant that callers expect to change.',
  failurePath: 'b updated → y still holds the old sum → stale value exported',
  confidence: 0.7,
  ...over,
});

/** The mock provider, except that a sweep task (`sweep-*`) gets `more` added to its answer. */
class SweepProvider implements Provider {
  readonly id = 'mock';
  readonly kind = 'mock' as const;
  readonly tasks: AgentTask[] = [];
  private readonly mock = new MockProvider('mock');

  constructor(private readonly more: ReportedFinding[] | Error) {}

  async run(task: AgentTask): Promise<AgentResult> {
    this.tasks.push(task);
    const result = await this.mock.run(task);
    if (!task.label.startsWith('sweep-')) return result;
    if (this.more instanceof Error) throw this.more;
    return {
      ...result,
      submission: { ...result.submission, findings: [...(result.submission.findings ?? []), ...this.more] },
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

const sweepOn = (c: Config) => {
  c.review.sweep = true;
};

describe('sweep over the whole change (review.sweep)', () => {
  it('reads every chunk in one call without tools, told what the chunks reported', async () => {
    const provider = new SweepProvider([extra({})]);
    const run = await review(provider, sweepOn);
    const sweeps = provider.tasks.filter((t) => t.label.startsWith('sweep-'));
    expect(sweeps).toHaveLength(1);
    const sweep = sweeps[0]!;
    expect(sweep.readTools).toBe(false);
    expect(sweep.maxSteps).toBe(3);
    // the code of every changed file, and the chunk reviews' finding as already reported
    expect(sweep.prompt).toContain('## File: src/a.ts');
    expect(sweep.prompt).toContain('## File: src/b.ts');
    expect(sweep.prompt).toMatch(/## Already reported \(do not repeat\)\n- src\/a\.ts:2 — division by zero/);
    expect(sweep.instructions).toContain('Already reported');

    // the mock repeats "division by zero": merged with the chunk's; the new defect comes from the sweep alone
    const byTitle = new Map(run.findings.map((f) => [f.title, f]));
    expect([...byTitle.keys()].sort()).toEqual(['division by zero', 'y is computed from the old b']);
    expect(byTitle.get('y is computed from the old b')!.source.chunkIds).toEqual([SWEEP_SOURCE]);
    expect(byTitle.get('division by zero')!.source.chunkIds).toContain(SWEEP_SOURCE);
    expect(run.sweep).toEqual({ parts: 1, failed: 0, findings: 2 });
    expect(run.options.sweep).toBe(true);
    expect(stagesLabel(run)).toContain('whole-change sweep (--sweep)');
  });

  it('hands what it found to the critic like any other finding', async () => {
    const provider = new SweepProvider([
      extra({}),
      extra({ startLine: 1, endLine: 1, title: 'A false positive' }),
    ]);
    const run = await review(provider, (c) => {
      sweepOn(c);
      c.review.selfCritique = true;
    });
    // the mock critic rejects titles with "false positive"
    expect(run.findings.map((f) => f.title).sort()).toEqual([
      'division by zero',
      'y is computed from the old b',
    ]);
    const rejected = run.rejected.find((f) => f.title === 'A false positive');
    expect(rejected?.critique?.verdict).toBe('rejected');
    expect(rejected?.source.chunkIds).toEqual([SWEEP_SOURCE]);
  });

  it('leaves the chunk reviews standing when it fails', async () => {
    const run = await review(new SweepProvider(new Error('agent crashed')), sweepOn);
    expect(run.status).toBe('completed');
    expect(run.findings.map((f) => f.title)).toEqual(['division by zero']);
    expect(run.sweep).toEqual({ parts: 1, failed: 1, findings: 0 });
    expect(run.warnings.some((w) => w.startsWith('sweep-1 failed (agent crashed)'))).toBe(true);
  });

  it('is off by default', async () => {
    const provider = new SweepProvider([extra({})]);
    const run = await review(provider);
    expect(provider.tasks.some((t) => t.label.startsWith('sweep-'))).toBe(false);
    expect(run.sweep).toBeUndefined();
    expect(run.findings.map((f) => f.title)).toEqual(['division by zero']);
  });
});

describe('sweep parts', () => {
  const chunk = (id: string, text: string, pass?: 'local' | 'contracts'): Chunk =>
    ({
      id,
      index: 0,
      files: [`${id}.ts`],
      parts: [{ role: 'review', text }],
      tokens: 0,
      mentions: [],
      ...(pass ? { pass } : {}),
    }) as unknown as Chunk;

  it('reads each chunk once, a focused pass copy included, in parts that fit', () => {
    const big = 'x '.repeat(400);
    const chunks = [chunk('c1', big), chunk('c1-local', big, 'local'), chunk('c2', big), chunk('c3', big)];
    expect(sweepParts(chunks, 1_000_000).map((p) => p.map((c) => c.id))).toEqual([['c1', 'c2', 'c3']]);
    expect(sweepParts(chunks, 500).map((p) => p.map((c) => c.id))).toEqual([['c1'], ['c2'], ['c3']]);
  });

  it('lists the reported findings of the part, one line each', () => {
    const f = (file: string, startLine: number, endLine: number, title: string) =>
      ({ file, startLine, endLine, title }) as Finding;
    expect(
      reportedLines(
        [f('a.ts', 3, 3, 'Off  by\none'), f('b.ts', 4, 9, 'Leak'), f('c.ts', 1, 1, 'Other')],
        new Set(['a.ts', 'b.ts']),
      ),
    ).toEqual(['- a.ts:3 — Off by one', '- b.ts:4-9 — Leak']);
  });
});
