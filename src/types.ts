import { z } from 'zod';

/**
 * critical — exploitable vulnerability, data loss/corruption or crash on a main path
 * major    — wrong behaviour likely to hit production
 * minor    — bug in an edge case or with limited impact
 * info     — risky pattern worth a look; not a confirmed defect
 */
export const SEVERITIES = ['critical', 'major', 'minor', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  'bug',
  'security',
  'concurrency',
  'error-handling',
  'performance',
  'resource-leak',
  'api-misuse',
  'data-loss',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const REASONING_LEVELS = ['none', 'low', 'medium', 'high'] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const ROLES = ['review', 'critique', 'summary'] as const;
export type Role = (typeof ROLES)[number];

/** What the model submits via `submit_findings`. */
export const ReportedFindingSchema = z.object({
  file: z.string().min(1).describe('Repository-relative path of the file'),
  startLine: z.number().int().positive().describe('First line (in the NEW version of the file)'),
  endLine: z.number().int().positive().describe('Last line (in the NEW version of the file)'),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  title: z.string().min(3).max(200).describe('One-line summary of the defect'),
  description: z
    .string()
    .min(10)
    .describe(
      'Why this is a bug: concrete inputs/state that lead to wrong behaviour, crash or vulnerability',
    ),
  failurePath: z
    .string()
    .optional()
    .describe(
      'How the defect is reached, as steps: input or state → code path → failure (e.g. "empty cart from POST /checkout → total() divides by items.length → NaN is charged"). Required for critical and major findings.',
    ),
  suggestion: z.string().optional().describe('How to fix it (short, optional)'),
  replacement: z
    .string()
    .max(4000)
    .optional()
    .describe(
      'The fixed code for lines startLine–endLine of the NEW file: whole lines, original indentation, nothing else. Only when the fix changes just those lines; it becomes a one-click suggestion on the pull request.',
    ),
  evidence: z.string().optional().describe('The exact offending code (a few lines at most)'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Probability (0..1) that this is a real defect a senior engineer would agree with'),
  hint: z
    .string()
    .optional()
    .describe('Id of the static-analysis hint (e.g. "H3") this finding confirms, if it is based on one'),
  checklist: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Id of the technology checklist (shown in brackets after its title, given without the brackets) with an item covering this defect; leave out only when no checklist covers it',
    ),
});
export type ReportedFinding = z.infer<typeof ReportedFindingSchema>;

export const SubmitFindingsSchema = z.object({
  findings: z.array(ReportedFindingSchema).describe('All defects found; empty array if none'),
  notes: z.string().optional().describe('Optional short remark about the reviewed code'),
  audit: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        result: z.enum(['defects', 'clean', 'unsure']),
      }),
    )
    .max(300)
    .optional()
    .describe('When asked to audit the changed functions: each function you checked and what you concluded'),
});
export type SubmitFindings = z.infer<typeof SubmitFindingsSchema>;

export const VERDICTS = ['confirmed', 'rejected', 'uncertain'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ReportedVerdictSchema = z.object({
  id: z.string().describe('Finding id exactly as given'),
  verdict: z.enum(VERDICTS),
  confidence: z.number().min(0).max(1).describe('Your confidence (0..1) that the finding is a real defect'),
  reason: z.string().min(3).describe('Short justification referencing the code'),
  severity: z.enum(SEVERITIES).optional().describe('Corrected severity, only if the original is wrong'),
  title: z
    .string()
    .min(3)
    .max(200)
    .optional()
    .describe(
      'Corrected one-line title, only when the original headline is wrong or overstated but a verified defect remains',
    ),
  replacementOk: z
    .boolean()
    .optional()
    .describe(
      'For a finding with a "replacement": true only if applying it fixes the defect and keeps the code valid',
    ),
});
export type ReportedVerdict = z.infer<typeof ReportedVerdictSchema>;

export const SubmitVerdictsSchema = z.object({
  verdicts: z.array(ReportedVerdictSchema),
});
export type SubmitVerdicts = z.infer<typeof SubmitVerdictsSchema>;

export interface Money {
  amount: number;
  /** ISO 4217 code, e.g. `USD`. */
  currency: string;
}

export interface Usage {
  /** Input tokens not served from the prompt cache. */
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  /** Input tokens read from the prompt cache. */
  cachedInputTokens?: number;
  /** Input tokens written to the prompt cache (priced above plain input). */
  cacheWriteTokens?: number;
  /** Model requests: agent prompts, or API calls of a tool loop (Copilot bills requests, not tokens). */
  requests?: number;
  /**
   * The provider reported no token counts, so they were estimated from the prompt and the reply text: a
   * lower bound, since tool results and hidden reasoning are not counted.
   */
  estimated?: boolean;
  /** Cost the provider reported itself (ACP `usage_update`), when it reports one. */
  reportedCost?: Money;
}

/** How the known part of a run's cost was obtained. */
export type CostBasis = 'reported' | 'priced' | 'estimated';

export interface CostSummary extends Money {
  /**
   * `reported` — by the provider; `priced` — reported tokens × the configured `pricing`; `estimated` —
   * estimated tokens × `pricing`.
   */
  basis: CostBasis[];
  /** Model tasks whose cost is unknown: the provider reported none and no price is configured. */
  unknownTasks: number;
  /** `provider:model` routes without a price. */
  unpriced: string[];
}

export interface CacheUse {
  dir: string;
  /** Chunks or split parts answered from the cache / by a model. */
  hits: number;
  misses: number;
  /** Findings whose critique verdict came from the cache / from the critic. */
  critiqueHits: number;
  critiqueMisses: number;
  /** Tokens the cached answers took when they were made. */
  saved: { inputTokens: number; outputTokens: number };
}

/**
 * Why a chunk could not be reviewed:
 * - `timeout` — the task ran out of time; `stalled` — the agent stopped sending updates;
 * - `step-limit` — the model used up its tool steps without submitting; `output-limit` — its answer hit
 *   the output token limit; `context-limit` — the prompt does not fit the context window;
 * - `no-output` — the reply carried no findings payload, even after a repair turn;
 * - `refusal`, `unavailable`, `auth` — the model declined, no usable model, credentials;
 * - `aborted` — interrupted; `error` — anything else.
 */
export const FAILURE_KINDS = [
  'timeout',
  'stalled',
  'step-limit',
  'output-limit',
  'context-limit',
  'no-output',
  'refusal',
  'unavailable',
  'auth',
  'budget',
  'aborted',
  'error',
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface AuthorInfo {
  name: string;
  email?: string;
  commit: string;
  summary?: string;
  date?: string;
  commitUrl?: string;
  lineUrl?: string;
}

export interface CritiqueInfo {
  verdict: Verdict;
  confidence: number;
  reason: string;
  originalConfidence: number;
  originalSeverity?: Severity;
  /** The reviewer's title when the critic corrected it (a wrong or overstated headline over a real defect). */
  originalTitle?: string;
}

export type FindingOrigin = 'llm' | 'static';

export interface Finding extends ReportedFinding {
  id: string;
  skills: string[];
  /** `llm` = reported by a model; `static` = a static-analysis hit carried into the review. */
  origin?: FindingOrigin;
  /** Static analyzer rule behind the finding (set for static hits and for LLM findings confirming one). */
  tool?: { analyzer: string; ruleId: string };
  /** Secrets / known-vulnerable dependencies: the critic may downgrade but not reject them. */
  nonRejectable?: boolean;
  source: { chunkIds: string[]; provider: string; model?: string };
  critique?: CritiqueInfo;
  author?: AuthorInfo;
  /** The critic checked `replacement`: true = safe to offer as a one-click suggestion. */
  replacementOk?: boolean;
  /** Severity lowered before critique because the finding gave no failure path (`review.requireFailurePath`). */
  lowered?: { from: Severity; reason: 'no-failure-path' };
  /** Set when a validation step rejected the finding (hallucinated path, lines out of range, ...). */
  droppedReason?: string;
  /**
   * Stable id across runs (`review/fingerprint.ts`): file, category, static rule and the reported code, not
   * line numbers. Keys SARIF/Code Quality results and de-duplicates pull request comments.
   */
  fingerprint?: string;
}

// ---------------------------------------------------------------------------
// Review input model
// ---------------------------------------------------------------------------

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/**
 * Review passes per chunk: `general` (one pass over everything, the default), or focused passes over the same
 * code — `local` (the changed lines themselves) and `contracts` (changed declarations and their consumers).
 */
export const REVIEW_PASSES = ['general', 'local', 'contracts'] as const;
export type ReviewPass = (typeof REVIEW_PASSES)[number];

/** How much related unchanged code a chunk gets (`chunking/expand.ts`). */
export const EXPAND_LEVELS = ['off', 'map', 'refs', 'deep'] as const;
export type ExpandLevel = (typeof EXPAND_LEVELS)[number];

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'file';

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: Exclude<FileStatus, 'file'>;
  binary: boolean;
  /** A submodule (gitlink, mode 160000): its "content" is a commit id in another repository. */
  submodule?: boolean;
  hunks: Hunk[];
}

/** A single file to be reviewed: either a diff (review mode) or a whole file (files mode). */
export interface ReviewUnit {
  path: string;
  oldPath?: string;
  status: FileStatus;
  language: string;
  hunks: Hunk[];
  /** Full content of the (new) file when available. */
  content?: string;
  /** 1-based inclusive line ranges (new file) the review should focus on. Empty = whole file. */
  focusRanges: Array<[number, number]>;
}

/** One line of a chunk's impact map. */
export interface ImpactEntry {
  name: string;
  /** How the change touches it: a changed declaration's kind, or `callee` (a function the new code calls). */
  kind: 'removed' | 'signature' | 'body' | 'callee';
  /** The changed file declaring it (not for callees). */
  file?: string;
  /** Unchanged places that use it (or define it, for callees), with the enclosing declaration. */
  sites: Array<{ path: string; line: number; in?: string }>;
  /** Further files that use it, not listed. */
  more: number;
}

export interface ChunkPart {
  path: string;
  language: string;
  status: FileStatus;
  text: string;
  tokens: number;
  /** For split files: the part number (1-based) and total parts. */
  part?: { index: number; total: number };
  /**
   * `review` (default) — code this chunk owns and must review;
   * `context` — read-only excerpt of a related file owned by another chunk (no findings expected);
   * `related` — read-only excerpt of unchanged code that uses or is used by the change (`chunking/expand.ts`).
   */
  role?: 'review' | 'context' | 'related';
}

export interface Chunk {
  id: string;
  index: number;
  parts: ChunkPart[];
  tokens: number;
  /** Files this chunk owns (reviews). */
  files: string[];
  /** Related files included read-only for context (owned by other chunks). */
  contextFiles?: string[];
  /** Unchanged files shown in part because they use or are used by the change, and why. */
  related?: Array<{ path: string; why: string }>;
  /** A focused pass over the chunk's code (a chunk without one gets the general review). */
  pass?: Exclude<ReviewPass, 'general'>;
  /** Declarations the change touches (`chunking/expand.ts`): the checklist of the `contracts` pass. */
  declarations?: Array<{ name: string; file: string; kind: 'removed' | 'signature' | 'body' }>;
  /** Where unchanged code uses the changed declarations or defines what the change calls (`chunking/expand.ts`). */
  impact?: ImpactEntry[];
  languages: string[];
  /** Files mentioned only by name (deleted files etc.). */
  mentions: string[];
  /** Why these files are together (e.g. "imports", "test pair", "co-change", "directory"). */
  groupReasons?: string[];
}

// ---------------------------------------------------------------------------
// Stack detection
// ---------------------------------------------------------------------------

export const TECH_CATEGORIES = [
  'language',
  'runtime',
  'framework',
  'database',
  'orm',
  'infra',
  'ci',
  'cloud',
  'tool',
] as const;
export type TechCategory = (typeof TECH_CATEGORIES)[number];

/** A detected technology, e.g. `db.postgresql`, `framework.nextjs`, `lang.typescript`. */
export interface TechHit {
  id: string;
  name: string;
  category: TechCategory;
  /** Combined confidence 0..1 (1 − Π(1 − wᵢ) over independent signals). */
  score: number;
  /** Human readable evidence, e.g. "dependency pg in package.json". */
  reasons: string[];
  /** Package roots (repo-relative dirs, "." = repository root) where the tech was detected. */
  packages: string[];
  /**
   * Lowest version the project is on (from manifests: `^15.1.0` → `15.1.0`, `go 1.22` → `1.22`, …), when
   * known. Per-package differences: see `versions`.
   */
  version?: string;
  /** Version per package root, when packages pin different versions. */
  versions?: Record<string, string>;
}

export interface PackageRoot {
  dir: string;
  manifests: string[];
  /** Tech ids detected for this package (with score >= activation threshold). */
  techs: string[];
}

export interface StackProfile {
  techs: TechHit[];
  packages: PackageRoot[];
  /** Languages by number of files, most common first. */
  languages: Array<{ id: string; files: number }>;
  filesScanned: number;
  durationMs: number;
  /** Limits hit, files that failed to parse, … */
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Static analysis
// ---------------------------------------------------------------------------

/** A static-analysis hit, used as a hint for the LLM and as a candidate finding. */
export interface StaticHit {
  /** Short id referenced by the model (`H1`, `H2`, …), unique within a run. */
  id: string;
  analyzer: string;
  ruleId: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: Severity;
  category: Category;
  message: string;
  /** Prior confidence of the rule (0..1). */
  confidence: number;
  /** Secrets / known-vulnerable dependencies: may be downgraded by the critic but not dropped. */
  nonRejectable?: boolean;
  help?: string;
}

export interface AnalyzerRun {
  id: string;
  label: string;
  tier: 'builtin' | 'external' | 'project';
  status: 'ok' | 'skipped' | 'failed' | 'timeout';
  hits: number;
  durationMs: number;
  version?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Run record
// ---------------------------------------------------------------------------

export interface RoleRouting {
  provider: string;
  model?: string;
  reasoning: ReasoningLevel;
}

export type RunTarget =
  | {
      kind: 'diff';
      base: string;
      head: string;
      baseSha: string;
      headSha: string;
      mergeBase: string;
      /** The head is a local snapshot of staged / uncommitted changes (not on any forge). */
      local?: 'staged' | 'uncommitted';
    }
  | { kind: 'files'; paths: string[]; headSha?: string };

export interface ChunkRecord {
  id: string;
  files: string[];
  contextFiles?: string[];
  /** Unchanged code shown in part (`review.expand`), and why. */
  related?: Array<{ path: string; why: string }>;
  tokens: number;
  skills: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
  /** Why the chunk failed (set with `status: 'failed'`). */
  failure?: FailureKind;
  /**
   * What was done to get a result after a problem: an early answer requested from the agent, a split into
   * smaller parts, a retry with more time or steps.
   */
  recovery?: string[];
  findings: number;
  /** Static-analysis hints given to the model for this chunk. */
  hints?: number;
  /** Tokens of every attempt, failed ones included. */
  usage?: Usage;
  /** Known cost of every attempt (reported, or computed from `pricing`). */
  cost?: Money;
  /** The answer came from the result cache: for the whole chunk, or for some of its split parts. */
  cached?: 'all' | 'partial';
  durationMs?: number;
  timeoutMs?: number;
  /** Tool calls by tool name (read_file, grep, …) made while reviewing this chunk. */
  toolCalls?: Record<string, number>;
  /** Why each skill was picked (`content:/…/`, `stack:…`, `file:…`, `always-on`, …), by skill id. */
  skillReasons?: Record<string, string[]>;
  /** Skills that matched the chunk but did not fit `review.skillTokenBudget`. */
  skillsDropped?: string[];
  /** `review.audit`: changed functions listed in the prompt and how many the model recorded as audited. */
  audit?: { listed: number; audited: number };
  /** `review.deepen`: findings the second look added (set when one ran). */
  deepened?: number;
  /** Provider/model that actually reviewed the chunk (after any fallback). */
  provider?: string;
  model?: string;
  attempts?: number;
}

export interface RefsInfo {
  /** How base and head were chosen, one line per decision. */
  explanation: string[];
  baseSource: 'flag' | 'ci' | 'forge' | 'branch-config' | 'rules' | 'default' | 'local';
  remote?: string;
  fetched: boolean;
  /** Commits between the merge-base and head. */
  commits?: number;
  /** Notices: unpushed commits, local branch behind remote, uncommitted changes not reviewed, … */
  notes: string[];
}

/** How the review covered one changed file (`review/coverage.ts`). */
export interface FileCoverage {
  path: string;
  /** Lines the change adds or removes (files mode: the file's lines). */
  changed: number;
  /**
   * `reviewed`: every part owning the file answered in full; `interrupted`: some only with an early answer;
   * `partial`: some parts failed; `failed`: no part answered; `skipped`: never sent to a model.
   */
  status: 'reviewed' | 'interrupted' | 'partial' | 'failed' | 'skipped';
  /** Why a file was skipped or not run. */
  reason?: string;
  /** The model opened the file with a tool, beyond the code in its prompt. */
  opened?: boolean;
}

/** `advice.deepen`: a second look (`--deepen`) at the chunks that had findings, suggested after a run. */
export interface DeepenAdvice {
  /** Chunks a second look would review again. */
  chunks: string[];
  /** What it would add, estimated from the first looks' cost; absent when unknown. */
  estimatedCost?: Money;
}

export interface RunRecord {
  schemaVersion: 1;
  id: string;
  command: 'review' | 'files';
  status: 'running' | 'completed' | 'partial' | 'failed';
  createdAt: string;
  durationMs?: number;
  repo: { root: string; remote?: string; platform?: 'github' | 'gitlab' | 'other' };
  target: RunTarget;
  options: {
    /** Review depth (older runs: undefined = full). */
    depth?: 'essential' | 'full';
    selfCritique: boolean;
    minConfidence: number;
    minSeverity?: Severity;
    skills: string;
    tools: boolean;
    authors: boolean;
    maxChunkTokens: number;
    concurrency: number;
  };
  routing: Partial<Record<Role, RoleRouting>>;
  /** Model fallbacks applied during the run. */
  fallbacks?: Array<{ role: Role; from: string; to: string; reason: string }>;
  refs?: RefsInfo;
  stack?: Array<{ id: string; name: string; category: TechCategory; score: number }>;
  analyzers?: AnalyzerRun[];
  /** Skill ids used by at least one chunk. */
  skillsUsed?: string[];
  /** Tool calls by tool name across the run. */
  toolUsage?: Record<string, number>;
  chunks: ChunkRecord[];
  /** Which changed files the review covered, problem files first. */
  coverage?: FileCoverage[];
  /** Suggested follow-ups (`--deepen`); advice only. */
  advice?: { deepen?: DeepenAdvice };
  findings: Finding[];
  /**
   * Kept findings of lower confidence (below `review.advisoryConfidence`) or `info` severity: shown in the
   * reports as "worth a look", left out of pull request comments, SARIF / Code Quality and `--fail-on`.
   */
  advisory?: Finding[];
  /** Findings removed by validation, critique or the confidence threshold — kept for auditing. */
  rejected: Finding[];
  usage: Usage;
  /** Cost of the run, when at least part of it is known. */
  cost?: CostSummary;
  /** Result cache use, when the cache was on. */
  cache?: CacheUse;
  summary?: string;
  warnings: string[];
  error?: string;
}
