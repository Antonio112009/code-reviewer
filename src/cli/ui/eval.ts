import { defectKey } from '../../eval/compare';
import type {
  CaseResult,
  EvalComparison,
  EvalResult,
  FindingRef,
  MetricDelta,
  Metrics,
} from '../../eval/types';
import { formatMoney } from '../../models/pricing';
import { formatDuration, formatTokens } from '../../report/common';
import { clean, padEnd, padStart, plural, truncate } from './format';
import type { Theme } from './theme';

// Human summary of an eval (stderr). Case ids, titles and notes come from case files, finding titles from
// models, and a compared result from disk: all of it goes through `clean`.

const MAX_LIST = 15;
const ID_WIDTH = 44;

/** Every token the runs processed: uncached and cached input, and output. */
export function totalTokens(m: Pick<Metrics, 'inputTokens' | 'cachedInputTokens' | 'outputTokens'>): number {
  return m.inputTokens + (m.cachedInputTokens ?? 0) + m.outputTokens;
}

export function pct(r: number | null | undefined): string {
  return r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`;
}

function points(d: number | null): string {
  if (d === null) return '';
  const p = Math.round(d * 100);
  return p === 0 ? '±0' : `${p > 0 ? '+' : ''}${p} pts`;
}

function ranged(r: number | null, min: number | null, max: number | null, repeat: number): string {
  if (repeat <= 1 || min === null || max === null || min === max) return pct(r);
  return `${pct(r)} (${Math.round(min * 100)}–${Math.round(max * 100)})`;
}

function location(f: { file: string; startLine: number; endLine: number }): string {
  return clean(defectKey(f));
}

function caseRow(c: CaseResult, cols: number[], theme: Theme, repeat: number): string {
  const m = c.metrics;
  const recalls = c.runs.map((r) => r.metrics.recall).filter((r): r is number => r !== null);
  const status =
    m.errors > 0
      ? theme.c.red(`${theme.sym.fail} ${plural(m.errors, 'error')}`)
      : m.failedChunks > 0
        ? theme.c.yellow(`${theme.sym.warn} ${m.failedChunks} failed chunk(s)`)
        : '';
  const cells = [
    truncate(clean(c.id), ID_WIDTH),
    String(m.expected),
    String(m.found),
    String(m.missed),
    c.clean ? '—' : String(m.unexpected),
    c.clean ? String(m.falsePositives) : '—',
    String(m.duplicates),
    c.clean
      ? '—'
      : ranged(
          m.recall,
          recalls.length ? Math.min(...recalls) : null,
          recalls.length ? Math.max(...recalls) : null,
          repeat,
        ),
    pct(m.precision),
    formatTokens(totalTokens(m)),
    formatDuration(m.durationMs),
  ];
  // Padded before colouring (escape sequences would break the widths): misses and false positives stand out.
  const paint: Array<((s: string) => string) | undefined> = [];
  if (m.missed > 0) paint[3] = theme.c.yellow;
  if (m.falsePositives > 0) paint[5] = theme.c.red;
  const line = cells
    .map((cell, i) => {
      const padded = i === 0 ? padEnd(cell, cols[0]!) : padStart(cell, cols[i]!);
      return paint[i]?.(padded) ?? padded;
    })
    .join('  ');
  return `${line}${status ? `  ${status}` : ''}`;
}

const HEADERS = ['Case', 'Exp', 'Found', 'Miss', 'Unexp', 'FP', 'Dup', 'Recall', 'Prec.', 'Tokens', 'Time'];

function table(result: EvalResult, theme: Theme): string[] {
  const repeat = result.settings.repeat;
  const agg = result.aggregate;
  const totalLabel = `Total (${plural(agg.cases, 'case')}${repeat > 1 ? ` ${theme.sym.times} ${repeat}` : ''})`;
  const idWidth = Math.min(
    ID_WIDTH,
    Math.max(totalLabel.length, ...result.cases.map((c) => clean(c.id).length)),
  );
  const cols = [idWidth, 3, 5, 4, 5, 3, 3, repeat > 1 ? 14 : 6, 5, 6, 7];
  const header = HEADERS.map((h, i) => (i === 0 ? padEnd(h, cols[0]!) : padStart(h, cols[i]!))).join('  ');
  const rows = result.cases.map((c) => caseRow(c, cols, theme, repeat));
  const total = [
    padEnd(totalLabel, cols[0]!),
    ...[agg.expected, agg.found, agg.missed, agg.unexpected, agg.falsePositives, agg.duplicates].map((n, i) =>
      padStart(String(n), cols[i + 1]!),
    ),
    padStart(ranged(agg.recall, agg.recallMin, agg.recallMax, repeat), cols[7]!),
    padStart(pct(agg.precision), cols[8]!),
    padStart(formatTokens(totalTokens(agg)), cols[9]!),
    padStart(formatDuration(result.durationMs), cols[10]!),
  ].join('  ');
  const rule = theme.c.dim('─'.repeat(Math.min(120, header.length)));
  return [theme.c.bold(header), rule, ...rows, rule, theme.c.bold(total)];
}

function findingLine(caseId: string, f: FindingRef, times: number, theme: Theme): string {
  const count = times > 1 ? theme.c.dim(` ${theme.sym.times}${times}`) : '';
  return `  ${clean(caseId)}  ${theme.c.cyan(location(f))}  ${truncate(clean(f.title), 80)}${count}`;
}

/** Unexpected findings or false positives of every case, the same finding of several runs once. */
function noiseLines(result: EvalResult, pick: 'unexpected' | 'falsePositives', theme: Theme): string[] {
  const lines: string[] = [];
  for (const c of result.cases) {
    const seen = new Map<string, { f: FindingRef; times: number }>();
    for (const f of c.runs.flatMap((r) => r[pick])) {
      const key = `${location(f)} ${f.title}`;
      const entry = seen.get(key);
      if (entry) entry.times++;
      else seen.set(key, { f, times: 1 });
    }
    for (const { f, times } of seen.values()) lines.push(findingLine(c.id, f, times, theme));
  }
  return lines;
}

function capped(title: string, lines: string[], theme: Theme): string[] {
  if (lines.length === 0) return [];
  const more = lines.length - MAX_LIST;
  return [
    '',
    theme.c.bold(title),
    ...lines.slice(0, MAX_LIST),
    ...(more > 0 ? [theme.c.dim(`  ${theme.sym.ellipsis} ${more} more in result.json`)] : []),
  ];
}

function missedLines(result: EvalResult, theme: Theme): string[] {
  const lines: string[] = [];
  for (const c of result.cases) {
    const runs = c.metrics.runs;
    for (const d of c.defects) {
      if (runs === 0 || d.found >= runs) continue;
      const rate = runs > 1 ? theme.c.dim(` (missed in ${runs - d.found}/${runs} runs)`) : '';
      const lost = d.lost > 0 ? theme.c.yellow(` ${theme.sym.dot} removed by critique/threshold`) : '';
      const note = d.note ? `  ${truncate(clean(d.note), 70)}` : '';
      lines.push(`  ${clean(c.id)}  ${theme.c.cyan(location(d))}${note}${rate}${lost}`);
    }
  }
  return lines;
}

function critiqueLine(m: Metrics, theme: Theme): string | undefined {
  if (m.lost === 0 && m.saved === 0) return undefined;
  const parts = [
    `recall ${pct(m.rawRecall)} ${theme.sym.arrow} ${pct(m.recall)}${m.lost ? ` (${plural(m.lost, 'expected defect')} lost)` : ''}`,
    `precision ${pct(m.rawPrecision)} ${theme.sym.arrow} ${pct(m.precision)}${m.saved ? ` (${plural(m.saved, 'unexpected/false-positive finding')} removed)` : ''}`,
  ];
  return `Self-critique and thresholds: ${parts.join(`, `)}`;
}

/** The summary printed after an eval: a table per case, totals, and what was missed or unexpected. */
export function renderEvalSummary(result: EvalResult, theme: Theme): string {
  const agg = result.aggregate;
  const s = result.settings;
  const lines = table(result, theme);
  lines.push('');
  lines.push(
    `F1 ${pct(agg.f1)} ${theme.sym.dot} precision ${pct(agg.precision)} ${theme.sym.dot} ${plural(agg.duplicates, 'duplicate')} ${theme.sym.dot} ${plural(agg.failedChunks, 'failed chunk')} ${theme.sym.dot} ${formatTokens(agg.inputTokens)} in${agg.cachedInputTokens ? ` (+${formatTokens(agg.cachedInputTokens)} cached)` : ''} / ${formatTokens(agg.outputTokens)} out tokens${costText(agg, theme)}`,
  );
  const critique = critiqueLine(agg, theme);
  if (critique) lines.push(critique);
  if (agg.cleanCases > 0) {
    lines.push(
      `Clean changes: ${agg.flaggedCleanRuns} of ${plural(agg.cleanRuns, 'run')} flagged (${plural(agg.falsePositives, 'false positive')})`,
    );
  }
  if (s.repeat > 1) {
    lines.push(
      `Recall per pass: ${agg.passes.map((p) => pct(p.recall)).join(', ')} (min ${pct(agg.recallMin)}, max ${pct(agg.recallMax)})`,
    );
  }
  if (agg.underrated > 0) lines.push(`${plural(agg.underrated, 'defect')} found below the expected severity`);
  if (agg.errors > 0)
    lines.push(theme.c.red(`${theme.sym.fail} ${plural(agg.errors, 'run')} failed (counted as missed)`));
  lines.push(...capped('Missed', missedLines(result, theme), theme));
  lines.push(
    ...capped(
      'Unexpected (possibly real but unlabelled — add them to `expect` if they are)',
      noiseLines(result, 'unexpected', theme),
      theme,
    ),
  );
  lines.push(
    ...capped('False positives on clean changes', noiseLines(result, 'falsePositives', theme), theme),
  );
  if (result.status === 'interrupted')
    lines.push('', theme.c.yellow('Interrupted: the result covers the finished runs only.'));
  return lines.join('\n');
}

const num = (n: number | null) => (n === null ? '—' : String(Number(n.toFixed(1))));
const tokens = (n: number | null) => (n === null ? '—' : formatTokens(n));
const money = (currency: string) => (n: number | null) =>
  n === null ? '—' : formatMoney({ amount: n, currency });

/** ` · cost $1.20` (`+ unknown` when some calls had no price), or nothing without cost data. */
function costText(agg: EvalResult['aggregate'], theme: Theme): string {
  if (!agg.costCurrency && agg.unpricedCalls === 0) return '';
  const known = agg.costCurrency ? formatMoney({ amount: agg.cost, currency: agg.costCurrency }) : '';
  const unknown = agg.unpricedCalls
    ? `${known ? ' + ' : ''}unknown for ${plural(agg.unpricedCalls, 'call')}`
    : '';
  return ` ${theme.sym.dot} cost ${clean(`${known}${unknown}`)}`;
}
const duration = (n: number | null) => (n === null ? '—' : formatDuration(n));

/** How a change is shown: percentage points (ratios), a signed number (counts) or a relative change. */
type DeltaKind = 'ratio' | 'count' | 'relative';
const FORMATS: Record<DeltaKind, (n: number | null) => string> = { ratio: pct, count: num, relative: num };

function deltaText(
  d: MetricDelta,
  kind: DeltaKind,
  lowerIsBetter: boolean,
  theme: Theme,
  format = FORMATS[kind],
): string {
  const text = `${format(d.before)} ${theme.sym.arrow} ${format(d.after)}`;
  if (d.delta === null || d.before === null) return text;
  if (Math.abs(d.delta) < 1e-9) return `${text} ${theme.c.dim('(±0)')}`;
  const paint = (lowerIsBetter ? d.delta < 0 : d.delta > 0) ? theme.c.green : theme.c.red;
  const sign = d.delta > 0 ? '+' : '';
  const change =
    kind === 'ratio'
      ? points(d.delta)
      : kind === 'count'
        ? `${sign}${num(d.delta)}`
        : d.before > 0
          ? `${sign}${Math.round((d.delta / d.before) * 100)}%`
          : '';
  return change ? `${text} ${paint(`(${change})`)}` : text;
}

/** Deltas against a previous result (`--compare`). */
export function renderComparison(cmp: EvalComparison, theme: Theme, currency = 'USD'): string {
  const lines = [
    theme.c.bold(`Compared with ${clean(cmp.against.id)} over ${plural(cmp.common, 'common case')}:`),
    `  recall          ${deltaText(cmp.recall, 'ratio', false, theme)}`,
    `  precision       ${deltaText(cmp.precision, 'ratio', false, theme)}`,
    `  F1              ${deltaText(cmp.f1, 'ratio', false, theme)}`,
    `  false positives ${deltaText(cmp.falsePositives, 'count', true, theme)}`,
    `  unexpected      ${deltaText(cmp.unexpected, 'count', true, theme)}`,
    `  tokens in       ${deltaText(cmp.inputTokens, 'relative', true, theme, tokens)}`,
    ...(cmp.cachedInputTokens && (cmp.cachedInputTokens.before || cmp.cachedInputTokens.after)
      ? [`  tokens cached   ${deltaText(cmp.cachedInputTokens, 'relative', true, theme, tokens)}`]
      : []),
    `  tokens out      ${deltaText(cmp.outputTokens, 'relative', true, theme, tokens)}`,
    ...(cmp.cost && (cmp.cost.before !== null || cmp.cost.after !== null)
      ? [`  cost            ${deltaText(cmp.cost, 'relative', true, theme, money(clean(currency)))}`]
      : []),
    `  time            ${deltaText(cmp.durationMs, 'relative', true, theme, duration)}`,
  ];
  const moved = (d: MetricDelta) =>
    (d.before === null) !== (d.after === null) || (d.delta !== null && Math.abs(d.delta) > 1e-9);
  if (cmp.cases.length) {
    lines.push('', theme.c.bold('Changed cases:'));
    for (const c of cmp.cases.slice(0, MAX_LIST * 2)) {
      const parts = [
        moved(c.recall) ? `recall ${deltaText(c.recall, 'ratio', false, theme)}` : '',
        moved(c.precision) ? `precision ${deltaText(c.precision, 'ratio', false, theme)}` : '',
        moved(c.noise) ? `noise ${deltaText(c.noise, 'count', true, theme)}` : '',
      ].filter(Boolean);
      lines.push(`  ${padEnd(truncate(clean(c.id), ID_WIDTH), 30)}  ${parts.join(`  ${theme.sym.dot} `)}`);
      for (const d of c.defects.slice(0, 5)) {
        const verb =
          d.after < d.before ? theme.c.red('missed more often') : theme.c.green('found more often');
        lines.push(
          `      ${theme.c.cyan(clean(d.key))} ${verb}${d.note ? theme.c.dim(`  ${truncate(clean(d.note), 60)}`) : ''}`,
        );
      }
    }
  }
  if (cmp.added.length) lines.push(theme.c.dim(`  New cases: ${cmp.added.map(clean).join(', ')}`));
  if (cmp.removed.length)
    lines.push(theme.c.dim(`  Cases no longer run: ${cmp.removed.map(clean).join(', ')}`));
  return lines.join('\n');
}
