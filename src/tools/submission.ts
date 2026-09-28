import { renameSync, writeFileSync } from 'node:fs';
import type { ReportedFinding, ReportedVerdict, SubmitFindings, SubmitVerdicts } from '../types';

/** One call of our read tools, for the run log and the chunk artifacts. */
export interface ToolCallEntry {
  name: string;
  /** The arguments as JSON, clipped. */
  args: string;
  /** Size of the result shown to the model. */
  chars: number;
  lines: number;
  /** The tool failed (the model got an error message). */
  error?: boolean;
  ms: number;
}

export interface Submission {
  findings?: ReportedFinding[];
  verdicts?: ReportedVerdict[];
  notes?: string[];
  calls: number;
  /** Files the model read through our tools (root-relative): a cached result is valid while they are unchanged. */
  reads?: string[];
  /** Our read-tool calls, in order (submit calls not included). */
  toolLog?: ToolCallEntry[];
}

/** Most distinct files recorded as read by one task. */
const MAX_READS = 500;
/** Most tool calls logged per task. */
const MAX_TOOL_LOG = 300;

/**
 * Accumulates `submit_*` tool calls. Models sometimes submit in several calls,
 * so findings are appended and verdicts are merged by id (last wins).
 * With `file` set, every update is atomically persisted — used by `mcp-serve`, which runs
 * in a process spawned by the ACP agent and hands results back to us through that file.
 */
export class SubmissionCollector {
  private state: Submission = { calls: 0 };

  constructor(private readonly file?: string) {}

  add(kind: 'findings', payload: SubmitFindings): void;
  add(kind: 'verdicts', payload: SubmitVerdicts): void;
  add(kind: 'findings' | 'verdicts', payload: SubmitFindings | SubmitVerdicts): void {
    this.state.calls++;
    if (kind === 'findings') {
      const p = payload as SubmitFindings;
      this.state.findings = [...(this.state.findings ?? []), ...p.findings];
      if (p.notes) this.state.notes = [...(this.state.notes ?? []), p.notes];
    } else {
      const byId = new Map((this.state.verdicts ?? []).map((v) => [v.id, v]));
      for (const v of (payload as SubmitVerdicts).verdicts) byId.set(v.id, v);
      this.state.verdicts = [...byId.values()];
    }
    this.persist();
  }

  /** Records a file a tool showed to the model (root-relative, posix). */
  noteRead(rel: string): void {
    const reads = this.state.reads ?? [];
    if (reads.includes(rel) || reads.length >= MAX_READS) return;
    this.state.reads = [...reads, rel];
    this.persist();
  }

  /** Records one read-tool call. */
  noteCall(entry: ToolCallEntry): void {
    const log = this.state.toolLog ?? [];
    if (log.length >= MAX_TOOL_LOG) return;
    this.state.toolLog = [...log, entry];
    this.persist();
  }

  get submission(): Submission {
    return this.state;
  }

  get submitted(): boolean {
    return this.state.calls > 0;
  }

  private persist(): void {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
  }
}
