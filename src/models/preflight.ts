import type { Config } from '../config/schema';
import type { InteractionHost } from '../review/events';
import type { Role } from '../types';
import type { Logger } from '../util/logger';
import {
  type Alternative,
  alternativesFor,
  isDefiniteListing,
  type ModelAvailability,
  modelStatus,
  tierOf,
} from './catalog';
import { type ListModelsOptions, listModels } from './discovery';
import { providerInfos, refKey, resolveFallback, triedRefs } from './fallback';
import type { ModelListing, ModelRef, ModelTier } from './types';

export interface RoleModelCheck {
  role: Role;
  ref: ModelRef;
  tier?: ModelTier;
  /**
   * `available`: the provider lists the model; `unavailable`: the provider is missing on this machine or
   * lists models without this one; `unverified`: the provider could not tell (or the agent default is used).
   */
  status: ModelAvailability;
  listing?: ModelListing;
  /** Why the model is unavailable (for messages and the fallback prompt). */
  reason?: string;
  /** Replacement candidates, best first (only computed for unavailable models). */
  alternatives: Alternative[];
}

export interface CheckModelsOptions {
  config: Config;
  /** Model per role (e.g. from resolveRouting). */
  routes: Partial<Record<Role, ModelRef | undefined>>;
  /** Providers usable on this machine (from detectProviders). */
  availableProviders: string[];
  logger: Logger;
  cwd: string;
  signal?: AbortSignal;
  /** Listings already known; filled in place and returned (share it with later resolveFallback calls). */
  listings?: Map<string, ModelListing>;
  /** Discovery tuning and test hooks. */
  discovery?: Pick<ListModelsOptions, 'timeoutMs' | 'endpoint' | 'fetch' | 'credentials'>;
}

/**
 * Checks the models configured for each role against what their providers offer right now (no tokens
 * spent). When a model is unavailable, the other available providers are listed too so the alternatives
 * are verified. Meant to start together with the run (in parallel with collecting changes).
 */
export async function checkRoleModels(
  opts: CheckModelsOptions,
): Promise<{ checks: RoleModelCheck[]; listings: Map<string, ModelListing> }> {
  const listings = opts.listings ?? new Map<string, ModelListing>();
  const fill = async (ids: string[]) => {
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const cfg = opts.config.providers[id];
        if (!cfg || listings.has(id) || !opts.availableProviders.includes(id)) return;
        listings.set(
          id,
          await listModels(id, cfg, {
            logger: opts.logger,
            cwd: opts.cwd,
            signal: opts.signal,
            ...opts.discovery,
          }),
        );
      }),
    );
  };

  const roles = (Object.entries(opts.routes) as Array<[Role, ModelRef | undefined]>).filter(
    (e): e is [Role, ModelRef] => e[1] !== undefined,
  );
  await fill(roles.map(([, ref]) => ref.provider));

  const statusOf = (ref: ModelRef): { status: ModelAvailability; reason?: string } => {
    if (!opts.availableProviders.includes(ref.provider)) {
      return { status: 'unavailable', reason: `provider "${ref.provider}" is not available on this machine` };
    }
    const listing = listings.get(ref.provider);
    const status = modelStatus(listing, ref.model);
    if (status !== 'unavailable') return { status };
    return { status, reason: `not offered by ${ref.provider}${offersHint(listing)}` };
  };
  const statuses = roles.map(([, ref]) => statusOf(ref));
  if (statuses.some((s) => s.status === 'unavailable')) {
    await fill(opts.availableProviders);
  }

  const providers = providerInfos({ ...opts, listings });
  const checks = roles.map(([role, ref], i): RoleModelCheck => {
    const cfg = opts.config.providers[ref.provider];
    const listing = listings.get(ref.provider);
    const tier = cfg ? tierOf(cfg, ref.model ?? listing?.current) : undefined;
    const { status, reason } = statuses[i]!;
    return {
      role,
      ref,
      tier,
      status,
      listing,
      ...(reason ? { reason } : {}),
      alternatives:
        status === 'unavailable'
          ? alternativesFor(ref, tier, providers, {
              allowCrossProvider: opts.config.models.allowCrossProvider,
              exclude: triedRefs({ failed: ref, listings }),
              // shown to the user (with the risk), never picked automatically
              includeUnconfined: true,
            })
          : [],
    };
  });
  return { checks, listings };
}

function offersHint(listing: ModelListing | undefined): string {
  if (!isDefiniteListing(listing) || !listing.models.length) return '';
  const shown = listing.models.slice(0, 8);
  const more = listing.models.length - shown.length;
  return ` (offers: ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''})`;
}

export interface PreflightResult {
  /** Model per role after replacements. */
  routes: Partial<Record<Role, ModelRef>>;
  /** Replacements made (for the `fallback` event and RunRecord.fallbacks). */
  fallbacks: Array<{ role: Role; from: string; to: string; reason: string }>;
  /** Unavailable models without a replacement: the run should stop with `formatUnavailable`. */
  unresolved: RoleModelCheck[];
  checks: RoleModelCheck[];
  listings: Map<string, ModelListing>;
}

/**
 * `checkRoleModels` + `resolveFallback` for every unavailable role model (asking on a terminal when
 * `models.onUnavailable` is `ask`). Unverified models are kept: the first real task is the actual test.
 */
export async function preflightModels(
  opts: CheckModelsOptions & { host?: InteractionHost },
): Promise<PreflightResult> {
  const { checks, listings } = await checkRoleModels(opts);
  const routes: Partial<Record<Role, ModelRef>> = {};
  const fallbacks: PreflightResult['fallbacks'] = [];
  const unresolved: RoleModelCheck[] = [];
  for (const check of checks) {
    routes[check.role] = check.ref;
    if (check.status !== 'unavailable') continue;
    const reason = check.reason ?? 'model unavailable';
    const replacement = await resolveFallback({
      role: check.role,
      failed: check.ref,
      reason,
      config: opts.config,
      availableProviders: opts.availableProviders,
      listings,
      host: opts.host,
      logger: opts.logger,
      signal: opts.signal,
    });
    if (replacement) {
      routes[check.role] = replacement;
      fallbacks.push({ role: check.role, from: refKey(check.ref), to: refKey(replacement), reason });
    } else {
      unresolved.push(check);
    }
  }
  return { routes, fallbacks, unresolved, checks, listings };
}

/** Error text for an unavailable role model: what is wrong, what is available, how to fix it. */
export function formatUnavailable(check: RoleModelCheck): string {
  const lines = [
    `The ${check.role} model ${check.ref.provider}:${check.ref.model ?? '(default)'} is unavailable: ${check.reason ?? 'unknown reason'}.`,
  ];
  if (check.alternatives.length) {
    const shown = check.alternatives
      .slice(0, 6)
      .map(
        (a) =>
          `${a.provider}:${a.model} (${a.tier}, ${a.status}${a.unconfined ? ', may run the reviewed code' : ''})`,
      )
      .join(', ');
    lines.push(`Alternatives: ${shown}.`);
  }
  lines.push(
    `Set roles.${check.role}.model, add models.fallbacks["${refKey(check.ref)}"] to the global config, or run \`code-reviewer providers models\`.`,
  );
  return lines.join('\n');
}
