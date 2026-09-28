import type { Price } from '../config/schema';
import type { CostBasis, CostSummary, Money, Usage } from '../types';

const M = 1_000_000;
const DEFAULT_CURRENCY = 'USD';

/** Usage of one model call with the route that made it (see `Spend` in review/execute.ts). */
export interface PricedSpend {
  provider: string;
  model?: string;
  usage: Usage;
}

/** The price for a route: `provider:model`, then `model`, then `provider` (case-insensitive). */
export function priceFor(
  pricing: Record<string, Price>,
  provider: string,
  model: string | undefined,
): Price | undefined {
  const byKey = new Map(Object.entries(pricing).map(([k, v]) => [k.toLowerCase(), v]));
  const keys = [...(model ? [`${provider}:${model}`, model] : []), provider].map((k) => k.toLowerCase());
  for (const key of keys) {
    const price = byKey.get(key);
    if (price) return price;
  }
  return undefined;
}

/**
 * Cost of one call: the provider's own figure when it reported one, else its usage × the configured price.
 * Undefined when neither is known (a price without the rates this usage needs counts as unknown).
 */
export function costOf(
  spend: PricedSpend,
  pricing: Record<string, Price>,
): (Money & { basis: CostBasis }) | undefined {
  const u = spend.usage;
  if (u.reportedCost) return { ...u.reportedCost, basis: 'reported' };
  const price = priceFor(pricing, spend.provider, spend.model);
  if (!price) return undefined;
  const tokens = u.inputTokens + (u.cachedInputTokens ?? 0) + u.outputTokens;
  const hasTokenRates = price.input !== undefined || price.output !== undefined;
  if (tokens > 0 && !hasTokenRates && price.request === undefined) return undefined;
  const amount =
    (u.inputTokens * (price.input ?? 0) +
      (u.cachedInputTokens ?? 0) * (price.cachedInput ?? price.input ?? 0) +
      u.outputTokens * (price.output ?? 0)) /
      M +
    (u.requests ?? 1) * (price.request ?? 0);
  return {
    amount,
    currency: price.currency ?? DEFAULT_CURRENCY,
    // Token rates applied to estimated counts give an estimate; a per-request price does not.
    basis: u.estimated && hasTokenRates ? 'estimated' : 'priced',
  };
}

/** Accumulates the cost of a run's model calls. */
export class CostMeter {
  private amount = 0;
  private currency?: string;
  private readonly basis = new Set<CostBasis>();
  private unknownTasks = 0;
  private readonly unpriced = new Set<string>();

  constructor(private readonly pricing: Record<string, Price>) {}

  /** Adds calls to the total; returns their known cost (undefined when none of it is known). */
  add(spends: PricedSpend[]): Money | undefined {
    let known: Money | undefined;
    for (const s of spends) {
      const cost = costOf(s, this.pricing);
      // One currency per run: a call billed in another one is reported as unknown.
      if (!cost || (this.currency && cost.currency !== this.currency)) {
        this.unknownTasks++;
        this.unpriced.add(s.model ? `${s.provider}:${s.model}` : s.provider);
        continue;
      }
      this.currency = cost.currency;
      this.amount += cost.amount;
      this.basis.add(cost.basis);
      known = { amount: (known?.amount ?? 0) + cost.amount, currency: cost.currency };
    }
    return known;
  }

  /** The run's cost, or undefined when no call has been priced or reported. */
  summary(): CostSummary | undefined {
    if (!this.currency && this.unknownTasks === 0) return undefined;
    return {
      amount: this.amount,
      currency: this.currency ?? DEFAULT_CURRENCY,
      basis: [...this.basis],
      unknownTasks: this.unknownTasks,
      unpriced: [...this.unpriced].sort(),
    };
  }
}

/** `$0.42`, `€1.20`, `0.0031 GBP`: small amounts keep significant digits. */
export function formatMoney(m: Money): string {
  const digits = m.amount === 0 ? 2 : m.amount < 0.01 ? 4 : m.amount < 1 ? 3 : 2;
  const value = m.amount.toFixed(digits);
  const symbol: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  return symbol[m.currency] ? `${symbol[m.currency]}${value}` : `${value} ${m.currency}`;
}
