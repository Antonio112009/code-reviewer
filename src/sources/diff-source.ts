import { addedRanges, parseUnifiedDiff } from '../git/diff-parser';
import type { GitRepo } from '../git/repo';
import type { FileDiff, ReviewUnit } from '../types';
import { untrustedGlobMatcher } from '../util/globs';
import { detectLanguage } from '../util/language';

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface CollectedUnits {
  units: ReviewUnit[];
  skipped: SkippedFile[];
}

/** Matcher for `review.exclude` / `project.ignore` (they may come from the reviewed repository's config). */
export function makeExcluder(patterns: string[]): (file: string) => boolean {
  if (patterns.length === 0) return () => false;
  return untrustedGlobMatcher(patterns);
}

/**
 * Every path changed between `from` and `to` — excluded, binary, renamed (both names) and submodule paths
 * included — for guards that must not depend on what is reviewed.
 */
export async function changedPaths(repo: GitRepo, from: string, to: string): Promise<string[]> {
  const out = await repo.run(['diff', '--name-only', '--no-renames', '-z', from, to, '--']);
  return out.split('\0').filter(Boolean);
}

/** Builds review units from `git diff mergeBase..headSha`. */
export async function collectDiffUnits(
  repo: GitRepo,
  opts: { from: string; to: string; exclude: string[] },
): Promise<CollectedUnits> {
  const raw = await repo.diff(opts.from, opts.to, 3);
  return buildDiffUnits(parseUnifiedDiff(raw), opts.exclude, (p) => repo.show(opts.to, p));
}

export async function buildDiffUnits(
  diffs: FileDiff[],
  exclude: string[],
  readNew: (path: string) => Promise<string | undefined>,
): Promise<CollectedUnits> {
  const isExcluded = makeExcluder(exclude);
  const units: ReviewUnit[] = [];
  const skipped: SkippedFile[] = [];

  for (const d of diffs) {
    if (isExcluded(d.path)) {
      skipped.push({ path: d.path, reason: 'excluded' });
      continue;
    }
    if (d.submodule) {
      skipped.push({ path: d.path, reason: 'submodule' });
      continue;
    }
    if (d.binary) {
      skipped.push({ path: d.path, reason: 'binary' });
      continue;
    }
    if (d.status === 'deleted') {
      units.push({
        path: d.path,
        status: 'deleted',
        language: detectLanguage(d.path),
        hunks: [],
        focusRanges: [],
      });
      continue;
    }
    if (d.hunks.length === 0) {
      // pure rename / mode change: nothing to review
      skipped.push({ path: d.path, reason: d.status === 'renamed' ? 'rename-only' : 'no-content-change' });
      continue;
    }
    const content = await readNew(d.path);
    units.push({
      path: d.path,
      oldPath: d.oldPath,
      status: d.status,
      language: detectLanguage(d.path),
      hunks: d.hunks,
      content,
      focusRanges: hunkRanges(d),
    });
  }
  return { units, skipped };
}

/** New-file line ranges covered by each hunk (includes context around pure deletions). */
function hunkRanges(d: FileDiff): Array<[number, number]> {
  const ranges = d.hunks.map((h): [number, number] => [
    Math.max(1, h.newStart),
    Math.max(h.newStart, h.newStart + h.newLines - 1),
  ]);
  return ranges.length ? ranges : addedRanges(d.hunks);
}
