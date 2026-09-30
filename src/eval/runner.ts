import path from 'node:path';
import pLimit from 'p-limit';
import type { Config } from '../config/schema';
import { formatUnavailable, preflightModels } from '../models';
import { detectProviders } from '../providers/detect';
import { ProviderRegistry } from '../providers/registry';
import { resolveRouting, runReview } from '../review/pipeline';
import type { Role, RoleRouting } from '../types';
import type { Logger } from '../util/logger';
import { packageVersion } from '../util/paths';
import { aggregateMetrics, caseMetrics, DEFAULT_TOLERANCE, erroredRun, isCounted, scoreRun } from './metrics';
import { type CaseRepo, materializeCase } from './repo';
import type { CaseResult, CaseRun, DefectResult, EvalCase, EvalResult, EvalSettings } from './types';

export class EvalRunError extends Error {}

/** Progress of an eval (the CLI prints it; the runner never writes to the terminal). */
export type EvalEvent =
  | { type: 'case-start'; case: EvalCase; repeat: number; index: number; total: number }
  | { type: 'case-run'; case: EvalCase; run: CaseRun; index: number; total: number }
  | { type: 'case-error'; case: EvalCase; error: string }
  | { type: 'warning'; case?: EvalCase; message: string };

export interface EvalOptions {
  cases: readonly EvalCase[];
  /** Effective configuration (config files and flags); see {@link evalRunConfig} for what is overridden. */
  config: Config;
  logger: Logger;
  id: string;
  /** Eval directory: review runs are saved in `<dir>/runs`. */
  dir: string;
  tolerance?: number;
  repeat?: number;
  /** Cases reviewed in parallel. */
  concurrency?: number;
  /** Keep the temporary case repositories. */
  keep?: boolean;
  /** For the result: where the cases came from and the filter applied. */
  corpus?: string[];
  filter?: string[];
  signal?: AbortSignal;
  onForcedExit?: (cleanup: () => void) => () => void;
  onEvent?: (e: EvalEvent) => void;
  /** Injected registry (tests); otherwise one is shared by all runs and disposed at the end. */
  providers?: ProviderRegistry;
  /** Skip the model availability check (tests). */
  skipPreflight?: boolean;
  /** Clone cache of real-repository cases (default `~/.code-reviewer/eval-cache`). */
  cacheDir?: string;
}

/**
 * The configuration each case is reviewed with: the effective one, except what belongs to the current
 * project or would execute case code — `project` (name, focus, instructions, ignore) describes the
 * current repository, not the cases; opt-in project analyzers run repository code; author attribution
 * means nothing for a generated repository. Runs are saved inside the eval directory.
 */
export function evalRunConfig(config: Config, dir: string): Config {
  const c = structuredClone(config);
  c.project = {};
  c.analyzers.project = [];
  c.review.authors = false;
  c.output.dir = path.join(dir, 'runs');
  // An eval measures the model: a cached answer would repeat an earlier run (and `--repeat` would be moot).
  c.cache.enabled = false;
  return c;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Checks the configured models once for the whole eval (instead of once per case) and applies any
 * replacement to the configuration, so that every case is reviewed by the same models.
 */
async function preflight(
  config: Config,
  opts: EvalOptions,
): Promise<{ routing: Partial<Record<Role, RoleRouting>>; fallbacks: EvalSettings['fallbacks'] }> {
  const routing = resolveRouting(config);
  if (opts.skipPreflight) return { routing, fallbacks: [] };
  const result = await preflightModels({
    config,
    routes: {
      review: { provider: routing.review.provider, model: routing.review.model },
      ...(routing.critique
        ? { critique: { provider: routing.critique.provider, model: routing.critique.model } }
        : {}),
    },
    availableProviders: detectProviders(config)
      .filter((s) => s.available)
      .map((s) => s.id),
    logger: opts.logger,
    cwd: opts.dir,
    signal: opts.signal,
  });
  const unresolved = result.unresolved[0];
  if (unresolved) throw new EvalRunError(formatUnavailable(unresolved));
  for (const role of ['review', 'critique'] as const) {
    const current = routing[role];
    const ref = result.routes[role];
    if (!current || !ref || (ref.provider === current.provider && ref.model === current.model)) continue;
    config.roles[role] = {
      ...config.roles[role],
      provider: ref.provider,
      model: ref.model,
      reasoning: current.reasoning,
    };
  }
  return { routing: resolveRouting(config), fallbacks: result.fallbacks };
}

/**
 * Reviews every case (`repeat` times) with `runReview` and scores the runs against the expected defects.
 * On an interrupt the running reviews are cancelled, no further case starts, and the result covers what
 * finished (`status: 'interrupted'`).
 */
export async function runEval(opts: EvalOptions): Promise<EvalResult> {
  const started = Date.now();
  const emit = opts.onEvent ?? (() => {});
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const repeat = opts.repeat ?? 1;
  const config = evalRunConfig(opts.config, opts.dir);
  const { routing, fallbacks } = await preflight(config, opts);
  const registry = opts.providers ?? new ProviderRegistry(config, opts.logger);
  const aborted = () => opts.signal?.aborted === true;
  const total = opts.cases.length;
  let costCurrency: string | undefined;

  const reviewOnce = async (c: EvalCase, repo: CaseRepo, rep: number): Promise<CaseRun> => {
    const runStarted = Date.now();
    try {
      const outcome = await runReview({
        command: 'review',
        cwd: repo.root,
        base: repo.base,
        head: repo.head,
        config,
        logger: opts.logger,
        offline: true,
        signal: opts.signal,
        onForcedExit: opts.onForcedExit,
        providers: registry,
        skipPreflight: true,
        onEvent: (e) => {
          if (e.type === 'warning') emit({ type: 'warning', case: c, message: e.message });
          if (e.type === 'fallback') {
            emit({ type: 'warning', case: c, message: `${e.role}: ${e.from} → ${e.to} (${e.reason})` });
          }
        },
      });
      const run = outcome.run!;
      if (run.cost?.basis.length) costCurrency ??= run.cost.currency;
      const score = scoreRun(c.expect, run, {
        tolerance,
        durationMs: Date.now() - runStarted,
        title: c.title,
      });
      // Every chunk failed: nothing was reviewed, which is an error rather than a clean result.
      if (run.status === 'failed') score.metrics.errors = 1;
      return {
        repeat: rep,
        status: aborted() ? 'interrupted' : run.status,
        ...(run.error ? { error: run.error } : {}),
        runId: run.id,
        ...(outcome.runDir ? { runDir: outcome.runDir } : {}),
        ...score,
      };
    } catch (err) {
      const status = aborted() ? 'interrupted' : 'error';
      return {
        repeat: rep,
        status,
        error: errorMessage(err),
        ...erroredRun(c.expect, Date.now() - runStarted),
      };
    }
  };

  const evaluate = async (c: EvalCase, index: number): Promise<CaseResult | undefined> => {
    const runs: CaseRun[] = [];
    let repo: CaseRepo | undefined;
    let setupError: string | undefined;
    try {
      repo = await materializeCase(c, {
        signal: opts.signal,
        keep: opts.keep,
        onForcedExit: opts.onForcedExit,
        cacheDir: opts.cacheDir,
      });
    } catch (err) {
      if (aborted()) return undefined;
      setupError = errorMessage(err);
      emit({ type: 'case-error', case: c, error: setupError });
      // Counted like failed reviews: the case's defects are missed, and the error is visible.
      for (let rep = 1; rep <= repeat; rep++) {
        runs.push({ repeat: rep, status: 'error', error: setupError, ...erroredRun(c.expect) });
      }
    }
    if (repo) {
      try {
        for (let rep = 1; rep <= repeat && !aborted(); rep++) {
          emit({ type: 'case-start', case: c, repeat: rep, index, total });
          const run = await reviewOnce(c, repo, rep);
          runs.push(run);
          emit({ type: 'case-run', case: c, run, index, total });
        }
      } finally {
        await repo.dispose().catch(() => undefined);
      }
    }
    if (runs.length === 0) return undefined;
    const defects: DefectResult[] = c.expect.map((d) => ({ ...d, found: 0, lost: 0 }));
    for (const run of runs.filter((r) => isCounted(r.status))) {
      for (const m of run.matched) defects[m.defect]!.found++;
      for (const l of run.lost) defects[l.defect]!.lost++;
    }
    return {
      id: c.id,
      title: c.title,
      tags: c.tags,
      clean: c.expect.every((d) => d.optional),
      source: c.source.kind === 'inline' ? 'inline' : c.source.repo,
      ...(opts.keep && repo?.tempDir ? { repoDir: repo.root } : {}),
      ...(setupError ? { error: setupError } : {}),
      defects,
      runs,
      metrics: caseMetrics(runs),
    };
  };

  const results: Array<CaseResult | undefined> = [];
  try {
    const limit = pLimit(Math.max(1, opts.concurrency ?? 1));
    await Promise.all(
      opts.cases.map((c, index) =>
        limit(async () => {
          if (!aborted()) results[index] = await evaluate(c, index);
        }),
      ),
    );
  } finally {
    if (!opts.providers) await registry.disposeAll();
  }

  const cases = results.filter((r): r is CaseResult => r !== undefined);
  return {
    schemaVersion: 1,
    id: opts.id,
    createdAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    status: aborted() ? 'interrupted' : 'completed',
    settings: {
      version: packageVersion(),
      corpus: opts.corpus ?? [],
      ...(opts.filter?.length ? { filter: opts.filter } : {}),
      tolerance,
      repeat,
      concurrency: opts.concurrency ?? 1,
      routing,
      fallbacks,
      depth: config.review.depth,
      selfCritique: config.review.selfCritique,
      minConfidence: config.review.minConfidence,
      minSeverity: config.review.minSeverity,
      skills: Array.isArray(config.review.skills) ? config.review.skills.join(',') : config.review.skills,
      tools: config.review.tools,
      analyzers: config.analyzers.builtin || config.analyzers.external !== 'off',
    },
    aggregate: { ...aggregateMetrics(cases, repeat), ...(costCurrency ? { costCurrency } : {}) },
    cases,
  };
}
