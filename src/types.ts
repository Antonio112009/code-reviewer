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
  suggestion: z.string().optional().describe('How to fix it (short, optional)'),
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
});
export type ReportedFinding = z.infer<typeof ReportedFindingSchema>;

export const SubmitFindingsSchema = z.object({
  findings: z.array(ReportedFindingSchema).describe('All defects found; empty array if none'),
  notes: z.string().optional().describe('Optional short remark about the reviewed code'),
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
});
export type ReportedVerdict = z.infer<typeof ReportedVerdictSchema>;

export const SubmitVerdictsSchema = z.object({
  verdicts: z.array(ReportedVerdictSchema),
});
export type SubmitVerdicts = z.infer<typeof SubmitVerdictsSchema>;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

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
  /** Set when a validation step rejected the finding (hallucinated path, lines out of range, ...). */
  droppedReason?: string;
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
   * `context` — read-only excerpt of a related file owned by another chunk (no findings expected).
   */
  role?: 'review' | 'context';
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
  | { kind: 'diff'; base: string; head: string; baseSha: string; headSha: string; mergeBase: string }
  | { kind: 'files'; paths: string[]; headSha?: string };

export interface ChunkRecord {
  id: string;
  files: string[];
  contextFiles?: string[];
  tokens: number;
  skills: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
  findings: number;
  /** Static-analysis hints given to the model for this chunk. */
  hints?: number;
  usage?: Usage;
  durationMs?: number;
  timeoutMs?: number;
  /** Tool calls by tool name (read_file, grep, …) made while reviewing this chunk. */
  toolCalls?: Record<string, number>;
  /** Provider/model that actually reviewed the chunk (after any fallback). */
  provider?: string;
  model?: string;
  attempts?: number;
}

export interface RefsInfo {
  /** How base and head were chosen, one line per decision. */
  explanation: string[];
  baseSource: 'flag' | 'ci' | 'forge' | 'branch-config' | 'rules' | 'default';
  remote?: string;
  fetched: boolean;
  /** Commits between the merge-base and head. */
  commits?: number;
  /** Notices: unpushed commits, local branch behind remote, uncommitted changes not reviewed, … */
  notes: string[];
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
  findings: Finding[];
  /** Findings removed by validation, critique or the confidence threshold — kept for auditing. */
  rejected: Finding[];
  usage: Usage;
  summary?: string;
  warnings: string[];
  error?: string;
}
