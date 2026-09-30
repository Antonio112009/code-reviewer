import type { DeepenAdvice, RunRecord } from '../types';

/*
 * Advice printed after a review: what a follow-up run would add and what it would cost. Advice only — nothing
 * here changes what the run did.
 */

/**
 * A second pass at high reasoning costs about 1.3× the first pass at medium, plus the critic's look at what it
 * adds (AACR-Bench ctx30: the reviewer's part of a run is $5.25 at medium and $6.77 at high).
 */
export const DEEPEN_COST_FACTOR = 1.45;

/**
 * Whether `--deepen` is worth suggesting: the run reviewed chunks and reported at least one finding (a change
 * worth a second pass), and it did not take one already. The estimate covers every reviewed chunk; it is
 * left out when some have no known cost (answered from the cache, or an unpriced model).
 */
export function deepenAdvice(run: RunRecord, deepened: boolean): DeepenAdvice | undefined {
  if (deepened || run.status === 'failed') return undefined;
  const chunks = run.chunks.filter((c) => c.status === 'done');
  if (chunks.length === 0 || !chunks.some((c) => c.findings > 0)) return undefined;
  const costs = chunks.map((c) => c.cost);
  const currency = costs[0]?.currency;
  const known = costs.every((c) => c !== undefined && c.amount > 0 && c.currency === currency);
  const amount = known ? costs.reduce((n, c) => n + c!.amount, 0) * DEEPEN_COST_FACTOR : 0;
  return {
    chunks: chunks.map((c) => c.id),
    ...(known && currency ? { estimatedCost: { amount, currency } } : {}),
  };
}
