import type { ProviderConfig } from '../config/schema';
import { isUnconfined } from '../providers/acp/presets';
import type { ModelListing, ModelRef, ModelTier } from './types';

/** Tiers from most to least capable. */
export const MODEL_TIERS: readonly ModelTier[] = ['frontier', 'balanced', 'fast'];

/** Catalog families: one per provider type / ACP preset that has a model catalog. */
export type CatalogKey = 'bedrock' | 'anthropic' | 'claude' | 'codex' | 'copilot' | 'gemini' | 'mock';

export interface CatalogModel {
  /** Id as passed to the provider (Bedrock inference profile id, ACP model option value, CLI `--model`). */
  id: string;
  tier: ModelTier;
  /** Human-readable name. */
  label: string;
  /** Other ids that mean the same model on this provider (case-insensitive). */
  aliases?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Access needs per-model approval / opt-in (most likely to be unavailable). */
  gated?: boolean;
  /** Safety classifiers decline security-heavy content more often (poor default for security review). */
  refusalProne?: boolean;
  /** Ids we could not verify against the live provider (best guess from docs). */
  unverified?: boolean;
  /** Free-form caveat shown next to the model (e.g. end of life). */
  note?: string;
}

const M = 1_000_000;

/**
 * Ordered candidates per provider family and tier: the first listed model of a tier is the preferred
 * replacement when another model of that tier is unavailable. Verified 2026-09-27 (research/agent5.md).
 */
export const MODEL_CATALOG: Record<CatalogKey, CatalogModel[]> = {
  bedrock: [
    {
      id: 'global.anthropic.claude-opus-5-5',
      tier: 'frontier',
      label: 'Claude Opus 5.5',
      contextWindow: M,
      maxOutputTokens: 128_000,
      gated: true,
      note: 'per-model access criteria',
    },
    {
      id: 'global.anthropic.claude-opus-4-8',
      tier: 'frontier',
      label: 'Claude Opus 4.8',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'global.anthropic.claude-fable-5-1',
      tier: 'frontier',
      label: 'Claude Fable 5.1',
      contextWindow: M,
      maxOutputTokens: 128_000,
      gated: true,
      refusalProne: true,
      note: 'needs the data-retention opt-in; higher refusal rate on security content',
    },
    {
      id: 'global.anthropic.claude-sonnet-5',
      tier: 'balanced',
      label: 'Claude Sonnet 5',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      tier: 'fast',
      label: 'Claude Haiku 4.5',
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      note: 'end of life no sooner than 2026-10-01',
    },
  ],
  // Values offered by the Claude Code ACP adapter 0.81 (observed 2026-09-27): the aliases track the newest
  // model of each family (`opus` = Opus 5.5, `sonnet` = Sonnet 5, `haiku` = Haiku 4.5).
  claude: [
    {
      id: 'opus',
      tier: 'frontier',
      label: 'Opus (newest; Claude Code alias)',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-opus-5-5',
      tier: 'frontier',
      label: 'Claude Opus 5.5',
      contextWindow: M,
      maxOutputTokens: 128_000,
      gated: true,
    },
    {
      id: 'claude-opus-5',
      tier: 'frontier',
      label: 'Claude Opus 5',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-opus-4-8',
      tier: 'frontier',
      label: 'Claude Opus 4.8',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-opus-4-7',
      tier: 'frontier',
      label: 'Claude Opus 4.7',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-fable-5-1',
      tier: 'frontier',
      label: 'Claude Fable 5.1',
      contextWindow: M,
      maxOutputTokens: 128_000,
      refusalProne: true,
    },
    {
      id: 'claude-fable-5',
      tier: 'frontier',
      label: 'Claude Fable 5',
      contextWindow: M,
      maxOutputTokens: 128_000,
      refusalProne: true,
    },
    {
      id: 'sonnet',
      tier: 'balanced',
      label: 'Sonnet (newest; Claude Code alias)',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-sonnet-5',
      tier: 'balanced',
      label: 'Claude Sonnet 5',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-sonnet-4-6',
      tier: 'balanced',
      label: 'Claude Sonnet 4.6',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    { id: 'haiku', tier: 'fast', label: 'Haiku (newest; Claude Code alias)', contextWindow: 200_000 },
    {
      id: 'claude-haiku-4-5',
      tier: 'fast',
      label: 'Claude Haiku 4.5',
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
    },
  ],
  // codex-acp 1.x also lists `gpt-6-luna` (its default), which ChatGPT-account logins may not be able to use.
  codex: [
    { id: 'gpt-5.6-sol', tier: 'frontier', label: 'GPT-5.6 Sol', contextWindow: 272_000 },
    { id: 'gpt-5.5', tier: 'frontier', label: 'GPT-5.5', contextWindow: 272_000 },
    { id: 'gpt-5.6-terra', tier: 'balanced', label: 'GPT-5.6 Terra', contextWindow: 272_000 },
    { id: 'gpt-5.6-luna', tier: 'fast', label: 'GPT-5.6 Luna', contextWindow: 272_000 },
  ],
  // Copilot and Gemini choose the model per process (`--model`); ids are best guesses.
  copilot: [
    { id: 'claude-opus-4.8', tier: 'frontier', label: 'Claude Opus 4.8', unverified: true },
    { id: 'gpt-5.6-sol', tier: 'frontier', label: 'GPT-5.6 Sol', unverified: true },
    { id: 'claude-sonnet-5', tier: 'balanced', label: 'Claude Sonnet 5', unverified: true },
    { id: 'gpt-5.6-terra', tier: 'balanced', label: 'GPT-5.6 Terra', unverified: true },
    { id: 'claude-haiku-4.5', tier: 'fast', label: 'Claude Haiku 4.5', unverified: true },
    { id: 'gpt-5.6-luna', tier: 'fast', label: 'GPT-5.6 Luna', unverified: true },
  ],
  gemini: [
    { id: 'pro', tier: 'frontier', label: 'Gemini Pro (CLI alias)', unverified: true },
    { id: 'flash', tier: 'balanced', label: 'Gemini Flash (CLI alias)', unverified: true },
    { id: 'flash-lite', tier: 'fast', label: 'Gemini Flash-Lite (CLI alias)', unverified: true },
  ],
  // Anthropic API model ids (the API has no alias for "newest").
  anthropic: [
    {
      id: 'claude-opus-5-5',
      tier: 'frontier',
      label: 'Claude Opus 5.5',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-sonnet-5',
      tier: 'balanced',
      label: 'Claude Sonnet 5',
      contextWindow: M,
      maxOutputTokens: 128_000,
    },
    {
      id: 'claude-haiku-4-5-20251001',
      tier: 'fast',
      label: 'Claude Haiku 4.5',
      aliases: ['claude-haiku-4-5'],
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
    },
  ],
  mock: [],
};

/**
 * Catalog family of a provider config, a detect.ts type (`acp:claude`) or a family name.
 * Custom ACP agents have no catalog.
 */
export function catalogKeyOf(provider: ProviderConfig | string): CatalogKey | undefined {
  if (typeof provider !== 'string') {
    if (provider.type === 'acp') return provider.preset === 'custom' ? undefined : provider.preset;
    // OpenAI-compatible endpoints serve arbitrary models: nothing to suggest.
    if (provider.type === 'openai') return undefined;
    return provider.type;
  }
  const key = provider.startsWith('acp:') ? provider.slice(4) : provider;
  return key in MODEL_CATALOG ? (key as CatalogKey) : undefined;
}

/** Catalog entries of a provider family, in preference order. */
export function catalogFor(provider: ProviderConfig | string): CatalogModel[] {
  const key = catalogKeyOf(provider);
  return key ? MODEL_CATALOG[key] : [];
}

const BEDROCK_GEO_PREFIX = /^(?:global|us|us-gov|eu|apac|au|jp|ca)\./;
const BEDROCK_ARN = /^arn:aws[\w-]*:bedrock:[\w-]*:\d*:(?:inference-profile|foundation-model)\//;

/**
 * Canonical form used for matching model ids: lower case; for Bedrock also without ARN wrapper and geo
 * prefix (`us.anthropic.claude-sonnet-5` ≡ `global.anthropic.claude-sonnet-5`).
 */
export function normalizeModelId(model: string, key?: CatalogKey): string {
  let id = model.trim().toLowerCase();
  if (key === 'bedrock' || BEDROCK_ARN.test(id) || id.includes('anthropic.')) {
    id = id.replace(BEDROCK_ARN, '').replace(BEDROCK_GEO_PREFIX, '');
  }
  return id;
}

/** Catalog entry for `model` on a provider family (exact id or alias, Bedrock geo prefixes ignored). */
export function findCatalogModel(provider: ProviderConfig | string, model: string): CatalogModel | undefined {
  const key = catalogKeyOf(provider);
  if (!key) return undefined;
  const wanted = normalizeModelId(model, key);
  return MODEL_CATALOG[key].find(
    (m) =>
      normalizeModelId(m.id, key) === wanted ||
      (m.aliases ?? []).some((a) => normalizeModelId(a, key) === wanted),
  );
}

const TIER_HEURISTICS: Array<[RegExp, ModelTier]> = [
  [/haiku|flash-lite|\bnano\b|-mini\b|-luna\b|\blite\b/, 'fast'],
  [/opus|fable|mythos|-sol\b|\bpro\b|gemini-[\d.]+-pro/, 'frontier'],
  [/sonnet|-terra\b|flash/, 'balanced'],
];

/**
 * Tier of a model: from the catalog of the provider family when known, else from well-known family names
 * (opus/fable → frontier, sonnet → balanced, haiku → fast, …). Undefined when it cannot be told.
 */
export function tierOf(
  providerType: ProviderConfig | string,
  model: string | undefined,
): ModelTier | undefined {
  if (!model) return undefined;
  const known = findCatalogModel(providerType, model);
  if (known) return known.tier;
  const id = normalizeModelId(model);
  if (id === 'mock' || id === 'default') return undefined;
  for (const [re, tier] of TIER_HEURISTICS) if (re.test(id)) return tier;
  return undefined;
}

/**
 * Tiers to try after `tier`, nearest first: a frontier model is best replaced by a balanced one, a
 * balanced one by frontier (more capable beats less capable), a fast one by balanced.
 */
export function tierPreference(tier: ModelTier): ModelTier[] {
  switch (tier) {
    case 'frontier':
      return ['frontier', 'balanced', 'fast'];
    case 'balanced':
      return ['balanced', 'frontier', 'fast'];
    case 'fast':
      return ['fast', 'balanced', 'frontier'];
  }
}

// ---------------------------------------------------------------------------------------------------------
// Listings and alternatives
// ---------------------------------------------------------------------------------------------------------

/** A listing that holds the provider's actual answer. */
export type DefiniteListing = Omit<ModelListing, 'models'> & { models: string[] };

/** Whether a listing is an authoritative answer from the provider (not a catalog guess or a failure). */
export function isDefiniteListing(listing: ModelListing | undefined): listing is DefiniteListing {
  return !!listing && Array.isArray(listing.models) && listing.source !== 'catalog';
}

/**
 * The listed value that `model` selects, or undefined. Bedrock ids must match exactly (a `us.` profile is
 * not an `eu.` one); ACP agents are matched like the session setup does: exact value or name first, then a
 * substring (`opus` selects `opus[1m]` when that is all the agent offers). Ollama lists `name:latest` for
 * a model requested as `name`.
 */
export function matchListedModel(listing: ModelListing, model: string): string | undefined {
  if (!Array.isArray(listing.models)) return undefined;
  const wanted = model.trim().toLowerCase();
  const label = (v: string) => (listing.labels?.[v] ?? '').toLowerCase();
  const exact = listing.models.find((v) => v.toLowerCase() === wanted || label(v) === wanted);
  if (exact) return exact;
  if (listing.source === 'openai-api')
    return listing.models.find((v) => v.toLowerCase() === `${wanted}:latest`);
  if (listing.source !== 'acp-config') return undefined;
  return listing.models.find((v) => v.toLowerCase().includes(wanted) || label(v).includes(wanted));
}

export type ModelAvailability = 'available' | 'unavailable' | 'unverified';

/**
 * Bedrock ids the listing (system inference profiles and Anthropic on-demand models) cannot represent:
 * ARNs (application / system inference profiles, provisioned, custom or imported models) and on-demand
 * models of other vendors. Their absence from the listing proves nothing.
 */
function outsideBedrockListing(model: string): boolean {
  if (model.startsWith('arn:')) return true;
  const bare = model.replace(/^(?:us|eu|apac|us-gov|global|jp|au|ca)\./, '');
  return !bare.startsWith('anthropic.');
}

/** Availability of `model` according to a listing; `unverified` when the provider could not tell. */
export function modelStatus(listing: ModelListing | undefined, model: string | undefined): ModelAvailability {
  if (!isDefiniteListing(listing) || !model) return 'unverified';
  if (matchListedModel(listing, model)) return 'available';
  if (listing.source === 'bedrock-api' && (outsideBedrockListing(model) || listing.error))
    return 'unverified';
  // `/models` of some servers omits what they serve (Azure deployments, LiteLLM wildcard routes): let the
  // request tell, and a "model not found" answer goes through the usual fallback.
  if (listing.source === 'openai-api') return 'unverified';
  return 'unavailable';
}

/** What `alternativesFor` needs to know about each configured provider. */
export interface ProviderInfo {
  id: string;
  config: ProviderConfig;
  /** Usable on this machine (see detectProviders). */
  available: boolean;
  listing?: ModelListing;
}

export interface Alternative {
  provider: string;
  model: string;
  tier: ModelTier;
  /** `available` = listed by the provider right now; `unverified` = catalog suggestion, not checked. */
  status: 'available' | 'unverified';
  sameProvider: boolean;
  /** API provider ↔ local agent: the code would be handled by a different kind of tool. */
  crossesKind: boolean;
  /** An agent that may run the reviewed code (see `AcpPreset.unconfined`). */
  unconfined?: boolean;
  entry?: CatalogModel;
}

export interface AlternativesOptions {
  /** Offer models of other providers (default true). */
  allowCrossProvider?: boolean;
  /** Only the failed model's tier (default: every tier, nearest first). */
  sameTierOnly?: boolean;
  /** Models never to propose (the failed one is always excluded). */
  exclude?: ModelRef[];
  /**
   * Also offer other agents that cannot be confined to read-only (they may run the reviewed code); only
   * for an interactive choice, where the risk is shown (default false).
   */
  includeUnconfined?: boolean;
}

/** `api` for direct APIs (Bedrock, Anthropic, OpenAI-compatible), `acp` for agents, `mock` for the offline provider. */
export function providerKind(cfg: ProviderConfig): 'api' | 'acp' | 'mock' {
  return cfg.type === 'acp' || cfg.type === 'mock' ? cfg.type : 'api';
}

function candidatesOf(p: ProviderInfo): Array<{ model: string; tier: ModelTier; entry?: CatalogModel }> {
  const catalog = catalogFor(p.config);
  if (!isDefiniteListing(p.listing))
    return catalog.map((entry) => ({ model: entry.id, tier: entry.tier, entry }));
  const listing = p.listing;
  const out: Array<{ model: string; tier: ModelTier; entry?: CatalogModel }> = [];
  const used = new Set<string>();
  for (const entry of catalog) {
    const hit = [entry.id, ...(entry.aliases ?? [])]
      .map((id) => listing.models.find((v) => v.toLowerCase() === id.toLowerCase()))
      .find((v) => v !== undefined);
    if (hit && !used.has(hit)) {
      used.add(hit);
      out.push({ model: hit, tier: entry.tier, entry });
    }
  }
  // Agents list few, curated values: offer the ones we can place in a tier too. Bedrock lists every
  // vendor's profiles in every geography, so only catalog models are proposed there.
  if (p.config.type === 'acp') {
    for (const value of listing.models) {
      const tier = used.has(value) ? undefined : tierOf(p.config, value);
      if (tier) out.push({ model: value, tier });
    }
  }
  return out;
}

/**
 * Replacement candidates for `ref` (whose tier is `tier`, if known) across the given providers, best first:
 * same tier before other tiers (nearest first); within a tier the failed model's provider first, then the
 * other providers in configuration order; models the provider lists before unverified catalog guesses.
 * Unavailable providers, the mock provider (unless the failed one is mock) and excluded models are skipped.
 */
export function alternativesFor(
  ref: ModelRef,
  tier: ModelTier | undefined,
  providers: ProviderInfo[],
  opts: AlternativesOptions = {},
): Alternative[] {
  const tiers = tier
    ? opts.sameTierOnly
      ? [tier]
      : tierPreference(tier)
    : opts.sameTierOnly
      ? []
      : MODEL_TIERS;
  const failedCfg = providers.find((p) => p.id === ref.provider)?.config;
  const failedKind = failedCfg ? providerKind(failedCfg) : undefined;
  const excluded = [ref, ...(opts.exclude ?? [])].filter((r) => r.model !== undefined);
  const isExcluded = (p: ProviderInfo, model: string) =>
    excluded.some(
      (r) =>
        r.provider === p.id &&
        normalizeModelId(r.model!, catalogKeyOf(p.config)) ===
          normalizeModelId(model, catalogKeyOf(p.config)),
    );

  const ranked: Array<{ alt: Alternative; keys: number[] }> = [];
  providers.forEach((p, providerIndex) => {
    if (!p.available) return;
    const sameProvider = p.id === ref.provider;
    if (!sameProvider && opts.allowCrossProvider === false) return;
    if (!sameProvider && !opts.includeUnconfined && isUnconfined(p.config)) return;
    if (p.config.type === 'mock' && failedCfg?.type !== 'mock') return;
    const status = isDefiniteListing(p.listing) ? 'available' : 'unverified';
    candidatesOf(p).forEach((c, candidateIndex) => {
      const tierIndex = tiers.indexOf(c.tier);
      if (tierIndex < 0 || isExcluded(p, c.model)) return;
      ranked.push({
        alt: {
          provider: p.id,
          model: c.model,
          tier: c.tier,
          status,
          sameProvider,
          crossesKind: failedKind !== undefined && providerKind(p.config) !== failedKind,
          ...(isUnconfined(p.config) ? { unconfined: true } : {}),
          entry: c.entry,
        },
        keys: [
          tierIndex,
          sameProvider ? 0 : 1,
          status === 'available' ? 0 : 1,
          providerIndex,
          candidateIndex,
        ],
      });
    });
  });
  ranked.sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) {
      const d = a.keys[i]! - b.keys[i]!;
      if (d !== 0) return d;
    }
    return 0;
  });
  return ranked.map((r) => r.alt);
}
