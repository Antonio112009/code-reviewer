import type { SkippedFile } from '../sources/diff-source';
import type { Chunk, FileCoverage, ReviewUnit } from '../types';

/** How one reviewed part (a chunk, or a piece of a split chunk) ended. */
export interface PartResult {
  files: readonly string[];
  kind: 'done' | 'interrupted' | 'failed';
  /** Files the model opened with a tool. */
  reads?: readonly string[];
}

/** Lines a unit adds or removes (whole files in files mode: their line count). */
function changedLines(u: ReviewUnit): number {
  if (!u.hunks.length) return u.content ? u.content.split('\n').length : 0;
  return u.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type !== 'ctx').length, 0);
}

/**
 * Which changed files the review really covered: every part that owned the file answered in full
 * (`reviewed`), some only with an early answer (`interrupted`), some or all failed (`partial` / `failed`),
 * or the file never reached a model (`skipped`, with the reason). Problem files first, then by path.
 */
export function coverageMap(
  units: readonly ReviewUnit[],
  skipped: readonly SkippedFile[],
  chunks: readonly Chunk[],
  parts: readonly PartResult[],
): FileCoverage[] {
  const byFile = new Map<string, { done: number; interrupted: number; failed: number; opened: boolean }>();
  const tally = (f: string) => {
    let t = byFile.get(f);
    if (!t) {
      t = { done: 0, interrupted: 0, failed: 0, opened: false };
      byFile.set(f, t);
    }
    return t;
  };
  for (const p of parts) {
    for (const f of p.files) {
      const t = tally(f);
      if (p.kind === 'done') t.done++;
      else if (p.kind === 'interrupted') t.interrupted++;
      else t.failed++;
    }
  }
  for (const p of parts) {
    for (const f of p.reads ?? []) {
      const t = byFile.get(f);
      if (t) t.opened = true;
    }
  }
  const inChunks = new Set(chunks.flatMap((c) => c.files));
  const out: FileCoverage[] = [];
  for (const u of units) {
    if (u.status === 'deleted') continue;
    const t = byFile.get(u.path);
    const base = { path: u.path, changed: changedLines(u) };
    if (!t || t.done + t.interrupted + t.failed === 0) {
      out.push({ ...base, status: 'failed', reason: inChunks.has(u.path) ? 'not run' : 'not in any chunk' });
      continue;
    }
    const answered = t.done + t.interrupted;
    const status: FileCoverage['status'] =
      answered === 0 ? 'failed' : t.failed ? 'partial' : t.interrupted ? 'interrupted' : 'reviewed';
    out.push({ ...base, status, ...(t.opened ? { opened: true } : {}) });
  }
  for (const s of skipped) out.push({ path: s.path, changed: 0, status: 'skipped', reason: s.reason });
  const rank: Record<FileCoverage['status'], number> = {
    failed: 0,
    partial: 1,
    interrupted: 2,
    skipped: 3,
    reviewed: 4,
  };
  return out.sort(
    (a, b) => rank[a.status] - rank[b.status] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}
