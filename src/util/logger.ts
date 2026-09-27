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

/**
 * Minimal stderr logger — stdout is reserved for machine-readable output. While a live terminal UI is
 * active, `setSink` routes lines through it so log output does not corrupt the redrawn area.
 */
export class Logger {
  private sink?: (line: string) => void;

  constructor(public level: LogLevel = 'info') {}

  /** Route output through `sink` (e.g. the live UI); `undefined` restores direct stderr writes. */
  setSink(sink: ((line: string) => void) | undefined): void {
    this.sink = sink;
  }

  private enabled(level: LogLevel): boolean {
    return ORDER[level] <= ORDER[this.level];
  }

  private write(line: string): void {
    if (this.sink) this.sink(line);
    else {
      try {
        process.stderr.write(`${line}\n`);
      } catch {
        // EPIPE / EIO after the terminal went away: nothing useful left to do
      }
    }
  }

  error(msg: string): void {
    if (this.enabled('error')) this.write(`${pc.red('✖')} ${sanitizeLogText(msg)}`);
  }
  warn(msg: string): void {
    if (this.enabled('warn')) this.write(`${pc.yellow('!')} ${sanitizeLogText(msg)}`);
  }
  info(msg: string): void {
    if (this.enabled('info')) this.write(sanitizeLogText(msg));
  }
  /** Secondary information (hints, where something was saved), dimmed. */
  note(msg: string): void {
    if (this.enabled('info')) this.write(pc.dim(sanitizeLogText(msg)));
  }
  step(msg: string): void {
    if (this.enabled('info')) this.write(`${pc.cyan('›')} ${sanitizeLogText(msg)}`);
  }
  success(msg: string): void {
    if (this.enabled('info')) this.write(`${pc.green('✔')} ${sanitizeLogText(msg)}`);
  }
  debug(msg: string): void {
    if (this.enabled('debug')) this.write(pc.dim(`[debug] ${sanitizeLogText(msg)}`));
  }
}

export const silentLogger = new Logger('silent');
