/**
 * Model discovery, availability and cross-provider fallback.
 * - `catalog.ts`: tiers (frontier/balanced/fast) with ordered candidates per provider family, alternatives.
 * - `discovery.ts`: what a provider offers right now (ACP `model` config option, Bedrock control plane).
 * - `classify.ts`: provider errors / agent replies → unavailable | transient | refusal | too-long | auth.
 * - `fallback.ts`: `models.onUnavailable` (ask | fallback | fail), remembered choices in the global config.
 * - `preflight.ts`: checks the role models before a run and resolves replacements.
 */

export {
  type Alternative,
  type AlternativesOptions,
  alternativesFor,
  type CatalogKey,
  type CatalogModel,
  catalogFor,
  catalogKeyOf,
  type DefiniteListing,
  findCatalogModel,
  isDefiniteListing,
  MODEL_CATALOG,
  MODEL_TIERS,
  type ModelAvailability,
  matchListedModel,
  modelStatus,
  normalizeModelId,
  type ProviderInfo,
  providerKind,
  tierOf,
  tierPreference,
} from './catalog';
export { classifyError, describeErrorClass, detectReplyError } from './classify';
export { type AwsCredentials, clearModelListingCache, type ListModelsOptions, listModels } from './discovery';
export {
  configuredChain,
  failedTier,
  parseRef,
  promptChoices,
  providerInfos,
  refKey,
  rememberFallback,
  resolveFallback,
  triedRefs,
} from './fallback';
export {
  type CheckModelsOptions,
  checkRoleModels,
  formatUnavailable,
  type PreflightResult,
  preflightModels,
  type RoleModelCheck,
} from './preflight';
export type { ErrorClass, FallbackRequest, ModelListing, ModelRef, ModelTier } from './types';
