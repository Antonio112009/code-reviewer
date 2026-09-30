import { SEVERITY_ORDER } from '../report/common';
import { titleSimilarity } from '../review/dedupe';
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

/** A finding about the defect's topic: title similarity to its note (or the case title) at least this. */
const TOPIC_SIMILARITY = 0.15;
/** A leftover finding this similar to the matched one reports the same defect again. */
const REPEAT_SIMILARITY = 0.3;

type Located = Pick<Finding, 'file' | 'startLine' | 'endLine'> & { confidence?: number; title?: string };

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

/** The places of an expected defect: `lines` first, then `also` (in its own file when it names one). */
export function defectRanges(d: ExpectedDefect): Array<{ file: string; startLine: number; endLine: number }> {
  return [
    { file: d.file, startLine: d.startLine, endLine: d.endLine },
    ...(d.also ?? []).map((a) => ({ file: a.file ?? d.file, startLine: a.startLine, endLine: a.endLine })),
  ];
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
  const file = normalizePath(f.file);
  const start = Math.min(f.startLine, f.endLine);
  const end = Math.max(f.startLine, f.endLine);
  let best: Fit | undefined;
  for (const r of defectRanges(d)) {
    if (normalizePath(r.file) !== file) continue;
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
  /** Title similarity to the defect's description (0 without one). */
  topic: number;
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
  topics: readonly (string | undefined)[] = [],
): Pair[] {
  const pairs: Pair[] = [];
  findings.forEach((f, finding) => {
    expected.forEach((d, defect) => {
      const r = fitOf(f, d, tolerance);
      const about = topics[defect];
      const topic = about && f.title ? titleSimilarity(f.title, about) : 0;
      if (r) pairs.push({ fit: r, topic, confidence: f.confidence ?? 0, finding, defect });
    });
  });
  // Among the findings within tolerance of a defect, one about the defect's topic beats a closer one about
  // something else (several real issues often sit next to a planted one).
  const onTopic = (p: Pair) => (p.topic >= TOPIC_SIMILARITY ? 1 : 0);
  return pairs.sort(
    (a, b) =>
      onTopic(b) - onTopic(a) ||
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
  /** Further reports of an already matched defect (a title like the matched finding's). */
  duplicates: Array<{ defect: number; finding: number }>;
  /** Other findings next to a matched defect that name a different issue. */
  nearby: Array<{ defect: number; finding: number }>;
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
  topics: readonly (string | undefined)[] = expected.map((d) => d.note),
): MatchResult {
  const pairs = candidatePairs(expected, findings, tolerance, topics);
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
  const nearby: MatchResult['nearby'] = [];
  const unmatched: number[] = [];
  findings.forEach((f, fi) => {
    if (defectOf.has(fi)) return;
    // Pairs are sorted: the first one of this finding is its best fit (every defect it fits is taken).
    const best = pairs.find((p) => p.finding === fi);
    if (!best) {
      unmatched.push(fi);
      return;
    }
    const kept = findings[findingOf.get(best.defect)!]!;
    const same =
      (f.startLine === kept.startLine && f.endLine === kept.endLine) ||
      (f.title !== undefined &&
        kept.title !== undefined &&
        titleSimilarity(f.title, kept.title) >= REPEAT_SIMILARITY);
    (same ? duplicates : nearby).push({ defect: best.defect, finding: fi });
  });
  return { matched, duplicates, nearby, unmatched };
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
  nearby: 0,
  acceptable: 0,
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
  opts: { tolerance?: number; durationMs?: number; title?: string } = {},
): RunScore {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  // Optional defects take part in matching, but not in recall; a case with only optional ones is clean.
  const clean = expected.every((d) => d.optional);
  const findings = run.findings;
  const match = matchFindings(
    expected,
    findings,
    tolerance,
    expected.map((d) => d.note ?? opts.title),
  );
  const acceptable = match.matched
    .filter(({ defect }) => expected[defect]!.optional)
    .map(({ defect, finding }) => ({ defect, finding: findingRef(findings[finding]!) }));
  const matched = match.matched
    .filter(({ defect }) => !expected[defect]!.optional)
    .map(({ defect, finding }) => {
      const f = findings[finding]!;
      const floor = expected[defect]!.severity;
      const underrated = floor !== undefined && SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[floor];
      return { defect, finding: findingRef(f), ...(underrated ? { underrated: true } : {}) };
    });
  const matchedDefects = new Set(match.matched.map((m) => m.defect));
  const missed = expected.map((_, i) => i).filter((i) => !matchedDefects.has(i) && !expected[i]!.optional);
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
    expected: expected.filter((d) => !d.optional).length,
    found: matched.length,
    missed: missed.length,
    unexpected: clean ? 0 : leftover.length,
    falsePositives: clean ? leftover.length : 0,
    duplicates: match.duplicates.length,
    nearby: match.nearby.length,
    acceptable: acceptable.length,
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
    nearby: match.nearby.map(({ defect, finding }) => ({
      defect,
      finding: findingRef(findings[finding]!),
    })),
    acceptable,
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
    nearby: [],
    acceptable: [],
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
