import path from 'node:path';
import { formatMoney } from '../../models/pricing';
import { analyzersSummary, formatDuration, formatNumber, stackEntries } from '../../report/common';
import type { ReviewPlan } from '../../review/events';
import { clean, join, padEnd, padStart, plural } from './format';
import { routingText, targetText } from './lines';
import { createTheme, type Theme } from './theme';

const LABEL_WIDTH = 10;
const MAX_LISTED = 12;

function list(items: string[], theme: Theme, max = MAX_LISTED): string {
  const shown = items.slice(0, max).map(clean).join(', ');
  return items.length > max ? `${shown} ${theme.c.dim(`+${items.length - max} more`)}` : shown;
}

function row(theme: Theme, name: string, value: string): string {
  return `${theme.c.bold(padEnd(name, LABEL_WIDTH))} ${value}`;
}

function cont(value: string): string {
  return `${' '.repeat(LABEL_WIDTH)} ${value}`;
}

/** `essential — serious production issues only (critical, major) · --full for everything` */
export function depthText(plan: Pick<ReviewPlan, 'depth' | 'minSeverity'>, theme: Theme): string {
  const { c } = theme;
  if (plan.depth === 'essential') {
    return `essential ${c.dim(`— serious production issues only (≥ ${plan.minSeverity}) · --full for everything`)}`;
  }
  return `full ${c.dim(`— every real defect (≥ ${plan.minSeverity})`)}`;
}

/** Selection reasons from most to least telling: what the changed code matched before inherited detection. */
const REASON_ORDER = [
  'content:',
  'file:',
  'version:',
  'static-hint',
  'explicit',
  'stack:',
  'extends:',
  'always-on',
  'group:',
  'language:',
];

/** The most telling reason a skill was selected (clipped), for one-line displays. */
export function primaryReason(reasons: readonly string[]): string | undefined {
  for (const prefix of REASON_ORDER) {
    const hit = reasons.find((r) => r.startsWith(prefix));
    if (hit) return hit.length > 48 ? `${hit.slice(0, 47)}…` : hit;
  }
  return reasons[0];
}

/** Human-readable `--dry-run` plan (refs, stack, analyzers, chunks with files, context, skills, timeouts). */
export function renderPlanText(
  plan: ReviewPlan,
  opts: { color: boolean; cwd: string; unicode?: boolean },
): string {
  const theme = createTheme(opts.color, opts.unicode ?? true);
  const { c, sym } = theme;
  const dot = c.dim(` ${sym.dot} `);
  const out: string[] = [];
  const t = plan.target;

  const shas =
    t.kind === 'diff'
      ? c.dim(`  (merge-base ${t.mergeBase.slice(0, 8)} ${sym.dot} head ${t.headSha.slice(0, 8)})`)
      : '';
  out.push(`${c.cyan(sym.diamond)} ${c.bold('Review plan')}  ${c.bold(targetText(t, theme))}${shas}`);
  const rel = path.relative(opts.cwd, plan.root);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.push(row(theme, 'Root', clean(rel)));
  else if (rel) out.push(row(theme, 'Root', clean(plan.root)));

  // Refs: how base/head were chosen and anything the user should know.
  if (plan.refs) {
    const r = plan.refs;
    const how = join(
      [
        `base from ${r.baseSource}`,
        r.remote ? `remote ${clean(r.remote)}` : '',
        r.fetched ? 'fetched' : 'not fetched',
      ],
      dot,
    );
    out.push(row(theme, 'Refs', how));
    for (const line of r.explanation) out.push(cont(c.dim(`${sym.dot} ${clean(line)}`)));
    for (const note of r.notes) out.push(cont(c.yellow(`${sym.warn} ${clean(note)}`)));
  }

  out.push(row(theme, 'Models', routingText(plan.routing, theme)));
  out.push(row(theme, 'Depth', depthText(plan, theme)));

  const techs = stackEntries(plan.stack);
  if (plan.stack) {
    const names = techs.map((x) => clean(x.name));
    out.push(row(theme, 'Stack', names.length ? names.join(dot) : c.dim('nothing detected')));
    const pkgs = plan.stack.packages.filter((p) => p.techs.length > 0);
    if (pkgs.length > 1) {
      for (const p of pkgs.slice(0, 8))
        out.push(cont(c.dim(`${clean(p.dir)}: ${p.techs.map(clean).join(', ')}`)));
    }
  }

  if (plan.analyzers) {
    const summary = analyzersSummary(plan.analyzers, sym.analyzer, ` ${sym.dot} `);
    out.push(row(theme, 'Analyzers', summary ? clean(summary) : c.dim('none')));
    for (const a of plan.analyzers.filter((x) => x.status !== 'ok' && x.reason)) {
      out.push(cont(c.dim(`${clean(a.label)}: ${clean(a.reason)}`)));
    }
  }

  if (plan.projectRules.length) out.push(row(theme, 'Rules', list(plan.projectRules, theme)));

  out.push(
    row(
      theme,
      'Files',
      join(
        [
          `${plan.units} to review`,
          plan.deleted.length ? `${plan.deleted.length} deleted` : '',
          plan.skipped.length ? `${plan.skipped.length} skipped` : '',
        ],
        dot,
      ),
    ),
  );
  if (plan.deleted.length) out.push(cont(c.dim(`deleted: ${list(plan.deleted, theme, 8)}`)));
  if (plan.skipped.length) {
    const skipped = plan.skipped.slice(0, 8).map((s) => `${clean(s.path)} (${clean(s.reason)})`);
    const more = plan.skipped.length > 8 ? ` +${plan.skipped.length - 8} more` : '';
    out.push(cont(c.dim(`skipped: ${skipped.join(', ')}${more}`)));
  }

  // Chunk table: one header line per chunk, then its files, context, skills.
  out.push('', c.bold(`Chunks (${plan.chunks.length}, budget ${formatNumber(plan.budget)} tokens each)`));
  const idWidth = Math.max(4, ...plan.chunks.map((ch) => clean(ch.id).length));
  const tokWidth = Math.max(6, ...plan.chunks.map((ch) => formatNumber(ch.tokens).length));
  for (const ch of plan.chunks) {
    const head = join(
      [
        c.cyan(padEnd(clean(ch.id), idWidth)),
        `${padStart(formatNumber(ch.tokens), tokWidth)} tok`,
        `timeout ${formatDuration(ch.timeoutMs)}`,
        ch.hints ? c.yellow(plural(ch.hints, 'hint')) : c.dim('0 hints'),
        ch.groupReasons.length ? c.dim(`[${ch.groupReasons.map(clean).join(', ')}]`) : '',
      ],
      '  ',
    );
    out.push(`  ${head}`);
    const pad = ' '.repeat(2 + idWidth + 2);
    out.push(`${pad}${c.dim('files  ')}  ${list(ch.files, theme)}`);
    if (ch.contextFiles.length) out.push(`${pad}${c.dim('context')}  ${c.dim(list(ch.contextFiles, theme))}`);
    if (ch.skills.length) {
      const skills = ch.skills.map((s) => {
        const reason = primaryReason(s.reasons);
        return reason ? `${clean(s.id)} ${c.dim(`(${clean(reason)})`)}` : clean(s.id);
      });
      out.push(`${pad}${c.dim('skills ')}  ${skills.join(', ')}`);
    }
  }
  if (plan.chunks.length === 0) out.push(c.dim('  nothing to review'));

  // Totals.
  const owned = new Set(plan.chunks.flatMap((ch) => ch.files)).size;
  const context = new Set(plan.chunks.flatMap((ch) => ch.contextFiles)).size;
  const hints = plan.chunks.reduce((n, ch) => n + ch.hints, 0);
  out.push(
    '',
    row(
      theme,
      'Totals',
      join(
        [
          plural(plan.chunks.length, 'chunk'),
          `${formatNumber(plan.totalTokens)} tokens`,
          `${plural(owned, 'file')}${context ? ` + ${context} context` : ''}`,
          plural(hints, 'hint'),
          plan.skills.length ? `skills: ${plan.skills.map(clean).join(', ')}` : 'no skills',
        ],
        dot,
      ),
    ),
  );
  if (plan.estimate) {
    const e = plan.estimate;
    const cost = e.cost ? ` ${sym.dot} at least ${formatMoney(e.cost)}` : '';
    out.push(
      row(
        theme,
        'Estimate',
        `${formatNumber(e.inputTokens)} prompt tokens${cost} ${c.dim('(before tool calls, retries and critique)')}`,
      ),
    );
  }
  return `${out.join('\n')}\n`;
}
