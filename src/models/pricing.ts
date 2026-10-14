import type { Price } from '../config/schema';
import type { CostBasis, CostSummary, Money, Usage } from '../types';

const M = 1_000_000;
const DEFAULT_CURRENCY = 'USD';
/** Without a `cacheWrite` price, cache writes cost this much more than plain input (Anthropic's 5-minute cache). */
const CACHE_WRITE_FACTOR = 1.25;

/** Usage of one model call with the route that made it (see `Spend` in review/execute.ts). */
export interface PricedSpend {
  provider: string;
  model?: string;
  usage: Usage;
}

/**
 * Built-in prices of Anthropic's current models, USD per million tokens, from the official pricing page
 * (platform.claude.com/docs/en/about-claude/pricing, 2026-10-14): input / cache read / 5-minute cache write /
 * output. Keyed by model id, so they apply to every provider that uses these ids (the Anthropic API, Vertex);
 * Bedrock's inference-profile ids are listed too. A user's `pricing` entry for the same key wins. Haiku 5.5 is
 * priced at its rate for prompts up to 100k tokens; a request over that pays five times more, which these
 * figures cannot know, so its cost is a lower bound.
 */
export const BUILTIN_PRICING: Record<string, Price> = (() => {
  const p = (input: number, cachedInput: number, cacheWrite: number, output: number): Price => ({
    input,
    cachedInput,
    cacheWrite,
    output,
  });
  const models: Record<string, Price> = {
    'claude-fable-5-1': p(10, 0.25, 12.5, 50),
    'claude-opus-5-5': p(4, 0.2, 5, 20),
    'claude-opus-5': p(5, 0.5, 6.25, 25),
    'claude-sonnet-5-5': p(2, 0.1, 2.5, 10),
    'claude-sonnet-5': p(2, 0.2, 2.5, 10),
    'claude-sonnet-4-6': p(3, 0.3, 3.75, 15),
    'claude-haiku-5-5': p(0.1, 0.01, 0.125, 0.5),
    'claude-haiku-4-5': p(1, 0.1, 1.25, 5),
  };
  const out: Record<string, Price> = {};
  for (const [id, price] of Object.entries(models)) {
    out[id] = price;
    // Bedrock inference profiles and Vertex's dated Haiku id.
    for (const prefix of ['global.anthropic.', 'us.anthropic.', 'eu.anthropic.', 'anthropic.'])
      out[`${prefix}${id}`] = price;
  }
  out['anthropic.claude-haiku-4-5-20251001-v1:0'] = models['claude-haiku-4-5']!;
  for (const prefix of ['global.', 'us.', 'eu.'])
    out[`${prefix}anthropic.claude-haiku-4-5-20251001-v1:0`] = models['claude-haiku-4-5']!;
  out['claude-haiku-4-5@20251001'] = models['claude-haiku-4-5']!;
  return out;
})();

/**
 * The price for a route: `provider:model`, then `model`, then `provider` (case-insensitive), from the user's
 * `pricing` first and the built-in table second.
 */
export function priceFor(
  pricing: Record<string, Price>,
  provider: string,
  model: string | undefined,
): Price | undefined {
  const byKey = new Map(
    [...Object.entries(BUILTIN_PRICING), ...Object.entries(pricing)].map(([k, v]) => [k.toLowerCase(), v]),
  );
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
  const tokens = u.inputTokens + (u.cachedInputTokens ?? 0) + (u.cacheWriteTokens ?? 0) + u.outputTokens;
  const hasTokenRates = price.input !== undefined || price.output !== undefined;
  if (tokens > 0 && !hasTokenRates && price.request === undefined) return undefined;
  const amount =
    (u.inputTokens * (price.input ?? 0) +
      (u.cachedInputTokens ?? 0) * (price.cachedInput ?? price.input ?? 0) +
      (u.cacheWriteTokens ?? 0) * (price.cacheWrite ?? (price.input ?? 0) * CACHE_WRITE_FACTOR) +
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

/**
 * `review.maxCost` for one run. Every model call is added as it completes; a call without a known cost (no
 * price, another currency) cannot count and is reported once per route. With self-critique on, reviews stop
 * at `1 - critiqueReserve` of the budget so the findings can still be verified.
 */
export class CostBudget {
  private amount = 0;
  private readonly unpriced = new Set<string>();

  constructor(
    readonly max: number,
    private readonly pricing: Record<string, Price>,
    private readonly opts: {
      /** Share kept for the critique (0 without self-critique). */
      critiqueReserve?: number;
      currency?: string;
      /** Called once per route whose calls cannot be counted. */
      onUnpriced?: (route: string) => void;
    } = {},
  ) {}

  add(spend: PricedSpend): void {
    const cost = costOf(spend, this.pricing);
    if (cost && cost.currency === (this.opts.currency ?? DEFAULT_CURRENCY)) {
      this.amount += cost.amount;
      return;
    }
    const route = spend.model ? `${spend.provider}:${spend.model}` : spend.provider;
    if (!this.unpriced.has(route)) {
      this.unpriced.add(route);
      this.opts.onUnpriced?.(route);
    }
  }

  get spent(): Money {
    return { amount: this.amount, currency: this.opts.currency ?? DEFAULT_CURRENCY };
  }

  /** Whether a new call for `role` may start. */
  allows(role: 'review' | 'critique' | string): boolean {
    const limit = role === 'critique' ? this.max : this.max * (1 - (this.opts.critiqueReserve ?? 0));
    return this.amount < limit;
  }
}

/** `$0.42`, `€1.20`, `0.0031 GBP`: small amounts keep significant digits. */
export function formatMoney(m: Money): string {
  const digits = m.amount === 0 ? 2 : m.amount < 0.01 ? 4 : m.amount < 1 ? 3 : 2;
  const value = m.amount.toFixed(digits);
  const symbol: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  return symbol[m.currency] ? `${symbol[m.currency]}${value}` : `${value} ${m.currency}`;
}
