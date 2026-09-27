import { renameSync, writeFileSync } from 'node:fs';
import type { ReportedFinding, ReportedVerdict, SubmitFindings, SubmitVerdicts } from '../types';

export interface Submission {
  findings?: ReportedFinding[];
  verdicts?: ReportedVerdict[];
  notes?: string[];
  calls: number;
}

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
