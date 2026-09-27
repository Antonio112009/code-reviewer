import type { ChunkPart, Hunk, ReviewUnit } from '../types';
import { estimateTokens } from './tokens';

export interface RenderOptions {
  /** Max tokens for a single part; bigger units are split. */
  maxPartTokens: number;
  /** Files whose full rendering fits in this many tokens are shown in full. */
  fullFileTokens: number;
  /** Context lines around hunks when the file is not shown in full. */
  contextLines: number;
}

const SPLIT_OVERLAP_LINES = 15;
/**
 * Longest line shown to a model. Longer lines (minified bundles, inline base64, notebook outputs) are
 * clipped with a note: one line must never blow a chunk past its budget or the context window.
 */
const MAX_LINE_CHARS = 2_000;
/** Recursion bound when an over-budget piece is halved again. */
const MAX_SPLIT_DEPTH = 12;

export function clipLine(text: string): string {
  return text.length > MAX_LINE_CHARS
    ? `${text.slice(0, MAX_LINE_CHARS)} … (${text.length - MAX_LINE_CHARS} more characters on this line omitted)`
    : text;
}

/** Renders a review unit into one or more prompt parts, each within `maxPartTokens`. */
export function renderUnit(unit: ReviewUnit, opts: RenderOptions): ChunkPart[] {
  if (unit.status === 'deleted') return [];
  if (unit.status === 'file') return renderWholeFile(unit, opts);
  return renderDiffUnit(unit, opts);
}

function fileHeader(unit: ReviewUnit, part?: { index: number; total: number }): string {
  const status =
    unit.status === 'file' ? '' : ` (${unit.status}${unit.oldPath ? ` from ${unit.oldPath}` : ''})`;
  const partLabel = part && part.total > 1 ? ` [part ${part.index}/${part.total}]` : '';
  return `## File: ${unit.path}${status}${partLabel}\n`;
}

function numbered(lines: string[], from: number, marks?: Set<number>): string {
  const width = String(from + lines.length).length;
  return lines
    .map((text, i) => {
      const n = from + i;
      const mark = marks?.has(n) ? '+' : ' ';
      return `${String(n).padStart(width)} ${mark} ${clipLine(text)}`;
    })
    .join('\n');
}

function renderWholeFile(unit: ReviewUnit, opts: RenderOptions): ChunkPart[] {
  const lines = (unit.content ?? '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const full = `${fileHeader(unit)}\`\`\`${unit.language}\n${numbered(lines, 1)}\n\`\`\`\n`;
  const tokens = estimateTokens(full);
  if (tokens <= opts.maxPartTokens) {
    return [{ path: unit.path, language: unit.language, status: unit.status, text: full, tokens }];
  }
  // Split into windows filled up to the budget line by line (line lengths are uneven), overlapping a bit.
  const lineTokens = lines.map((l) => estimateTokens(clipLine(l)) + 2);
  const limit = Math.max(1, Math.floor(opts.maxPartTokens * 0.9) - 50);
  const slices: Array<[number, number]> = [];
  for (let start = 0; start < lines.length; ) {
    let end = start;
    let sum = 0;
    while (end < lines.length && (end === start || sum + lineTokens[end]! <= limit))
      sum += lineTokens[end++]!;
    slices.push([start, end]);
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - SPLIT_OVERLAP_LINES);
  }
  return slices.map(([s, e], i) => {
    const part = { index: i + 1, total: slices.length };
    const text = `${fileHeader(unit, part)}Lines ${s + 1}-${e} of ${lines.length}\n\`\`\`${unit.language}\n${numbered(lines.slice(s, e), s + 1)}\n\`\`\`\n`;
    return {
      path: unit.path,
      language: unit.language,
      status: unit.status,
      text,
      tokens: estimateTokens(text),
      part,
    };
  });
}

interface Window {
  start: number;
  end: number;
  hunks: Hunk[];
}

function renderDiffUnit(unit: ReviewUnit, opts: RenderOptions): ChunkPart[] {
  const content = unit.content ?? '';
  const fileLines = content.split('\n');
  if (fileLines.at(-1) === '') fileLines.pop();
  const added = new Set(
    unit.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => l.newLine!)),
  );

  // Small file: show the whole new version (added lines marked with +) plus removed code.
  const wholeWindow: Window = { start: 1, end: fileLines.length, hunks: unit.hunks };
  if (content && fileLines.length > 0) {
    const whole = renderWindow(unit, wholeWindow, fileLines, added, {
      removedBudget: removedBudgetFor(opts.maxPartTokens),
    });
    if (estimateTokens(whole) <= Math.min(opts.fullFileTokens, opts.maxPartTokens)) {
      const text = fileHeader(unit) + whole;
      return [
        { path: unit.path, language: unit.language, status: unit.status, text, tokens: estimateTokens(text) },
      ];
    }
  }

  // Large file: hunks expanded by `contextLines`, overlapping windows merged.
  const windows: Window[] = [];
  for (const h of unit.hunks) {
    const start = Math.max(1, h.newStart - opts.contextLines);
    const end = Math.min(
      Math.max(fileLines.length, 1),
      h.newStart + Math.max(h.newLines, 1) - 1 + opts.contextLines,
    );
    const last = windows.at(-1);
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      last.hunks.push(h);
    } else windows.push({ start, end, hunks: [h] });
  }

  const rendered = windows.flatMap((w) => splitWindow(unit, w, fileLines, added, opts.maxPartTokens));
  // Pack consecutive windows of the same file into as few parts as fit.
  const groups: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const block of rendered) {
    const t = estimateTokens(block);
    if (current.length && currentTokens + t > opts.maxPartTokens) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(block);
    currentTokens += t;
  }
  if (current.length) groups.push(current);

  return groups.map((blocks, i) => {
    const part = { index: i + 1, total: groups.length };
    const text = fileHeader(unit, part) + blocks.join('\n');
    return {
      path: unit.path,
      language: unit.language,
      status: unit.status,
      text,
      tokens: estimateTokens(text),
      part: groups.length > 1 ? part : undefined,
    };
  });
}

/** Share of a part reserved for removed code; the rest is for the new code around the change. */
const REMOVED_SHARE = 0.4;
const NEW_CODE_SHARE = 0.5;

function removedBudgetFor(maxTokens: number): number {
  return Math.max(200, Math.floor(maxTokens * REMOVED_SHARE));
}

interface WindowRenderOptions {
  /** Token budget for all removed-code blocks of the window together. */
  removedBudget: number;
  /** Hunks whose removed code is shown here (default: all hunks of the window). */
  removedFor?: Hunk[];
  /** Skip removed code entirely (used to measure the new-code part). */
  newCodeOnly?: boolean;
}

/** Old side of a hunk, truncated to `budget` tokens with a note about omitted lines. */
function removedBlock(unit: ReviewUnit, h: Hunk, budget: number): string {
  const oldSide = h.lines
    .filter((l) => l.type !== 'add')
    .map((l) => `${l.type === 'del' ? '-' : ' '} ${clipLine(l.text)}`);
  const header = `__removed code__ ${h.header} ("-" = line removed by this change)`;
  let body = oldSide.join('\n');
  if (estimateTokens(body) > budget) {
    const perLine = estimateTokens(body) / Math.max(1, oldSide.length);
    const keep = Math.max(1, Math.floor(budget / perLine));
    body = `${oldSide.slice(0, keep).join('\n')}\n… (${oldSide.length - keep} more removed lines omitted)`;
  }
  return `${header}\n\`\`\`${unit.language}\n${body}\n\`\`\``;
}

/** Renders the new-code window plus the removed lines of its hunks. */
function renderWindow(
  unit: ReviewUnit,
  w: Window,
  fileLines: string[],
  added: Set<number>,
  opts: WindowRenderOptions,
): string {
  const out: string[] = [];
  if (fileLines.length > 0) {
    out.push(`__new code__ (lines ${w.start}-${w.end}; "+" marks lines added by this change)`);
    out.push(
      `\`\`\`${unit.language}\n${numbered(fileLines.slice(w.start - 1, w.end), w.start, added)}\n\`\`\``,
    );
  } else {
    // content unavailable: fall back to the raw new side of the hunks
    for (const h of w.hunks) {
      const newSide = h.lines.filter((l) => l.type !== 'del');
      out.push(`__new hunk__ ${h.header}`);
      out.push(
        `\`\`\`${unit.language}\n${newSide.map((l) => `${l.newLine} ${l.type === 'add' ? '+' : ' '} ${clipLine(l.text)}`).join('\n')}\n\`\`\``,
      );
    }
  }
  if (!opts.newCodeOnly) {
    const removed = (opts.removedFor ?? w.hunks).filter((h) => h.lines.some((l) => l.type === 'del'));
    const perHunk = Math.max(100, Math.floor(opts.removedBudget / Math.max(1, removed.length)));
    for (const h of removed) out.push(removedBlock(unit, h, perHunk));
  }
  return `${out.join('\n')}\n`;
}

/**
 * Splits a window whose rendering exceeds `maxTokens` into overlapping line ranges.
 * Each hunk's removed code is shown exactly once — in the piece containing the hunk start.
 */
function splitWindow(
  unit: ReviewUnit,
  w: Window,
  fileLines: string[],
  added: Set<number>,
  maxTokens: number,
): string[] {
  const removedBudget = removedBudgetFor(maxTokens);
  const text = renderWindow(unit, w, fileLines, added, { removedBudget });
  if (estimateTokens(text) <= maxTokens || w.end === w.start) return [text];

  const newTokens = estimateTokens(
    renderWindow(unit, w, fileLines, added, { removedBudget, newCodeOnly: true }),
  );
  const span = w.end - w.start + 1;
  const pieces = Math.max(2, Math.ceil(newTokens / (maxTokens * NEW_CODE_SHARE)));
  const size = Math.ceil(span / pieces) + SPLIT_OVERLAP_LINES;
  const owner = (h: Hunk) => Math.min(Math.max(h.newStart, w.start), w.end);
  const assigned = new Set<Hunk>();
  const out: string[] = [];
  /** Renders lines s..e; a piece still over budget (uneven line lengths) is halved again. */
  const renderPiece = (s: number, e: number, depth: number): void => {
    const hunks = w.hunks.filter((h) => h.newStart <= e && h.newStart + h.newLines - 1 >= s);
    const removedFor = w.hunks.filter((h) => !assigned.has(h) && owner(h) >= s && owner(h) <= e);
    const text = renderWindow(unit, { start: s, end: e, hunks }, fileLines, added, {
      removedBudget,
      removedFor,
    });
    if (e > s && depth < MAX_SPLIT_DEPTH && estimateTokens(text) > maxTokens) {
      const mid = Math.floor((s + e) / 2);
      renderPiece(s, mid, depth + 1);
      renderPiece(mid + 1, e, depth + 1);
      return;
    }
    for (const h of removedFor) assigned.add(h);
    out.push(text);
  };
  for (let s = w.start; s <= w.end; s += size - SPLIT_OVERLAP_LINES) {
    const e = Math.min(w.end, s + size - 1);
    renderPiece(s, e, 0);
    if (e === w.end) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Read-only context excerpts (related files reviewed in another chunk)
// ---------------------------------------------------------------------------------------------------

/** Lines around each change shown in a context excerpt. */
export const CONTEXT_EXCERPT_LINES = 5;
/** Longest excerpt ever prepared; a context excerpt is a pointer, not a second review. */
const MAX_EXCERPT_LINES = 600;

/** A file's context excerpt, prepared once and cut to size per chunk by {@link renderContextPart}. */
export interface ContextExcerpt {
  path: string;
  language: string;
  status: ChunkPart['status'];
  /** Numbered code lines (`…` marks skipped lines between windows). */
  lines: string[];
  /** Token estimate of each line (with its newline). */
  lineTokens: number[];
  /** Lines of the excerpt that were cut before rendering (beyond {@link MAX_EXCERPT_LINES}). */
  omitted: number;
}

/**
 * Prepares a compact read-only excerpt of a unit: its changed hunks with ±`contextLines` lines of the new
 * code (added lines marked `+`), or — for whole files and new files — the first lines of the file.
 */
export function prepareContextExcerpt(
  unit: ReviewUnit,
  contextLines = CONTEXT_EXCERPT_LINES,
): ContextExcerpt | undefined {
  if (unit.status === 'deleted') return undefined;
  const fileLines = (unit.content ?? '').split('\n');
  if (fileLines.at(-1) === '') fileLines.pop();
  const lines: string[] = [];
  let skipped = 0;
  if (fileLines.length === 0) {
    // content unavailable: the new side of the hunks
    for (const h of unit.hunks) {
      if (lines.length) lines.push('…');
      for (const l of h.lines)
        if (l.type !== 'del') lines.push(`${l.newLine} ${l.type === 'add' ? '+' : ' '} ${clipLine(l.text)}`);
    }
  } else {
    const added = new Set(
      unit.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => l.newLine!)),
    );
    const focus: Array<[number, number]> =
      unit.status === 'file'
        ? unit.focusRanges
        : unit.hunks.map((h): [number, number] => [h.newStart, h.newStart + Math.max(h.newLines, 1) - 1]);
    const ranges = focus.length ? focus : [[1, fileLines.length] as [number, number]];
    const windows: Array<[number, number]> = [];
    for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
      const start = Math.max(1, s - contextLines);
      const end = Math.min(fileLines.length, e + contextLines);
      if (end < start) continue;
      const last = windows.at(-1);
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else windows.push([start, end]);
    }
    const width = String(fileLines.length).length;
    for (const [s, e] of windows) {
      if (s > 1 || lines.length) lines.push('…');
      const stop = Math.min(e, s + MAX_EXCERPT_LINES);
      for (let n = s; n <= stop; n++) {
        lines.push(
          `${String(n).padStart(width)} ${added.has(n) ? '+' : ' '} ${clipLine(fileLines[n - 1] ?? '')}`,
        );
      }
      skipped += e - stop;
    }
  }
  if (lines.length === 0) return undefined;
  const kept = lines.slice(0, MAX_EXCERPT_LINES);
  const omitted = skipped + lines.length - kept.length;
  return {
    path: unit.path,
    language: unit.language,
    status: unit.status,
    lines: kept,
    lineTokens: kept.map((l) => estimateTokens(`${l}\n`)),
    omitted,
  };
}

/**
 * Renders an excerpt as a read-only context part of at most `maxTokens` tokens (cutting trailing lines),
 * with the header `## Context: <path> (read-only — reviewed in <chunk ids>)`. Undefined when not even a
 * few lines fit.
 */
export function renderContextPart(
  excerpt: ContextExcerpt,
  maxTokens: number,
  reviewedIn: readonly string[],
): ChunkPart | undefined {
  const header = `## Context: ${excerpt.path} (read-only — reviewed in ${reviewedIn.join(', ')})\n`;
  const open = `\`\`\`${excerpt.language}\n`;
  const close = '\n```\n';
  const fixed = estimateTokens(header + open + close);
  const whole = excerpt.lineTokens.reduce((a, b) => a + b, 0);
  // room for the "… (N more lines not shown)" note only when something is cut
  const noteReserve = excerpt.omitted === 0 && fixed + whole <= maxTokens ? 0 : 24;
  let budget = maxTokens - fixed - noteReserve;
  const minLines = Math.min(3, excerpt.lines.length);
  for (let attempt = 0; attempt < 4 && budget > 0; attempt++) {
    let k = 0;
    let used = 0;
    while (k < excerpt.lines.length && used + excerpt.lineTokens[k]! <= budget)
      used += excerpt.lineTokens[k++]!;
    if (k < minLines) return undefined;
    const omitted = excerpt.lines.length - k + excerpt.omitted;
    const note = omitted > 0 ? `\n… (${omitted} more lines not shown)` : '';
    const text = `${header}${open}${excerpt.lines.slice(0, k).join('\n')}${note}${close}`;
    const tokens = estimateTokens(text);
    if (tokens <= maxTokens) {
      return {
        path: excerpt.path,
        language: excerpt.language,
        status: excerpt.status,
        text,
        tokens,
        role: 'context',
      };
    }
    budget -= tokens - maxTokens + 8;
  }
  return undefined;
}
