import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Finding, ReviewUnit, Severity } from '../types';
import { resolveInside, toPosix } from '../util/paths';

/** How far (lines) a diff-mode finding may sit from the changed hunks and still count as related. */
const HUNK_TOLERANCE = 20;

export interface ValidationResult {
  kept: Finding[];
  dropped: Finding[];
}

/**
 * Guards against hallucinations: unknown files, lines beyond the end of the file and — in diff
 * mode — findings in changed files that are far from anything the change touched.
 */
export function validateFindings(
  findings: Finding[],
  opts: { root: string; units: ReviewUnit[]; mode: 'diff' | 'files' },
): ValidationResult {
  const units = new Map(opts.units.map((u) => [u.path, u]));
  const fileLines = new Map<string, string[]>();
  const kept: Finding[] = [];
  const dropped: Finding[] = [];
  const drop = (f: Finding, reason: string) => dropped.push({ ...f, droppedReason: reason });

  for (const reported of findings) {
    // Model output is untrusted: the path must name a regular file inside the review root.
    let abs: string;
    let content: string | undefined;
    try {
      abs = resolveInside(opts.root, reported.file);
      // Checked and read through one descriptor: the file cannot be swapped in between.
      content = readRegularFile(abs);
    } catch {
      content = undefined;
    }
    if (content === undefined) {
      drop(reported, 'unknown-file');
      continue;
    }
    const f = { ...reported, file: toPosix(path.relative(opts.root, abs!)) };
    let lines = fileLines.get(f.file);
    if (lines === undefined) {
      lines = (units.get(f.file)?.content ?? content).split('\n');
      fileLines.set(f.file, lines);
    }
    const count = lines.length;
    if (f.startLine > count) {
      drop(f, 'line-out-of-range');
      continue;
    }
    const clamped = f.endLine > count ? { ...f, endLine: count } : f;
    const finding = usableReplacement(clamped, lines) ? clamped : withoutReplacement(clamped);

    const unit = units.get(f.file);
    if (opts.mode === 'diff' && unit && unit.focusRanges.length > 0) {
      const near = unit.focusRanges.some(
        ([s, e]) => finding.startLine <= e + HUNK_TOLERANCE && finding.endLine >= s - HUNK_TOLERANCE,
      );
      if (!near) {
        drop(finding, 'outside-changed-lines');
        continue;
      }
    }
    kept.push(finding);
  }
  return { kept, dropped };
}

/** Shortest failure path that can name an input, a step and a failure. */
const MIN_FAILURE_PATH = 20;
const LOWER: Partial<Record<Severity, Severity>> = { critical: 'major', major: 'minor' };

/**
 * A critical or major model finding must say how the defect is reached (`failurePath`: input → path →
 * failure); without one its severity is lowered a level before critique. Static findings are exempt.
 */
export function requireFailurePath(findings: Finding[]): { findings: Finding[]; lowered: number } {
  let lowered = 0;
  const out = findings.map((f) => {
    const to = LOWER[f.severity];
    if (!to || f.origin === 'static' || (f.failurePath?.trim().length ?? 0) >= MIN_FAILURE_PATH) return f;
    lowered++;
    return { ...f, severity: to, lowered: { from: f.severity, reason: 'no-failure-path' as const } };
  });
  return { findings: out, lowered };
}

/** Most lines a one-click replacement may cover or contain. */
const MAX_REPLACED_LINES = 30;
const MAX_REPLACEMENT_LINES = 60;

function withoutReplacement(f: Finding): Finding {
  if (f.replacement === undefined) return f;
  const { replacement: _dropped, ...rest } = f;
  return rest;
}

/**
 * A replacement can be offered as a one-click change when it covers a few whole lines, differs from them,
 * and cannot break out of the suggestion fence.
 */
function usableReplacement(f: Finding, lines: readonly string[]): boolean {
  const r = f.replacement;
  if (r === undefined) return true;
  const span = f.endLine - f.startLine + 1;
  if (span < 1 || span > MAX_REPLACED_LINES) return false;
  const text = r.replace(/\n$/, '');
  if (text.includes('```') || text.includes('\r') || text.split('\n').length > MAX_REPLACEMENT_LINES)
    return false;
  return text !== lines.slice(f.startLine - 1, f.endLine).join('\n');
}

/** The content of `abs` when it is a regular file, checked and read through the same descriptor. */
function readRegularFile(abs: string): string | undefined {
  const fd = openSync(abs, 'r');
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd, 'utf8') : undefined;
  } finally {
    closeSync(fd);
  }
}
