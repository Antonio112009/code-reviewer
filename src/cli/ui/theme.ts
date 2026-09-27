import pc from 'picocolors';
import type { Severity } from '../../types';

export type Colors = ReturnType<typeof pc.createColors>;

type Env = Record<string, string | undefined>;

/** Environment variables set by common CI systems. */
const CI_VARS = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'BUILD_NUMBER',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'TF_BUILD',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BITBUCKET_BUILD_NUMBER',
];

export function isCI(env: Env): boolean {
  return CI_VARS.some((k) => {
    const v = env[k];
    return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
  });
}

/** FORCE_COLOR: undefined = not set, true = force on, false = force off (`0` / `false`). */
function forceColor(env: Env): boolean | undefined {
  const v = env.FORCE_COLOR;
  if (v === undefined) return undefined;
  if (v === '0' || v.toLowerCase() === 'false') return false;
  return true;
}

/**
 * Whether to emit colors on `stream`: NO_COLOR (non-empty) always wins, then FORCE_COLOR, then
 * TERM=dumb; otherwise colors only on a TTY — and never in plain mode unless forced.
 */
export function colorEnabled(stream: { isTTY?: boolean }, env: Env, plain = false): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  const forced = forceColor(env);
  if (forced !== undefined) return forced;
  if (plain) return false;
  if (env.TERM === 'dumb') return false;
  return stream.isTTY === true;
}

/** Mirrors `is-unicode-supported`: every non-Windows terminal except the Linux console, modern Windows hosts. */
export function unicodeEnabled(env: Env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return env.TERM !== 'linux';
  return (
    Boolean(env.WT_SESSION) ||
    Boolean(env.TERMINUS_SUBLIME) ||
    env.ConEmuTask === '{cmd::Cmder}' ||
    env.TERM_PROGRAM === 'Terminus-Sublime' ||
    env.TERM_PROGRAM === 'vscode' ||
    env.TERM === 'xterm-256color' ||
    env.TERM === 'alacritty' ||
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  );
}

export interface Symbols {
  ok: string;
  fail: string;
  warn: string;
  info: string;
  dot: string;
  ellipsis: string;
  arrow: string;
  back: string;
  barFull: string;
  barEmpty: string;
  spinner: string[];
  clock: string;
  dash: string;
  times: string;
  start: string;
  diamond: string;
  activity: string;
  analyzer: Record<'ok' | 'skipped' | 'failed' | 'timeout', string>;
}

const UNICODE: Symbols = {
  ok: '✔',
  fail: '✖',
  warn: '!',
  info: 'ℹ',
  dot: '·',
  ellipsis: '…',
  arrow: '→',
  back: '↪',
  barFull: '█',
  barEmpty: '░',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  clock: '⏱',
  dash: '–',
  times: '×',
  start: '▶',
  diamond: '◆',
  activity: '↳',
  analyzer: { ok: '✓', skipped: '–', failed: '✖', timeout: '⏱' },
};

const ASCII: Symbols = {
  ok: 'v',
  fail: 'x',
  warn: '!',
  info: 'i',
  dot: '-',
  ellipsis: '...',
  arrow: '->',
  back: '->',
  barFull: '#',
  barEmpty: '.',
  spinner: ['-', '\\', '|', '/'],
  clock: 't',
  dash: '-',
  times: 'x',
  start: '>',
  diamond: '*',
  activity: '>',
  analyzer: { ok: 'ok', skipped: '-', failed: 'x', timeout: 'timeout' },
};

export interface Theme {
  readonly color: boolean;
  readonly unicode: boolean;
  readonly c: Colors;
  readonly sym: Symbols;
  /** `CRITICAL` / `MAJOR` … label, padded to 8 columns, styled per severity. */
  severityLabel(s: Severity): string;
  /** Colors `text` like severity `s`. */
  severity(s: Severity, text: string): string;
}

export function createTheme(color: boolean, unicode = true): Theme {
  const c = pc.createColors(color);
  const style: Record<Severity, (s: string) => string> = {
    critical: (s) => c.bold(c.red(s)),
    major: (s) => c.red(s),
    minor: (s) => c.yellow(s),
    info: (s) => c.cyan(s),
  };
  const label: Record<Severity, (s: string) => string> = {
    critical: (s) => (color ? c.bgRed(c.white(c.bold(s))) : s),
    major: (s) => c.bold(c.red(s)),
    minor: (s) => c.yellow(s),
    info: (s) => c.cyan(s),
  };
  return {
    color,
    unicode,
    c,
    sym: unicode ? UNICODE : ASCII,
    // Unknown severities (runs recorded by older versions) render unstyled instead of throwing.
    severityLabel: (s) => (label[s] ?? String)(String(s).toUpperCase().padEnd(8)),
    severity: (s, text) => (style[s] ?? String)(text),
  };
}
