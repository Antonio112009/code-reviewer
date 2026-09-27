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
import type { Role, RoleRouting, RunRecord } from '../types';
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

export interface RoutedResult extends AgentResult {
  provider: string;
  attempts: number;
}

const MAX_ATTEMPTS = 3;

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
export class UnfinishedTurnError extends Error {}

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
  for (let attempt = 1; ; attempt++) {
    try {
      const provider = registry.get(route.provider);
      const result = await provider.run({ ...task, model: route.model, reasoning: route.reasoning });
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
        throw new UnfinishedTurnError(`the turn ended without findings (${why})`);
      }
      return { ...result, model: result.model ?? route.model, provider: route.provider, attempts: attempt };
    } catch (err) {
      if (task.signal?.aborted || attempt >= MAX_ATTEMPTS || isOwnTimeout(err)) throw err;
      const cls = classifyError(err);
      if (cls === 'transient') {
        await sleep(attempt * 3_000, task.signal);
        continue;
      }
      if (cls === 'unavailable' || cls === 'refusal') {
        const next = await router.replace(role, route, messageOf(err));
        if (!next) throw err;
        route = next;
        continue;
      }
      if (cls === 'auth') router.fatal = err instanceof Error ? err : new Error(String(err));
      throw err;
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
