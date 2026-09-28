import { estimateTokens } from '../chunking/tokens';
import type { Config } from '../config/schema';
import {
  classifyError,
  detectReplyError,
  type ModelListing,
  type ModelRef,
  refKey,
  resolveFallback,
} from '../models';
import type { ProviderRegistry } from '../providers/registry';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from '../providers/types';
import type { FailureKind, Money, Role, RoleRouting, RunRecord, Usage } from '../types';
import type { Logger } from '../util/logger';
import type { InteractionHost, ReviewEvent } from './events';

type Fallback = NonNullable<RunRecord['fallbacks']>[number];

export interface ModelRouterDeps {
  config: Config;
  availableProviders: string[];
  listings: Map<string, ModelListing>;
  host?: InteractionHost;
  logger: Logger;
  signal?: AbortSignal;
  emit?: (e: ReviewEvent) => void;
}

/**
 * Current model per role for a run. When a model turns out to be unavailable mid-run, the first failing
 * task asks for a replacement (prompt / configured fallbacks) and every concurrent task waiting on the
 * same model shares that single decision; later tasks start directly on the replacement.
 */
export class ModelRouter {
  readonly fallbacks: Fallback[] = [];
  /** Set on an error no retry or fallback can fix (e.g. expired credentials): remaining tasks fail fast. */
  fatal?: Error;
  private readonly decisions = new Map<string, Promise<RoleRouting | undefined>>();
  private readonly tried = new Map<Role, ModelRef[]>();

  constructor(
    private readonly routes: Partial<Record<Role, RoleRouting>>,
    private readonly deps: ModelRouterDeps,
  ) {}

  route(role: Role): RoleRouting {
    const r = this.routes[role];
    if (!r) throw new Error(`no ${role} route configured`);
    return r;
  }

  /** Replacement for `failed` (shared by concurrent callers); undefined = no replacement, stop. */
  replace(role: Role, failed: RoleRouting, reason: string): Promise<RoleRouting | undefined> {
    const current = this.routes[role];
    // Another task already switched away from the failed model: follow it.
    if (current && refKey(current) !== refKey(failed)) return Promise.resolve(current);
    const key = `${role}|${refKey(failed)}`;
    let decision = this.decisions.get(key);
    if (!decision) {
      const tried = [...(this.tried.get(role) ?? []), { provider: failed.provider, model: failed.model }];
      this.tried.set(role, tried);
      decision = resolveFallback({
        role,
        failed: { provider: failed.provider, model: failed.model },
        reason,
        config: this.deps.config,
        availableProviders: this.deps.availableProviders,
        listings: this.deps.listings,
        host: this.deps.host,
        logger: this.deps.logger,
        tried,
        signal: this.deps.signal,
      }).then((ref) => {
        if (!ref) return undefined;
        const next: RoleRouting = { provider: ref.provider, model: ref.model, reasoning: failed.reasoning };
        this.routes[role] = next;
        const entry = { role, from: refKey(failed), to: refKey(next), reason };
        this.fallbacks.push(entry);
        this.deps.emit?.({ type: 'fallback', ...entry });
        return next;
      });
      this.decisions.set(key, decision);
    }
    return decision;
  }
}

/** Tokens (and a reported cost) one model call spent, with the route that spent them (for pricing). */
export interface Spend {
  provider: string;
  model?: string;
  usage: Usage;
}

export interface RoutedResult extends AgentResult {
  provider: string;
  attempts: number;
  /** Usage of every attempt, failed ones included (`usage` is their sum). */
  spend: Spend[];
}

const MAX_ATTEMPTS = 3;
/** First retry delay for transient errors; later ones grow ×3 (with jitter). */
const BACKOFF_MS = 3_000;

const SPEND = Symbol('spend');

/** Usage of the attempts behind an error thrown by {@link runRouted}: failed attempts cost tokens too. */
export function spendOf(err: unknown): Spend[] {
  if (!err || typeof err !== 'object') return [];
  return (err as { [SPEND]?: Spend[] })[SPEND] ?? [];
}

/** Attaches the usage of failed attempts to an error (read back with {@link spendOf}). */
export function attachSpend(err: unknown, spend: Spend[]): unknown {
  if (spend.length && err && typeof err === 'object') {
    Object.defineProperty(err, SPEND, { value: [...spend], configurable: true });
  }
  return err;
}

/** Spend of a provider result: routed results carry theirs, a plain provider's result becomes one entry. */
export function spendOfResult(result: AgentResult, providerId: string): Spend[] {
  const routed = (result as Partial<RoutedResult>).spend;
  if (routed) return routed;
  return result.usage ? [{ provider: providerId, model: result.model, usage: result.usage }] : [];
}

/** Sum of usages; `estimated` when any part was, the reported cost only when every part reported one. */
export function sumUsage(usages: Usage[]): Usage {
  const total: Usage = { inputTokens: 0, outputTokens: 0 };
  let cost: Money | undefined;
  let costComplete = usages.length > 0;
  for (const u of usages) {
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    if (u.reasoningTokens) total.reasoningTokens = (total.reasoningTokens ?? 0) + u.reasoningTokens;
    if (u.cachedInputTokens) total.cachedInputTokens = (total.cachedInputTokens ?? 0) + u.cachedInputTokens;
    if (u.requests) total.requests = (total.requests ?? 0) + u.requests;
    if (u.estimated) total.estimated = true;
    if (u.reportedCost && (!cost || cost.currency === u.reportedCost.currency)) {
      cost = { amount: (cost?.amount ?? 0) + u.reportedCost.amount, currency: u.reportedCost.currency };
    } else costComplete = false;
  }
  if (cost && costComplete) total.reportedCost = cost;
  return total;
}

/**
 * The provider's usage, or an estimate from the prompt and the reply when it reported no token counts (a
 * lower bound: tool results and hidden reasoning are not counted). Every call is at least one request.
 */
export function usageOrEstimate(usage: Usage | undefined, task: AgentTask, text: string): Usage {
  if (usage && !usage.estimated) return { ...usage, requests: usage.requests ?? 1 };
  return {
    ...usage,
    inputTokens: estimateTokens(task.instructions) + estimateTokens(task.prompt),
    outputTokens: estimateTokens(text),
    estimated: true,
    requests: usage?.requests ?? 1,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0]! : String(err);
}

/** A turn that ended without a usable answer (cancelled by our timeout or stall watchdog, output or step limit). */
export class UnfinishedTurnError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
  ) {
    super(message);
  }
}

/** The model answered, but neither the submit tool nor its reply carried a findings payload. */
export class NoPayloadError extends Error {
  constructor(
    message: string,
    /** What the model replied instead (kept in the run's artifacts). */
    readonly reply = '',
  ) {
    super(message);
  }
}

/** Why a model task failed, for the run record and the advice shown to the user. */
export function failureKindOf(err: unknown, signal?: AbortSignal): FailureKind {
  if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) return 'aborted';
  if (err instanceof UnfinishedTurnError) return err.kind;
  if (err instanceof NoPayloadError) return 'no-output';
  if (isOwnTimeout(err)) return 'timeout';
  switch (classifyError(err)) {
    case 'too-long':
      return 'context-limit';
    case 'auth':
      return 'auth';
    case 'unavailable':
      return 'unavailable';
    case 'refusal':
      return 'refusal';
    default:
      return 'error';
  }
}

function unfinishedKind(result: Pick<AgentResult, 'interruptedBy'>, stop: string): FailureKind {
  if (result.interruptedBy) return result.interruptedBy;
  if (stop === 'max_turn_requests') return 'step-limit';
  if (stop === 'max_tokens' || stop === 'length') return 'output-limit';
  return 'error';
}

/** Stop reasons (ACP and AI SDK finish reasons) of a turn that did not finish its answer. */
const UNFINISHED_STOPS = new Set(['cancelled', 'max_tokens', 'max_turn_requests', 'length']);
/** Stop reasons of a model that declined to answer: a fallback model may not. */
const REFUSAL_STOPS = new Set(['refusal', 'content-filter']);

/**
 * Why a turn that submitted nothing is unusable (`cancelled`, `refusal`, `max_tokens`, …), or undefined
 * when it finished normally (a reply text may still carry the findings).
 */
export function unfinishedStop(result: Pick<AgentResult, 'submission' | 'stopReason'>): string | undefined {
  const stop = result.stopReason;
  if (result.submission.calls > 0 || !stop) return undefined;
  return UNFINISHED_STOPS.has(stop) || REFUSAL_STOPS.has(stop) ? stop : undefined;
}

/** True for the task's own timeout: retrying would only repeat it (and triple time and tokens). */
function isOwnTimeout(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 6; depth++) {
    if (e instanceof UnfinishedTurnError || (e as { name?: unknown }).name === 'TimeoutError') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs `task` for `role` on the router's current model with recovery: transient errors are retried with
 * backoff, unavailable/refused models are replaced via the router, credential errors stop the run.
 * A turn cancelled by its own timeout, cut off by a limit or refused without submitting anything is an
 * error too (never a clean, empty review).
 */
export async function runRouted(
  role: Role,
  task: AgentTask,
  router: ModelRouter,
  registry: ProviderRegistry,
): Promise<RoutedResult> {
  if (router.fatal) throw router.fatal;
  let route = router.route(role);
  const spend: Spend[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      const provider = registry.get(route.provider);
      const result = await provider.run({ ...task, model: route.model, reasoning: route.reasoning });
      const model = result.model ?? route.model;
      const usage = usageOrEstimate(result.usage, task, result.text);
      spend.push({ provider: route.provider, ...(model ? { model } : {}), usage });
      // Some agents answer an unusable model with an error message instead of a protocol error.
      const replyError = result.submission.calls === 0 ? detectReplyError(result.text) : undefined;
      if (replyError) throw new ProviderError(replyError, route.provider);
      const stop = unfinishedStop(result);
      if (stop && REFUSAL_STOPS.has(stop)) {
        throw new ProviderError(
          `the model declined to answer (stop reason: refusal, ${stop})`,
          route.provider,
        );
      }
      if (stop) {
        const why = result.warnings.find((w) => /cancelled/.test(w)) ?? `stop reason: ${stop}`;
        throw new UnfinishedTurnError(
          `the turn ended without findings (${why})`,
          unfinishedKind(result, stop),
        );
      }
      return {
        ...result,
        usage: sumUsage(spend.map((s) => s.usage)),
        model,
        provider: route.provider,
        attempts: attempt,
        spend,
      };
    } catch (err) {
      if (task.signal?.aborted || attempt >= MAX_ATTEMPTS || isOwnTimeout(err)) throw attachSpend(err, spend);
      const cls = classifyError(err);
      if (cls === 'transient') {
        await sleep(BACKOFF_MS * 3 ** (attempt - 1) * (0.75 + Math.random() * 0.5), task.signal);
        continue;
      }
      if (cls === 'unavailable' || cls === 'refusal') {
        const next = await router.replace(role, route, messageOf(err));
        if (!next) throw attachSpend(err, spend);
        route = next;
        continue;
      }
      if (cls === 'auth') router.fatal = err instanceof Error ? err : new Error(String(err));
      throw attachSpend(err, spend);
    }
  }
}

/** A Provider facade that always runs on the router's current model for `role` (used by critique). */
export class RoutedProvider implements Provider {
  readonly kind = 'api' as const;

  constructor(
    private readonly role: Role,
    private readonly router: ModelRouter,
    private readonly registry: ProviderRegistry,
  ) {}

  get id(): string {
    return this.router.route(this.role).provider;
  }

  run(task: AgentTask): Promise<AgentResult> {
    return runRouted(this.role, task, this.router, this.registry);
  }

  async dispose(): Promise<void> {}
}
