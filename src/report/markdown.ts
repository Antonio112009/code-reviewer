import type { Finding, RunRecord } from '../types';
import {
  cacheLabel,
  chunkModelLabel,
  costLabel,
  depthLabel,
  failureAdvice,
  fallbackLabel,
  formatDuration,
  formatNumber,
  rejectedByReason,
  rejectionLabel,
  routingLabel,
  skillUsage,
  sortFindings,
  stackEntries,
  stripUnsafeChars,
  summaryLine,
  targetLabel,
  tokensLabel,
  toolCallsLabel,
  toolUsage,
} from './common';

// Everything below that comes from the reviewed repository or from model output is untrusted: it is
// stripped of control characters and HTML-escaped so a malicious PR cannot inject markup, images or
// tracking pixels into a report that is later rendered (IDE preview, PR comment, wiki).

function stripControls(s: string): string {
  return stripUnsafeChars(s);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&(?=[#a-zA-Z0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Markdown prose from a model or the repository (untrusted): HTML is escaped, backticks are escaped
 * (code-span detection that differs from CommonMark by one backtick would let raw HTML through, and an
 * unclosed fence would swallow the rest of the report), images are neutralised (`![x](url)` would load a
 * remote resource when the report is viewed) and `~~~` fences are broken.
 */
export function mdText(s: string): string {
  return stripControls(s)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      escapeHtml(line)
        .replace(/[\\`]/g, '\\$&')
        .replace(/!\[/g, '!\\[')
        .replace(/^(\s*)~~~/, '$1\\~~~'),
    )
    .join('\n');
}

/** Single-line text (headings, list items): whitespace collapsed, markup escaped. */
export function mdLine(s: string): string {
  return mdText(s.replace(/\s+/g, ' ').trim());
}

/** Table cell: single line, `|` escaped (also inside code spans, as GFM requires). */
function cell(s: string): string {
  return mdLine(s).replace(/\|/g, '\\|') || '—';
}

/** Inline code span that cannot be broken out of (backtick runs inside are handled). */
export function code(s: string): string {
  const text = stripControls(s).replace(/\s+/g, ' ');
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

function codeCell(s: string): string {
  return code(s).replace(/\|/g, '\\|');
}

/** Fenced block that cannot be closed early by the content. */
function fence(text: string, lang = ''): string {
  const clean = stripControls(text).trimEnd();
  const longest = Math.max(0, ...[...clean.matchAll(/`{3,}/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${clean}\n${ticks}`;
}

function safeUrl(url: string | undefined): string | undefined {
  if (!url || !/^https?:\/\/[^\s<>()]+$/.test(url)) return undefined;
  return url;
}

function list(items: string[], max: number): string {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} +${items.length - max}` : shown;
}

function renderFinding(f: Finding, n: number): string {
  const loc = `${f.file}:${f.startLine}${f.endLine !== f.startLine ? `-${f.endLine}` : ''}`;
  const lineUrl = safeUrl(f.author?.lineUrl);
  const locLink = lineUrl ? `[${code(loc)}](${lineUrl})` : code(loc);
  const conf = f.critique
    ? `confidence **${f.confidence.toFixed(2)}** (reviewer ${f.critique.originalConfidence.toFixed(2)}, critic: ${f.critique.verdict})`
    : `confidence **${f.confidence.toFixed(2)}**`;
  const meta = [locLink, f.category, conf];
  if (f.origin === 'static')
    meta.push(`static${f.tool ? `: ${code(`${f.tool.analyzer}/${f.tool.ruleId}`)}` : ''}`);
  else if (f.tool) meta.push(`confirms ${code(`${f.tool.analyzer}/${f.tool.ruleId}`)}`);
  if (f.author) {
    const commitUrl = safeUrl(f.author.commitUrl);
    const sha = f.author.commit.slice(0, 8);
    const commit = commitUrl ? `[${code(sha)}](${commitUrl})` : code(sha);
    const email = f.author.email ? ` &lt;${mdLine(f.author.email)}&gt;` : '';
    meta.push(`author: ${mdLine(f.author.name)}${email} (${commit})`);
  }
  const lines = [
    `### ${n}. [${f.severity.toUpperCase()}] ${mdLine(f.title)}`,
    '',
    meta.join(' · '),
    '',
    mdText(f.description.trim()),
  ];
  if (f.evidence) lines.push('', '**Evidence**', '', fence(f.evidence));
  if (f.suggestion) lines.push('', `**Suggestion:** ${mdText(f.suggestion.trim())}`);
  if (f.critique?.reason) lines.push('', `> **Critic:** ${mdLine(f.critique.reason)}`);
  const source = [
    f.skills.length ? `skills: ${f.skills.map(mdLine).join(', ')}` : '',
    `chunks: ${f.source.chunkIds.map(mdLine).join(', ')}`,
    f.source.model ? `model: ${mdLine(`${f.source.provider}:${f.source.model}`)}` : '',
  ].filter(Boolean);
  lines.push('', `<sub>${source.join(' · ')}</sub>`);
  return lines.join('\n');
}

function renderRefs(run: RunRecord, out: string[]): void {
  const t = run.target;
  if (t.kind !== 'diff' && !run.refs) return;
  out.push('## Refs', '');
  if (t.kind === 'diff') {
    out.push(`- **Base:** ${code(t.base)} at ${code(t.baseSha.slice(0, 12))}`);
    out.push(`- **Head:** ${code(t.head)} at ${code(t.headSha.slice(0, 12))}`);
    out.push(`- **Merge-base:** ${code(t.mergeBase.slice(0, 12))}`);
  }
  const refs = run.refs;
  if (refs) {
    const remote = refs.remote ? ` · remote ${code(refs.remote)}` : '';
    out.push(
      `- **Base chosen by:** ${mdLine(refs.baseSource)}${remote} · ${refs.fetched ? 'fetched' : 'not fetched'}`,
    );
    for (const line of refs.explanation) out.push(`  - ${mdLine(line)}`);
    if (refs.notes.length) {
      out.push('', '**Notes**', '');
      for (const note of refs.notes) out.push(`- ⚠️ ${mdLine(note)}`);
    }
  }
  out.push('');
}

function renderStack(run: RunRecord, out: string[]): void {
  const entries = stackEntries(run.stack);
  if (!entries.length) return;
  out.push('## Detected stack', '');
  out.push('| Technology | Category | Score |', '|---|---|---|');
  for (const t of entries) out.push(`| ${cell(t.name)} | ${cell(t.category)} | ${t.score.toFixed(2)} |`);
  out.push('');
}

function renderAnalyzers(run: RunRecord, out: string[]): void {
  const runs = run.analyzers ?? [];
  if (!runs.length) return;
  const hits = runs.reduce((n, r) => n + (r.status === 'ok' ? r.hits : 0), 0);
  out.push('## Static analysis', '');
  const ok = runs.filter((r) => r.status === 'ok').length;
  out.push(`**${hits} hint${hits === 1 ? '' : 's'}** from ${ok} of ${runs.length} analyzers.`, '');
  out.push('| Analyzer | Tier | Status | Hints | Duration | Details |', '|---|---|---|---|---|---|');
  for (const r of runs) {
    const details = [r.version ? `v${r.version}` : '', r.reason ?? ''].filter(Boolean).join(' · ');
    out.push(
      `| ${cell(r.label)} | ${r.tier} | ${r.status} | ${r.hits} | ${formatDuration(r.durationMs)} | ${cell(details)} |`,
    );
  }
  out.push('');
}

function renderSkillsAndTools(run: RunRecord, out: string[]): void {
  const skills = skillUsage(run);
  if (skills.length) {
    out.push('## Skills used', '');
    out.push(skills.map((s) => `${code(s.id)} ×${s.chunks}`).join(' · '), '');
  }
  const tools = toolUsage(run);
  if (tools.length) {
    const total = tools.reduce((n, t) => n + t.calls, 0);
    out.push('## Tool usage', '');
    out.push(
      `${total} call${total === 1 ? '' : 's'}: ${tools.map((t) => `${code(t.tool)} ×${t.calls}`).join(' · ')}`,
      '',
    );
  }
}

function renderChunks(run: RunRecord, out: string[]): void {
  out.push('## Chunks', '');
  out.push(
    '| Chunk | Files | Context files | Tokens | Skills | Hints | Tool calls | Model | Timeout | Duration | Status | Findings |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const c of run.chunks) {
    const status = [
      `${c.status}${c.cached ? ` (${c.cached === 'all' ? 'cached' : 'partly cached'})` : ''}${c.failure ? ` (${c.failure})` : ''}${c.attempts && c.attempts > 1 ? ` (${c.attempts} attempts)` : ''}${c.error ? `: ${c.error.split('\n')[0]!.slice(0, 120)}` : ''}`,
      ...(c.recovery ?? []).map((r) => `↻ ${r}`),
    ].join('; ');
    out.push(
      [
        '',
        cell(c.id),
        cell(list(c.files, 4)),
        cell(list(c.contextFiles ?? [], 3)),
        formatNumber(c.tokens),
        cell(c.skills.join(', ')),
        String(c.hints ?? 0),
        cell(toolCallsLabel(c.toolCalls, '×', ', ')),
        cell(chunkModelLabel(c)),
        formatDuration(c.timeoutMs),
        formatDuration(c.durationMs),
        cell(status),
        String(c.findings),
        '',
      ]
        .join(' | ')
        .trim(),
    );
  }
  out.push('');
}

/** Markdown report: findings first, then how the review was done (refs, stack, analyzers, skills, chunks). */
export function renderMarkdown(run: RunRecord): string {
  const out: string[] = [];
  out.push(`# Code review — ${mdLine(targetLabel(run))}`, '');
  out.push('| | |', '|---|---|');
  out.push(`| Run | ${codeCell(run.id)} |`);
  out.push(`| Status | ${run.status} |`);
  out.push(`| Created | ${run.createdAt} |`);
  out.push(`| Review model | ${cell(routingLabel(run, 'review') ?? '—')} |`);
  if (run.options.selfCritique)
    out.push(`| Critique model | ${cell(routingLabel(run, 'critique') ?? '—')} |`);
  out.push(`| Duration | ${formatDuration(run.durationMs)} |`);
  out.push(`| Tokens | ${cell(tokensLabel(run))} |`);
  const cost = costLabel(run);
  if (cost) out.push(`| Cost | ${cell(cost)} |`);
  const cached = cacheLabel(run);
  if (cached) out.push(`| Cache | ${cell(cached)} |`);
  const failed = run.chunks.filter((c) => c.status === 'failed');
  out.push(`| Chunks | ${run.chunks.length}${failed.length ? ` (${failed.length} failed)` : ''} |`);
  out.push(`| Depth | ${cell(depthLabel(run))} |`);
  out.push(`| Min confidence | ${run.options.minConfidence} |`, '');
  out.push(`**${mdLine(summaryLine(run))}**`, '');
  if (run.error) out.push(`> **Error:** ${mdLine(run.error)}`, '');
  if (failed.length) {
    out.push(`> **Not reviewed:** ${failed.length} of ${run.chunks.length} chunks failed.`);
    for (const c of failed) {
      out.push(`> - ${codeCell(c.id)} (${cell(list(c.files, 4))}): ${mdLine(failureAdvice(c.failure))}`);
    }
    out.push('');
  }
  if (run.summary) out.push(mdText(run.summary), '');

  out.push('## Findings', '');
  const findings = sortFindings(run.findings);
  if (findings.length === 0) out.push('_No defects found above the confidence threshold._', '');
  findings.forEach((f, i) => {
    out.push(renderFinding(f, i + 1), '', '---', '');
  });

  if (run.advisory?.length) {
    out.push(
      `## Worth a look (${run.advisory.length})`,
      '',
      '_Lower confidence or `info` severity: not posted to the pull request and not counted by `--fail-on`._',
      '',
      '| Location | Severity | Title | Confidence |',
      '|---|---|---|---|',
    );
    for (const f of sortFindings(run.advisory)) {
      out.push(
        `| ${codeCell(`${f.file}:${f.startLine}`)} | ${f.severity} | ${cell(f.title)} | ${f.confidence.toFixed(2)} |`,
      );
    }
    out.push('');
  }

  if (run.rejected.length) {
    out.push(`## Rejected findings (${run.rejected.length})`, '');
    out.push(
      rejectedByReason(run)
        .map((r) => `${r.count} ${r.label}`)
        .join(' · '),
      '',
    );
    out.push('| Location | Title | Reason | Confidence |', '|---|---|---|---|');
    for (const f of sortFindings(run.rejected)) {
      const reason =
        f.droppedReason === 'critique' && f.critique
          ? `critique: ${f.critique.reason}`
          : rejectionLabel(f.droppedReason, run.options);
      out.push(
        `| ${codeCell(`${f.file}:${f.startLine}`)} | ${cell(f.title)} | ${cell(reason)} | ${f.confidence.toFixed(2)} |`,
      );
    }
    out.push('');
  }

  renderRefs(run, out);
  renderStack(run, out);
  renderAnalyzers(run, out);
  renderSkillsAndTools(run, out);
  if (run.fallbacks?.length) {
    out.push('## Model fallbacks', '', ...run.fallbacks.map((f) => `- ${mdLine(fallbackLabel(f))}`), '');
  }
  renderChunks(run, out);
  if (run.warnings.length) {
    out.push('## Warnings', '', ...run.warnings.map((w) => `- ${mdLine(w)}`), '');
  }
  return out.join('\n');
}
