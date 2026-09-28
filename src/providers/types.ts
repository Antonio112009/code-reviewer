import type { SkillCatalog } from '../skills/catalog';
import type { SubmitKind } from '../tools/definitions';
import type { Submission } from '../tools/submission';
import type { ReasoningLevel, Usage } from '../types';

/** One unit of LLM work: review a chunk, or critique a batch of findings. */
export interface AgentTask {
  kind: SubmitKind;
  /** Short label for logs (e.g. chunk id). */
  label: string;
  /** System-level instructions. ACP agents have no system prompt, so they get it prepended. */
  instructions: string;
  prompt: string;
  model?: string;
  reasoning: ReasoningLevel;
  /** Expose read-only exploration tools (read_file, grep, ...). The submit tool is always exposed. */
  readTools: boolean;
  /** Review root: every file access is confined to it. */
  root: string;
  git: boolean;
  maxSteps: number;
  timeoutMs: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** Cancel when the agent sends no update for this long (ACP); defaults to no stall detection. */
  stallTimeoutMs?: number;
  /** Live activity for progress UIs (tool calls as they happen). */
  onActivity?: (activity: AgentActivity) => void;
  /**
   * Skill catalog for the on-demand `list_skills` / `get_skill` tools (in-process providers). ACP agents
   * get the same tools from `code-reviewer mcp-serve --project-root`.
   */
  skills?: SkillCatalog;
  /** Repository root used to load project skills in `mcp-serve` (ACP). */
  projectRoot?: string;
  /** Skill ids hidden from the skill tools (`review.skillsExclude`). */
  skillsExclude?: string[];
  /** Review depth the skill tools serve (`essential`: essential-tier skills and bullets only). */
  skillDepth?: 'essential' | 'full';
  /**
   * When the turn runs out of time, steps or output without submitting, ask the model for what it has so
   * far (one short extra turn) instead of losing the work. Default: on.
   */
  salvage?: boolean;
}

export type AgentActivity = { kind: 'tool'; name: string } | { kind: 'message' };

export interface AgentResult {
  submission: Submission;
  /** Final assistant text (used as a fallback when the submit tool was not called). */
  text: string;
  usage?: Usage;
  model?: string;
  stopReason?: string;
  /** The turn was cut short by our task timeout or stall watchdog (`stopReason` is then `cancelled`). */
  interruptedBy?: 'timeout' | 'stalled';
  /** Why the model was asked to submit early (see `AgentTask.salvage`); set when that happened. */
  salvaged?: string;
  /**
   * Files the model read (root-relative, posix), through our tools or the agent's own read/search tools
   * as far as they are reported: a cached result stays valid while they are unchanged.
   */
  reads?: string[];
  toolCalls: number;
  /** Tool calls by normalised tool name (read_file, grep, submit_findings, Read, …). */
  toolUsage?: Record<string, number>;
  warnings: string[];
}

export type ProviderKind = 'api' | 'acp' | 'mock';

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  run(task: AgentTask): Promise<AgentResult>;
  dispose(): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
