import pLimit from 'p-limit';
import type { AnalyzerSettings } from '../config/schema';
import type { AnalyzerRun, StaticHit } from '../types';
import type { ProcessRegistry } from '../util/processes';
import { astGrepAnalyzer, type StructuralCheck } from './ast-grep';
import { probeVersion, scrubEnv } from './env';
import { AnalyzerError } from './exec';
import { EXTERNAL_ANALYZERS } from './external';
import { finalizeHits, type TaggedHit } from './hits';
import { patternRule, patternsAnalyzer } from './patterns';
import { PROJECT_ANALYZERS } from './project';
import { createSandbox, type OwnedSandbox, safeRelativePath } from './sandbox';
import { secretsAnalyzer } from './secrets';
import { suppressionsAnalyzer } from './suppressions';
import type { AnalyzerContext, AnalyzerDef, AnalyzerOutcome, LocatedBinary, RawHit } from './types';

export interface AnalyzeFile {
  /** Repo-relative path. */
  path: string;
  /** Content of the reviewed revision. */
  content: string;
  language: string;
  /**
   * 1-based inclusive ranges of changed lines. Files mode: empty = whole file. Diff mode: a file without
   * ranges (a change that only deletes lines) has nothing to flag and is not analysed.
   */
  changedRanges: Array<[number, number]>;
}

export interface AnalyzeOptions {
  files: AnalyzeFile[];
  settings: AnalyzerSettings;
  mode: 'diff' | 'files';
  /** Project analyzers enabled on the command line (`--analyzers eslint,tsc`). */
  projectOptIn?: string[];
  /** Repository root — only project-tier analyzers may use it. */
  repoRoot?: string;
  signal?: AbortSignal;
  onRun?: (run: AnalyzerRun) => void;
  /** Environment to resolve tools from (scrubbed before it reaches any tool). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Process registry for spawned tools (defaults to the process-wide one used by shutdown). */
  registry?: ProcessRegistry;
  /** Structural checks of the loaded skills, run by the `ast-grep` analyzer. */
  checks?: readonly StructuralCheck[];
}

export interface AnalyzeResult {
  hits: StaticHit[];
  runs: AnalyzerRun[];
}

/** Every analyzer, in display order: built-in, safe external, opt-in project. */
const ANALYZERS: readonly AnalyzerDef[] = [
  secretsAnalyzer,
  patternsAnalyzer,
  suppressionsAnalyzer,
  ...EXTERNAL_ANALYZERS,
  astGrepAnalyzer,
  ...PROJECT_ANALYZERS,
];
const ORDER = new Map(ANALYZERS.map((a, i) => [a.id, i]));

/** In-process analyzers never get more than this, whatever `settings.timeoutMs` says. */
export const BUILTIN_TIMEOUT_MS = 10_000;
/** Analyzers running at the same time. */
export const ANALYZER_CONCURRENCY = 4;

function normalizeFiles(files: AnalyzeFile[], mode: 'diff' | 'files'): AnalyzeFile[] {
  const byPath = new Map<string, AnalyzeFile>();
  for (const f of files) {
    if (typeof f.content !== 'string' || !safeRelativePath(f.path) || byPath.has(f.path)) continue;
    const ranges = (f.changedRanges ?? [])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && Math.max(a, b) >= 1)
      .map(([a, b]): [number, number] => [Math.min(a, b), Math.max(a, b)])
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    byPath.set(f.path, { ...f, changedRanges: ranges });
  }
  // Empty ranges mean "whole file" to the analyzers: in diff mode that would report pre-existing code
  // of files the change only deleted lines from.
  return [...byPath.values()]
    .filter((f) => mode !== 'diff' || f.changedRanges.length > 0)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function optInSet(settings: AnalyzerSettings, extra: string[] | undefined): Set<string> {
  return new Set([...settings.project, ...(extra ?? [])].map((s) => s.trim()).filter(Boolean));
}

interface Executed {
  run: AnalyzerRun;
  hits: RawHit[];
  /** Not reported at all (an optional external tool that is simply not installed). */
  omit?: boolean;
}

async function execute(
  def: AnalyzerDef,
  files: AnalyzeFile[],
  opts: AnalyzeOptions,
  env: NodeJS.ProcessEnv,
): Promise<Executed> {
  const started = Date.now();
  const base = { id: def.id, label: def.label, tier: def.tier };
  const finish = (
    status: AnalyzerRun['status'],
    reason?: string,
    version?: string,
    hits: RawHit[] = [],
  ): Executed => {
    const run: AnalyzerRun = { ...base, status, hits: 0, durationMs: Date.now() - started };
    if (version) run.version = version;
    if (reason) run.reason = reason;
    return { run, hits };
  };
  if (opts.signal?.aborted) return finish('skipped', 'interrupted');

  let tool: LocatedBinary | undefined;
  let version: string | undefined;
  if (def.locate) {
    try {
      tool = await def.locate({ env, repoRoot: opts.repoRoot });
    } catch (err) {
      return finish('failed', `lookup failed: ${(err as Error).message}`);
    }
    if (!tool) {
      // A missing optional tool is normal; one the user explicitly opted into is worth reporting.
      if (def.tier !== 'project') return { ...finish('skipped', 'not found on PATH'), omit: true };
      return finish('skipped', 'not installed (repository or PATH)');
    }
    if (tool.trusted) {
      const probe = await probeVersion(tool.command, def.versionArgs ?? ['--version'], {
        env,
        signal: opts.signal,
        registry: opts.registry,
      });
      if (!probe.ok)
        return finish(opts.signal?.aborted ? 'skipped' : 'failed', probe.reason ?? 'version probe failed');
      version = probe.version;
    }
  }

  const timeoutMs =
    def.tier === 'builtin' ? Math.min(BUILTIN_TIMEOUT_MS, opts.settings.timeoutMs) : opts.settings.timeoutMs;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  else opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const sandboxes: OwnedSandbox[] = [];
  const ctx: AnalyzerContext = {
    files,
    mode: opts.mode,
    signal: controller.signal,
    timeoutMs,
    deadline,
    env,
    tool,
    version,
    repoRoot: def.tier === 'project' ? opts.repoRoot : undefined,
    registry: opts.registry,
    checks: opts.checks,
    sandbox: async (sandboxFiles, transform) => {
      const box = await createSandbox(def.id, sandboxFiles, { repoRoot: opts.repoRoot, transform });
      sandboxes.push(box);
      return box;
    },
  };

  let outcome: AnalyzerOutcome;
  try {
    const running = def.run(ctx);
    if (def.tier === 'builtin') {
      // In-process work cannot be killed: stop waiting at the deadline (the analyzer also checks the signal).
      running.catch(() => undefined);
      const stopped = new Promise<AnalyzerOutcome>((resolve) => {
        const settle = () =>
          resolve({
            hits: [],
            status: timedOut ? 'timeout' : 'failed',
            reason: timedOut ? undefined : 'interrupted',
          });
        if (controller.signal.aborted) settle();
        else controller.signal.addEventListener('abort', settle, { once: true });
      });
      outcome = await Promise.race([running, stopped]);
    } else {
      outcome = await running;
    }
  } catch (err) {
    outcome =
      err instanceof AnalyzerError
        ? { hits: [], status: err.status, reason: err.message }
        : { hits: [], status: 'failed', reason: (err as Error).message || String(err) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    await Promise.all(sandboxes.map((b) => b.remove()));
  }
  let status = outcome.status ?? 'ok';
  let reason = outcome.reason;
  if (status === 'timeout' && !reason) reason = `timed out after ${timeoutMs} ms`;
  if (status !== 'ok' && timedOut && status !== 'timeout') {
    status = 'timeout';
    reason = `timed out after ${timeoutMs} ms`;
  }
  return finish(status, reason, outcome.version ?? version, outcome.hits);
}

/** Runs the static-analysis pre-pass (built-in, safe external and opt-in project analyzers) in parallel. */
export async function runAnalyzers(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const { settings, mode } = opts;
  const files = normalizeFiles(opts.files, mode);
  const env = scrubEnv(opts.env ?? process.env);
  const disabled = new Set(settings.disabled);
  const optIn = optInSet(settings, opts.projectOptIn);
  const runs: AnalyzerRun[] = [];
  const raw: TaggedHit[] = [];
  const emit = (run: AnalyzerRun) => {
    runs.push(run);
    try {
      opts.onRun?.(run);
    } catch {
      // A UI callback must never break the review.
    }
  };

  const known = new Set(ANALYZERS.map((a) => a.id));
  for (const id of [...optIn].sort()) {
    if (!known.has(id) && !disabled.has(id)) {
      emit({
        id,
        label: id,
        tier: 'project',
        status: 'skipped',
        hits: 0,
        durationMs: 0,
        reason: 'unknown analyzer',
      });
    }
  }

  const planned: Array<{ def: AnalyzerDef; files: AnalyzeFile[] }> = [];
  for (const def of ANALYZERS) {
    if (disabled.has(def.id)) continue;
    if (def.tier === 'builtin' && !settings.builtin) continue;
    if (def.tier === 'external' && settings.external === 'off') continue;
    if (def.tier === 'project' && !optIn.has(def.id)) continue;
    const selected = def.select(files, mode, opts.checks);
    if (selected.length === 0) {
      if (def.tier === 'project') {
        emit({
          id: def.id,
          label: def.label,
          tier: def.tier,
          status: 'skipped',
          hits: 0,
          durationMs: 0,
          reason: 'no matching files',
        });
      }
      continue;
    }
    if (def.tier === 'project' && !opts.repoRoot) {
      emit({
        id: def.id,
        label: def.label,
        tier: def.tier,
        status: 'skipped',
        hits: 0,
        durationMs: 0,
        reason: 'no repository root',
      });
      continue;
    }
    planned.push({ def, files: selected });
  }

  const limit = pLimit(ANALYZER_CONCURRENCY);
  await Promise.all(
    planned.map(({ def, files: selected }) =>
      limit(async () => {
        const { run, hits, omit } = await execute(def, selected, opts, env);
        if (omit) return;
        const tagged = hits.map((h) => ({ ...h, analyzer: def.id }));
        raw.push(...tagged);
        run.hits = finalizeHits(tagged, files, mode).length;
        emit(run);
      }),
    ),
  );

  const hits = finalizeHits(raw, files, mode);
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(h.analyzer, (counts.get(h.analyzer) ?? 0) + 1);
  const ordered = runs
    .map((r) => ({ ...r, hits: counts.get(r.id) ?? 0 }))
    .sort(
      (a, b) =>
        (ORDER.get(a.id) ?? 999) - (ORDER.get(b.id) ?? 999) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return { hits, runs: ordered };
}

export interface AnalyzerInfo {
  id: string;
  label: string;
  tier: 'builtin' | 'external' | 'project';
  languages: string[];
  description: string;
}

/** Every analyzer the tool knows, in display order. */
export function listAnalyzers(): AnalyzerInfo[] {
  return ANALYZERS.map((a) => ({
    id: a.id,
    label: a.label,
    tier: a.tier,
    languages: [...a.languages],
    description: a.network ? `${a.description} [network]` : a.description,
  }));
}

export interface DetectedAnalyzer extends AnalyzerInfo {
  /** The analyzer can run here (bundled, or its executable was found). */
  available: boolean;
  /** It would run in a review with these settings. */
  enabled: boolean;
  version?: string;
  reason?: string;
}

/**
 * Which analyzers can run on this machine (binaries on PATH, versions). Never executes repository
 * code: repository-local tools (eslint/tsc in node_modules, vendor/bin/phpstan) are only located.
 */
export async function detectAnalyzers(
  settings: AnalyzerSettings,
  opts: { repoRoot?: string; env?: NodeJS.ProcessEnv; projectOptIn?: string[]; signal?: AbortSignal } = {},
): Promise<DetectedAnalyzer[]> {
  const env = scrubEnv(opts.env ?? process.env);
  const disabled = new Set(settings.disabled);
  const optIn = optInSet(settings, opts.projectOptIn);
  const infos = listAnalyzers();
  const limit = pLimit(ANALYZER_CONCURRENCY);
  return Promise.all(
    ANALYZERS.map((def, i) =>
      limit(async (): Promise<DetectedAnalyzer> => {
        const info = infos[i] as AnalyzerInfo;
        const isDisabled = disabled.has(def.id);
        const tierOn =
          def.tier === 'builtin'
            ? settings.builtin
            : def.tier === 'external'
              ? settings.external === 'auto'
              : optIn.has(def.id);
        const offReason = isDisabled
          ? 'disabled in settings (analyzers.disabled)'
          : !tierOn
            ? def.tier === 'builtin'
              ? 'built-in analyzers are off (analyzers.builtin)'
              : def.tier === 'external'
                ? 'external analyzers are off (analyzers.external)'
                : `opt-in: runs repository code — enable with --analyzers ${def.id}`
            : undefined;
        if (!def.locate) return { ...info, available: true, enabled: !offReason, reason: offReason };
        const tool = await def.locate({ env, repoRoot: opts.repoRoot }).catch(() => undefined);
        if (!tool) {
          return {
            ...info,
            available: false,
            enabled: false,
            reason: def.tier === 'project' ? 'not installed (repository or PATH)' : 'not found on PATH',
          };
        }
        let version: string | undefined;
        let reason = offReason;
        if (tool.trusted) {
          const probe = await probeVersion(tool.command, def.versionArgs ?? ['--version'], {
            env,
            signal: opts.signal,
          });
          if (!probe.ok) {
            return {
              ...info,
              available: false,
              enabled: false,
              reason: probe.reason ?? 'version probe failed',
            };
          }
          version = probe.version;
        } else if (!reason) {
          reason = 'repository-local executable (version not probed)';
        }
        const out: DetectedAnalyzer = { ...info, available: true, enabled: !offReason };
        if (version) out.version = version;
        if (reason) out.reason = reason;
        return out;
      }),
    ),
  );
}

const TOOL_SKILLS: Record<string, string> = {
  secrets: 'security/secrets',
  gitleaks: 'security/secrets',
  suppressions: 'security/core',
  shellcheck: 'shell/core',
  hadolint: 'infra/docker/core',
  ruff: 'python/core/exceptions',
  cppcheck: 'c-cpp/memory/use-after-free',
  eslint: 'javascript/core/async-promises',
  tsc: 'javascript/typescript/narrowing-soundness',
  'golangci-lint': 'go/errors/handling',
  phpstan: 'php/core/comparisons',
  semgrep: 'security/core',
  opengrep: 'security/core',
  'osv-scanner': 'security/supply-chain',
};

/**
 * Review skills related to the given hits (sorted, unique) — e.g. `sql` for an SQL-injection pattern,
 * `github-actions` for a workflow rule. Unknown ids should simply be ignored by the caller.
 */
export function skillsForHits(hits: Array<Pick<StaticHit, 'analyzer' | 'ruleId'>>): string[] {
  const out = new Set<string>();
  for (const h of hits) {
    const skill = h.analyzer === 'patterns' ? patternRule(h.ruleId)?.skill : TOOL_SKILLS[h.analyzer];
    if (skill) out.add(skill);
  }
  return [...out].sort();
}
