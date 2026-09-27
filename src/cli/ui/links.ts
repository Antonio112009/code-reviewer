import path from 'node:path';
import { pathToFileURL } from 'node:url';
import terminalLink from 'terminal-link';
import type { UiSettings } from '../../config/schema';
import { clean } from './format';
import { isCI } from './theme';

type Env = Record<string, string | undefined>;

/** How file locations are rendered: OSC 8 link to `file://…`, to `vscode://file/…`, or plain text. */
export type LinkMode = 'file' | 'vscode' | 'off';

function version(v: string | undefined): [number, number] {
  const [major = 0, minor = 0] = (v ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  return [major, minor];
}

/** OSC 8 support from the environment (a subset of `supports-hyperlinks`, usable for any stream). */
export function envSupportsHyperlinks(env: Env): boolean {
  if (env.WT_SESSION) return true;
  const [major, minor] = version(env.TERM_PROGRAM_VERSION);
  switch (env.TERM_PROGRAM) {
    case 'iTerm.app':
      return major > 3 || (major === 3 && minor >= 1);
    case 'WezTerm':
    case 'ghostty':
    case 'zed':
      return true;
    case 'vscode':
      return major > 1 || (major === 1 && minor >= 72);
  }
  if (env.VTE_VERSION && env.VTE_VERSION !== '0.50.0') {
    const n = Number.parseInt(env.VTE_VERSION, 10);
    return n >= 5000;
  }
  return env.TERM === 'xterm-kitty' || env.TERM === 'alacritty' || env.TERM === 'xterm-ghostty';
}

/**
 * Resolves the `ui.hyperlinks` setting. Links are never emitted to a non-TTY stream or in CI (log viewers
 * print the raw escape codes) unless FORCE_HYPERLINK=1; FORCE_HYPERLINK=0 always disables them.
 * `auto` picks `file` links on terminals known to support OSC 8 — except in the VS Code terminal, whose
 * own `path:line` detection jumps to the line (an OSC 8 `file://` link would not).
 */
export function resolveLinkMode(
  setting: UiSettings['hyperlinks'],
  stream: { isTTY?: boolean },
  env: Env,
  isStderr = false,
): LinkMode {
  if (setting === 'off') return 'off';
  const force = env.FORCE_HYPERLINK;
  if (force !== undefined && force !== '') {
    if (Number.parseInt(force, 10) === 0) return 'off';
    return setting === 'vscode' ? 'vscode' : 'file';
  }
  if (stream.isTTY !== true || isCI(env) || env.TERM === 'dumb') return 'off';
  if (setting === 'file' || setting === 'vscode') return setting;
  if (env.TERM_PROGRAM === 'vscode') return 'off';
  const supported = envSupportsHyperlinks(env) || (isStderr && terminalLink.stderr.isSupported);
  return supported ? 'file' : 'off';
}

/** OSC 8 hyperlink escape sequence. */
export function osc8(text: string, url: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}

/** `vscode://file/<abs>:<line>:<col>` with every path segment percent-encoded. */
export function vscodeUrl(abs: string, line?: number, col?: number): string {
  const posix = abs.split(path.sep).join('/');
  const encoded = posix
    .split('/')
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  const withSlash = encoded.startsWith('/') ? encoded : `/${encoded}`;
  const pos = line ? `:${line}${col ? `:${col}` : ''}` : '';
  return `vscode://file${withSlash}${pos}`;
}

export interface Linker {
  readonly mode: LinkMode;
  /**
   * A clickable `path:line[-end]` for a repository-relative file (display path relative to `cwd`).
   * Paths escaping the repository root are shown without a link.
   */
  location(file: string, startLine?: number, endLine?: number): string;
  /**
   * A clickable absolute path (reports, run directory); always a `file://` target. The visible text is
   * the path relative to `cwd` unless `text` is given.
   */
  path(absPath: string, text?: string): string;
}

export function createLinker(opts: { mode: LinkMode; cwd: string; root?: string }): Linker {
  const root = path.resolve(opts.root ?? opts.cwd);
  const cwd = path.resolve(opts.cwd);
  const display = (abs: string) => {
    const rel = path.relative(cwd, abs);
    return !rel || path.isAbsolute(rel) ? abs : rel.split(path.sep).join('/');
  };
  return {
    mode: opts.mode,
    location(file, startLine, endLine) {
      const abs = path.resolve(root, file);
      const rel = path.relative(root, abs);
      const inside = rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
      const range = startLine ? `:${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}` : '';
      const text = `${clean(inside ? display(abs) : file)}${range}`;
      if (!inside || opts.mode === 'off') return text;
      const url = opts.mode === 'vscode' ? vscodeUrl(abs, startLine, 1) : pathToFileURL(abs).href;
      return osc8(text, url);
    },
    path(absPath, label) {
      const abs = path.resolve(absPath);
      const text = clean(label ?? display(abs));
      return opts.mode === 'off' ? text : osc8(text, pathToFileURL(abs).href);
    },
  };
}
