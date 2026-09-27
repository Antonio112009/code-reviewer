import { createLogUpdate } from 'log-update';
import type { ReviewEvent } from '../../review/events';
import { clean, clock, join, padEnd, plural, truncate } from './format';
import { type ChunkColumns, chunkColumns, filesCell, type Narrator, stickyHeader } from './lines';
import type { ReviewState, RunningChunk, Transition } from './state';
import type { Theme } from './theme';

const HIDE_CURSOR = '\u001B[?25l';
const SHOW_CURSOR = '\u001B[?25h';
/** A running chunk with no activity for this long is shown as idle. */
const IDLE_AFTER_MS = 30_000;

export interface FrameContext {
  theme: Theme;
  width: number;
  height: number;
  now: number;
}

function spinner(theme: Theme, now: number, offset = 0): string {
  const frames = theme.sym.spinner;
  return theme.c.cyan(frames[(Math.floor(now / 80) + offset) % frames.length]!);
}

function bar(theme: Theme, ratio: number, cells: number): string {
  const r = Math.min(1, Math.max(0, ratio));
  const full = Math.round(r * cells);
  return theme.c.green(theme.sym.barFull.repeat(full)) + theme.c.dim(theme.sym.barEmpty.repeat(cells - full));
}

function runningRow(c: RunningChunk, i: number, ctx: FrameContext, cols: ChunkColumns): string {
  const { theme, now } = ctx;
  const { c: col, sym } = theme;
  const idle = now - c.lastActivityAt;
  const activity =
    idle >= IDLE_AFTER_MS
      ? col.yellow(`idle ${clock(idle)}`)
      : c.lastTool
        ? `${col.dim(sym.activity)} ${clean(c.lastTool)}${(c.tools[c.lastTool] ?? 0) > 1 ? col.dim(`${sym.times}${c.tools[c.lastTool]}`) : ''}`
        : col.dim('thinking');
  return join(
    [
      `${spinner(theme, now, i)} ${padEnd(clean(c.id), cols.idWidth)}`,
      filesCell(c.files, cols, theme),
      clock(now - c.startedAt),
      padEnd(activity, 18),
      c.skills.length ? col.dim(c.skills.map(clean).join(', ')) : '',
    ],
    '  ',
  );
}

/**
 * The redrawn part of the live view: current phase spinner, the chunk progress bar with running chunks,
 * or the critique progress. Pure function of the state (tests render it directly).
 */
export function renderFrame(state: ReviewState, ctx: FrameContext): string {
  if (state.done) return '';
  const { theme, now, width } = ctx;
  const { c, sym } = theme;
  const dot = c.dim(` ${sym.dot} `);
  const lines: string[] = [];
  const phase = state.current && state.current.endedAt === undefined ? state.current : undefined;
  const elapsed = `${sym.clock} ${clock(now - state.startedAt)}`;
  const reviewing = phase?.id === 'review' || state.running.size > 0;
  const critiquing = phase?.id === 'critique' && state.critique !== undefined && state.critique.batches > 0;
  // Sticky one-line header while the long phases run (the persisted title may have scrolled away).
  if ((reviewing || critiquing) && ctx.height >= 8) {
    const header = stickyHeader(state, theme);
    if (header) lines.push(header);
  }

  if (reviewing) {
    const total = state.total;
    const done = state.finished.length;
    const eta = state.eta(now);
    const cells = Math.max(10, Math.min(24, Math.floor(width / 5)));
    lines.push(
      join(
        [
          `${bar(theme, total ? done / total : 0, cells)} ${c.bold(`${done}/${total}`)} chunks`,
          `${state.running.size} running`,
          state.failed ? c.red(`${state.failed} failed`) : '',
          state.rawFindings ? c.yellow(plural(state.rawFindings, 'finding')) : '',
          elapsed,
          eta !== undefined && done < total ? `ETA ~${clock(eta)}` : '',
          state.warnings.length ? c.yellow(plural(state.warnings.length, 'warning')) : '',
        ],
        dot,
      ),
    );
    const rows = [...state.running.values()].sort(
      (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
    );
    const cols = chunkColumns(state, width);
    // Keep the frame inside the terminal: header line + rows (+ "more" line) ≤ height - 1.
    const room = Math.max(1, ctx.height - 1 - lines.length);
    const shown = rows.length > room ? rows.slice(0, Math.max(0, room - 1)) : rows;
    shown.forEach((r, i) => {
      lines.push(runningRow(r, i, ctx, cols));
    });
    if (shown.length < rows.length)
      lines.push(c.dim(`  ${sym.ellipsis} +${rows.length - shown.length} more running`));
  } else if (critiquing && phase && state.critique) {
    const cr = state.critique;
    lines.push(
      join(
        [
          `${spinner(theme, now)} critique  ${bar(theme, cr.done / cr.batches, 12)} ${cr.done}/${cr.batches} batches`,
          plural(cr.findings, 'finding'),
          clock(now - phase.startedAt),
          elapsed,
        ],
        dot,
      ),
    );
  } else if (phase) {
    lines.push(
      join(
        [
          `${spinner(theme, now)} ${clean(phase.message)}`,
          c.dim(clock(now - phase.startedAt)),
          c.dim(elapsed),
        ],
        '  ',
      ),
    );
  }
  return lines.map((l) => truncate(l, Math.max(10, width - 1), sym.ellipsis).trimEnd()).join('\n');
}

export interface LiveRendererOptions {
  stream: NodeJS.WriteStream;
  state: ReviewState;
  narrator: Narrator;
  theme: Theme;
  now: () => number;
  /** Redraw interval (default 100 ms). */
  intervalMs?: number;
}

/**
 * Live dashboard on a TTY (log-update on stderr): finished work is persisted above a small redrawn
 * area. Rendering is state-driven on a timer, so bursts of events cost nothing extra.
 */
export class LiveRenderer {
  private readonly log: ReturnType<typeof createLogUpdate>;
  private timer: NodeJS.Timeout | undefined;
  private pauses = 0;
  private stopped = false;
  private cursorHidden = false;
  private readonly pending: string[] = [];
  private readonly onResize = () => this.render();
  private readonly onExit = () => this.showCursor();

  constructor(private readonly o: LiveRendererOptions) {
    // showCursor: true — we manage the cursor on *our* stream (log-update would use process.stderr).
    this.log = createLogUpdate(o.stream, { showCursor: true });
  }

  start(): void {
    this.hideCursor();
    this.o.stream.on?.('resize', this.onResize);
    process.on('exit', this.onExit);
    this.startTimer();
    this.render();
  }

  handle(e: ReviewEvent, t: Transition): void {
    if (this.stopped) return;
    const lines = this.o.narrator.lines(e, t, this.o.state);
    if (lines.length) this.print(lines);
    else if (e.type !== 'chunk-activity') this.render();
  }

  /** Writes lines above the live area (buffered while paused). */
  print(lines: string[]): void {
    if (this.stopped) {
      this.write(`${lines.join('\n')}\n`);
      return;
    }
    if (this.pauses > 0) {
      this.pending.push(...lines);
      return;
    }
    // Long lines (refs notes, warnings) wrap in the scrollback rather than losing their end.
    const text = lines.join('\n');
    this.safe(() => this.log.persist(text));
    this.render();
  }

  render(): void {
    if (this.stopped || this.pauses > 0) return;
    const frame = renderFrame(this.o.state, {
      theme: this.o.theme,
      width: this.width(),
      height: this.o.stream.rows ?? 24,
      now: this.o.now(),
    });
    this.safe(() => (frame ? this.log(frame) : this.log.clear()));
  }

  pause(): void {
    if (this.stopped) return;
    this.pauses++;
    if (this.pauses > 1) return;
    this.stopTimer();
    this.safe(() => this.log.clear());
    this.showCursor();
  }

  resume(): void {
    if (this.stopped || this.pauses === 0) return;
    this.pauses--;
    if (this.pauses > 0) return;
    this.hideCursor();
    if (this.pending.length) this.print(this.pending.splice(0));
    this.startTimer();
    this.render();
  }

  /** Clears the live area and restores the terminal (idempotent). */
  stop(): void {
    if (this.stopped) return;
    this.stopTimer();
    this.safe(() => {
      this.log.clear();
      this.log.done();
    });
    this.stopped = true;
    this.pauses = 0;
    if (this.pending.length) this.write(`${this.pending.splice(0).join('\n')}\n`);
    this.showCursor();
    this.o.stream.off?.('resize', this.onResize);
    process.off('exit', this.onExit);
  }

  private width(): number {
    return this.o.stream.columns || 80;
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.render(), this.o.intervalMs ?? 100);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private hideCursor(): void {
    if (this.cursorHidden) return;
    this.cursorHidden = true;
    this.write(HIDE_CURSOR);
  }

  private showCursor(): void {
    if (!this.cursorHidden) return;
    this.cursorHidden = false;
    this.write(SHOW_CURSOR);
  }

  private write(s: string): void {
    this.safe(() => this.o.stream.write(s));
  }

  /** Terminal writes can throw (EIO after SIGHUP, closed pipe): never let the UI crash the run. */
  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}
