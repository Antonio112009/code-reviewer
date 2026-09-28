import pc from 'picocolors';
import { stripUnsafeChars } from '../report/common';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/**
 * Messages routinely quote untrusted text (config errors naming the reviewed repository's keys, agent
 * tool titles, agent stderr), so escape sequences, control characters and bidi controls are removed
 * before anything reaches the terminal. `\n` and `\t` stay; `\r` would let a message overwrite its line.
 * Only the logger's own markers are styled.
 */
function sanitizeLogText(msg: string): string {
  return stripUnsafeChars(String(msg)).replace(/\r/g, '');
}

/** Receives every message, whatever the console level (e.g. a run's log file). */
export type LogTap = (level: Exclude<LogLevel, 'silent'>, message: string) => void;

/**
 * Minimal stderr logger — stdout is reserved for machine-readable output. While a live terminal UI is
 * active, `setSink` routes lines through it so log output does not corrupt the redrawn area.
 */
export class Logger {
  private sink?: (line: string) => void;
  private readonly taps = new Set<LogTap>();

  constructor(
    public level: LogLevel = 'info',
    /** A child logger prints through its parent (sink and level included) and has taps of its own. */
    private readonly parent?: Logger,
  ) {}

  /** A logger for one run: same output, plus taps that only see this run's messages. */
  child(): Logger {
    return new Logger(this.level, this);
  }

  /** Adds a tap for every message from now on; returns the function that removes it. */
  tap(fn: LogTap): () => void {
    this.taps.add(fn);
    return () => this.taps.delete(fn);
  }

  /** Route output through `sink` (e.g. the live UI); `undefined` restores direct stderr writes. */
  setSink(sink: ((line: string) => void) | undefined): void {
    if (this.parent) this.parent.setSink(sink);
    else this.sink = sink;
  }

  private enabled(level: LogLevel): boolean {
    return ORDER[level] <= ORDER[this.parent?.level ?? this.level];
  }

  private write(line: string): void {
    if (this.parent) {
      this.parent.write(line);
      return;
    }
    if (this.sink) this.sink(line);
    else {
      try {
        process.stderr.write(`${line}\n`);
      } catch {
        // EPIPE / EIO after the terminal went away: nothing useful left to do
      }
    }
  }

  /** Taps (this logger's and its parents') get the plain message, whatever is printed. */
  private notify(level: Exclude<LogLevel, 'silent'>, msg: string): void {
    for (const tap of this.taps) {
      try {
        tap(level, msg);
      } catch {
        // a failing tap must not break logging
      }
    }
    this.parent?.notify(level, msg);
  }

  private log(level: Exclude<LogLevel, 'silent'>, msg: string, format: (text: string) => string): void {
    const text = sanitizeLogText(msg);
    this.notify(level, text);
    if (this.enabled(level)) this.write(format(text));
  }

  error(msg: string): void {
    this.log('error', msg, (t) => `${pc.red('✖')} ${t}`);
  }
  warn(msg: string): void {
    this.log('warn', msg, (t) => `${pc.yellow('!')} ${t}`);
  }
  info(msg: string): void {
    this.log('info', msg, (t) => t);
  }
  /** Secondary information (hints, where something was saved), dimmed. */
  note(msg: string): void {
    this.log('info', msg, (t) => pc.dim(t));
  }
  step(msg: string): void {
    this.log('info', msg, (t) => `${pc.cyan('›')} ${t}`);
  }
  success(msg: string): void {
    this.log('info', msg, (t) => `${pc.green('✔')} ${t}`);
  }
  debug(msg: string): void {
    this.log('debug', msg, (t) => pc.dim(`[debug] ${t}`));
  }
}

export const silentLogger = new Logger('silent');
