import type { Command } from 'commander';
import type { Config } from '../../config/schema';
import { findOpenPullRequest } from '../../git/forge';
import type { GitRepo } from '../../git/repo';
import { type PublishFlags, type PublishOutcome, publishRun } from '../../publish';
import { SUMMARY_REASON_LABELS } from '../../publish/plan';
import { FORGE_LABELS, targetLabel } from '../../publish/target';
import { stripUnsafeChars } from '../../report/common';
import type { RunRecord } from '../../types';
import type { Logger } from '../../util/logger';

export interface PublishCliFlags extends PublishFlags {
  /** Post inline comments even when the pull request head moved since the review. */
  force?: boolean;
}

/** `--pr`, `--repo`, `--forge`, `--api-url`, `--force` (shared by `review --post` and `runs publish`). */
export function addPublishTargetOptions(cmd: Command): Command {
  return cmd
    .option(
      '--pr <number>',
      'pull/merge request to post to (default: from CI, else the open PR/MR of the branch)',
    )
    .option(
      '--repo <path>',
      'GitHub owner/name or GitLab project path/id (default: from CI or the git remote)',
    )
    .option('--forge <forge>', 'github | gitlab (default: detected from CI or the remote)')
    .option(
      '--api-url <url>',
      'API of GitHub Enterprise / self-managed GitLab, e.g. https://gitlab.example.com/api/v4 (receives your token)',
    )
    .option('--force', 'post inline comments even when the pull request head moved since the review');
}

export interface PostRunOptions {
  run: RunRecord;
  repo?: GitRepo;
  config: Config;
  flags: PublishCliFlags;
  logger: Logger;
  signal?: AbortSignal;
  /** Print what would be posted (stdout) instead of posting. */
  dryRun?: boolean;
  /** With `dryRun`: the plan as JSON. */
  json?: boolean;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function kindOf(outcome: PublishOutcome): string {
  return outcome.target.forge === 'github' ? 'pull request' : 'merge request';
}

/** Terminal text of a dry run: the target, then every comment body as it would be posted. */
export function renderDryRun(outcome: PublishOutcome): string {
  const { target } = outcome;
  const out = [
    `Would post to ${FORGE_LABELS[target.forge]} ${kindOf(outcome)} ${targetLabel(target)} (API ${target.apiUrl}):`,
    `  ${plural(outcome.inline.length, 'inline comment')}, ${plural(outcome.listed.length, 'finding')} in the summary only.`,
    '',
  ];
  for (const c of outcome.inline) {
    const range =
      c.anchor.endLine > c.anchor.startLine
        ? `${c.anchor.startLine}-${c.anchor.endLine}`
        : c.anchor.startLine;
    out.push(`--- Inline comment: ${stripUnsafeChars(c.anchor.path)}:${range} ---`, c.body, '');
  }
  out.push('--- Summary comment ---', outcome.summaryBody, '');
  return out.join('\n');
}

function dryRunJson(outcome: PublishOutcome): unknown {
  const { forge, apiUrl, repo, number } = outcome.target;
  return {
    forge,
    apiUrl,
    repo,
    number,
    inline: outcome.inline.map((c) => ({ ...c.anchor, fingerprint: c.fingerprint, body: c.body })),
    summaryOnly: outcome.listed.map(({ finding, reason }) => ({
      file: finding.file,
      startLine: finding.startLine,
      endLine: finding.endLine,
      severity: finding.severity,
      title: finding.title,
      fingerprint: finding.fingerprint,
      reason,
    })),
    summary: outcome.summaryBody,
  };
}

/**
 * Publishes a run to its pull / merge request and reports the outcome. Returns false (after printing the
 * error) when publishing failed; the run and its reports are already saved by then.
 */
export async function postRun(opts: PostRunOptions): Promise<boolean> {
  const { logger, repo } = opts;
  try {
    const outcome = await publishRun({
      run: opts.run,
      repo,
      settings: opts.config.publish,
      flags: opts.flags,
      force: opts.flags.force,
      dryRun: opts.dryRun,
      signal: opts.signal,
      logger,
      findPullRequest: repo
        ? (platform) =>
            findOpenPullRequest({ cwd: repo.root, platform, env: process.env, signal: opts.signal })
        : undefined,
    });
    if (outcome.dryRun) {
      process.stdout.write(
        opts.json ? `${JSON.stringify(dryRunJson(outcome), null, 2)}\n` : renderDryRun(outcome),
      );
      return true;
    }
    const parts = [
      plural(outcome.inline.length, 'inline comment'),
      outcome.alreadyPosted.length ? `${outcome.alreadyPosted.length} already there` : '',
      outcome.resolved.length ? `${outcome.resolved.length} fixed thread(s) resolved` : '',
      `summary ${outcome.summary}`,
    ].filter(Boolean);
    logger.success(
      `Posted to ${FORGE_LABELS[outcome.target.forge]} ${kindOf(outcome)} ${targetLabel(outcome.target)}: ${parts.join(', ')}`,
    );
    if (outcome.stale && !outcome.stale.forced) {
      logger.warn(
        `The ${kindOf(outcome)} head (${outcome.stale.prHead.slice(0, 8)}) differs from the reviewed commit: no inline comments were posted (--force posts them anyway).`,
      );
    }
    const reasons = new Map<string, number>();
    for (const { reason } of outcome.listed) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    if (reasons.size) {
      const list = [...reasons].map(
        ([r, n]) => `${n} ${SUMMARY_REASON_LABELS[r as keyof typeof SUMMARY_REASON_LABELS]}`,
      );
      logger.note(`Listed in the summary only: ${list.join(', ')}`);
    }
    for (const note of outcome.notes) logger.warn(note);
    return true;
  } catch (err) {
    logger.error(`Publishing failed: ${(err as Error).message}`);
    return false;
  }
}
