import type { DeepenAdvice, RunRecord } from '../types';

/*
 * Advice printed after a review: what a follow-up run would add and what it would cost. Advice only — nothing
 * here changes what the run did.
 */

/**
 * A second look costs about as much as the first look at the same chunks, plus checking what it finds
 * (AACR-Bench ctx30: $4.7 more for $3.9 of first looks at chunks with findings).
 */
export const DEEPEN_COST_FACTOR = 1.1;

/**
 * Whether `--deepen` is worth suggesting: the run reviewed chunks that reported findings, and it did not take
 * a second look already. The estimate is left out when some of those chunks have no known cost (answered from
 * the cache, or an unpriced model).
 */
export function deepenAdvice(run: RunRecord, deepened: boolean): DeepenAdvice | undefined {
  if (deepened || run.status === 'failed') return undefined;
  const chunks = run.chunks.filter((c) => c.status === 'done' && c.findings > 0);
  if (chunks.length === 0) return undefined;
  const costs = chunks.map((c) => c.cost);
  const currency = costs[0]?.currency;
  const known = costs.every((c) => c !== undefined && c.amount > 0 && c.currency === currency);
  const amount = known ? costs.reduce((n, c) => n + c!.amount, 0) * DEEPEN_COST_FACTOR : 0;
  return {
    chunks: chunks.map((c) => c.id),
    ...(known && currency ? { estimatedCost: { amount, currency } } : {}),
  };
}
