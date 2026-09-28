import { parseUnifiedDiff } from '../git/diff-parser';
import type { GitRepo } from '../git/repo';
import { SEVERITY_ORDER, sortFindings } from '../report/common';
import type { FileDiff, Finding, Severity } from '../types';
import type { PostedThread } from './resolve';

/** Context lines of a pull request diff as GitHub and GitLab show it. */
const PR_DIFF_CONTEXT = 3;

/** A new-side line of the pull request diff that can carry an inline comment. */
export interface DiffLineInfo {
  type: 'add' | 'ctx';
  /** Old-side line of a context line (GitLab positions need both). */
  oldLine?: number;
}

export interface CommentableFile {
  path: string;
  /** Path before a rename. */
  oldPath?: string;
  /** New-side line ranges of the hunks (1-based, inclusive): a comment range must lie inside one. */
  hunks: Array<[number, number]>;
  lines: Map<number, DiffLineInfo>;
}

/** Commentable lines per (new) path. */
export type CommentableDiff = Map<string, CommentableFile>;

/** Where an inline comment goes. */
export interface InlineAnchor {
  path: string;
  oldPath?: string;
  startLine: number;
  endLine: number;
  /** Single line for forges that anchor on one line (GitLab): the first added line of the range, else its start. */
  line: number;
  /** Old-side line of `line` when it is a context line. */
  oldLine?: number;
}

/** Commentable lines of parsed file diffs (deleted and binary files have none). */
export function commentableLines(files: FileDiff[]): CommentableDiff {
  const out: CommentableDiff = new Map();
  for (const f of files) {
    if (f.status === 'deleted' || f.binary || f.submodule) continue;
    const file: CommentableFile = { path: f.path, oldPath: f.oldPath, hunks: [], lines: new Map() };
    for (const h of f.hunks) {
      if (h.newLines === 0) continue;
      file.hunks.push([h.newStart, h.newStart + h.newLines - 1]);
      for (const l of h.lines) {
        if (l.type === 'add' && l.newLine !== undefined) file.lines.set(l.newLine, { type: 'add' });
        else if (l.type === 'ctx' && l.newLine !== undefined)
          file.lines.set(l.newLine, { type: 'ctx', oldLine: l.oldLine });
      }
    }
    if (file.hunks.length) out.set(f.path, file);
  }
  return out;
}

/** The pull request diff (`mergeBase..headSha`, 3 context lines) from the local repository. */
export async function loadCommentableDiff(
  repo: GitRepo,
  mergeBase: string,
  headSha: string,
): Promise<CommentableDiff> {
  return commentableLines(parseUnifiedDiff(await repo.diff(mergeBase, headSha, PR_DIFF_CONTEXT)));
}

/** Inline position of a finding: its whole line range must lie inside one hunk of the diff. */
export function anchorFor(f: Finding, diff: CommentableDiff): InlineAnchor | undefined {
  const file = diff.get(f.file);
  if (!file) return undefined;
  const start = f.startLine;
  const end = Math.max(f.startLine, f.endLine);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1) return undefined;
  if (!file.hunks.some(([s, e]) => start >= s && end <= e)) return undefined;
  let line = start;
  for (let n = start; n <= end; n++) {
    if (file.lines.get(n)?.type === 'add') {
      line = n;
      break;
    }
  }
  const info = file.lines.get(line);
  if (!info) return undefined;
  return {
    path: file.path,
    ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    startLine: start,
    endLine: end,
    line,
    ...(info.type === 'ctx' && info.oldLine !== undefined ? { oldLine: info.oldLine } : {}),
  };
}

/** Why a finding is listed in the summary instead of getting an inline comment. */
export type SummaryReason = 'outside-diff' | 'limit' | 'severity' | 'stale' | 'rejected' | 'no-diff';

export const SUMMARY_REASON_LABELS: Record<SummaryReason, string> = {
  'outside-diff': 'outside the diff',
  limit: 'inline comment limit reached',
  severity: 'below the inline severity',
  stale: 'the pull request changed since the review',
  rejected: 'could not be placed inline',
  'no-diff': 'diff not available',
};

export interface PlannedInline {
  finding: Finding;
  fingerprint: string;
  anchor: InlineAnchor;
}

/** A planned inline comment with its rendered body. */
export interface InlineComment extends PlannedInline {
  body: string;
}

/** What a forge knows about the pull request before anything is posted. */
export interface ForgeState {
  /** Head commit of the pull / merge request. */
  headSha: string;
  /** Fingerprints of inline comments this tool already posted there (de-duplication). */
  posted: Set<string>;
}

export interface InlineResult {
  posted: InlineComment[];
  /** Comments the forge refused (position outside its diff, …): listed in the summary instead. */
  rejected: Array<{ comment: InlineComment; reason: string }>;
}

/** One forge (GitHub, GitLab): the calls a publication needs. */
export interface ForgeAdapter {
  load(): Promise<ForgeState>;
  /** Posts inline comments anchored on `commitSha` (the reviewed commit). */
  postInline(comments: InlineComment[], commitSha: string): Promise<InlineResult>;
  /** Creates the summary comment, or updates the one an earlier run created. */
  upsertSummary(body: string): Promise<'created' | 'updated'>;
  /** Unresolved inline threads this tool started (first comment ours, with a fingerprint). */
  openThreads(): Promise<PostedThread[]>;
  /** Replies `body` in the thread, then resolves it. */
  resolveThread(thread: PostedThread, body: string): Promise<void>;
}

export interface PublicationPlan {
  inline: PlannedInline[];
  summary: Array<{ finding: Finding; reason: SummaryReason }>;
  /** Findings whose inline comment is already on the pull request (same fingerprint). */
  alreadyPosted: Finding[];
}

export interface PlanOptions {
  /** Undefined when the diff could not be computed: everything goes into the summary. */
  diff?: CommentableDiff;
  maxInline: number;
  minSeverity: Severity;
  /** Fingerprints of inline comments already on the pull request. */
  posted: ReadonlySet<string>;
  /** The pull request head moved since the review: no inline comments (lines may have moved). */
  stale: boolean;
}

/**
 * Splits findings (with fingerprints) into inline comments and summary entries, worst first so the inline
 * limit keeps the most severe ones.
 */
export function planPublication(findings: Finding[], opts: PlanOptions): PublicationPlan {
  const plan: PublicationPlan = { inline: [], summary: [], alreadyPosted: [] };
  const floor = SEVERITY_ORDER[opts.minSeverity];
  for (const finding of sortFindings(findings)) {
    const fingerprint = finding.fingerprint!;
    if (opts.posted.has(fingerprint)) {
      plan.alreadyPosted.push(finding);
      continue;
    }
    const reason = ((): SummaryReason | undefined => {
      if (opts.stale) return 'stale';
      if ((SEVERITY_ORDER[finding.severity] ?? 9) > floor) return 'severity';
      if (!opts.diff) return 'no-diff';
      return undefined;
    })();
    if (reason) {
      plan.summary.push({ finding, reason });
      continue;
    }
    const anchor = anchorFor(finding, opts.diff!);
    if (!anchor) plan.summary.push({ finding, reason: 'outside-diff' });
    else if (plan.inline.length >= opts.maxInline) plan.summary.push({ finding, reason: 'limit' });
    else plan.inline.push({ finding, fingerprint, anchor });
  }
  return plan;
}
