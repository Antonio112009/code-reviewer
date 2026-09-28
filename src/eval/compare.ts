import { sumMetrics } from './metrics';
import type { CaseComparison, CaseResult, EvalComparison, EvalResult, MetricDelta, Metrics } from './types';

// Pure: deltas between two eval results, over the cases both contain.

const EPSILON = 1e-9;

function delta(before: number | null, after: number | null): MetricDelta {
  return { before, after, delta: before !== null && after !== null ? after - before : null };
}

function changed(d: MetricDelta): boolean {
  return (d.before === null) !== (d.after === null) || (d.delta !== null && Math.abs(d.delta) > EPSILON);
}

/** Mean per run of a count (cases may have been run a different number of times). */
function perRun(m: Metrics, value: number): number {
  return m.runs > 0 ? value / m.runs : 0;
}

/** A count summed over cases as one pass over them: each case contributes its mean per run. */
function perPass(cases: readonly CaseResult[], pick: (m: Metrics) => number): number {
  return cases.reduce((sum, c) => sum + perRun(c.metrics, pick(c.metrics)), 0);
}

/** Cost per pass; null for a side without any known cost (older results, nothing priced). */
function costDelta(before: readonly CaseResult[], after: readonly CaseResult[]): MetricDelta {
  const side = (cases: readonly CaseResult[]) =>
    cases.some((c) => (c.metrics.cost ?? 0) > 0) ? perPass(cases, (m) => m.cost ?? 0) : null;
  return delta(side(before), side(after));
}

export function defectKey(d: { file: string; startLine: number; endLine: number }): string {
  return `${d.file}:${d.startLine}${d.endLine !== d.startLine ? `-${d.endLine}` : ''}`;
}

function compareCase(before: CaseResult, after: CaseResult): CaseComparison {
  const noise = (m: Metrics) => perRun(m, m.unexpected + m.falsePositives);
  const rates = (c: CaseResult) =>
    new Map(c.defects.map((d) => [defectKey(d), { note: d.note, rate: perRun(c.metrics, d.found) }]));
  const previous = rates(before);
  const defects: CaseComparison['defects'] = [];
  for (const [key, now] of rates(after)) {
    const then = previous.get(key);
    if (then && Math.abs(now.rate - then.rate) > EPSILON) {
      defects.push({ key, ...(now.note ? { note: now.note } : {}), before: then.rate, after: now.rate });
    }
  }
  return {
    id: after.id,
    recall: delta(before.metrics.recall, after.metrics.recall),
    precision: delta(before.metrics.precision, after.metrics.precision),
    noise: delta(noise(before.metrics), noise(after.metrics)),
    defects,
  };
}

/** How `after` differs from `before` (`file`: where `before` was loaded from). */
export function compareResults(before: EvalResult, after: EvalResult, file: string): EvalComparison {
  const previous = new Map(before.cases.map((c) => [c.id, c]));
  const current = new Set(after.cases.map((c) => c.id));
  const commonAfter = after.cases.filter((c) => previous.has(c.id));
  const commonBefore = commonAfter.map((c) => previous.get(c.id)!);
  const b = sumMetrics(commonBefore.map((c) => c.metrics));
  const a = sumMetrics(commonAfter.map((c) => c.metrics));
  const pass = (pick: (m: Metrics) => number) =>
    delta(perPass(commonBefore, pick), perPass(commonAfter, pick));
  const cases = commonAfter
    .map((c) => compareCase(previous.get(c.id)!, c))
    .filter((c) => changed(c.recall) || changed(c.precision) || changed(c.noise) || c.defects.length > 0);
  return {
    against: { id: before.id, createdAt: before.createdAt, file },
    common: commonAfter.length,
    added: after.cases.filter((c) => !previous.has(c.id)).map((c) => c.id),
    removed: before.cases.filter((c) => !current.has(c.id)).map((c) => c.id),
    recall: delta(b.recall, a.recall),
    precision: delta(b.precision, a.precision),
    f1: delta(b.f1, a.f1),
    rawRecall: delta(b.rawRecall, a.rawRecall),
    rawPrecision: delta(b.rawPrecision, a.rawPrecision),
    falsePositives: pass((m) => m.falsePositives),
    unexpected: pass((m) => m.unexpected),
    inputTokens: pass((m) => m.inputTokens),
    cachedInputTokens: pass((m) => m.cachedInputTokens ?? 0),
    cacheWriteTokens: pass((m) => m.cacheWriteTokens ?? 0),
    outputTokens: pass((m) => m.outputTokens),
    cost: costDelta(commonBefore, commonAfter),
    durationMs: pass((m) => m.durationMs),
    cases,
  };
}
