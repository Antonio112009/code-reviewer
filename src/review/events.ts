import type { SkippedFile } from '../sources/diff-source';
import type {
  AnalyzerRun,
  Chunk,
  ChunkRecord,
  ImpactEntry,
  Money,
  RefsInfo,
  Role,
  RoleRouting,
  RunRecord,
  RunTarget,
  Severity,
  StackProfile,
} from '../types';

/** Pipeline phases in execution order (used for the progress header and timings). */
export const PHASES = [
  'refs',
  'collect',
  'stack',
  'analyzers',
  'chunking',
  'snapshot',
  'review',
  'validate',
  'critique',
  'authors',
  'report',
] as const;
export type PhaseId = (typeof PHASES)[number];

export interface PlannedChunk {
  id: string;
  files: string[];
  contextFiles: string[];
  /** Unchanged code shown in part (`review.expand`), and why. */
  related?: Array<{ path: string; why: string }>;
  /** Impact map (`chunking/expand.ts`). */
  impact?: ImpactEntry[];
  tokens: number;
  skills: Array<{ id: string; reasons: string[] }>;
  /** Skills that matched but did not fit the skill budget. */
  skillsDropped?: string[];
  /** Why the files are grouped together. */
  groupReasons: string[];
  hints: number;
  timeoutMs: number;
}

export interface ReviewPlan {
  target: RunTarget;
  root: string;
  refs?: RefsInfo;
  units: number;
  skipped: SkippedFile[];
  deleted: string[];
  budget: number;
  /** Review depth (`essential` | `full`) and the severity floor it implies. */
  depth: 'essential' | 'full';
  minSeverity: Severity;
  chunks: PlannedChunk[];
  totalTokens: number;
  projectRules: string[];
  routing: Partial<Record<Role, RoleRouting>>;
  stack?: StackProfile;
  analyzers?: AnalyzerRun[];
  /** Skill ids used by at least one chunk. */
  skills: string[];
  /**
   * Lower bound for the review prompts (code, instructions, skills, hints; no tool results, retries or
   * critique), and their input cost when a price is configured for the review model.
   */
  estimate?: { inputTokens: number; cost?: Money };
}

export type ReviewEvent =
  | { type: 'phase'; phase: PhaseId; message: string }
  /** A phase finished (duration for the timing breakdown). */
  | { type: 'phase-done'; phase: PhaseId; durationMs: number }
  | { type: 'refs'; target: RunTarget; refs: RefsInfo }
  | { type: 'stack'; stack: StackProfile }
  | { type: 'analyzers'; runs: AnalyzerRun[]; hits: number }
  | { type: 'plan'; plan: ReviewPlan }
  | { type: 'chunk-start'; chunk: Chunk; record: ChunkRecord }
  /** Live activity inside a running chunk (a tool call, a streamed message, a recovery step). */
  | { type: 'chunk-activity'; chunkId: string; tool?: string; note?: string }
  | { type: 'chunk-done'; chunk: Chunk; record: ChunkRecord }
  | { type: 'critique-start'; findings: number; batches: number }
  | { type: 'critique-progress'; batch: number; total: number }
  | { type: 'fallback'; role: Role; from: string; to: string; reason: string }
  | { type: 'warning'; message: string }
  | { type: 'done'; run: RunRecord };

/** A UI that can be paused while the pipeline asks the user something (e.g. a model fallback). */
export interface InteractionHost {
  /** Temporarily stop live rendering so a prompt can use the terminal. */
  pause(): void;
  resume(): void;
  /** Whether prompts are possible (interactive TTY, not CI). */
  readonly interactive: boolean;
}
