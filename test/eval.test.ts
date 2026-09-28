import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/index';
import { CaseError, casePathProblem, filterCases, lineCount, loadCases, parseCase } from '../src/eval/cases';
import { compareResults } from '../src/eval/compare';
import {
  aggregateMetrics,
  erroredRun,
  matchFindings,
  normalizePath,
  scoreRun,
  sumMetrics,
  withRatios,
} from '../src/eval/metrics';
import { materializeCase } from '../src/eval/repo';
import { evalRunConfig, runEval } from '../src/eval/runner';
import { loadEvalResult, saveEvalResult } from '../src/eval/store';
import type { CaseResult, EvalCase, EvalResult, ExpectedDefect } from '../src/eval/types';
import type { Finding, Severity } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

function finding(
  file: string,
  startLine: number,
  endLine = startLine,
  extra: Partial<Finding> = {},
): Finding {
  return {
    id: `f-${file}-${startLine}-${extra.title ?? ''}`,
    file,
    startLine,
    endLine,
    severity: 'major',
    category: 'bug',
    title: `finding at ${startLine}`,
    description: 'a description of the defect',
    confidence: 0.8,
    skills: [],
    source: { chunkIds: ['c001'], provider: 'mock' },
    ...extra,
  };
}

function defect(file: string, startLine: number, endLine = startLine, severity?: Severity): ExpectedDefect {
  return { file, startLine, endLine, ...(severity ? { severity } : {}) };
}

function run(findings: Finding[], rejected: Finding[] = []) {
  return {
    status: 'completed' as const,
    findings,
    rejected,
    chunks: [
      { id: 'c001', files: [], tokens: 10, skills: [], status: 'done' as const, findings: findings.length },
    ],
    usage: { inputTokens: 1000, outputTokens: 100 },
  };
}

describe('matchFindings', () => {
  it('matches the same file within the tolerance and normalises paths', () => {
    const expected = [defect('src/a.ts', 10, 12)];
    expect(matchFindings(expected, [finding('./src/a.ts', 15)], 3).matched).toEqual([
      { defect: 0, finding: 0 },
    ]);
    expect(matchFindings(expected, [finding('src/a.ts', 16)], 3).unmatched).toEqual([0]);
    expect(matchFindings(expected, [finding('src/a.ts', 5, 6)], 3).unmatched).toEqual([0]);
    expect(matchFindings(expected, [finding('src/a.ts', 7)], 3).matched).toHaveLength(1);
    expect(matchFindings(expected, [finding('src/a.ts', 16)], 4).matched).toHaveLength(1);
    expect(matchFindings(expected, [finding('src/b.ts', 11)], 3).unmatched).toEqual([0]);
    expect(normalizePath('.\\src\\x/../a.ts')).toBe('src/a.ts');
  });

  it('gives each defect its best finding and counts the rest as duplicates', () => {
    const expected = [defect('a.js', 10)];
    const r = matchFindings(expected, [finding('a.js', 12), finding('a.js', 10), finding('a.js', 9, 11)], 3);
    expect(r.matched).toEqual([{ defect: 0, finding: 1 }]);
    expect(r.duplicates.map((d) => d.finding).sort()).toEqual([0, 2]);
    expect(r.unmatched).toEqual([]);
  });

  it('also matches the alternative ranges of a defect', () => {
    const expected = [{ ...defect('run.sh', 16), also: [{ startLine: 2, endLine: 2 }] }];
    expect(matchFindings(expected, [finding('run.sh', 2)], 3).matched).toHaveLength(1);
    expect(matchFindings(expected, [finding('run.sh', 9)], 3).unmatched).toEqual([0]);
    // the closer range decides between two defects
    const two = [expected[0]!, defect('run.sh', 6)];
    expect(matchFindings(two, [finding('run.sh', 3)], 3).matched).toEqual([{ defect: 0, finding: 0 }]);
  });

  it('matches an `also` range in another file (the caller that crashes)', () => {
    const expected = [
      { ...defect('Batches.java', 15), also: [{ file: 'ReminderJob.java', startLine: 27, endLine: 33 }] },
    ];
    expect(matchFindings(expected, [finding('ReminderJob.java', 29, 31)], 3).matched).toHaveLength(1);
    // lines of the other file do not count in the defect's own file, and vice versa
    expect(matchFindings(expected, [finding('Batches.java', 29)], 3).unmatched).toEqual([0]);
    expect(matchFindings(expected, [finding('ReminderJob.java', 15)], 3).unmatched).toEqual([0]);
  });

  it('assigns one finding to one defect even when it spans two', () => {
    const expected = [defect('a.js', 10), defect('a.js', 14)];
    const wide = matchFindings(expected, [finding('a.js', 10, 14)], 3);
    expect(wide.matched).toHaveLength(1);
    const both = matchFindings(expected, [finding('a.js', 10, 14), finding('a.js', 14)], 3);
    // the exact finding takes line 14, the wide one the remaining defect
    expect(both.matched).toEqual([
      { defect: 0, finding: 0 },
      { defect: 1, finding: 1 },
    ]);
  });
});

describe('scoreRun', () => {
  it('counts found, missed, unexpected, duplicates and underrated findings', () => {
    const expected = [defect('a.js', 10, 10, 'critical'), defect('a.js', 40)];
    const s = scoreRun(expected, run([finding('a.js', 10), finding('a.js', 11), finding('a.js', 80)]));
    expect(s.metrics).toMatchObject({
      expected: 2,
      found: 1,
      missed: 1,
      unexpected: 1,
      falsePositives: 0,
      duplicates: 1,
      underrated: 1,
      recall: 0.5,
      precision: 0.5,
      inputTokens: 1000,
      outputTokens: 100,
      chunks: 1,
    });
    expect(s.missed).toEqual([1]);
    expect(s.matched[0]).toMatchObject({ defect: 0, underrated: true });
    expect(s.unexpected.map((f) => f.startLine)).toEqual([80]);
  });

  it('treats every finding on a clean case as a false positive', () => {
    const s = scoreRun([], run([finding('a.js', 3), finding('a.js', 3, 3, { title: 'again' })]));
    expect(s.metrics).toMatchObject({
      falsePositives: 2,
      unexpected: 0,
      precision: 0,
      recall: null,
      f1: null,
    });
    expect(scoreRun([], run([])).metrics).toMatchObject({ precision: null, recall: null });
  });

  it('measures what self-critique and the thresholds removed', () => {
    const expected = [defect('a.js', 10), defect('a.js', 30), defect('a.js', 50)];
    const removed = [
      finding('a.js', 30, 30, { droppedReason: 'critique' }),
      finding('a.js', 31, 31, { droppedReason: 'below-threshold' }), // a would-be duplicate
      finding('a.js', 70, 70, { droppedReason: 'critique' }), // noise kept out of the report
      finding('a.js', 50, 50, { droppedReason: 'outside-changed-lines' }), // validation, not a filter
      finding('b.js', 1, 1, { droppedReason: 'below-severity' }),
    ];
    const s = scoreRun(expected, run([finding('a.js', 10)], removed));
    expect(s.lost.map((l) => [l.defect, l.finding.droppedReason])).toEqual([[1, 'critique']]);
    expect(s.saved.map((f) => `${f.file}:${f.startLine}`)).toEqual(['a.js:70', 'b.js:1']);
    expect(s.metrics).toMatchObject({ found: 1, lost: 1, saved: 2, recall: 1 / 3, precision: 1 });
    expect(s.metrics.rawRecall).toBeCloseTo(2 / 3);
    expect(s.metrics.rawPrecision).toBeCloseTo(2 / 4);
  });

  it('an errored run misses every defect', () => {
    expect(erroredRun([defect('a', 1), defect('a', 9)]).metrics).toMatchObject({
      errors: 1,
      missed: 2,
      found: 0,
      recall: 0,
      f1: 0,
      precision: null,
    });
  });
});

describe('metrics', () => {
  it('sums counts and recomputes the ratios', () => {
    const a = scoreRun([defect('a', 1)], run([finding('a', 1)])).metrics;
    const b = scoreRun([defect('a', 1), defect('a', 20)], run([finding('a', 50)])).metrics;
    const total = sumMetrics([a, b]);
    expect(total).toMatchObject({ runs: 2, expected: 3, found: 1, unexpected: 1 });
    expect(total.recall).toBeCloseTo(1 / 3);
    expect(total.precision).toBeCloseTo(1 / 2);
    expect(total.f1).toBeCloseTo((2 * (1 / 3) * (1 / 2)) / (1 / 3 + 1 / 2));
    expect(withRatios({ ...total, found: 0 }).f1).toBe(0);
  });

  it('aggregates passes of a repeated eval with the recall spread', () => {
    const c: CaseResult = {
      id: 'x',
      title: 'x',
      tags: [],
      clean: false,
      source: 'inline',
      defects: [],
      runs: [1, 2, 3].map((repeat) => ({
        repeat,
        status: 'completed' as const,
        ...scoreRun([defect('a', 1), defect('a', 20)], run(repeat === 2 ? [] : [finding('a', 1)])),
      })),
      metrics: withRatios({ ...erroredRun([]).metrics, errors: 0 }),
    };
    const clean: CaseResult = {
      ...c,
      id: 'clean',
      clean: true,
      runs: [1, 2, 3].map((repeat) => ({
        repeat,
        status: 'completed' as const,
        ...scoreRun([], run(repeat === 3 ? [finding('a', 1)] : [])),
      })),
    };
    const agg = aggregateMetrics([c, clean], 3);
    expect(agg.passes.map((p) => p.recall)).toEqual([0.5, 0, 0.5]);
    expect(agg).toMatchObject({ recallMin: 0, recallMax: 0.5, cleanRuns: 3, flaggedCleanRuns: 1, cases: 2 });
    expect(agg.recall).toBeCloseTo(1 / 3);
  });
});

const INLINE = `title: Unparameterised lookup
tags: [javascript, security]
base:
  src/db.js: |
    export const one = 1;
head:
  src/db.js: |
    export const one = 1;
    export const two = 2;
expect:
  - file: src/db.js
    lines: [1, 2]
    severity: major
    note: something
`;

describe('case files', () => {
  const parse = (text: string) => parseCase(text, { id: 'x', file: '/corpus/x.yaml' });

  it('parses an inline case', () => {
    const c = parse(INLINE);
    expect(c).toMatchObject({ id: 'x', title: 'Unparameterised lookup', tags: ['javascript', 'security'] });
    expect(c.expect).toEqual([
      { file: 'src/db.js', startLine: 1, endLine: 2, severity: 'major', note: 'something' },
    ]);
    expect(c.source.kind).toBe('inline');
    expect(parse(INLINE.replace('lines: [1, 2]', 'lines: 2')).expect[0]).toMatchObject({
      startLine: 2,
      endLine: 2,
    });
    expect(parse(INLINE.replace('lines: [1, 2]', 'lines: 2\n    also: [1, [1, 2]]')).expect[0]!.also).toEqual(
      [
        { startLine: 1, endLine: 1 },
        { startLine: 1, endLine: 2 },
      ],
    );
  });

  it('parses a real-repository case', () => {
    const sha = 'a'.repeat(40);
    const c = parse(
      `title: Real one\nrepo: ../repos/app\nbaseRef: ${sha}\nheadRef: ${'b'.repeat(40)}\nexpect: []\n`,
    );
    expect(c.source).toEqual({
      kind: 'repo',
      repo: path.resolve('/repos/app'),
      baseRef: sha,
      headRef: 'b'.repeat(40),
    });
    expect(
      parse(
        `title: Real one\nrepo: https://example.com/a.git\nbaseRef: ${sha}\nheadRef: ${'c'.repeat(40)}\nexpect: []\n`,
      ).source,
    ).toMatchObject({ repo: 'https://example.com/a.git' });
  });

  it.each([
    ['no expect', INLINE.replace(/expect:[\s\S]*$/, ''), /expect/],
    ['unknown key', `${INLINE}extra: 1\n`, /extra/],
    [
      'lines outside the file',
      INLINE.replace('lines: [1, 2]', 'lines: [2, 3]'),
      /outside src\/db\.js \(2 lines\)/,
    ],
    ['reversed lines', INLINE.replace('lines: [1, 2]', 'lines: [2, 1]'), /ends before it starts/],
    [
      'also outside the file',
      INLINE.replace('lines: [1, 2]', 'lines: 1\n    also: [[2, 9]]'),
      /lines 2-9 are outside/,
    ],
    ['expected file missing', INLINE.replace('- file: src/db.js', '- file: src/other.js'), /does not exist/],
    [
      'traversal',
      INLINE.replace(
        '  src/db.js: |\n    export const one = 1;\n    export',
        '  ../x.js: |\n    export const one = 1;\n    export',
      ),
      /canonical/,
    ],
    [
      'review config',
      INLINE.replace('head:\n  src/db.js', 'head:\n  .code-reviewer/config.yaml'),
      /\.code-reviewer/,
    ],
    ['no change', INLINE.replace('    export const two = 2;\n', ''), /does not change/],
    ['both kinds', `${INLINE}repo: https://example.com/x.git\n`, /either/],
    [
      'bad sha',
      `title: x y\nrepo: /r\nbaseRef: main\nheadRef: ${'a'.repeat(40)}\nexpect: []\n`,
      /full commit sha/,
    ],
    [
      'ssh url',
      `title: x y\nrepo: git@github.com:a/b.git\nbaseRef: ${'a'.repeat(40)}\nheadRef: ${'b'.repeat(40)}\nexpect: []\n`,
      /https/,
    ],
    [
      'ext transport',
      `title: x y\nrepo: "ext::sh -c touch% /tmp/x"\nbaseRef: ${'a'.repeat(40)}\nheadRef: ${'b'.repeat(40)}\nexpect: []\n`,
      /https/,
    ],
    [
      'credentials',
      `title: x y\nrepo: https://u:p@example.com/x.git\nbaseRef: ${'a'.repeat(40)}\nheadRef: ${'b'.repeat(40)}\nexpect: []\n`,
      /credentials/,
    ],
    ['bad yaml', 'title: [', /invalid YAML/],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parse(text)).toThrow(CaseError);
    expect(() => parse(text)).toThrow(message);
  });

  it('checks paths and counts lines', () => {
    expect(casePathProblem('src/a.js')).toBeUndefined();
    for (const bad of [
      '/etc/passwd',
      'a/../b',
      './a',
      'a//b',
      '.git/config',
      'x/.git/hooks/pre-commit',
      'C:/x',
      'a\\b',
    ]) {
      expect(casePathProblem(bad), bad).toBeDefined();
    }
    expect(lineCount('')).toBe(0);
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('a\nb')).toBe(2);
  });

  it('loads a directory with ids relative to it, and filters by tag, glob and prefix', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cr-eval-cases-'));
    try {
      mkdirSync(path.join(dir, 'js', 'deep'), { recursive: true });
      writeFileSync(path.join(dir, 'js', 'a.yaml'), INLINE);
      writeFileSync(path.join(dir, 'js', 'deep', 'b.yml'), INLINE.replace('security', 'react'));
      writeFileSync(path.join(dir, 'js', 'notes.md'), '# not a case');
      const cases = await loadCases([dir], '/');
      expect(cases.map((c) => c.id)).toEqual(['js/a', 'js/deep/b']);
      expect((await loadCases(['js/a.yaml'], dir)).map((c) => c.id)).toEqual(['a']);
      expect(filterCases(cases, ['react']).map((c) => c.id)).toEqual(['js/deep/b']);
      expect(filterCases(cases, ['js/deep']).map((c) => c.id)).toEqual(['js/deep/b']);
      expect(filterCases(cases, ['**/a', 'nothing']).map((c) => c.id)).toEqual(['js/a']);
      expect(filterCases(cases, []).length).toBe(2);
      // `!` excludes: by tag, and on its own it starts from every case
      expect(filterCases(cases, ['js', '!react']).map((c) => c.id)).toEqual(['js/a']);
      expect(filterCases(cases, ['!react']).map((c) => c.id)).toEqual(['js/a']);
      await expect(loadCases([path.join(dir, 'missing')], '/')).rejects.toThrow(/no such file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('compareResults', () => {
  const result = (id: string, cases: CaseResult[]): EvalResult =>
    ({
      schemaVersion: 1,
      id,
      createdAt: '2026-09-01T10:00:00.000Z',
      cases,
      aggregate: aggregateMetrics(cases, 1),
    }) as EvalResult;
  const caseOf = (id: string, expected: ExpectedDefect[], findings: Finding[]): CaseResult => {
    const scored = scoreRun(expected, run(findings));
    const runs = [{ repeat: 1, status: 'completed' as const, ...scored }];
    return {
      id,
      title: id,
      tags: [],
      clean: expected.length === 0,
      source: 'inline',
      defects: expected.map((d, i) => ({
        ...d,
        found: scored.matched.some((m) => m.defect === i) ? 1 : 0,
        lost: 0,
      })),
      runs,
      metrics: sumMetrics([scored.metrics]),
    };
  };

  it('reports deltas over the common cases and the defects that changed', () => {
    const before = result('old', [
      caseOf('a', [defect('x.js', 1), defect('x.js', 20)], [finding('x.js', 1)]),
      caseOf('clean', [], [finding('y.js', 3)]),
      caseOf('gone', [defect('z.js', 1)], []),
    ]);
    const after = result('new', [
      caseOf('a', [defect('x.js', 1), defect('x.js', 20)], [finding('x.js', 20)]),
      caseOf('clean', [], []),
      caseOf('new', [defect('z.js', 1)], []),
    ]);
    const cmp = compareResults(before, after, '/evals/old/result.json');
    expect(cmp).toMatchObject({ common: 2, added: ['new'], removed: ['gone'], against: { id: 'old' } });
    expect(cmp.recall).toEqual({ before: 0.5, after: 0.5, delta: 0 });
    expect(cmp.precision).toEqual({ before: 0.5, after: 1, delta: 0.5 });
    expect(cmp.falsePositives).toEqual({ before: 1, after: 0, delta: -1 });
    expect(cmp.cases.map((c) => c.id)).toEqual(['a', 'clean']);
    expect(cmp.cases[0]!.defects).toEqual([
      { key: 'x.js:1', before: 1, after: 0 },
      { key: 'x.js:20', before: 0, after: 1 },
    ]);
    expect(cmp.cost).toEqual({ before: null, after: null, delta: null });
  });

  it('scores the known cost of a run and compares it with results written before cost existed', () => {
    const priced = {
      ...run([]),
      cost: { amount: 0.25, currency: 'USD', basis: ['priced' as const], unknownTasks: 1, unpriced: ['x'] },
    };
    const scored = scoreRun([defect('x.js', 1)], priced);
    expect(scored.metrics).toMatchObject({ cost: 0.25, unpricedCalls: 1, cachedInputTokens: 0 });
    // agents such as Claude Code serve most input from the prompt cache: it counts as tokens too
    const cachedRun = {
      ...run([]),
      usage: { inputTokens: 14, outputTokens: 2_000, cachedInputTokens: 160_000 },
    };
    expect(scoreRun([defect('x.js', 1)], cachedRun).metrics).toMatchObject({
      inputTokens: 14,
      cachedInputTokens: 160_000,
    });

    const withCost: CaseResult = { ...caseOf('a', [defect('x.js', 1)], []), metrics: scored.metrics };
    // an older result.json has no cost fields
    const old = caseOf('a', [defect('x.js', 1)], []);
    const { cost: _cost, unpricedCalls: _unpriced, cachedInputTokens: _cached, ...legacy } = old.metrics;
    const before = result('old', [{ ...old, metrics: legacy as typeof old.metrics }]);
    expect(sumMetrics([legacy as typeof old.metrics, scored.metrics]).cost).toBe(0.25);
    const cmp = compareResults(before, result('new', [withCost]), '/evals/old/result.json');
    expect(cmp.cost).toEqual({ before: null, after: 0.25, delta: null });
  });
});

// ---------------------------------------------------------------------------------------------------
// End to end with the mock provider (reports `BUG:` marker lines; its critic rejects "false positive")
// ---------------------------------------------------------------------------------------------------

const LABELLED = `title: Averages
tags: [javascript]
base:
  src/math.js: |
    export function sum(xs) {
      return xs.reduce((a, b) => a + b, 0);
    }
head:
  src/math.js: |
    export function sum(xs) {
      return xs.reduce((a, b) => a + b, 0);
    }

    export function average(xs) {
      let total = 0;
      for (let i = 0; i <= xs.length; i++) total += xs[i]; // BUG(major): off-by-one reads past the end
      return total / xs.length;
    }

    export function first(xs) {
      return xs[1]; // BUG(major): false positive about the index
    }

    export function median(xs) {
      const sorted = xs.sort();
      return sorted[sorted.length / 2];
    }

    export function last(xs) {
      return xs[xs.length]; // BUG(major): reads one past the end
    }
expect:
  - file: src/math.js
    lines: 7
  - file: src/math.js
    lines: 12
  - file: src/math.js
    lines: [16, 17]
    note: sorts in place and indexes with a fraction
`;

const CLEAN = `title: Rename
tags: [python, clean]
base:
  app/util.py: |
    def total(items):
        return sum(items)
head:
  app/util.py: |
    def total_of(items):
        return sum(items)  # BUG(major): a false positive on a clean change


    def count(items):
        return len(items)  # BUG(major): noise on a clean change
expect: []
`;

const MISSED = `title: Nothing reported
tags: [go]
base:
  main.go: |
    package main
head:
  main.go: |
    package main

    func main() {}
expect:
  - file: main.go
    lines: 3
`;

describe('runEval (mock provider)', () => {
  let corpus: string;
  let work: string;
  let cases: EvalCase[];
  let result: EvalResult;

  beforeAll(async () => {
    corpus = mkdtempSync(path.join(tmpdir(), 'cr-eval-corpus-'));
    work = mkdtempSync(path.join(tmpdir(), 'cr-eval-work-'));
    mkdirSync(path.join(corpus, 'js'));
    writeFileSync(path.join(corpus, 'js', 'labelled.yaml'), LABELLED);
    writeFileSync(path.join(corpus, 'clean.yaml'), CLEAN);
    writeFileSync(path.join(corpus, 'missed.yaml'), MISSED);
    cases = await loadCases([corpus], '/');
    result = await runEval({
      cases,
      config: testConfig(),
      logger: silentLogger,
      id: 'e1',
      dir: path.join(work, 'e1'),
    });
  });

  afterAll(() => {
    rmSync(corpus, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  it('scores every case', () => {
    expect(result.status).toBe('completed');
    const byId = Object.fromEntries(result.cases.map((c) => [c.id, c]));
    expect(byId['js/labelled']!.metrics).toMatchObject({
      expected: 3,
      found: 1,
      missed: 2,
      unexpected: 1,
      lost: 1,
    });
    expect(byId['js/labelled']!.defects.map((d) => [d.startLine, d.found, d.lost])).toEqual([
      [7, 1, 0],
      [12, 0, 1],
      [16, 0, 0],
    ]);
    expect(byId['js/labelled']!.runs[0]!.unexpected.map((f) => f.title)).toEqual(['reads one past the end']);
    expect(byId.clean!.metrics).toMatchObject({ falsePositives: 1, saved: 1, unexpected: 0 });
    expect(byId.missed!.metrics).toMatchObject({ expected: 1, found: 0, precision: null });
  });

  it('aggregates recall, precision and the self-critique effect', () => {
    const agg = result.aggregate;
    expect(agg).toMatchObject({
      cases: 3,
      cleanCases: 1,
      expected: 4,
      found: 1,
      unexpected: 1,
      falsePositives: 1,
      lost: 1,
      saved: 1,
      errors: 0,
      flaggedCleanRuns: 1,
    });
    expect(agg.recall).toBeCloseTo(0.25);
    expect(agg.precision).toBeCloseTo(1 / 3);
    expect(agg.rawRecall).toBeCloseTo(0.5);
    expect(agg.rawPrecision).toBeCloseTo(0.4);
    expect(agg.inputTokens).toBeGreaterThan(0);
    expect(result.settings).toMatchObject({
      tolerance: 3,
      repeat: 1,
      depth: 'full',
      routing: { review: { provider: 'mock' } },
    });
  });

  it('keeps review runs inside the eval directory and removes the temporary repositories', () => {
    for (const c of result.cases) {
      const r = c.runs[0]!;
      expect(r.runDir!.startsWith(path.join(work, 'e1', 'runs'))).toBe(true);
      expect(existsSync(path.join(r.runDir!, 'run.json'))).toBe(true);
      expect(c.repoDir).toBeUndefined();
    }
    const run = JSON.parse(readFileSync(path.join(result.cases[0]!.runs[0]!.runDir!, 'run.json'), 'utf8'));
    expect(run.target).toMatchObject({ base: 'main' });
    expect(existsSync(run.repo.root)).toBe(false);
  });

  it('repeats cases and keeps repositories on request', async () => {
    const repeated = await runEval({
      cases: cases.filter((c) => c.id === 'missed'),
      config: testConfig(),
      logger: silentLogger,
      id: 'e2',
      dir: path.join(work, 'e2'),
      repeat: 2,
      keep: true,
      skipPreflight: true,
    });
    const [c] = repeated.cases;
    expect(c!.runs.map((r) => r.repeat)).toEqual([1, 2]);
    expect(repeated.aggregate.passes).toHaveLength(2);
    expect(c!.defects[0]).toMatchObject({ found: 0 });
    expect(existsSync(path.join(c!.repoDir!, 'main.go'))).toBe(true);
    rmSync(path.dirname(c!.repoDir!), { recursive: true, force: true });
  });

  it('stops starting cases once interrupted', async () => {
    const controller = new AbortController();
    controller.abort();
    const interrupted = await runEval({
      cases,
      config: testConfig(),
      logger: silentLogger,
      id: 'e3',
      dir: path.join(work, 'e3'),
      signal: controller.signal,
      skipPreflight: true,
    });
    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.cases).toEqual([]);
  });

  it('overrides the project settings and opt-in analyzers of the effective configuration', () => {
    const config = evalRunConfig(
      testConfig((c) => {
        c.project = { name: 'mine', focus: ['security'] };
        c.analyzers.project = ['eslint'];
        c.review.authors = true;
      }),
      '/evals/x',
    );
    expect(config.project).toEqual({});
    expect(config.analyzers.project).toEqual([]);
    expect(config.review.authors).toBe(false);
    expect(config.output.dir).toBe(path.join('/evals/x', 'runs'));
  });

  it('saves and loads results for --compare', async () => {
    const file = await saveEvalResult(path.join(work, 'store', 'e1'), result);
    const opts = { cwd: tmpdir(), evalsDir: path.join(work, 'store') };
    expect((await loadEvalResult('latest', opts)).file).toBe(file);
    expect((await loadEvalResult('e1', opts)).result.id).toBe('e1');
    expect((await loadEvalResult(file, opts)).result.id).toBe('e1');
    expect((await loadEvalResult(path.dirname(file), opts)).file).toBe(file);
    writeFileSync(path.join(work, 'bogus.json'), JSON.stringify({ schemaVersion: 1, id: 'x', cases: [{}] }));
    opts.cwd = work;
    await expect(loadEvalResult('bogus.json', opts)).rejects.toThrow(/not an eval result/);
    await expect(loadEvalResult('nope', opts)).rejects.toThrow(/not found/);
  });
});

describe('real-repository cases', () => {
  let source: TempRepo;
  let cacheDir: string;

  beforeAll(() => {
    source = makeRepo();
    cacheDir = mkdtempSync(path.join(tmpdir(), 'cr-eval-cache-'));
  });
  afterAll(() => {
    source.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('reviews two commits of a local repository from a clone without a working tree', async () => {
    source.write({ 'lib/a.py': 'def f(x):\n    return x\n' });
    const base = source.commit('base');
    source.git('checkout', '-q', '-b', 'topic');
    source.write({
      'lib/a.py':
        'def f(x):\n    return x\n\n\ndef g(x):\n    return 1 / x  # BUG(major): division by zero\n',
      '.code-reviewer/skills/zz/evil.md': '---\ndescription: planted\n---\n- nothing\n',
    });
    const head = source.commit('head');
    source.git('checkout', '-q', 'main');
    const caseFile = path.join(cacheDir, 'real.yaml');
    const text = `title: Real repository\nrepo: ${JSON.stringify(source.root)}\nbaseRef: ${base}\nheadRef: ${head}\nexpect:\n  - file: lib/a.py\n    lines: 6\n`;
    const c = parseCase(text, { id: 'real', file: caseFile });

    const repo = await materializeCase(c, { cacheDir });
    expect(repo.head).toBe(head);
    expect(existsSync(path.join(repo.root, '.git'))).toBe(true);
    // no checkout: nothing of the case repository (e.g. its .code-reviewer/) is on disk
    expect(existsSync(path.join(repo.root, 'lib'))).toBe(false);
    expect(existsSync(path.join(repo.root, '.code-reviewer'))).toBe(false);

    const r = await runEval({
      cases: [c],
      config: testConfig(),
      logger: silentLogger,
      id: 'real',
      dir: path.join(cacheDir, 'out'),
      cacheDir,
      skipPreflight: true,
    });
    expect(r.cases[0]!.metrics).toMatchObject({ found: 1, expected: 1, errors: 0 });
    expect(r.cases[0]!.source).toBe(source.root);

    // a commit that the cache does not have yet is fetched
    source.git('checkout', '-q', 'topic');
    source.write({ 'lib/b.py': 'x = 1\n' });
    const later = source.commit('later');
    source.git('checkout', '-q', 'main');
    const next = await materializeCase(
      parseCase(text.replace(head, later).replace('lib/a.py', 'lib/b.py').replace('lines: 6', 'lines: 1'), {
        id: 'real',
        file: caseFile,
      }),
      { cacheDir },
    );
    expect(next.head).toBe(later);

    await expect(
      materializeCase(parseCase(text.replace('lines: 6', 'lines: 60'), { id: 'real', file: caseFile }), {
        cacheDir,
      }),
    ).rejects.toThrow(/outside lib\/a\.py/);
  });
});

describe('code-reviewer eval (CLI)', () => {
  let corpus: string;
  let cwd: string;
  let home: string;
  const savedHome = process.env.CODE_REVIEWER_HOME;

  beforeAll(() => {
    corpus = mkdtempSync(path.join(tmpdir(), 'cr-eval-cli-corpus-'));
    cwd = mkdtempSync(path.join(tmpdir(), 'cr-eval-cli-cwd-'));
    home = mkdtempSync(path.join(tmpdir(), 'cr-eval-cli-home-'));
    process.env.CODE_REVIEWER_HOME = home;
    writeFileSync(path.join(corpus, 'labelled.yaml'), LABELLED);
    writeFileSync(path.join(corpus, 'clean.yaml'), CLEAN);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });
  afterAll(() => {
    if (savedHome === undefined) delete process.env.CODE_REVIEWER_HOME;
    else process.env.CODE_REVIEWER_HOME = savedHome;
    for (const d of [corpus, cwd, home]) rmSync(d, { recursive: true, force: true });
  });

  async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
    await buildProgram().parseAsync([
      'node',
      'code-reviewer',
      '-C',
      cwd,
      'eval',
      corpus,
      '--provider',
      'mock',
      ...args,
    ]);
    vi.restoreAllMocks();
    const code = Number(process.exitCode ?? 0);
    process.exitCode = undefined;
    return { code, stdout, stderr };
  }

  it('prints the result as JSON on stdout and the summary on stderr', async () => {
    const { code, stdout, stderr } = await cli('--full', '--json');
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as EvalResult;
    expect(result).toMatchObject({ schemaVersion: 1, status: 'completed', settings: { depth: 'full' } });
    expect(result.cases.map((c) => c.id)).toEqual(['clean', 'labelled']);
    expect(Object.keys(result.aggregate)).toEqual(
      expect.arrayContaining([
        'recall',
        'precision',
        'f1',
        'falsePositives',
        'unexpected',
        'lost',
        'saved',
        'passes',
      ]),
    );
    expect(existsSync(path.join(cwd, '.code-reviewer', 'evals', result.id, 'result.json'))).toBe(true);
    expect(stderr).toContain('Recall');
    expect(stderr).toContain('Self-critique and thresholds');
    expect(stderr).toMatch(/Missed[\s\S]*labelled[\s\S]*sorts in place/);
  });

  it('compares with a previous result and gates on recall', async () => {
    const first = JSON.parse((await cli('--full', '--json')).stdout) as EvalResult;
    const previous = path.join(cwd, '.code-reviewer', 'evals', first.id);
    const { code, stdout, stderr } = await cli(
      '--full',
      '--no-self-critique',
      '--json',
      '--compare',
      previous,
      '--min-recall',
      '0.9',
    );
    expect(code).toBe(1);
    const second = JSON.parse(stdout) as EvalResult;
    expect(second.comparison).toMatchObject({ against: { id: first.id }, common: 2 });
    expect(second.comparison!.recall.delta).toBeCloseTo(1 / 3);
    expect(second.comparison!.falsePositives).toMatchObject({ before: 1, after: 2 });
    expect(second.comparison!.cases.find((c) => c.id === 'labelled')!.defects).toEqual([
      { key: 'src/math.js:12', before: 0, after: 1 },
    ]);
    expect(stderr).toContain('Compared with');
    expect(stderr).toMatch(/recall .* is below --min-recall 90%/);
  });

  it('drops minor findings at essential depth and rejects bad flags', async () => {
    const essential = JSON.parse(
      (await cli('--json', '--filter', 'javascript', '--min-precision', '0.5')).stdout,
    ) as EvalResult;
    expect(essential.settings.depth).toBe('essential');
    expect(essential.cases.map((c) => c.id)).toEqual(['labelled']);
    const bad = await cli('--repeat', '0');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/--repeat/);
    const none = await cli('--filter', 'nothing-matches');
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/No case matches/);
  });
});
