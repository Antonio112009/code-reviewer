import { SEVERITY_ORDER } from '../report/common';
import type { Finding, RunRecord } from '../types';
import type {
  AggregateMetrics,
  CaseResult,
  CaseRun,
  CaseRunStatus,
  ExpectedDefect,
  FindingRef,
  Metrics,
} from './types';

// Pure scoring: which reported findings match which expected defects, and the resulting metrics. No I/O.

/** Lines a finding may sit away from an expected defect and still match it. */
export const DEFAULT_TOLERANCE = 3;

/** Drop reasons of the filters after the review: self-critique and the confidence / severity thresholds. */
export const FILTER_REASONS: readonly string[] = ['critique', 'below-threshold', 'below-severity'];

type Located = Pick<Finding, 'file' | 'startLine' | 'endLine'> & { confidence?: number };

/** `./src\\a.ts` → `src/a.ts`: posix separators, no `.` segments, no leading `./` or `/`. */
export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** The line ranges of an expected defect: `lines` first, then `also`. */
export function defectRanges(d: ExpectedDefect): Array<{ startLine: number; endLine: number }> {
  return [{ startLine: d.startLine, endLine: d.endLine }, ...(d.also ?? [])];
}

interface Fit {
  /** Lines between the two ranges (0 when they overlap). */
  gap: number;
  /** Intersection over union of the two line ranges (0 when they do not overlap). */
  iou: number;
}

/**
 * How a finding sits relative to a defect (its best range: `lines` or one of `also`), or undefined when
 * it is not within `tolerance` lines of any of them.
 */
function fitOf(f: Located, d: ExpectedDefect, tolerance: number): Fit | undefined {
  if (normalizePath(f.file) !== normalizePath(d.file)) return undefined;
  const start = Math.min(f.startLine, f.endLine);
  const end = Math.max(f.startLine, f.endLine);
  let best: Fit | undefined;
  for (const r of defectRanges(d)) {
    if (start > r.endLine + tolerance || end < r.startLine - tolerance) continue;
    const gap = Math.max(0, Math.max(start, r.startLine) - Math.min(end, r.endLine));
    const overlap = Math.max(0, Math.min(end, r.endLine) - Math.max(start, r.startLine) + 1);
    const union = Math.max(end, r.endLine) - Math.min(start, r.startLine) + 1;
    const fit = { gap, iou: overlap / union };
    if (!best || fit.gap < best.gap || (fit.gap === best.gap && fit.iou > best.iou)) best = fit;
  }
  return best;
}

interface Pair {
  fit: Fit;
  confidence: number;
  finding: number;
  defect: number;
}

/**
 * Every (finding, defect) pair within `tolerance`, best fit first: closer, then more overlap, then more
 * confident; the input order breaks ties.
 */
function candidatePairs(
  expected: readonly ExpectedDefect[],
  findings: readonly Located[],
  tolerance: number,
): Pair[] {
  const pairs: Pair[] = [];
  findings.forEach((f, finding) => {
    expected.forEach((d, defect) => {
      const r = fitOf(f, d, tolerance);
      if (r) pairs.push({ fit: r, confidence: f.confidence ?? 0, finding, defect });
    });
  });
  return pairs.sort(
    (a, b) =>
      a.fit.gap - b.fit.gap ||
      b.fit.iou - a.fit.iou ||
      b.confidence - a.confidence ||
      a.finding - b.finding ||
      a.defect - b.defect,
  );
}

export interface MatchResult {
  /** One finding per matched defect (indices into the inputs). */
  matched: Array<{ defect: number; finding: number }>;
  /** Further findings on an already matched defect. */
  duplicates: Array<{ defect: number; finding: number }>;
  /** Findings near no expected defect. */
  unmatched: number[];
}

/**
 * Matches findings to expected defects: same file and line ranges within `tolerance` lines of each other.
 * Every defect is matched by at most one finding and every finding matches at most one defect, best fit
 * first (greedy over all candidate pairs). A finding left over next to a matched defect is a duplicate.
 */
export function matchFindings(
  expected: readonly ExpectedDefect[],
  findings: readonly Located[],
  tolerance = DEFAULT_TOLERANCE,
): MatchResult {
  const pairs = candidatePairs(expected, findings, tolerance);
  const defectOf = new Map<number, number>();
  const findingOf = new Map<number, number>();
  for (const p of pairs) {
    if (defectOf.has(p.finding) || findingOf.has(p.defect)) continue;
    defectOf.set(p.finding, p.defect);
    findingOf.set(p.defect, p.finding);
  }
  const matched = [...findingOf.entries()]
    .map(([defect, finding]) => ({ defect, finding }))
    .sort((a, b) => a.defect - b.defect);
  const duplicates: MatchResult['duplicates'] = [];
  const unmatched: number[] = [];
  findings.forEach((_, fi) => {
    if (defectOf.has(fi)) return;
    // Pairs are sorted: the first one of this finding is its best fit (every defect it fits is taken).
    const best = pairs.find((p) => p.finding === fi);
    if (best) duplicates.push({ defect: best.defect, finding: fi });
    else unmatched.push(fi);
  });
  return { matched, duplicates, unmatched };
}

export function findingRef(f: Finding): FindingRef {
  return {
    file: f.file,
    startLine: f.startLine,
    endLine: f.endLine,
    severity: f.severity,
    title: f.title,
    confidence: f.confidence,
    ...(f.critique ? { verdict: f.critique.verdict } : {}),
    ...(f.droppedReason ? { droppedReason: f.droppedReason } : {}),
  };
}

const ZERO: Omit<Metrics, 'recall' | 'precision' | 'f1' | 'rawRecall' | 'rawPrecision'> = {
  runs: 0,
  errors: 0,
  expected: 0,
  found: 0,
  missed: 0,
  unexpected: 0,
  duplicates: 0,
  falsePositives: 0,
  underrated: 0,
  lost: 0,
  saved: 0,
  chunks: 0,
  failedChunks: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  cost: 0,
  unpricedCalls: 0,
  durationMs: 0,
};

type Counts = typeof ZERO;
const COUNT_KEYS = Object.keys(ZERO) as Array<keyof Counts>;

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

/**
 * Recall = found / expected; precision = found / (found + unexpected + false positives), i.e. a lower
 * bound: unexpected findings may be real but unlabelled bugs. F1 is 0 when nothing was found and
 * undefined without expectations (clean cases).
 */
export function withRatios(c: Counts): Metrics {
  const recall = ratio(c.found, c.expected);
  const precision = ratio(c.found, c.found + c.unexpected + c.falsePositives);
  const f1 =
    c.expected === 0 ? null : c.found === 0 ? 0 : (2 * recall! * precision!) / (recall! + precision!);
  const rawFound = c.found + c.lost;
  return {
    ...c,
    recall,
    precision,
    f1,
    rawRecall: ratio(rawFound, c.expected),
    rawPrecision: ratio(rawFound, rawFound + c.unexpected + c.falsePositives + c.saved),
  };
}

/** Sums the counts of several metrics and recomputes the ratios (micro average). */
export function sumMetrics(list: readonly Metrics[]): Metrics {
  const total: Counts = { ...ZERO };
  // `?? 0`: results written before a count existed (e.g. cost) are still summed.
  for (const m of list) for (const k of COUNT_KEYS) total[k] += m[k] ?? 0;
  return withRatios(total);
}

/** The part of a run record the scoring needs. */
export type ScoredRun = Pick<RunRecord, 'status' | 'findings' | 'rejected' | 'chunks' | 'usage' | 'cost'>;

export type RunScore = Omit<CaseRun, 'repeat' | 'status' | 'error' | 'runId' | 'runDir'>;

/**
 * Scores one review run against a case's expectations: matched / missed defects, unexpected findings
 * (false positives on a clean case), duplicates, and the effect of self-critique and the thresholds
 * (`lost` recall, `saved` precision) from the run's removed findings.
 */
export function scoreRun(
  expected: readonly ExpectedDefect[],
  run: ScoredRun,
  opts: { tolerance?: number; durationMs?: number } = {},
): RunScore {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const clean = expected.length === 0;
  const findings = run.findings;
  const match = matchFindings(expected, findings, tolerance);
  const matched = match.matched.map(({ defect, finding }) => {
    const f = findings[finding]!;
    const floor = expected[defect]!.severity;
    const underrated = floor !== undefined && SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[floor];
    return { defect, finding: findingRef(f), ...(underrated ? { underrated: true } : {}) };
  });
  const matchedDefects = new Set(match.matched.map((m) => m.defect));
  const missed = expected.map((_, i) => i).filter((i) => !matchedDefects.has(i));
  const leftover = match.unmatched.map((i) => findingRef(findings[i]!));

  // Findings that self-critique or a threshold removed: the missed defects they had caught (matched one to
  // one, like reported findings), and those near no expected defect at all (noise kept out of the report).
  const removed = run.rejected.filter((f) => f.droppedReason && FILTER_REASONS.includes(f.droppedReason));
  const lost = matchFindings(
    missed.map((i) => expected[i]!),
    removed,
    tolerance,
  ).matched.map(({ defect, finding }) => ({
    defect: missed[defect]!,
    finding: findingRef(removed[finding]!),
  }));
  const saved = removed.filter((f) => !expected.some((d) => fitOf(f, d, tolerance))).map(findingRef);

  const counts: Counts = {
    ...ZERO,
    runs: 1,
    expected: expected.length,
    found: matched.length,
    missed: missed.length,
    unexpected: clean ? 0 : leftover.length,
    falsePositives: clean ? leftover.length : 0,
    duplicates: match.duplicates.length,
    underrated: matched.filter((m) => m.underrated).length,
    lost: lost.length,
    saved: saved.length,
    chunks: run.chunks.length,
    failedChunks: run.chunks.filter((c) => c.status === 'failed').length,
    inputTokens: run.usage.inputTokens,
    cachedInputTokens: run.usage.cachedInputTokens ?? 0,
    cacheWriteTokens: run.usage.cacheWriteTokens ?? 0,
    outputTokens: run.usage.outputTokens,
    cost: run.cost?.amount ?? 0,
    unpricedCalls: run.cost?.unknownTasks ?? 0,
    durationMs: opts.durationMs ?? 0,
  };
  return {
    metrics: withRatios(counts),
    matched,
    missed,
    unexpected: clean ? [] : leftover,
    falsePositives: clean ? leftover : [],
    duplicates: match.duplicates.map(({ defect, finding }) => ({
      defect,
      finding: findingRef(findings[finding]!),
    })),
    lost,
    saved,
  };
}

/** A run that produced no review (setup or pipeline error): every expected defect counts as missed. */
export function erroredRun(expected: readonly ExpectedDefect[], durationMs = 0): RunScore {
  return {
    metrics: withRatios({
      ...ZERO,
      runs: 1,
      errors: 1,
      expected: expected.length,
      missed: expected.length,
      durationMs,
    }),
    matched: [],
    missed: expected.map((_, i) => i),
    unexpected: [],
    falsePositives: [],
    duplicates: [],
    lost: [],
    saved: [],
  };
}

/** Runs that count towards the metrics: an interrupted run did not review the whole change. */
export function isCounted(status: CaseRunStatus): boolean {
  return status !== 'interrupted';
}

export function caseMetrics(runs: readonly CaseRun[]): Metrics {
  return sumMetrics(runs.filter((r) => isCounted(r.status)).map((r) => r.metrics));
}

/** Totals over every counted run, the ratios of each pass over the corpus and the recall spread. */
export function aggregateMetrics(cases: readonly CaseResult[], repeat: number): AggregateMetrics {
  const runs = cases.flatMap((c) => c.runs.filter((r) => isCounted(r.status)).map((r) => ({ c, r })));
  const total = sumMetrics(runs.map(({ r }) => r.metrics));
  const passes = Array.from({ length: repeat }, (_, i) => i + 1)
    .filter((pass) => runs.some(({ r }) => r.repeat === pass))
    .map((pass) => {
      const m = sumMetrics(runs.filter(({ r }) => r.repeat === pass).map(({ r }) => r.metrics));
      return { repeat: pass, recall: m.recall, precision: m.precision, f1: m.f1 };
    });
  const recalls = passes.map((p) => p.recall).filter((r): r is number => r !== null);
  const cleanRuns = runs.filter(({ c }) => c.clean);
  return {
    ...total,
    cases: cases.length,
    cleanCases: cases.filter((c) => c.clean).length,
    cleanRuns: cleanRuns.length,
    flaggedCleanRuns: cleanRuns.filter(({ r }) => r.metrics.falsePositives > 0).length,
    passes,
    recallMin: recalls.length ? Math.min(...recalls) : null,
    recallMax: recalls.length ? Math.max(...recalls) : null,
  };
}
