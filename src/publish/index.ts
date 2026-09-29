import type { PublishSettings } from '../config/schema';
import { detectCiPullRequest } from '../git/ci';
import type { GitRepo } from '../git/repo';
import { SEVERITY_ORDER, safeRepoPath } from '../report/common';
import { computeFingerprint, FINGERPRINT_RE, uniqueFingerprints } from '../review/fingerprint';
import type { Finding, RunRecord } from '../types';
import type { Logger } from '../util/logger';
import { packageVersion } from '../util/paths';
import { githubAdapter, githubHeaders } from './github';
import { gitlabAdapter, gitlabHeaders } from './gitlab';
import { parseState, sinceLastReview } from './history';
import { ApiClient, ApiError, type FetchLike, type SleepLike } from './http';
import {
  type CommentableDiff,
  type ForgeAdapter,
  type InlineComment,
  loadCommentableDiff,
  planPublication,
  type SummaryReason,
} from './plan';
import { renderInlineComment, renderResolvedReply, renderSummary } from './render';
import { type FixedThread, fixedThreads } from './resolve';
import {
  missingTokenMessage,
  PublishError,
  type PublishFlags,
  type PublishTarget,
  type ResolveTargetOptions,
  resolvePublishTarget,
  tokenFor,
} from './target';

export { ApiClient, ApiError, type FetchLike, type SleepLike } from './http';
export { type ForgeKind, PublishError, type PublishFlags, type PublishTarget, targetLabel } from './target';

const SHA_RE = /^[0-9a-f]{7,64}$/;

export interface PublishRunOptions {
  run: RunRecord;
  /** The repository the run was made in: the pull request diff and old runs' fingerprints come from it. */
  repo?: GitRepo;
  settings: PublishSettings;
  flags: PublishFlags;
  /** Post inline comments even when the pull request head moved since the review. */
  force?: boolean;
  /** Resolve the target and render everything, but call no API (no token needed). */
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  sleep?: SleepLike;
  signal?: AbortSignal;
  logger: Logger;
  findPullRequest?: ResolveTargetOptions['findPullRequest'];
  /** Per-request timeout of the forge API (default 30 s). */
  timeoutMs?: number;
}

export interface PublishOutcome {
  target: PublishTarget;
  dryRun: boolean;
  /** Inline comments posted (dry run: that would be posted). */
  inline: InlineComment[];
  /** Findings listed in the summary only, with the reason. */
  listed: Array<{ finding: Finding; reason: SummaryReason }>;
  /** Findings whose inline comment was already on the pull request. */
  alreadyPosted: Finding[];
  summaryBody: string;
  /** What happened to the summary comment (not set in a dry run). */
  summary?: 'created' | 'updated';
  /** Set when the pull request head differs from the reviewed commit. */
  stale?: { prHead: string; forced: boolean };
  /** Threads of earlier comments resolved because their finding was fixed (not in a dry run). */
  resolved: FixedThread[];
  notes: string[];
}

/**
 * Findings with fingerprints. Runs saved before fingerprints existed get them from the reviewed commit in
 * the local repository (the same code the pipeline hashes), else from the title fallback.
 */
async function findingsWithFingerprints(run: RunRecord, repo: GitRepo | undefined): Promise<Finding[]> {
  const sha = run.target.headSha;
  const missing = run.findings.filter((f) => !f.fingerprint || !FINGERPRINT_RE.test(f.fingerprint));
  if (!missing.length || !repo || !sha || !SHA_RE.test(sha)) return uniqueFingerprints(run.findings);
  const files = new Map<string, string[] | undefined>();
  for (const f of missing) {
    const file = safeRepoPath(f.file);
    if (file && !files.has(file)) files.set(file, (await repo.show(sha, file))?.split('\n'));
  }
  return uniqueFingerprints(
    run.findings.map((f) =>
      missing.includes(f)
        ? { ...f, fingerprint: computeFingerprint(f, files.get(safeRepoPath(f.file) ?? '')) }
        : f,
    ),
  );
}

function adapterFor(target: PublishTarget, client: ApiClient, logger: Logger): ForgeAdapter {
  return target.forge === 'github'
    ? githubAdapter(target, client, logger)
    : gitlabAdapter(target, client, logger);
}

/**
 * Posts a diff run to its pull / merge request: inline comments for findings inside the pull request diff
 * (de-duplicated by fingerprint, capped, skipped when the head moved), and one summary comment that later
 * runs update in place. `dryRun` renders the same without any API call.
 */
export async function publishRun(opts: PublishRunOptions): Promise<PublishOutcome> {
  const { run, logger } = opts;
  const t = run.target;
  if (t.kind !== 'diff') {
    throw new PublishError(
      'Only branch reviews (`code-reviewer review`) can be posted to a pull request; this run reviewed files.',
    );
  }
  if (t.local) {
    throw new PublishError(
      `This run reviewed ${t.local} changes, which are on no pull request: commit and push them, then review the branch to post it.`,
    );
  }
  if (!SHA_RE.test(t.headSha) || !SHA_RE.test(t.mergeBase)) {
    throw new PublishError('The run does not record valid commit ids; it cannot be published.');
  }
  const env = opts.env ?? process.env;
  const target = await resolvePublishTarget({
    run,
    flags: opts.flags,
    settings: opts.settings,
    env,
    ci: await detectCiPullRequest(env),
    findPullRequest: opts.findPullRequest,
  });
  for (const line of target.explanation) logger.debug(`publish: ${line}`);

  const notes: string[] = [];
  const findings = await findingsWithFingerprints(run, opts.repo);
  let diff: CommentableDiff | undefined;
  if (opts.repo) {
    try {
      diff = await loadCommentableDiff(opts.repo, t.mergeBase, t.headSha);
    } catch (err) {
      logger.debug(`publish: diff ${t.mergeBase}..${t.headSha}: ${(err as Error).message}`);
    }
  }
  if (!diff && findings.length) {
    notes.push('The reviewed commits are not in the local repository, so every finding is listed here.');
  }
  const settings = {
    maxInline: opts.settings.maxInlineComments,
    minSeverity: opts.settings.minSeverity,
    diff,
  };

  if (opts.dryRun) {
    const plan = planPublication(findings, { ...settings, posted: new Set(), stale: false });
    const inline = plan.inline.map((p) => ({ ...p, body: renderInlineComment(p.finding, p.fingerprint) }));
    const summaryBody = renderSummary({
      run,
      forge: target.forge,
      posted: inline,
      alreadyPosted: [],
      listed: plan.summary,
      notes,
    });
    return {
      target,
      dryRun: true,
      inline,
      listed: plan.summary,
      alreadyPosted: [],
      summaryBody,
      resolved: [],
      notes,
    };
  }

  const token = tokenFor(target.forge, env);
  if (!token) throw new PublishError(missingTokenMessage(target.forge));
  logger.debug(`publish: token from ${token.source}`);
  const userAgent = `code-reviewer/${packageVersion()}`;
  const client = new ApiClient({
    baseUrl: target.apiUrl,
    headers:
      target.forge === 'github'
        ? githubHeaders(token.token, userAgent)
        : gitlabHeaders(token.token, userAgent),
    fetch: opts.fetch,
    sleep: opts.sleep,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    logger,
  });
  const adapter = adapterFor(target, client, logger);
  const state = await adapter.load();
  const stale = state.headSha !== t.headSha.toLowerCase();
  if (stale) {
    logger.debug(`publish: head ${state.headSha} ≠ reviewed ${t.headSha}${opts.force ? ' (--force)' : ''}`);
  }
  const plan = planPublication(findings, { ...settings, posted: state.posted, stale: stale && !opts.force });
  const planned = plan.inline.map((p) => ({ ...p, body: renderInlineComment(p.finding, p.fingerprint) }));
  const listed = [...plan.summary];
  let inline: InlineComment[] = [];
  if (planned.length) {
    const result = await adapter.postInline(planned, t.headSha);
    inline = result.posted;
    for (const { comment } of result.rejected) listed.push({ finding: comment.finding, reason: 'rejected' });
    if (result.rejected.length) {
      notes.push(
        `${result.rejected.length} inline comment(s) were refused by the forge and are listed here.`,
      );
    }
  }
  listed.sort(
    (a, b) => (SEVERITY_ORDER[a.finding.severity] ?? 9) - (SEVERITY_ORDER[b.finding.severity] ?? 9),
  );
  const resolved =
    opts.settings.resolveFixed !== false && !stale && opts.repo
      ? await resolveFixed(adapter, opts.repo, run, findings, state.posted, notes, logger)
      : [];
  const staleInfo = stale ? { prHead: state.headSha, forced: opts.force === true } : undefined;
  const since = sinceLastReview(
    parseState(state.summary),
    t.headSha,
    findings,
    new Set(resolved.map((r) => r.thread.fingerprint)),
  );
  const summaryBody = renderSummary({
    run,
    forge: target.forge,
    posted: inline,
    alreadyPosted: plan.alreadyPosted,
    listed,
    staleHead: staleInfo,
    resolved: resolved.length,
    notes,
    ...(since ? { since } : {}),
  });
  const summary = await adapter.upsertSummary(summaryBody);
  return {
    target,
    dryRun: false,
    inline,
    listed,
    alreadyPosted: plan.alreadyPosted,
    summaryBody,
    summary,
    ...(staleInfo ? { stale: staleInfo } : {}),
    resolved,
    notes,
  };
}

/**
 * Resolves the threads of earlier inline comments whose finding was fixed (`fixedThreads` decides). Only
 * looked at when some fingerprint on the pull request is missing from this run; forge errors (a token that
 * may comment but not resolve, …) become a note instead of failing the publication.
 */
async function resolveFixed(
  adapter: ForgeAdapter,
  repo: GitRepo,
  run: RunRecord,
  findings: Finding[],
  posted: ReadonlySet<string>,
  notes: string[],
  logger: Logger,
): Promise<FixedThread[]> {
  const current = [...findings, ...(run.advisory ?? [])];
  const present = new Set(current.map((f) => f.fingerprint));
  if (![...posted].some((fp) => !present.has(fp))) return [];
  const done: FixedThread[] = [];
  try {
    const threads = await adapter.openThreads();
    for (const fixed of await fixedThreads(repo, run, current, threads)) {
      await adapter.resolveThread(fixed.thread, renderResolvedReply(fixed.reason, run));
      logger.debug(`publish: resolved ${fixed.thread.path}:${fixed.thread.endLine} (${fixed.reason})`);
      done.push(fixed);
    }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    logger.debug(`publish: resolving fixed threads: ${err.message}`);
    notes.push(`Earlier comments whose finding was fixed could not be resolved: ${err.message}`);
  }
  return done;
}
