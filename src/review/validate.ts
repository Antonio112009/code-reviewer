import { readFileSync, statSync } from 'node:fs';
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
  const lineCounts = new Map<string, number>();
  const kept: Finding[] = [];
  const dropped: Finding[] = [];
  const drop = (f: Finding, reason: string) => dropped.push({ ...f, droppedReason: reason });

  for (const reported of findings) {
    // Model output is untrusted: the path must name a regular file inside the review root.
    let abs: string;
    try {
      abs = resolveInside(opts.root, reported.file);
      if (!statSync(abs).isFile()) throw new Error('not a file');
    } catch {
      drop(reported, 'unknown-file');
      continue;
    }
    const f = { ...reported, file: toPosix(path.relative(opts.root, abs)) };
    let count = lineCounts.get(f.file);
    if (count === undefined) {
      const content = units.get(f.file)?.content ?? readFileSync(abs, 'utf8');
      count = content.split('\n').length;
      lineCounts.set(f.file, count);
    }
    if (f.startLine > count) {
      drop(f, 'line-out-of-range');
      continue;
    }
    const finding = f.endLine > count ? { ...f, endLine: count } : f;

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
