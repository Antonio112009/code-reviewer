import type { PhaseId, ReviewEvent, ReviewPlan } from '../../review/events';
import type { AnalyzerRun, ChunkRecord, RefsInfo, Role, RunTarget, StackProfile } from '../../types';

export interface PhaseState {
  id: PhaseId;
  message: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
}

export interface RunningChunk {
  id: string;
  files: string[];
  contextFiles: string[];
  skills: string[];
  hints: number;
  tokens: number;
  startedAt: number;
  lastActivityAt: number;
  lastTool?: string;
  tools: Record<string, number>;
}

export interface FinishedChunk {
  record: ChunkRecord;
  /** Tool calls: from the record, else counted from activity events. */
  tools: Record<string, number>;
  durationMs: number;
  finishedAt: number;
  /** 1-based completion order. */
  index: number;
}

export interface CritiqueState {
  findings: number;
  batches: number;
  done: number;
  startedAt: number;
}

/** What changed when an event was applied (renderers print lines for these). */
export interface Transition {
  /** Phases that ended because of this event (explicit `phase-done` or a new phase starting). */
  ended: PhaseState[];
  /** The phase that started. */
  started?: PhaseState;
  finished?: FinishedChunk;
}

/**
 * Review progress model built from the pipeline's event stream. Pure bookkeeping: rendering lives in
 * `live.ts` / `plain.ts`, time comes from the caller (injectable clock).
 */
export class ReviewState {
  readonly startedAt: number;
  phases: PhaseState[] = [];
  current?: PhaseState;
  target?: RunTarget;
  refs?: RefsInfo;
  stack?: StackProfile;
  analyzers?: { runs: AnalyzerRun[]; hits: number };
  plan?: ReviewPlan;
  readonly running = new Map<string, RunningChunk>();
  readonly finished: FinishedChunk[] = [];
  failed = 0;
  rawFindings = 0;
  maxConcurrent = 0;
  critique?: CritiqueState;
  readonly fallbacks: Array<{ role: Role; from: string; to: string; reason: string }> = [];
  readonly warnings: string[] = [];
  done = false;

  constructor(now: number) {
    this.startedAt = now;
  }

  /** Total chunks (planned, else seen so far). */
  get total(): number {
    return this.plan?.chunks.length ?? this.finished.length + this.running.size;
  }

  apply(e: ReviewEvent, now: number): Transition {
    const t: Transition = { ended: [] };
    switch (e.type) {
      case 'phase': {
        if (this.current && this.current.endedAt === undefined)
          t.ended.push(this.endPhase(this.current, now));
        const phase: PhaseState = { id: e.phase, message: e.message, startedAt: now };
        this.phases.push(phase);
        this.current = phase;
        t.started = phase;
        break;
      }
      case 'phase-done': {
        let phase = [...this.phases].reverse().find((p) => p.id === e.phase);
        if (!phase) {
          phase = { id: e.phase, message: e.phase, startedAt: now - e.durationMs };
          this.phases.push(phase);
        }
        if (phase.endedAt === undefined) {
          phase.endedAt = now;
          t.ended.push(phase);
        }
        phase.durationMs = e.durationMs;
        break;
      }
      case 'refs':
        this.target = e.target;
        this.refs = e.refs;
        break;
      case 'stack':
        this.stack = e.stack;
        break;
      case 'analyzers':
        this.analyzers = { runs: e.runs, hits: e.hits };
        break;
      case 'plan':
        this.plan = e.plan;
        this.target ??= e.plan.target;
        this.refs ??= e.plan.refs;
        this.stack ??= e.plan.stack;
        if (!this.analyzers && e.plan.analyzers) {
          const hits = e.plan.analyzers.reduce((n, r) => n + (r.status === 'ok' ? r.hits : 0), 0);
          this.analyzers = { runs: e.plan.analyzers, hits };
        }
        break;
      case 'chunk-start': {
        const r = e.record;
        this.running.set(e.chunk.id, {
          id: e.chunk.id,
          files: e.chunk.files,
          contextFiles: e.chunk.contextFiles ?? [],
          skills: r.skills,
          hints: r.hints ?? 0,
          tokens: e.chunk.tokens,
          startedAt: now,
          lastActivityAt: now,
          tools: {},
        });
        this.maxConcurrent = Math.max(this.maxConcurrent, this.running.size);
        break;
      }
      case 'chunk-activity': {
        const c = this.running.get(e.chunkId);
        if (!c) break;
        c.lastActivityAt = now;
        if (e.tool) {
          c.lastTool = e.tool;
          c.tools[e.tool] = (c.tools[e.tool] ?? 0) + 1;
        } else if (e.note) c.lastTool = e.note;
        break;
      }
      case 'chunk-done': {
        const c = this.running.get(e.chunk.id);
        this.running.delete(e.chunk.id);
        const r = e.record;
        const tools = r.toolCalls && Object.keys(r.toolCalls).length ? r.toolCalls : (c?.tools ?? {});
        const finished: FinishedChunk = {
          record: r,
          tools,
          durationMs: r.durationMs ?? (c ? now - c.startedAt : 0),
          finishedAt: now,
          index: this.finished.length + 1,
        };
        this.finished.push(finished);
        if (r.status === 'failed') this.failed++;
        else this.rawFindings += r.findings;
        t.finished = finished;
        break;
      }
      case 'critique-start':
        this.critique = { findings: e.findings, batches: e.batches, done: 0, startedAt: now };
        break;
      case 'critique-progress':
        this.critique ??= { findings: 0, batches: e.total, done: 0, startedAt: now };
        this.critique.batches = e.total;
        this.critique.done = Math.max(this.critique.done, e.batch);
        break;
      case 'fallback':
        this.fallbacks.push({ role: e.role, from: e.from, to: e.to, reason: e.reason });
        break;
      case 'warning':
        this.warnings.push(e.message);
        break;
      case 'done':
        t.ended.push(...this.finish(now));
        break;
    }
    return t;
  }

  /** Ends the open phase (end of run). */
  finish(now: number): PhaseState[] {
    this.done = true;
    const ended: PhaseState[] = [];
    if (this.current && this.current.endedAt === undefined) ended.push(this.endPhase(this.current, now));
    return ended;
  }

  private endPhase(p: PhaseState, now: number): PhaseState {
    p.endedAt = now;
    p.durationMs ??= now - p.startedAt;
    return p;
  }

  /** Phase durations in execution order (the same phase may run more than once: summed). */
  timings(): Array<{ id: PhaseId; ms: number }> {
    const out: Array<{ id: PhaseId; ms: number }> = [];
    for (const p of this.phases) {
      if (p.durationMs === undefined) continue;
      const prev = out.find((x) => x.id === p.id);
      if (prev) prev.ms += p.durationMs;
      else out.push({ id: p.id, ms: p.durationMs });
    }
    return out;
  }

  /**
   * Remaining time estimate for the review phase: average chunk duration × queued work, spread over the
   * observed concurrency. Undefined until a chunk has finished.
   */
  eta(now: number): number | undefined {
    const ok = this.finished.filter((f) => f.durationMs > 0);
    if (ok.length === 0) return undefined;
    const avg = ok.reduce((n, f) => n + f.durationMs, 0) / ok.length;
    const queued = Math.max(0, this.total - this.finished.length - this.running.size);
    let work = queued * avg;
    for (const c of this.running.values()) work += Math.max(avg - (now - c.startedAt), avg * 0.1);
    const lanes = Math.max(1, this.maxConcurrent);
    return work / lanes;
  }
}
