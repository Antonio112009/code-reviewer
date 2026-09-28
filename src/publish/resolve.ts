import { parseUnifiedDiff } from '../git/diff-parser';
import type { GitRepo } from '../git/repo';
import type { Finding, Hunk, RunRecord } from '../types';

/** An open inline comment thread this tool started on the pull / merge request. */
export interface PostedThread {
  /** What the forge resolves: a GitHub review thread (GraphQL node id) or a GitLab discussion id. */
  id: string;
  /** GitHub REST id of the thread's first comment (replies go to it). */
  commentId?: number;
  fingerprint: string;
  path: string;
  /** New-side lines the comment was placed on, in `commit`. */
  startLine: number;
  endLine: number;
  /** The commit the comment was placed on. */
  commit: string;
}

/** A thread to resolve, and why. */
export interface FixedThread {
  thread: PostedThread;
  reason: string;
}

/** A finding reported again this close to where the old one moved counts as the same issue. */
const NEARBY_LINES = 3;
const SHA_RE = /^[0-9a-f]{40,64}$/i;

/** Where old lines `start..end` ended up in the new file (a changed hunk maps to its new range). */
export function mapRange(hunks: Hunk[], start: number, end: number): [number, number] {
  const map = (line: number): number => {
    let delta = 0;
    for (const h of hunks) {
      const oldEnd = h.oldStart + h.oldLines - 1;
      // a pure insertion (oldLines 0) goes after line oldStart
      if (h.oldLines === 0 ? h.oldStart < line : oldEnd < line) {
        delta += h.newLines - h.oldLines;
        continue;
      }
      if (h.oldLines > 0 && h.oldStart <= line && line <= oldEnd) return h.newStart;
      break;
    }
    return line + delta;
  };
  return [map(start), Math.max(map(start), map(end))];
}

/** Whether a hunk changed any of the old lines `start..end` (an insertion between them counts). */
export function touches(h: Hunk, start: number, end: number): boolean {
  if (h.oldLines === 0) return h.oldStart >= start && h.oldStart < end;
  return h.oldStart <= end && h.oldStart + h.oldLines - 1 >= start;
}

/**
 * Threads whose finding was fixed: resolved only when every sign agrees, since a model may simply not report a
 * finding again (run-to-run variance):
 * - no finding of this run (advisory ones included) has its fingerprint;
 * - the file was reviewed in full (no failed chunk), or it is no longer part of the change;
 * - the commented lines changed between the comment's commit and the reviewed head (a commit that is not in
 *   the local repository, e.g. after a force push, proves nothing);
 * - no finding was reported where those lines went (the same issue in rewritten code has a new fingerprint).
 */
export async function fixedThreads(
  repo: GitRepo,
  run: RunRecord,
  /** This run's findings and advisory findings, with fingerprints. */
  current: Finding[],
  threads: PostedThread[],
): Promise<FixedThread[]> {
  const t = run.target;
  if (t.kind !== 'diff' || t.local || !SHA_RE.test(t.headSha)) return [];
  const fingerprints = new Set(current.map((f) => f.fingerprint).filter(Boolean));
  const changedInPr = new Set(
    parseUnifiedDiff(await repo.diff(t.mergeBase, t.headSha, 0)).flatMap((f) =>
      f.oldPath ? [f.path, f.oldPath] : [f.path],
    ),
  );
  const out: FixedThread[] = [];
  for (const thread of threads) {
    if (fingerprints.has(thread.fingerprint) || !SHA_RE.test(thread.commit)) continue;
    const chunks = run.chunks.filter((c) => c.files.includes(thread.path));
    if (!changedInPr.has(thread.path)) {
      if (await repo.hasCommit(thread.commit)) {
        out.push({ thread, reason: 'the pull request no longer changes this file' });
      }
      continue;
    }
    if (chunks.length === 0 || chunks.some((c) => c.status !== 'done')) continue;
    if (thread.commit.toLowerCase() === t.headSha.toLowerCase() || !(await repo.hasCommit(thread.commit))) {
      continue;
    }
    const raw = await repo.run([
      '--literal-pathspecs',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '-U0',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      thread.commit,
      t.headSha,
      '--',
      thread.path,
    ]);
    const file = parseUnifiedDiff(raw)[0];
    if (!file) continue; // unchanged since the comment
    if (file.status === 'deleted') {
      out.push({ thread, reason: 'the file was removed' });
      continue;
    }
    if (!file.hunks.some((h) => touches(h, thread.startLine, thread.endLine))) continue;
    const [start, end] = mapRange(file.hunks, thread.startLine, thread.endLine);
    if (sameIssueNearby(current, thread, start, end)) continue;
    out.push({ thread, reason: `the commented code changed in ${t.headSha.slice(0, 8)}` });
  }
  return out;
}

/**
 * A finding of this run in the same file near the commented code's new place: possibly the same issue in the
 * rewritten code (its fingerprint changes with the code), so the old thread stays open.
 */
function sameIssueNearby(current: Finding[], thread: PostedThread, start: number, end: number): boolean {
  return current.some(
    (f) =>
      f.file === thread.path &&
      f.startLine <= end + NEARBY_LINES &&
      Math.max(f.startLine, f.endLine) >= start - NEARBY_LINES,
  );
}
