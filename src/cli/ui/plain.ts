import type { ReviewEvent } from '../../review/events';
import { clean, clock, join } from './format';
import type { Narrator } from './lines';
import type { ReviewState, Transition } from './state';
import type { Theme } from './theme';

export interface PlainRendererOptions {
  stream: NodeJS.WritableStream;
  state: ReviewState;
  narrator: Narrator;
  theme: Theme;
  now: () => number;
  /** Print a heartbeat after this much silence (default 60 s; CI systems kill silent jobs). */
  heartbeatMs?: number;
}

/**
 * Line-oriented progress for CI logs and pipes: one line per state change, prefixed with the elapsed
 * time, a heartbeat when nothing happened for a minute, no cursor control.
 */
export class PlainRenderer {
  private timer: NodeJS.Timeout | undefined;
  private lastWrite: number;
  private pauses = 0;
  private stopped = false;
  private readonly pending: string[] = [];

  constructor(private readonly o: PlainRendererOptions) {
    this.lastWrite = o.now();
  }

  private get heartbeatMs(): number {
    return this.o.heartbeatMs ?? 60_000;
  }

  start(): void {
    // Check 4× per period so the longest silence is ~1.25 × heartbeatMs.
    this.timer = setInterval(() => this.heartbeat(), Math.max(1000, Math.floor(this.heartbeatMs / 4)));
    this.timer.unref?.();
  }

  handle(e: ReviewEvent, t: Transition): void {
    if (this.stopped) return;
    const lines = this.o.narrator.lines(e, t, this.o.state);
    if (lines.length) this.print(lines);
  }

  print(lines: string[]): void {
    if (this.pauses > 0 && !this.stopped) {
      this.pending.push(...lines.map((l) => this.stamp(l)));
      return;
    }
    this.write(lines.map((l) => this.stamp(l)));
  }

  /** Prints a "still working" line if nothing was printed for `heartbeatMs`. */
  heartbeat(): void {
    if (this.stopped || this.pauses > 0 || this.o.state.done) return;
    if (this.o.now() - this.lastWrite < this.heartbeatMs) return;
    this.print([this.heartbeatLine()]);
  }

  heartbeatLine(): string {
    const { state, theme } = this.o;
    const { sym } = theme;
    const now = this.o.now();
    const phase = state.current && state.current.endedAt === undefined ? state.current : undefined;
    const running = [...state.running.values()]
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
      .map((c) => join([clean(c.id), clock(now - c.startedAt), c.lastTool ? clean(c.lastTool) : ''], ' '));
    if (phase?.id === 'review' || state.running.size > 0) {
      return theme.c.dim(
        join(
          [
            `${sym.ellipsis} still reviewing: ${state.finished.length}/${state.total} chunks done`,
            running.length ? `running ${running.join(', ')}` : '',
          ],
          ` ${sym.dot} `,
        ),
      );
    }
    if (phase?.id === 'critique' && state.critique) {
      return theme.c.dim(
        `${sym.ellipsis} still in self-critique: ${state.critique.done}/${state.critique.batches} batches done (${clock(now - phase.startedAt)})`,
      );
    }
    if (phase)
      return theme.c.dim(
        `${sym.ellipsis} still working: ${clean(phase.message)} (${clock(now - phase.startedAt)})`,
      );
    return theme.c.dim(`${sym.ellipsis} still working`);
  }

  pause(): void {
    if (!this.stopped) this.pauses++;
  }

  resume(): void {
    if (this.stopped || this.pauses === 0) return;
    this.pauses--;
    if (this.pauses === 0 && this.pending.length) this.write(this.pending.splice(0));
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.pauses = 0;
    if (this.pending.length) this.write(this.pending.splice(0));
  }

  private stamp(line: string): string {
    return `${this.o.theme.c.dim(`[${clock(this.o.now() - this.o.state.startedAt)}]`)} ${line}`;
  }

  private write(lines: string[]): void {
    this.lastWrite = this.o.now();
    try {
      this.o.stream.write(`${lines.join('\n')}\n`);
    } catch {
      // EIO after SIGHUP / closed pipe: progress output is best effort.
    }
  }
}
