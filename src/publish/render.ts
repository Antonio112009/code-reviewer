import { clipText, severityCounts, summaryLine, TOOL_INFO_URI } from '../report/common';
import { code, mdLine, mdText } from '../report/markdown';
import { FINGERPRINT_RE } from '../review/fingerprint';
import { CATEGORIES, type Finding, type RunRecord, SEVERITIES, type Severity } from '../types';
import { packageVersion } from '../util/paths';
import { type PlannedInline, SUMMARY_REASON_LABELS, type SummaryReason } from './plan';

/*
 * Pull request comments. Everything from a model or the repository is untrusted: it is clipped, escaped like
 * the Markdown report (no HTML, no images, no fences breaking out) and additionally defused for forges:
 * @mentions cannot ping anyone, issue / merge request references cannot cross-link, links do not render,
 * and no line can start a GitLab quick action (`/approve`, `/merge`, …) or a heading.
 */

/** Hidden marker of the summary comment; it is updated in place on later runs. */
export const SUMMARY_MARKER = '<!-- code-reviewer:summary -->';
/** Hidden marker of the (GitHub) review that carries the inline comments. */
export const REVIEW_MARKER = '<!-- code-reviewer:review -->';
/** Hidden marker of our reply that resolved a thread: a thread someone reopened is left alone. */
export const RESOLVED_MARKER = '<!-- code-reviewer:resolved -->';

/** GitHub's comment limit is 65,536 characters; GitLab's is far higher. Stay well below both. */
export const MAX_COMMENT_CHARS = 60_000;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 3_000;
const MAX_SUGGESTION = 1_500;
/** Summary entries: a shorter failure scenario, and at most this many findings listed. */
const MAX_SUMMARY_DESCRIPTION = 300;
const MAX_SUMMARY_FINDINGS = 50;

const ZWSP = '​';
/** Placeholders for `[` / `]` while the text goes through `mdText` (private-use code points). */
const OPEN = '';
const CLOSE = '';

export function fingerprintMarker(fingerprint: string): string {
  return `<!-- code-reviewer:fp=${fingerprint} -->`;
}

/** Fingerprints named by our markers in a comment body. */
export function extractFingerprints(body: unknown): string[] {
  if (typeof body !== 'string') return [];
  const out: string[] = [];
  for (const m of body.matchAll(/<!-- code-reviewer:fp=([0-9a-f]{16,64}) -->/g)) out.push(m[1]!);
  return out;
}

/** Brackets become placeholders before `mdText`, so no `[`, `](` or `![` survives into the Markdown. */
function hideBrackets(s: string): string {
  return s.replace(/\[/g, OPEN).replace(/\]/g, CLOSE);
}

/**
 * Defuses forge features in Markdown escaped by `mdText`: a zero-width space after `@` (mentions), after
 * `#` / `!` before digits (issue / merge request references), in URL schemes and `www.` (autolinks), and
 * before a line-leading `/` (GitLab quick actions) or `#` (headings). Bracket placeholders become character
 * references, which CommonMark treats as literal text (no links, images or reference definitions).
 */
function defuse(md: string): string {
  return md
    .split('\n')
    .map((line) =>
      line
        .replace(/@(?=[\w-])/g, `@${ZWSP}`)
        .replace(/([#!])(?=\d)/g, `$1${ZWSP}`)
        .replace(/\b(https?|ftp):\/\//gi, `$1:${ZWSP}//`)
        .replace(/\bwww\./gi, `www${ZWSP}.`)
        .replace(/^(\s*)([/#])/, `$1${ZWSP}$2`)
        .replaceAll(OPEN, '&#91;')
        .replaceAll(CLOSE, '&#93;'),
    )
    .join('\n');
}

/** Untrusted multi-line text for a comment: clipped, escaped (`mdText`), defused for forges. */
export function forgeText(s: unknown, max: number): string {
  return defuse(mdText(hideBrackets(clipText(String(s ?? '').trim(), max))));
}

/** Untrusted single-line text for a comment (whitespace collapsed). */
export function forgeLine(s: unknown, max: number): string {
  return defuse(mdLine(hideBrackets(clipText(String(s ?? ''), max))));
}

/** Inline code span for untrusted text (a mention or reference inside a code span does nothing). */
function forgeCode(s: unknown, max: number): string {
  return code(clipText(String(s ?? ''), max));
}

function severityOf(f: Finding): Severity {
  return SEVERITIES.includes(f.severity) ? f.severity : 'info';
}

function categoryOf(f: Finding): string {
  return CATEGORIES.includes(f.category) ? f.category : 'bug';
}

function confidenceOf(f: Finding): string {
  return typeof f.confidence === 'number' && Number.isFinite(f.confidence) ? f.confidence.toFixed(2) : '?';
}

function location(f: Finding): string {
  const range = f.endLine > f.startLine ? `${f.startLine}-${f.endLine}` : `${f.startLine}`;
  return `${f.file}:${range}`;
}

/** Body of one inline comment: severity, title, failure scenario, suggestion, confidence, critic verdict. */
export function renderInlineComment(f: Finding, fingerprint: string): string {
  const lines = [
    `**${severityOf(f).toUpperCase()}** · ${categoryOf(f)} · **${forgeLine(f.title, MAX_TITLE)}**`,
    '',
    forgeText(f.description, MAX_DESCRIPTION),
  ];
  if (f.suggestion?.trim()) lines.push('', `**Suggestion:** ${forgeText(f.suggestion, MAX_SUGGESTION)}`);
  const meta = [`confidence ${confidenceOf(f)}`];
  if (f.critique?.verdict) meta.push(`critic: ${forgeLine(f.critique.verdict, 20)}`);
  if (f.origin === 'static' && f.tool)
    meta.push(`static: ${forgeCode(`${f.tool.analyzer}/${f.tool.ruleId}`, 120)}`);
  meta.push(`[code-reviewer](${TOOL_INFO_URI})`);
  lines.push('', `<sub>${meta.join(' · ')}</sub>`);
  if (FINGERPRINT_RE.test(fingerprint)) lines.push('', fingerprintMarker(fingerprint));
  return lines.join('\n');
}

/** Reply posted before resolving the thread of a finding that was fixed. */
export function renderResolvedReply(reason: string, run: RunRecord): string {
  return [
    `Resolved: ${forgeLine(reason, 200)}, and the latest review (run ${code(clipText(run.id, 128))}) did not report this finding again. Reopen the thread if the problem is still there.`,
    '',
    RESOLVED_MARKER,
  ].join('\n');
}

/** Top-level body of the GitHub review that carries the inline comments. */
export function renderReviewBody(count: number): string {
  return `code-reviewer: ${count} inline comment${count === 1 ? '' : 's'} on this revision; the summary comment lists everything.\n\n${REVIEW_MARKER}`;
}

export interface SummaryInput {
  run: RunRecord;
  /** Wording: "pull request" (GitHub, default) or "merge request" (GitLab). */
  forge?: 'github' | 'gitlab';
  /** Inline comments posted by this publication. */
  posted: PlannedInline[];
  /** Findings whose inline comment was already on the pull request. */
  alreadyPosted: Finding[];
  /** Findings listed in the summary only. */
  listed: Array<{ finding: Finding; reason: SummaryReason }>;
  /** Pull request head when it differs from the reviewed commit. */
  staleHead?: { prHead: string; forced: boolean };
  /** Threads of earlier comments resolved because their finding was fixed. */
  resolved?: number;
  /** Extra notes (diff not available, …). */
  notes?: string[];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function shortSha(sha: string): string {
  return /^[0-9a-f]{7,64}$/i.test(sha) ? sha.slice(0, 8) : '?';
}

function summaryEntry(f: Finding, reason: SummaryReason): string {
  const head = `- **${severityOf(f).toUpperCase()}** ${forgeCode(location(f), 300)} · ${forgeLine(f.title, MAX_TITLE)} _(${SUMMARY_REASON_LABELS[reason]})_`;
  const detail = forgeLine(f.description, MAX_SUMMARY_DESCRIPTION);
  return detail ? `${head}\n  ${detail}` : head;
}

/**
 * The summary comment: counts by severity, what was not reviewed (failed chunks), a stale-head note, the
 * findings without an inline comment, and a compact footer. No links; the hidden marker lets later runs
 * update it in place.
 */
export function renderSummary(input: SummaryInput): string {
  const { run } = input;
  const request = input.forge === 'gitlab' ? 'merge request' : 'pull request';
  const counts = severityCounts(run.findings);
  const total = run.findings.length;
  const out: string[] = [
    SUMMARY_MARKER,
    `### Code review: ${total === 0 ? 'no findings' : plural(total, 'finding')}`,
    '',
  ];
  const target = run.target;
  const reviewed =
    target.kind === 'diff'
      ? `reviewed ${code(clipText(target.head, 120))} at ${code(shortSha(target.headSha))} against ${code(clipText(target.base, 120))}`
      : 'reviewed files';
  out.push(
    `${SEVERITIES.map((s) => `**${counts[s]}** ${s}`).join(' · ')} — ${reviewed}${run.options?.depth ? `, depth ${forgeLine(run.options.depth, 20)}` : ''}`,
    '',
  );
  const advisory = run.advisory?.length ?? 0;
  if (advisory) {
    out.push(
      `${plural(advisory, 'more finding')} of lower confidence or \`info\` severity ${advisory === 1 ? 'is' : 'are'} listed as "worth a look" in the review report, not here.`,
      '',
    );
  }

  const failed = run.chunks.filter((c) => c.status === 'failed');
  if (failed.length) {
    const files = [...new Set(failed.flatMap((c) => c.files))];
    const shown = files.slice(0, 10).map((f) => forgeCode(f, 200));
    const kinds = new Map<string, number>();
    for (const c of failed) kinds.set(c.failure ?? 'error', (kinds.get(c.failure ?? 'error') ?? 0) + 1);
    const reasons = [...kinds].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
    out.push(
      `> ⚠️ **${failed.length} of ${plural(run.chunks.length, 'chunk')} failed: part of the change was not reviewed** (${shown.join(', ')}${files.length > shown.length ? `, +${files.length - shown.length} more` : ''}). Reason: ${forgeLine(reasons, 200)}.`,
      '',
    );
  }
  if (run.status === 'partial' && !failed.length)
    out.push('> ⚠️ **The review did not finish: its results are partial.**', '');
  if (input.staleHead) {
    const { prHead, forced } = input.staleHead;
    out.push(
      forced
        ? `> ⚠️ The ${request} head (${code(shortSha(prHead))}) differs from the reviewed commit (${code(shortSha(target.headSha ?? ''))}); inline comments were posted anyway (\`--force\`) and may point at moved lines.`
        : `> ⚠️ The ${request} head (${code(shortSha(prHead))}) differs from the reviewed commit (${code(shortSha(target.headSha ?? ''))}): lines may have moved, so no inline comments were posted. Review the new head to update them.`,
      '',
    );
  }
  for (const note of input.notes ?? []) out.push(`> ${forgeLine(note, 500)}`, '');

  const inlineParts = [
    input.posted.length ? `${input.posted.length} new` : '',
    input.alreadyPosted.length ? `${input.alreadyPosted.length} already on this ${request}` : '',
    input.resolved ? `${input.resolved} resolved (fixed)` : '',
  ].filter(Boolean);
  if (inlineParts.length) out.push(`Inline comments: ${inlineParts.join(', ')}.`, '');

  const footer = `<sub>code-reviewer ${packageVersion()} · run ${code(clipText(run.id, 128))} · ${forgeLine(summaryLine(run), 400)}</sub>`;
  if (input.listed.length) {
    out.push(`#### Not commented inline (${input.listed.length})`, '');
    let used = out.join('\n').length + footer.length + 200;
    let shown = 0;
    for (const { finding, reason } of input.listed) {
      const entry = summaryEntry(finding, reason);
      if (shown >= MAX_SUMMARY_FINDINGS || used + entry.length > MAX_COMMENT_CHARS) break;
      out.push(entry);
      used += entry.length + 1;
      shown++;
    }
    if (shown < input.listed.length)
      out.push(`- … and ${input.listed.length - shown} more in the full report`);
    out.push('');
  }
  out.push(footer);
  return clipText(out.join('\n'), MAX_COMMENT_CHARS);
}
