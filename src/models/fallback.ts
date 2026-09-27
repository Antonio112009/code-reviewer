import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import YAML from 'yaml';
import { GLOBAL_CONFIG_FILES } from '../config/load';
import { type Config, PartialConfigSchema } from '../config/schema';
import { globalConfigDir } from '../util/paths';
import {
  type Alternative,
  alternativesFor,
  catalogKeyOf,
  modelStatus,
  normalizeModelId,
  type ProviderInfo,
  tierOf,
} from './catalog';
import type { FallbackRequest, ModelRef, ModelTier } from './types';

/** `provider:model` (or just `provider` for the provider's default model). */
export function refKey(ref: ModelRef): string {
  return ref.model ? `${ref.provider}:${ref.model}` : ref.provider;
}

/** Parses `provider:model`; everything after the first colon is the model (Bedrock ids contain colons). */
export function parseRef(value: string): ModelRef {
  const i = value.indexOf(':');
  if (i < 0) return { provider: value.trim() };
  const model = value.slice(i + 1).trim();
  return { provider: value.slice(0, i).trim(), ...(model ? { model } : {}) };
}

function sameRef(a: ModelRef, b: ModelRef, config: Config): boolean {
  if (a.provider !== b.provider) return false;
  if (!a.model || !b.model) return a.model === b.model;
  const cfg = config.providers[a.provider];
  const key = cfg ? catalogKeyOf(cfg) : undefined;
  return normalizeModelId(a.model, key) === normalizeModelId(b.model, key);
}

/** Configured providers with their availability and listings, in configuration order. */
export function providerInfos(
  req: Pick<FallbackRequest, 'config' | 'availableProviders' | 'listings'>,
): ProviderInfo[] {
  return Object.entries(req.config.providers).map(([id, config]) => ({
    id,
    config,
    available: req.availableProviders.includes(id),
    listing: req.listings?.get(id),
  }));
}

/** Tier of the failed model (for an agent default: the tier of the agent's current model, if listed). */
export function failedTier(
  req: Pick<FallbackRequest, 'config' | 'failed' | 'listings'>,
): ModelTier | undefined {
  const cfg = req.config.providers[req.failed.provider];
  if (!cfg) return undefined;
  return tierOf(cfg, req.failed.model ?? req.listings?.get(req.failed.provider)?.current);
}

/**
 * Models never to propose again: the failed one (for an agent default also the agent's current model, which
 * is what actually failed) and those already tried in this run.
 */
export function triedRefs(req: Pick<FallbackRequest, 'failed' | 'tried' | 'listings'>): ModelRef[] {
  const current = req.failed.model ? undefined : req.listings?.get(req.failed.provider)?.current;
  return [
    req.failed,
    ...(current ? [{ provider: req.failed.provider, model: current }] : []),
    ...(req.tried ?? []),
  ];
}

interface ChainEntry {
  ref: ModelRef;
  status: 'available' | 'unverified';
}

/**
 * `models.fallbacks` entries for the failed model (key `provider:model`, then `provider:*`) that can be
 * used here: known provider, available on this machine, not already tried, not reported missing by the
 * provider's listing, and cross-provider only when allowed. Chains only ever come from the user's global
 * config or CLI flags (the loader rejects `models` in project configs).
 */
export function configuredChain(req: FallbackRequest): ChainEntry[] {
  const { config, failed } = req;
  const raw =
    config.models.fallbacks[refKey(failed)] ?? config.models.fallbacks[`${failed.provider}:*`] ?? [];
  const tried = triedRefs(req);
  const out: ChainEntry[] = [];
  for (const value of raw) {
    const ref = parseRef(value);
    const cfg = config.providers[ref.provider];
    const skip = (why: string) => req.logger.debug(`[models] fallback ${value} skipped: ${why}`);
    if (!cfg) {
      skip('unknown provider');
      continue;
    }
    if (!req.availableProviders.includes(ref.provider)) {
      skip('provider not available on this machine');
      continue;
    }
    if (ref.provider !== failed.provider && !config.models.allowCrossProvider) {
      skip('models.allowCrossProvider is false');
      continue;
    }
    if (tried.some((t) => sameRef(t, ref, config))) continue;
    const status = modelStatus(req.listings?.get(ref.provider), ref.model);
    if (status === 'unavailable') {
      skip(`not offered by ${ref.provider}`);
      continue;
    }
    if (!out.some((e) => sameRef(e.ref, ref, config))) out.push({ ref, status });
  }
  return out;
}

// Decisions are shared by every task of a run (same Config object): concurrent chunks that hit the same
// unavailable model get one prompt and one answer.
const decisions = new WeakMap<Config, Map<string, Promise<ModelRef | undefined>>>();
let promptQueue: Promise<unknown> = Promise.resolve();

/** Runs prompts one at a time: two roles failing together must not draw two prompts at once. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = promptQueue.then(fn, fn);
  promptQueue = run.catch(() => undefined);
  return run;
}

/**
 * Picks a replacement for an unavailable model according to `models.onUnavailable`:
 * - `fail` → undefined;
 * - `fallback` → the first usable entry of `models.fallbacks["provider:model"]`, else the best same-tier
 *   catalog alternative on an available provider of the same kind (API ↔ agent switches need a configured
 *   chain or an interactive choice), cross-provider only with `models.allowCrossProvider`;
 * - `ask` → on an interactive terminal the user picks among the configured chain and the alternatives (and
 *   may save the choice to the global config); otherwise the configured chain, else undefined.
 * The decision is memoised per run config and failed model.
 */
export function resolveFallback(req: FallbackRequest): Promise<ModelRef | undefined> {
  const mode = req.config.models.onUnavailable;
  if (mode === 'fail' || req.signal?.aborted) return Promise.resolve(undefined);
  let memo = decisions.get(req.config);
  if (!memo) {
    memo = new Map();
    decisions.set(req.config, memo);
  }
  const key = refKey(req.failed);
  const known = memo.get(key);
  if (known) return known;
  const pending = decide(req).catch((err: unknown) => {
    req.logger.warn(`Model fallback failed: ${(err as Error).message}`);
    return undefined;
  });
  memo.set(key, pending);
  // An interrupted prompt must not become the answer for later calls.
  void pending.then(() => {
    if (req.signal?.aborted && memo.get(key) === pending) memo.delete(key);
  });
  return pending;
}

async function decide(req: FallbackRequest): Promise<ModelRef | undefined> {
  const { config, logger } = req;
  const chain = configuredChain(req);
  const tier = failedTier(req);
  const providers = providerInfos(req);
  const exclude = triedRefs(req);

  if (config.models.onUnavailable === 'ask') {
    if (req.host?.interactive) return exclusive(() => ask(req, chain, tier, providers));
    const first = chain[0]?.ref;
    if (first) logger.debug(`[models] ${refKey(req.failed)} → ${refKey(first)} (configured fallback)`);
    return first;
  }

  if (chain[0]) {
    logger.debug(`[models] ${refKey(req.failed)} → ${refKey(chain[0].ref)} (configured fallback)`);
    return chain[0].ref;
  }
  const alternatives = alternativesFor(req.failed, tier, providers, {
    allowCrossProvider: config.models.allowCrossProvider,
    sameTierOnly: true,
    exclude,
  }).filter((a) => !a.crossesKind);
  const pick = alternatives.find((a) => a.status === 'available') ?? alternatives[0];
  if (!pick) return undefined;
  logger.debug(
    `[models] ${refKey(req.failed)} → ${pick.provider}:${pick.model} (${pick.tier}, ${pick.status})`,
  );
  return { provider: pick.provider, model: pick.model };
}

const STOP = '\u0000stop';

interface PromptChoice {
  ref: ModelRef;
  label: string;
  hint: string;
}

/** Most alternatives the prompt offers per provider and tier (the list stays short and varied). */
const PER_PROVIDER_TIER = 2;
const MAX_CHOICES = 10;

function choiceHint(a: Alternative, failedProvider: string, label: string | undefined): string {
  const parts: string[] = [];
  if (label && label.toLowerCase() !== a.model.toLowerCase()) parts.push(label);
  parts.push(a.tier, a.status);
  if (a.provider !== failedProvider) parts.push('other provider');
  if (a.crossesKind) parts.push('switches between API and local agent');
  if (a.entry?.gated) parts.push('gated access');
  if (a.entry?.refusalProne) parts.push('refuses more security content');
  if (a.unconfined) parts.push('may run the reviewed code (not read-only)');
  return parts.join(' · ');
}

/**
 * Choices for the interactive prompt: the configured chain first, then the ranked alternatives (at most
 * two per provider and tier, ten in total).
 */
export function promptChoices(
  req: FallbackRequest,
  chain: ChainEntry[],
  tier: ModelTier | undefined,
  providers: ProviderInfo[],
): PromptChoice[] {
  const { config } = req;
  const choices: PromptChoice[] = [];
  const has = (ref: ModelRef) => choices.some((c) => sameRef(c.ref, ref, config));
  const labelOf = (ref: ModelRef, entryLabel?: string) =>
    (ref.model ? req.listings?.get(ref.provider)?.labels?.[ref.model] : undefined) ?? entryLabel;
  for (const entry of chain) {
    const cfg = config.providers[entry.ref.provider]!;
    const label = labelOf(entry.ref);
    choices.push({
      ref: entry.ref,
      label: refKey(entry.ref),
      hint: [label, 'configured fallback', tierOf(cfg, entry.ref.model), entry.status]
        .filter(Boolean)
        .join(' · '),
    });
  }
  const alternatives = alternativesFor(req.failed, tier, providers, {
    allowCrossProvider: config.models.allowCrossProvider,
    exclude: triedRefs(req),
    includeUnconfined: true,
  });
  const perGroup = new Map<string, number>();
  for (const a of alternatives) {
    if (choices.length >= MAX_CHOICES) break;
    const ref = { provider: a.provider, model: a.model };
    const group = `${a.provider}|${a.tier}`;
    if (has(ref) || (perGroup.get(group) ?? 0) >= PER_PROVIDER_TIER) continue;
    perGroup.set(group, (perGroup.get(group) ?? 0) + 1);
    choices.push({
      ref,
      label: refKey(ref),
      hint: choiceHint(a, req.failed.provider, labelOf(ref, a.entry?.label)),
    });
  }
  return choices;
}

async function ask(
  req: FallbackRequest,
  chain: ChainEntry[],
  tier: ModelTier | undefined,
  providers: ProviderInfo[],
): Promise<ModelRef | undefined> {
  if (req.signal?.aborted) return undefined;
  const { logger, failed } = req;
  const choices = promptChoices(req, chain, tier, providers);
  const failedLabel = `${failed.provider}:${failed.model ?? '(agent default)'}`;
  const reason = firstLine(req.reason, 180);
  if (!choices.length) {
    logger.warn(`${failedLabel} is unavailable (${reason}) and no alternative model was found.`);
    return undefined;
  }
  const host = req.host!;
  host.pause();
  try {
    const choice = await p.select<string>({
      message: `The ${req.role} model ${pc.bold(failedLabel)} is unavailable${reason ? ` — ${pc.dim(reason)}` : ''}\nContinue with:`,
      options: [
        ...choices.map((c) => ({ value: refKey(c.ref), label: c.label, hint: c.hint })),
        { value: STOP, label: 'Stop the run' },
      ],
      maxItems: 12,
      output: process.stderr,
      signal: req.signal,
    });
    if (p.isCancel(choice) || choice === STOP) return undefined;
    const picked = choices.find((c) => refKey(c.ref) === choice)?.ref;
    if (!picked) return undefined;
    const remember = await p.confirm({
      message: `Remember this choice? (saves ${refKey(failed)} → ${refKey(picked)} to the global config)`,
      initialValue: false,
      output: process.stderr,
      signal: req.signal,
    });
    if (remember === true) {
      try {
        const file = await rememberFallback(failed, picked);
        logger.info(pc.dim(`Saved fallback to ${file}`));
      } catch (err) {
        logger.warn(`Could not save the fallback: ${(err as Error).message}`);
      }
    }
    return picked;
  } finally {
    host.resume();
  }
}

function firstLine(text: string, max: number): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Saves `from → to` as the first entry of `models.fallbacks["from"]` in the GLOBAL config file
 * (`~/.code-reviewer/config.yaml`, or the existing config.yml/config.json), keeping comments and layout
 * (yaml Document API). The file is replaced atomically; a symlinked config is updated at its target.
 * Returns the written path.
 */
export async function rememberFallback(
  from: ModelRef,
  to: ModelRef,
  dir = globalConfigDir(),
): Promise<string> {
  const existing = GLOBAL_CONFIG_FILES.map((f) => path.join(dir, f)).find((f) => existsSync(f));
  const target = existing ? await realpath(existing) : path.join(dir, 'config.yaml');
  const text = existing ? await readFile(target, 'utf8') : '';
  const key = refKey(from);
  const value = refKey(to);
  const merge = (current: unknown): string[] => {
    const list = Array.isArray(current) ? current.filter((v): v is string => typeof v === 'string') : [];
    return [value, ...list.filter((v) => v !== value)];
  };

  let output: string;
  if (target.endsWith('.json')) {
    const data = (text.trim() ? JSON.parse(text) : {}) as Record<string, unknown>;
    const models = objectAt(data, 'models');
    const fallbacks = objectAt(models, 'fallbacks');
    fallbacks[key] = merge(fallbacks[key]);
    output = `${JSON.stringify(data, null, 2)}\n`;
  } else {
    const doc = YAML.parseDocument(text);
    if (doc.errors.length) throw new Error(`${target}: ${doc.errors[0]!.message}`);
    const current = doc.getIn(['models', 'fallbacks', key]);
    doc.setIn(
      ['models', 'fallbacks', key],
      doc.createNode(merge(YAML.isSeq(current) ? current.toJSON() : [])),
    );
    output = doc.toString();
  }
  const check = PartialConfigSchema.safeParse(YAML.parse(output) ?? {});
  if (!check.success)
    throw new Error(`${target} would become invalid: ${check.error.issues[0]?.message ?? ''}`);

  await mkdir(path.dirname(target), { recursive: true });
  const mode = existing ? (await stat(target)).mode & 0o777 : 0o600;
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, output, { mode });
  await rename(tmp, target);
  return target;
}

/** `obj[key]` as a plain object, created when missing; refuses to overwrite a non-object value. */
function objectAt(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = obj[key];
  if (current === undefined || current === null) {
    const created: Record<string, unknown> = {};
    obj[key] = created;
    return created;
  }
  if (typeof current !== 'object' || Array.isArray(current)) throw new Error(`"${key}" is not a mapping`);
  return current as Record<string, unknown>;
}
