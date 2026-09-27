import path from 'node:path';
import { stripUnsafeChars } from '../../report/common';

// Terminal text helpers. Everything printed by the UI that originates from the reviewed repository or a
// model (paths, titles, descriptions, errors) must go through `clean`/`sanitize`: a malicious file name
// or model reply could otherwise carry escape sequences (OSC 52 clipboard writes, fake output, title
// changes) straight into the user's terminal.

/** CSI, OSC (BEL or ST terminated) and two-byte escape sequences. */
const ANSI = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/**
 * Removes escape sequences, control characters (keeping `\n` and `\t`; `\r` would let text overwrite
 * the line it is on) and bidi controls.
 */
export function sanitize(s: string): string {
  return stripUnsafeChars(s).replace(/\r/g, '');
}

/** Untrusted value → safe single line (whitespace collapsed). */
export function clean(value: unknown): string {
  return sanitize(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const EMOJI = /^\p{Extended_Pictographic}$/u;

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Terminal columns taken by one code point (0, 1 or 2). */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1;
  if (ZERO_WIDTH.test(ch) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (isWide(cp)) return 2;
  // Pictographs with emoji presentation by default (⏱ U+23F1 is text-presentation → 1 column).
  if (cp >= 0x1f000 && EMOJI.test(ch)) return 2;
  return 1;
}

/** Visible width of a string that may contain ANSI escapes. */
export function visibleWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch);
  return w;
}

/**
 * Cuts `s` to at most `width` visible columns (adding `ellipsis`), keeping escape sequences intact:
 * styles and hyperlinks opened before the cut are still closed.
 */
export function truncate(s: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return '';
  if (visibleWidth(s) <= width) return s;
  const target = Math.max(0, width - visibleWidth(ellipsis));
  let out = '';
  let used = 0;
  let cut = false;
  let i = 0;
  const re = new RegExp(ANSI.source, 'y');
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i) ?? 0);
    i += ch.length;
    if (cut) continue;
    const w = charWidth(ch);
    if (used + w > target) {
      out += ellipsis;
      cut = true;
      continue;
    }
    out += ch;
    used += w;
  }
  return out;
}

/** Pads to `width` visible columns (never truncates). */
export function padEnd(s: string, width: number): string {
  const w = visibleWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}

export function padStart(s: string, width: number): string {
  const w = visibleWidth(s);
  return w >= width ? s : ' '.repeat(width - w) + s;
}

/** Stopwatch: `01:42`, `1:02:03`. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/**
 * Short file list for one line: the full list when it fits `max` columns, otherwise the largest group
 * of same-directory, same-extension files as a glob plus a count (`src/api/*.ts +2`).
 */
export function compactFiles(files: string[], max = 40): string {
  if (files.length === 0) return '—';
  const list = files.map(clean);
  const joined = list.join(', ');
  if (list.length === 1 || visibleWidth(joined) <= max) return joined;
  const groups = new Map<string, string[]>();
  for (const f of list) {
    const key = `${path.posix.dirname(f)}\0${path.posix.extname(f)}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  let best: string[] = [];
  let bestKey = '';
  for (const [key, g] of groups) {
    if (g.length > best.length) {
      best = g;
      bestKey = key;
    }
  }
  let head: string;
  let covered: number;
  if (best.length >= 2) {
    const [dir, ext] = bestKey.split('\0') as [string, string];
    head = `${dir === '.' ? '' : `${dir}/`}*${ext}`;
    covered = best.length;
  } else {
    head = list[0]!;
    covered = 1;
  }
  const rest = list.length - covered;
  return rest > 0 ? `${head} +${rest}` : head;
}

/** First sentence of a (model-written) description, sanitised to one line. */
export function gist(description: string): string {
  const text = clean(description);
  const m = /^(.{12,}?[.!?])\s+(?=[A-Z`"'([])/.exec(text);
  return m ? m[1]! : text;
}

/** Joins non-empty parts. */
export function join(parts: Array<string | false | undefined | null>, sep: string): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(sep);
}
