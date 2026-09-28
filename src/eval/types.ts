import type { ReasoningLevel, Role, RunRecord, Severity, Verdict } from '../types';

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** A known defect introduced by a case's change, in the NEW (head) version of a file. */
export interface ExpectedDefect {
  /** Repository-relative posix path. */
  file: string;
  startLine: number;
  endLine: number;
  /** Other line ranges of the same file where a report of this defect also counts (e.g. its cause). */
  also?: Array<{ startLine: number; endLine: number }>;
  /** Lowest severity a reviewer should give it; a match below it counts as `underrated`. */
  severity?: Severity;
  note?: string;
}

export type CaseSource =
  /** Self-contained: files at the base commit and the files the change writes (null deletes a file). */
  | { kind: 'inline'; base: Record<string, string>; head: Record<string, string | null> }
  /** A real repository (local path or https URL) and two full commit shas. */
  | { kind: 'repo'; repo: string; baseRef: string; headRef: string };

export interface EvalCase {
  /** Path relative to the corpus root without extension, e.g. `javascript/order-by-injection`. */
  id: string;
  /** Absolute path of the case file. */
  file: string;
  title: string;
  tags: string[];
  source: CaseSource;
  /** Empty for a clean change: every finding on it is a false positive. */
  expect: ExpectedDefect[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** A finding as recorded in an eval result (enough to read it without opening the run). */
export interface FindingRef {
  file: string;
  startLine: number;
  endLine: number;
  severity: Severity;
  title: string;
  confidence: number;
  verdict?: Verdict;
  /** Set for findings removed by self-critique or a threshold. */
  droppedReason?: string;
}

/**
 * Counts and ratios of one run, a case (summed over its runs) or the whole eval.
 * - `found` / `missed`: expected defects matched / not matched by a reported finding;
 * - `unexpected`: findings on a case with expectations that match no expected defect (possibly real
 *   but unlabelled bugs); `falsePositives`: findings on a clean case;
 * - `duplicates`: further findings on an already matched defect (neither right nor wrong);
 * - `lost`: missed defects that a finding removed by self-critique or a threshold had matched;
 *   `saved`: removed findings that matched no expected defect (would-be unexpected / false positives);
 * - `rawRecall` / `rawPrecision`: the same ratios without those filters.
 */
export interface Metrics {
  runs: number;
  errors: number;
  expected: number;
  found: number;
  missed: number;
  unexpected: number;
  duplicates: number;
  falsePositives: number;
  /** Matched findings below the expected severity. */
  underrated: number;
  lost: number;
  saved: number;
  recall: number | null;
  precision: number | null;
  f1: number | null;
  rawRecall: number | null;
  rawPrecision: number | null;
  chunks: number;
  failedChunks: number;
  /** Input tokens not served from the prompt cache. */
  inputTokens: number;
  /** Input tokens read from the prompt cache (agents such as Claude Code serve most of their input from it). */
  cachedInputTokens: number;
  outputTokens: number;
  /** Known cost (reported by the provider or priced with `pricing`), in the aggregate's `costCurrency`. */
  cost: number;
  /** Model calls without a known cost (no reported cost and no price). */
  unpricedCalls: number;
  durationMs: number;
}

export type CaseRunStatus = RunRecord['status'] | 'error' | 'interrupted';

export interface CaseRun {
  /** 1-based repetition (`--repeat`). */
  repeat: number;
  status: CaseRunStatus;
  error?: string;
  runId?: string;
  /** Directory of the saved review run (run.json and reports). */
  runDir?: string;
  metrics: Metrics;
  /** Indices refer to the case's `defects`. */
  matched: Array<{ defect: number; finding: FindingRef; underrated?: boolean }>;
  missed: number[];
  unexpected: FindingRef[];
  falsePositives: FindingRef[];
  duplicates: Array<{ defect: number; finding: FindingRef }>;
  /** Missed defects that a removed finding had matched. */
  lost: Array<{ defect: number; finding: FindingRef }>;
  /** Removed findings that matched no expected defect. */
  saved: FindingRef[];
}

export interface DefectResult extends ExpectedDefect {
  /** Runs in which a reported finding matched this defect. */
  found: number;
  /** Runs in which only a removed finding matched it. */
  lost: number;
}

export interface CaseResult {
  id: string;
  title: string;
  tags: string[];
  clean: boolean;
  /** `inline`, or the repository of a real-repository case. */
  source: string;
  /** Temporary repository kept with `--keep`. */
  repoDir?: string;
  /** Setup error (the case could not be materialised); `runs` is then empty. */
  error?: string;
  defects: DefectResult[];
  runs: CaseRun[];
  /** Summed over the counted runs (interrupted runs are left out). */
  metrics: Metrics;
}

export interface AggregateMetrics extends Metrics {
  cases: number;
  cleanCases: number;
  /** Runs of clean cases with at least one false positive. */
  flaggedCleanRuns: number;
  cleanRuns: number;
  /** Ratios of each pass over the corpus (one entry per `--repeat`). */
  passes: Array<{ repeat: number; recall: number | null; precision: number | null; f1: number | null }>;
  recallMin: number | null;
  recallMax: number | null;
  /** Currency of `cost`, when any run had a known cost. */
  costCurrency?: string;
}

export interface EvalSettings {
  version: string;
  corpus: string[];
  filter?: string[];
  tolerance: number;
  repeat: number;
  concurrency: number;
  routing: Partial<Record<Role, { provider: string; model?: string; reasoning: ReasoningLevel }>>;
  fallbacks: Array<{ role: Role; from: string; to: string; reason: string }>;
  depth: 'essential' | 'full';
  selfCritique: boolean;
  minConfidence: number;
  minSeverity: Severity;
  skills: string;
  tools: boolean;
  analyzers: boolean;
}

export interface MetricDelta {
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface CaseComparison {
  id: string;
  recall: MetricDelta;
  precision: MetricDelta;
  /** Unexpected findings and false positives per run. */
  noise: MetricDelta;
  /** Expected defects whose found rate changed (found runs / runs). */
  defects: Array<{ key: string; note?: string; before: number; after: number }>;
}

export interface EvalComparison {
  against: { id: string; createdAt: string; file: string };
  /** Over the cases present in both results. */
  common: number;
  added: string[];
  removed: string[];
  recall: MetricDelta;
  precision: MetricDelta;
  f1: MetricDelta;
  rawRecall: MetricDelta;
  rawPrecision: MetricDelta;
  /** Per pass over the common cases (totals divided by each case's run count). */
  falsePositives: MetricDelta;
  unexpected: MetricDelta;
  inputTokens: MetricDelta;
  cachedInputTokens: MetricDelta;
  outputTokens: MetricDelta;
  /** Null on a side without cost data (older results, nothing priced). */
  cost: MetricDelta;
  durationMs: MetricDelta;
  /** Cases whose recall, precision, noise or defects changed. */
  cases: CaseComparison[];
}

export interface EvalResult {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  durationMs: number;
  status: 'completed' | 'interrupted';
  settings: EvalSettings;
  aggregate: AggregateMetrics;
  cases: CaseResult[];
  comparison?: EvalComparison;
}
