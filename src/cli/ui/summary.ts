import path from 'node:path';
import {
  analyzersSummary,
  cacheLabel,
  costLabel,
  coverageLabel,
  coverageStatus,
  deepenAdviceText,
  failureAdvice,
  fallbackLabel,
  formatDuration,
  formatNumber,
  rejectedByReason,
  SEVERITY_ORDER,
  severityCounts,
  skillUsage,
  toolUsage,
} from '../../report/common';
import type { PhaseId } from '../../review/events';
import type { Finding, RunRecord, Severity } from '../../types';
import { clean, gist, join, padEnd, truncate, visibleWidth } from './format';
import type { Linker } from './links';
import type { Theme } from './theme';

export interface SummaryContext {
  theme: Theme;
  linker: Linker;
  /** Terminal width used to fit titles and descriptions. */
  width: number;
  verbose: boolean;
  /** Phase durations observed by the UI (execution order). */
  timings: Array<{ id: PhaseId; ms: number }>;
  reports: string[];
  runDir?: string;
}

const LABEL_WIDTH = 10;
const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'info'];

/** Findings grouped by file: files with the worst findings first, then by path; inside by severity, line. */
export function groupFindings(findings: Finding[]): Array<{ file: string; findings: Finding[] }> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const g = groups.get(f.file);
    if (g) g.push(f);
    else groups.set(f.file, [f]);
  }
  const worst = (fs: Finding[]) => Math.min(...fs.map((f) => SEVERITY_ORDER[f.severity] ?? 9));
  return [...groups]
    .map(([file, fs]) => ({
      file,
      findings: [...fs].sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
          a.startLine - b.startLine ||
          b.confidence - a.confidence,
      ),
    }))
    .sort((a, b) => worst(a.findings) - worst(b.findings) || a.file.localeCompare(b.file));
}

/**
 * `✖ 1 critical · 3 major · 2 minor · 1 info`, `✔ No defects above confidence 0.7`, or the failure of a
 * run that produced nothing.
 */
export function headline(run: RunRecord, theme: Theme): string {
  const { c, sym } = theme;
  if (run.findings.length === 0) {
    if (run.status === 'failed') {
      return c.bold(
        c.red(`${sym.fail} Review failed${run.error ? `: ${clean(run.error.split('\n')[0])}` : ''}`),
      );
    }
    const scope = run.status === 'partial' ? ' in the reviewed code' : '';
    const what = run.options.depth === 'essential' ? 'No serious defects' : 'No defects';
    const hint =
      run.options.depth === 'essential' ? c.dim(' (essential depth; --full checks everything)') : '';
    return `${c.bold(c.green(`${sym.ok} ${what} above confidence ${run.options.minConfidence}${scope}`))}${hint}`;
  }
  const counts = severityCounts(run.findings);
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map((s) => theme.severity(s, `${counts[s]} ${s}`));
  const worst = SEVERITIES.find((s) => counts[s] > 0) ?? 'info';
  const mark =
    worst === 'critical' || worst === 'major'
      ? c.red(sym.fail)
      : worst === 'minor'
        ? c.yellow(sym.warn)
        : c.cyan(sym.info);
  return c.bold(`${mark} ${parts.join(c.dim(` ${sym.dot} `))}`);
}

function statusLine(run: RunRecord, theme: Theme): string | undefined {
  const { c, sym } = theme;
  const failed = run.chunks.filter((ch) => ch.status === 'failed').length;
  if (run.status === 'failed' && run.findings.length > 0) {
    return c.red(`${sym.fail} Review failed${run.error ? `: ${clean(run.error.split('\n')[0])}` : ''}`);
  }
  if (run.status === 'partial') {
    const why = failed
      ? `${failed} of ${run.chunks.length} chunks failed`
      : 'the run was interrupted before it finished';
    return c.yellow(`${sym.warn} Partial result: ${why} — some code was not reviewed.`);
  }
  return undefined;
}

function findingMeta(f: Finding, theme: Theme): string {
  const { sym } = theme;
  const critic = f.critique
    ? f.critique.verdict === 'confirmed'
      ? `critic ${sym.analyzer.ok}`
      : `critic ${f.critique.verdict}`
    : '';
  const downgraded =
    f.critique?.originalSeverity && f.critique.originalSeverity !== f.severity
      ? `was ${f.critique.originalSeverity}`
      : '';
  const origin =
    f.origin === 'static'
      ? `static${f.tool ? ` ${clean(f.tool.analyzer)}` : ''}`
      : f.tool
        ? `confirms ${clean(f.tool.analyzer)}`
        : '';
  return join(
    [
      `conf ${f.confidence.toFixed(2)}`,
      critic,
      downgraded,
      origin,
      f.author ? `@${clean(f.author.name)}` : '',
    ],
    ` ${sym.dot} `,
  );
}

function findingLines(findings: Finding[], ctx: SummaryContext): string[] {
  const { theme, linker, width } = ctx;
  const { c } = theme;
  const out: string[] = [];
  const indent = ' '.repeat(2 + 8 + 2);
  groupFindings(findings).forEach((group, gi) => {
    if (gi > 0) out.push('');
    const locs = group.findings.map((f) => linker.location(f.file, f.startLine, f.endLine));
    const locWidth = Math.min(48, Math.max(...locs.map(visibleWidth)));
    group.findings.forEach((f, i) => {
      const loc = padEnd(locs[i]!, locWidth);
      const meta = findingMeta(f, theme);
      const prefix = 2 + 8 + 2 + Math.max(locWidth, visibleWidth(locs[i]!)) + 2;
      const titleRoom = Math.max(16, width - 1 - prefix - visibleWidth(meta) - 2);
      const title = truncate(clean(f.title), titleRoom, theme.sym.ellipsis);
      const line = `  ${theme.severityLabel(f.severity)}  ${c.cyan(loc)}  ${c.bold(title)}  ${c.dim(meta)}`;
      out.push(truncate(line, width - 1, theme.sym.ellipsis));
      const g = gist(f.description);
      if (g) out.push(indent + truncate(g, Math.max(20, width - 1 - indent.length), theme.sym.ellipsis));
    });
  });
  return out;
}

function section(theme: Theme, name: string, value: string, width: number): string {
  return truncate(`${theme.c.bold(padEnd(name, LABEL_WIDTH))} ${value}`, width - 1, theme.sym.ellipsis);
}

/** `Label      a · b · c`, wrapped onto indented continuation lines instead of being cut. */
function listSection(theme: Theme, name: string, items: string[], width: number): string[] {
  const sep = theme.c.dim(` ${theme.sym.dot} `);
  const room = Math.max(20, width - 1 - LABEL_WIDTH - 1);
  const rows: string[][] = [[]];
  let used = 0;
  for (const item of items) {
    const row = rows.at(-1)!;
    const w = visibleWidth(item) + (row.length ? 3 : 0);
    if (row.length && used + w > room) {
      rows.push([item]);
      used = visibleWidth(item);
    } else {
      row.push(item);
      used += w;
    }
  }
  return rows.map((row, i) => section(theme, i === 0 ? name : '', row.join(sep), width));
}

/** Final summary printed after a run: headline, findings by file, how the review went, where the reports are. */
export function renderSummary(run: RunRecord, ctx: SummaryContext): string {
  const { theme, width } = ctx;
  const { c, sym } = theme;
  const dot = c.dim(` ${sym.dot} `);
  const out: string[] = [''];
  out.push(headline(run, theme));
  const status = statusLine(run, theme);
  if (status) out.push(status);
  const notCovered = (run.coverage ?? []).filter((f) => f.status !== 'reviewed' && f.status !== 'skipped');
  if (notCovered.length) {
    out.push(
      c.yellow(
        `${sym.warn} Coverage: ${coverageLabel(run)} — ${notCovered
          .slice(0, 5)
          .map((f) => `${f.path} (${coverageStatus(f)})`)
          .join(', ')}${notCovered.length > 5 ? ', …' : ''}`,
      ),
    );
  }
  if (run.findings.length) out.push('', ...findingLines(run.findings, ctx));
  if (run.advisory?.length) {
    out.push(
      '',
      c.dim(
        `Worth a look (${run.advisory.length}): lower confidence or info — in the reports, not in pull request comments or --fail-on`,
      ),
      ...findingLines(run.advisory, ctx),
    );
  }
  if (run.notes?.length) {
    out.push(
      '',
      c.dim(
        `Maintainability notes (${run.notes.length}): true of the changed code, not defects — in the reports and the summary comment, never inline`,
      ),
      ...findingLines(run.notes, ctx),
    );
  }
  const tip = deepenAdviceText(run);
  if (tip) out.push('', c.cyan(`${sym.arrow} ${clean(tip)}`));
  out.push('');

  const items = (name: string, list: string[]) => {
    if (list.length) out.push(...listSection(theme, name, list, width));
  };
  items(
    'Skills',
    skillUsage(run)
      .filter((s) => s.chunks > 0)
      .map((s) => `${clean(s.id)} ${c.dim(`${sym.times}${s.chunks}`)}`),
  );
  items(
    'Tools',
    toolUsage(run).map((t) => `${clean(t.tool)} ${c.dim(`${sym.times}${t.calls}`)}`),
  );
  items(
    'Analyzers',
    (run.analyzers ?? []).map((a) => clean(analyzersSummary([a], sym.analyzer))),
  );
  const rejected = rejectedByReason(run);
  if (rejected.length) {
    const total = rejected.reduce((n, r) => n + r.count, 0);
    const [first, ...rest] = rejected.map((r) => `${r.count} ${clean(r.label)}`);
    items('Rejected', [`${total}${c.dim(':')} ${first}`, ...rest]);
  }
  const failed = run.chunks.filter((ch) => ch.status === 'failed' && ch.failure !== 'aborted');
  const maxFailed = ctx.verbose ? failed.length : 3;
  failed.slice(0, maxFailed).forEach((ch, i) => {
    const what = `${c.red(sym.fail)} ${clean(ch.id)} ${c.dim(clean(ch.files.slice(0, 2).join(', ')))} ${clean(failureAdvice(ch.failure))}`;
    out.push(section(theme, i === 0 ? 'Failed' : '', what, width));
  });
  if (failed.length > maxFailed) {
    out.push(
      section(theme, '', c.dim(`${sym.ellipsis} ${failed.length - maxFailed} more in the report`), width),
    );
  }
  items(
    'Second pass',
    run.chunks
      .filter((ch) => ch.deepened !== undefined)
      .map((ch) => `${clean(ch.id)} ${c.dim(`+${ch.deepened}`)}`),
  );
  const recovered = run.chunks.flatMap((ch) => ch.recovery ?? []);
  items(
    'Recovered',
    recovered.slice(0, ctx.verbose ? undefined : 4).map((r) => clean(r)),
  );
  for (const [i, f] of (run.fallbacks ?? []).entries()) {
    out.push(section(theme, i === 0 ? 'Fallbacks' : '', c.yellow(clean(fallbackLabel(f, sym.arrow))), width));
  }
  if (run.warnings.length) {
    const max = ctx.verbose ? run.warnings.length : 3;
    run.warnings.slice(0, max).forEach((w, i) => {
      out.push(section(theme, i === 0 ? 'Warnings' : '', `${c.yellow(sym.warn)} ${clean(w)}`, width));
    });
    if (run.warnings.length > max) {
      out.push(
        section(theme, '', c.dim(`${sym.ellipsis} ${run.warnings.length - max} more in the report`), width),
      );
    }
  }
  items('Timings', [
    `${formatDuration(run.durationMs)} total`,
    ...ctx.timings.filter((t) => t.ms >= 1).map((t) => `${t.id} ${c.dim(formatDuration(t.ms))}`),
  ]);
  const u = run.usage;
  const approx = u.estimated ? '≥' : '';
  items(
    'Tokens',
    [
      `in ${approx}${formatNumber(u.inputTokens)}`,
      u.cachedInputTokens ? `cached ${formatNumber(u.cachedInputTokens)}` : '',
      u.cacheWriteTokens ? `cache write ${formatNumber(u.cacheWriteTokens)}` : '',
      `out ${approx}${formatNumber(u.outputTokens)}`,
      u.reasoningTokens ? `reasoning ${formatNumber(u.reasoningTokens)}` : '',
      u.requests ? `${formatNumber(u.requests)} request${u.requests === 1 ? '' : 's'}` : '',
      u.estimated ? c.dim('estimated: not reported by the provider') : '',
    ].filter(Boolean),
  );
  const cost = costLabel(run);
  if (cost) out.push(section(theme, 'Cost', clean(cost), width));
  const cached = cacheLabel(run);
  if (cached && run.cache && run.cache.hits + run.cache.critiqueHits > 0) {
    out.push(section(theme, 'Cache', clean(cached), width));
  }
  const runDir = ctx.runDir ? ` ${c.dim(sym.arrow)} ${ctx.linker.path(ctx.runDir)}` : '';
  out.push(section(theme, 'Run', `${clean(run.id)} ${c.dim(`(${run.status})`)}${runDir}`, width));
  if (ctx.reports.length) {
    // Reports next to the run directory are shown by file name only (still clickable).
    const dir = ctx.runDir === undefined ? undefined : path.resolve(ctx.runDir);
    const short = dir !== undefined && ctx.reports.every((r) => path.dirname(path.resolve(r)) === dir);
    const items = ctx.reports.map((r) => ctx.linker.path(r, short ? path.basename(r) : undefined));
    out.push(section(theme, 'Reports', items.join(dot), width));
  }
  return `${out.join('\n')}\n`;
}

/** Red error block for a failed command. */
export function renderError(error: Error, theme: Theme, verbose: boolean): string {
  const { c, sym } = theme;
  const lines = String(error.message || error.name || 'Unknown error')
    .split('\n')
    .map((l) => clean(l))
    .filter(Boolean);
  const out = ['', c.red(c.bold(`${sym.fail} ${lines[0] ?? 'Review failed'}`))];
  for (const l of lines.slice(1, verbose ? undefined : 8)) out.push(c.red(`  ${l}`));
  if (verbose && error.stack) {
    for (const l of error.stack.split('\n').slice(1)) out.push(c.dim(`  ${clean(l)}`));
  }
  return `${out.join('\n')}\n`;
}
