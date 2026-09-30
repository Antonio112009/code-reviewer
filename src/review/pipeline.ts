import path from 'node:path';
import pLimit from 'p-limit';
import { type AnalyzeResult, runAnalyzers, skillsForHits } from '../analyzers';
import {
  type CachedReview,
  type CachedVerdict,
  type CacheRoute,
  critiqueCacheKey,
  getReview,
  getVerdict,
  hashReads,
  hintIdentity,
  mapHints,
  openResultCache,
  reviewCacheKey,
} from '../cache/review';
import type { ResultCache } from '../cache/store';
import { buildChunks, scheduleOrder, splitChunk } from '../chunking/chunker';
import { changedSymbols, expandChunks, revisionSource } from '../chunking/expand';
import { buildFileGraph, type FileGraph } from '../chunking/graph';
import { estimateTokens } from '../chunking/tokens';
import type { Config } from '../config/schema';
import {
  commitReader,
  loadProjectRules,
  type ProjectRules,
  workingTreeReader,
} from '../context/project-rules';
import { type DetectedStack, detectStack } from '../context/stack';
import { type LocalChanges, NothingLocalError } from '../git/local-changes';
import { resolveRefs } from '../git/refs';
import { parseRemote } from '../git/remote';
import { GitRepo } from '../git/repo';
import {
  createFilesSnapshot,
  createSnapshot,
  pruneStaleSnapshots,
  type ReviewRoot,
  type RootFile,
} from '../git/snapshot';
import { findCatalogModel, formatUnavailable, type ModelListing, preflightModels } from '../models';
import { CostBudget, CostMeter, costOf, formatMoney } from '../models/pricing';
import { isUnconfined } from '../providers/acp/presets';
import { detectProviders } from '../providers/detect';
import { ProviderRegistry } from '../providers/registry';
import type { AgentTask } from '../providers/types';
import { writeReports } from '../report';
import { SEVERITY_ORDER, sortFindings } from '../report/common';
import { RunLog } from '../runs/log';
import { RunStore } from '../runs/store';
import {
  type FileSignals,
  type SkillMatch,
  selectSkills,
  signalText,
  skillsForDepth,
} from '../skills/detector';
import { loadSkills, type Skill } from '../skills/loader';
import { changedPaths, collectDiffUnits, type SkippedFile } from '../sources/diff-source';
import { collectFileUnits } from '../sources/files-source';
import { dependencyRoots } from '../tools/dependencies';
import type {
  CacheUse,
  Chunk,
  ExpandLevel,
  FailureKind,
  Finding,
  RefsInfo,
  ReportedFinding,
  ReviewPass,
  ReviewUnit,
  Role,
  RoleRouting,
  RunRecord,
  RunTarget,
  StaticHit,
} from '../types';
import { newRunId, shortHash } from '../util/ids';
import type { Logger } from '../util/logger';
import { packageVersion } from '../util/paths';
import { attributeFindings } from './attribution';
import { coverageMap, type PartResult } from './coverage';
import { type CritiqueCache, critiqueFindings } from './critique';
import { dedupeFindings } from './dedupe';
import type { InteractionHost, PhaseId, ReviewEvent, ReviewPlan } from './events';
import {
  attachSpend,
  failureKindOf,
  ModelRouter,
  NoPayloadError,
  RoutedProvider,
  runRouted,
  type Spend,
  spendOf,
  sumUsage,
} from './execute';
import { resolveFindings, toFinding } from './findings';
import { fingerprintFindings, reviewRootReader } from './fingerprint';
import {
  addedCodeOf,
  analyzeFilesFrom,
  chunkStackLine,
  claimsHint,
  fileCodeOf,
  hintsForChunk,
  linkedReviewConfig,
  listRevisionFiles,
  rawCodeOf,
  revisionReader,
  techsForChunk,
  techVersionsForChunk,
  touchedReviewConfig,
} from './planning';
import {
  critiqueFindingIdentity,
  critiqueInstructions,
  repairPrompt,
  reviewInstructions,
  reviewPrompt,
  reviewPromptIdentity,
} from './prompts';
import { taskTimeoutMs } from './timeouts';
import { requireFailurePath, validateFindings } from './validate';

const PROJECT_RULES_BUDGET = 3_000;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_OUTPUT_RESERVE = 16_000;
const PROMPT_OVERHEAD = 2_000;
/**
 * One chunk per configured pass: `general` keeps the chunk as it is; a focused pass gets a copy of it
 * (`<id>-local`, `<id>-contracts`) that the review instructions point at one kind of defect.
 */
function withPasses(chunks: Chunk[], passes: readonly ReviewPass[]): Chunk[] {
  const unique = [...new Set(passes)];
  if (unique.length === 1 && unique[0] === 'general') return chunks;
  return chunks.flatMap((c) =>
    unique.map((pass) =>
      pass === 'general'
        ? c
        : {
            ...c,
            id: `${c.id}-${pass}`,
            pass,
            parts: [...c.parts],
            contextFiles: [...(c.contextFiles ?? [])],
          },
    ),
  );
}

/** Share of the chunk budget that related unchanged code may add to a chunk, per `review.expand` level. */
const EXPAND_SHARE = { map: 0, refs: 0.15, deep: 0.25 } as const;
/** Rough prompt tokens per static hint line. */
const TOKENS_PER_HINT = 60;
/** Unclaimed hints at or above this prior confidence become candidate findings when their chunk failed. */
const STATIC_CANDIDATE_CONFIDENCE = 0.6;

export type { PhaseId, PlannedChunk, ReviewEvent, ReviewPlan } from './events';

export interface ReviewRequest {
  command: 'review' | 'files';
  cwd: string;
  base?: string;
  head?: string;
  /** Review the staged / uncommitted changes instead of commits (`--staged`, `--uncommitted`). */
  local?: LocalChanges;
  paths?: string[];
  config: Config;
  logger: Logger;
  dryRun?: boolean;
  /** Never touch the network (no fetch, no PR lookup). */
  offline?: boolean;
  /** Project-tier analyzers enabled on the command line (`--analyzers eslint,tsc`). */
  projectAnalyzers?: string[];
  onEvent?: (e: ReviewEvent) => void;
  signal?: AbortSignal;
  /** Terminal UI used to ask questions (model fallback) while the run is live. */
  host?: InteractionHost;
  /** Registers synchronous cleanup for a forced exit (see Lifecycle.onForcedExit). */
  onForcedExit?: (cleanup: () => void) => () => void;
  /** Injected registry (tests); otherwise one is created and disposed by the pipeline. */
  providers?: ProviderRegistry;
  /** Skip the model availability check (tests, offline demos). */
  skipPreflight?: boolean;
}

export interface ReviewOutcome {
  plan: ReviewPlan;
  run?: RunRecord;
  runDir?: string;
  reports: string[];
}

export class ReviewError extends Error {}

export function resolveRouting(config: Config): { review: RoleRouting; critique?: RoleRouting } {
  const review = config.roles.review;
  if (!review) throw new ReviewError('No review role configured (roles.review).');
  const modelsOf = (id: string) => {
    const cfg = config.providers[id];
    return cfg && cfg.type !== 'mock'
      ? { defaultModel: cfg.defaultModel, critiqueModel: cfg.critiqueModel }
      : {};
  };
  const reviewRoute: RoleRouting = {
    provider: review.provider,
    model: review.model ?? modelsOf(review.provider).defaultModel,
    reasoning: review.reasoning ?? 'medium',
  };
  if (!config.review.selfCritique) return { review: reviewRoute };
  // The critic runs on the review provider unless a critique role names another. Without a model of its
  // own it takes the provider's `critiqueModel` (claude: opus), else the review's model (same provider) or
  // the provider's default.
  const r = config.roles.critique;
  const provider = r?.provider ?? review.provider;
  const models = modelsOf(provider);
  const critique: RoleRouting = {
    provider,
    model:
      r?.model ??
      models.critiqueModel ??
      (provider === reviewRoute.provider ? reviewRoute.model : models.defaultModel),
    reasoning: r?.reasoning ?? 'high',
  };
  return { review: reviewRoute, critique };
}

/**
 * What reviewing a chunk (or one split part of it) produced: findings, a failure, or only usage (an attempt
 * that failed but was recovered by a split or a retry).
 */
type PartOutcome = { id: string; files: string[]; spend: Spend[] } & (
  | {
      kind: 'done';
      hints: StaticHit[];
      findings: Finding[];
      claimed: Set<string>;
      /** The model's items (hints by run-local id) and the files it read: what the result cache keeps. */
      items?: ReportedFinding[];
      reads?: string[];
      provider: string;
      model?: string;
      attempts: number;
      toolUsage?: Record<string, number>;
      /** Why the model was asked for an early answer: a partial review, never cached. */
      salvaged?: string;
      /** Distinct functions the model recorded as audited (`review.audit`). */
      audited?: number;
      /** Answered from the result cache; `saved` is what that answer took when it was made. */
      cached?: { saved?: { inputTokens: number; outputTokens: number } };
    }
  | { kind: 'failed'; hints: StaticHit[]; err: unknown; failure: FailureKind }
  | { kind: 'spent' }
);
type DoneOutcome = PartOutcome & { kind: 'done' };

/** Failures a smaller chunk can fix: out of time, steps, output or context window. */
const SPLITTABLE: ReadonlySet<FailureKind> = new Set([
  'timeout',
  'step-limit',
  'output-limit',
  'context-limit',
]);
/** A failed chunk is halved at most this many times (up to four parts). */
const MAX_SPLIT_LEVEL = 2;
/** With self-critique, reviews stop at 85% of `review.maxCost`: the rest is kept to verify their findings. */
const CRITIQUE_RESERVE = 0.15;

function addCounts(total: Record<string, number>, add: Record<string, number> | undefined): void {
  for (const [k, v] of Object.entries(add ?? {})) total[k] = (total[k] ?? 0) + v;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (err instanceof Error && err.name === 'AbortError');
}

/** A static hit carried into the review as a candidate finding (verified by the critic). */
function staticFinding(hit: StaticHit, chunkId: string): Finding {
  return {
    id: `s-${shortHash(`${hit.file}:${hit.startLine}:${hit.analyzer}:${hit.ruleId}`)}`,
    file: hit.file,
    startLine: hit.startLine,
    endLine: Math.max(hit.startLine, hit.endLine),
    severity: hit.severity,
    category: hit.category,
    title: hit.message.split('\n')[0]!.slice(0, 200) || hit.ruleId,
    description: `${hit.message}${hit.help ? `\n\n${hit.help}` : ''}`.slice(0, 2_000).padEnd(10, '.'),
    confidence: hit.confidence,
    skills: [],
    origin: 'static',
    tool: { analyzer: hit.analyzer, ruleId: hit.ruleId },
    ...(hit.nonRejectable ? { nonRejectable: true } : {}),
    source: { chunkIds: [chunkId], provider: `static:${hit.analyzer}` },
  };
}

/** The chunk's files for per-file skill matching (see `SkillContext.perFile`). */
function perFileSignals(owned: ReviewUnit[], mode: 'diff' | 'files'): FileSignals[] {
  return owned.map((u) => ({
    path: u.path,
    language: u.language,
    code: signalText(mode === 'diff' ? addedCodeOf([u]) : rawCodeOf([u])),
    fileCode: signalText(fileCodeOf([u])),
  }));
}

/**
 * `git status` pathspec excluding the runs directory when it lies inside the repository (posix). On
 * Windows `path.relative` to another drive is absolute, which git rejects as outside the repository.
 */
export function runsDirExclude(repoRoot: string, runsDir: string, p: typeof path.posix = path): string[] {
  const rel = p.relative(repoRoot, runsDir);
  if (!rel || rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return [];
  return [rel.split(p.sep).join('/')];
}

export async function runReview(req: ReviewRequest): Promise<ReviewOutcome> {
  const { config } = req;
  // Everything this run logs (debug included) and its main events end up in the run's `run.log`.
  const runLog = new RunLog();
  const logger = req.logger.child();
  const untap = logger.tap((level, message) => runLog.add(level, message));
  const emit = (e: ReviewEvent) => {
    runLog.event(e);
    req.onEvent?.(e);
  };
  logger.debug(
    `code-reviewer ${packageVersion()} · node ${process.version} · ${process.platform}/${process.arch} · ${req.command} in ${req.cwd}`,
  );
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    emit({ type: 'warning', message });
  };
  const phase = async <T>(id: PhaseId, message: string, fn: () => Promise<T>): Promise<T> => {
    emit({ type: 'phase', phase: id, message });
    const started = Date.now();
    try {
      return await fn();
    } finally {
      emit({ type: 'phase-done', phase: id, durationMs: Date.now() - started });
    }
  };
  const throwIfAborted = () => {
    if (req.signal?.aborted) throw new ReviewError('Interrupted');
  };

  const repo = await GitRepo.find(req.cwd);
  const repoRoot = repo?.root ?? path.resolve(req.cwd);
  const routing = resolveRouting(config);
  for (const [role, route] of Object.entries(routing)) {
    const cfg = route ? config.providers[route.provider] : undefined;
    if (cfg && isUnconfined(cfg)) {
      warn(
        `${route!.provider} (${role}) cannot be confined to read-only: it may run commands, i.e. the reviewed code, in the review snapshot. Use it only on code you trust.`,
      );
    }
  }
  const mode: RunTarget['kind'] = req.command === 'review' ? 'diff' : 'files';

  // 1. What to review: refs (fresh remote base) and changed units ------------------------------------
  let target: RunTarget;
  let refsInfo: RefsInfo | undefined;
  if (mode === 'diff') {
    if (!repo) {
      throw new ReviewError('`review` must run inside a git repository (use `files` for plain folders).');
    }
    const refs = await phase('refs', 'Resolving branches', () =>
      resolveRefs({
        repo,
        base: req.base,
        head: req.head,
        ...(req.local
          ? {
              local: {
                mode: req.local,
                // Run reports quote code: never review them as new files.
                excludeUntracked: runsDirExclude(repoRoot, path.resolve(repoRoot, config.output.dir)),
              },
            }
          : {}),
        settings: config.git,
        offline: req.offline,
        signal: req.signal,
        warn,
      }).catch((err: unknown) => {
        if (isAbort(err, req.signal) || err instanceof NothingLocalError) throw err;
        throw new ReviewError(errorMessage(err));
      }),
    );
    // A local snapshot is not a commit of the user's: count the commits up to HEAD, its parent (none on
    // top of HEAD, where "0 commits" would only confuse).
    const tip = refs.local ? refs.local.parent : refs.headSha;
    const commits =
      refs.local && refs.info.baseSource === 'local'
        ? undefined
        : await repo.countCommits(`${refs.mergeBase}..${tip}`).catch(() => undefined);
    refsInfo = { ...refs.info, ...(typeof commits === 'number' ? { commits } : {}) };
    target = {
      kind: 'diff',
      base: refs.base,
      head: refs.head,
      baseSha: refs.baseSha,
      headSha: refs.headSha,
      mergeBase: refs.mergeBase,
      ...(refs.local ? { local: refs.local.mode } : {}),
    };
    emit({ type: 'refs', target, refs: refsInfo });
    if (refs.mergeBase === refs.headSha)
      warn(`${refs.head} has no commits on top of ${refs.base} — nothing to review.`);
  } else {
    target = {
      kind: 'files',
      paths: req.paths ?? [],
      headSha: repo ? await repo.headSha().catch(() => undefined) : undefined,
    };
  }
  throwIfAborted();

  const exclude = [...config.review.exclude, ...(config.project.ignore ?? [])];
  const { units, skipped } = await phase('collect', 'Collecting changes', async () => {
    if (target.kind === 'diff') {
      return collectDiffUnits(repo!, { from: target.mergeBase, to: target.headSha, exclude });
    }
    return collectFileUnits({ root: repoRoot, cwd: req.cwd, paths: req.paths ?? [], exclude, repo });
  });
  const unitByPath = new Map(units.map((u) => [u.path, u]));

  // A change to the review configuration itself must not steer its own review: every changed path
  // counts (excluded, binary and renamed files too), not only the reviewed units.
  const configTouched =
    target.kind === 'diff'
      ? touchedReviewConfig(await changedPaths(repo!, target.mergeBase, target.headSha))
      : [];
  if (configTouched.length) {
    warn(
      `This change modifies review configuration (${configTouched.join(', ')}); its project skills are ignored and rules are read from ${target.kind === 'diff' ? target.base : 'the base'}.`,
    );
  }
  // Through a symlink, a change to its target would steer the review without touching `.code-reviewer/`.
  const linkedConfig =
    target.kind === 'diff' && !configTouched.length ? await linkedReviewConfig(repoRoot) : undefined;
  if (linkedConfig) {
    warn(`${linkedConfig} is a symbolic link: project skills are ignored when reviewing a change.`);
  }
  const projectSkillsRoot = configTouched.length || linkedConfig ? undefined : repoRoot;

  // 2. In parallel: stack, static analysis, file graph, rules, skills, model availability -------------
  const availableProviders = detectProviders(config)
    .filter((s) => s.available)
    .map((s) => s.id);
  const listings = new Map<string, ModelListing>();

  const stackP: Promise<DetectedStack | undefined> = phase('stack', 'Detecting technologies', () =>
    detectStack(
      target.kind === 'diff'
        ? { root: repoRoot, repo, sha: target.headSha, signal: req.signal }
        : { root: repoRoot, repo, signal: req.signal },
    ),
  ).catch((err: unknown) => {
    if (isAbort(err, req.signal)) throw err;
    warn(`Stack detection failed: ${errorMessage(err)} — skills are selected without it.`);
    return undefined;
  });

  const skillsP: Promise<Skill[]> =
    config.review.skills === 'none' ? Promise.resolve([]) : loadSkills(projectSkillsRoot, warn);

  const analyzersP: Promise<AnalyzeResult> = phase('analyzers', 'Running static analyzers', async () =>
    runAnalyzers({
      // Structural checks come with the skills (ast-grep); a failed skill load leaves none.
      checks: (await skillsP.catch(() => [] as Skill[])).flatMap((s) => s.checks ?? []),
      files: analyzeFilesFrom(units, mode),
      settings: config.analyzers,
      mode,
      projectOptIn: req.projectAnalyzers,
      repoRoot,
      signal: req.signal,
    }),
  ).catch((err: unknown) => {
    if (isAbort(err, req.signal)) throw err;
    warn(`Static analysis failed: ${errorMessage(err)}`);
    return { hits: [], runs: [] };
  });

  const graphP: Promise<FileGraph | undefined> =
    config.review.chunking === 'smart' && units.length > 1
      ? (async () => {
          const allFiles =
            target.kind === 'diff'
              ? await listRevisionFiles(repo!, target.headSha)
              : repo
                ? await repo.listFiles(['.'])
                : units.map((u) => u.path);
          const readFile =
            target.kind === 'diff'
              ? revisionReader(repo!, target.headSha)
              : (rel: string) => workingTreeReader(repoRoot).read(rel);
          return buildFileGraph({
            units,
            allFiles,
            readFile,
            repo,
            headSha: target.headSha,
            ...(target.kind === 'diff' ? { baseSha: target.mergeBase } : {}),
            signal: req.signal,
          });
        })().catch((err: unknown) => {
          if (isAbort(err, req.signal)) throw err;
          warn(`Could not build the file graph: ${errorMessage(err)} — packing by directory.`);
          return undefined;
        })
      : Promise.resolve(undefined);

  const rulesP: Promise<ProjectRules & { origin?: string }> = config.review.projectRules
    ? (target.kind === 'diff'
        ? loadProjectRules(commitReader(repo!, target.baseSha, target.base), PROJECT_RULES_BUDGET).then(
            (r) => ({ ...r, origin: target.kind === 'diff' ? target.base : undefined }),
          )
        : loadProjectRules(repoRoot, PROJECT_RULES_BUDGET)
      ).catch((err: unknown) => {
        warn(`Could not read project rules: ${errorMessage(err)}`);
        return { text: '', sources: [], tokens: 0 };
      })
    : Promise.resolve({ text: '', sources: [], tokens: 0 });

  const preflightP =
    req.dryRun || req.skipPreflight
      ? Promise.resolve(undefined)
      : preflightModels({
          config,
          routes: {
            review: { provider: routing.review.provider, model: routing.review.model },
            ...(routing.critique
              ? { critique: { provider: routing.critique.provider, model: routing.critique.model } }
              : {}),
          },
          availableProviders,
          logger,
          cwd: repoRoot,
          signal: req.signal,
          host: req.host,
          listings,
        });

  const [stack, analysis, graph, rules, skills] = await Promise.all([
    stackP,
    analyzersP,
    graphP,
    rulesP,
    skillsP,
  ]);
  if (stack) emit({ type: 'stack', stack });
  emit({ type: 'analyzers', runs: analysis.runs, hits: analysis.hits.length });
  for (const note of stack?.notes ?? []) logger.debug(`stack: ${note}`);
  throwIfAborted();

  // 3. Chunking ------------------------------------------------------------------------------------------
  const reviewRole = config.roles.review;
  // Configured, else what the catalog knows about the review model (Sonnet 5 / Opus 5.5: 1M), else 200k.
  const reviewProvider = config.providers[routing.review.provider];
  const contextWindow =
    reviewRole?.contextWindow ??
    (reviewProvider && routing.review.model
      ? findCatalogModel(reviewProvider, routing.review.model)?.contextWindow
      : undefined) ??
    DEFAULT_CONTEXT_WINDOW;
  const outputReserve = reviewRole?.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE;
  const depth = config.review.depth;
  /** Skills of this depth (essential: essential tier, `[full]` bullets removed). */
  const depthSkills = skillsForDepth(skills, depth);
  const instructionsBase = reviewInstructions({
    mode,
    depth,
    rules: rules.text,
    skills: [],
    project: config.project,
  });
  const overhead =
    estimateTokens(instructionsBase) +
    config.review.skillTokenBudget +
    config.analyzers.maxHintsPerChunk * TOKENS_PER_HINT +
    PROMPT_OVERHEAD;
  const promptRoom = contextWindow - outputReserve - overhead;
  const budget = Math.max(2_000, Math.min(config.review.maxChunkTokens, promptRoom));

  const { chunks, mentions, baseChunks } = await phase(
    'chunking',
    'Grouping related files into chunks',
    async () => {
      const result = buildChunks(units, {
        budget,
        fullFileTokens: config.review.fullFileTokens,
        contextLines: config.review.contextLines,
        graph,
        strategy: graph ? 'smart' : 'directory',
        contextShare: config.review.contextShare,
        maxTotalTokens: Math.max(budget, promptRoom),
      });
      const baseChunks = result.chunks.length;
      result.chunks = withPasses(result.chunks, config.review.passes);
      // The contracts pass always gets the changed declarations and their users' code (`refs` unless
      // `deep`); other passes per `expand`, the local pass none.
      const configured = config.review.expand;
      const levelOf = (c: Chunk): Exclude<ExpandLevel, 'off'> | undefined =>
        c.pass === 'local'
          ? undefined
          : c.pass === 'contracts'
            ? configured === 'deep'
              ? 'deep'
              : 'refs'
            : configured === 'off'
              ? undefined
              : configured;
      for (const level of ['map', 'refs', 'deep'] as const) {
        const toExpand = result.chunks.filter((c) => levelOf(c) === level);
        if (!toExpand.length || target.kind !== 'diff' || !repo) continue;
        const share = EXPAND_SHARE[level];
        const stats = await expandChunks(toExpand, units, revisionSource(repo, target.headSha), {
          level,
          changed: new Set(units.flatMap((u) => (u.oldPath ? [u.path, u.oldPath] : [u.path]))),
          maxTokens: (c) => Math.max(0, Math.min(Math.floor(budget * share), promptRoom - c.tokens)),
          signal: req.signal,
        }).catch((err: unknown) => {
          if (isAbort(err, req.signal)) throw err;
          warn(`Could not add related unchanged code: ${errorMessage(err)}`);
          return undefined;
        });
        if (stats) {
          logger.debug(
            `expand (${level}): ${stats.symbols} changed declaration(s), ${stats.impact} impact line(s), ${stats.files} related excerpt(s), ${stats.tokens} tokens${stats.tooCommon.length ? `; too common: ${stats.tooCommon.join(', ')}` : ''}`,
          );
        }
      }
      // The audit lists the changed functions: computed here when expand did not already.
      if (config.review.audit) {
        const unitOf = new Map(units.map((u) => [u.path, u]));
        for (const c of result.chunks) {
          if (c.declarations) continue;
          const symbols = c.files.flatMap((f) => {
            const u = unitOf.get(f);
            return u ? changedSymbols(u) : [];
          });
          if (symbols.length) c.declarations = symbols.map(({ name, file, kind }) => ({ name, file, kind }));
        }
      }
      return { ...result, baseChunks };
    },
  );
  if (baseChunks > config.review.maxChunks) {
    warn(
      `${baseChunks} chunks exceed review.maxChunks=${config.review.maxChunks}; consider narrowing the review.`,
    );
  }

  // Per chunk: skills (stack-aware, hint-aware), static hints, timeout.
  const chunkSkills = new Map<string, SkillMatch[]>();
  /** Skills that matched a chunk but did not fit the skill budget. */
  const chunkSkillsDropped = new Map<string, string[]>();
  const chunkHints = new Map<string, StaticHit[]>();
  const chunkStack = new Map<string, string>();
  /**
   * Secrets / vulnerable dependencies (shown to the model or beyond the hint cap) with the model findings
   * that claimed them: each one is reported unless a claiming finding survives validation.
   */
  const mustReport = new Map<string, { hit: StaticHit; chunkId: string; claimedBy: Set<string> }>();
  for (const chunk of chunks) {
    const owned = chunk.files.map((f) => unitByPath.get(f)).filter((u): u is ReviewUnit => u !== undefined);
    const { shown: hints, overflow } = hintsForChunk(analysis.hits, chunk, config.analyzers.maxHintsPerChunk);
    chunkHints.set(chunk.id, hints);
    for (const h of [...hints, ...overflow]) {
      if (h.nonRejectable && !mustReport.has(h.id))
        mustReport.set(h.id, { hit: h, chunkId: chunk.id, claimedBy: new Set() });
    }
    const techs = techsForChunk(stack, chunk.files);
    const techVersions = techVersionsForChunk(stack, chunk.files, techs);
    const stackLine = chunkStackLine(techs, techVersions);
    if (stackLine) chunkStack.set(chunk.id, stackLine);
    const dropped: SkillMatch[] = [];
    const matches = selectSkills(
      // An explicit skill list is honoured as given; auto selection only sees the depth's skills.
      Array.isArray(config.review.skills) ? skills : depthSkills,
      {
        files: chunk.files,
        languages: [...new Set(owned.map((u) => u.language))],
        techs,
        techVersions,
        code: signalText(rawCodeOf(owned)),
        fileCode: signalText(fileCodeOf(owned)),
        ...(mode === 'diff' ? { addedCode: signalText(addedCodeOf(owned)) } : {}),
        perFile: perFileSignals(owned, mode),
      },
      config.review.skills,
      config.review.skillTokenBudget,
      config.review.skillsExclude,
      dropped,
    );
    // Skills tied to the analyzer rules that fired here, when the budget still allows.
    if (config.review.skills === 'auto' && hints.length) {
      let used = matches.reduce((n, m) => n + m.skill.tokens, 0);
      const have = new Set(matches.map((m) => m.skill.id));
      for (const id of skillsForHits(hints)) {
        const skill = depthSkills.find((s) => s.id === id);
        if (!skill || have.has(id) || config.review.skillsExclude.includes(id)) continue;
        if (used + skill.tokens > config.review.skillTokenBudget) continue;
        matches.push({ skill, score: 0, reasons: ['static-hint'] });
        have.add(id);
        used += skill.tokens;
      }
    }
    chunkSkills.set(chunk.id, matches);
    const picked = new Set(matches.map((m) => m.skill.id));
    const over = dropped.map((m) => m.skill.id).filter((id) => !picked.has(id));
    if (over.length) chunkSkillsDropped.set(chunk.id, over);
  }

  const plan: ReviewPlan = {
    target,
    root: repoRoot,
    depth,
    minSeverity: config.review.minSeverity,
    ...(refsInfo ? { refs: refsInfo } : {}),
    units: units.length,
    skipped: skipped as SkippedFile[],
    deleted: mentions,
    budget,
    chunks: chunks.map((c) => ({
      id: c.id,
      files: c.files,
      contextFiles: c.contextFiles ?? [],
      ...(c.related?.length ? { related: c.related } : {}),
      ...(c.impact?.length ? { impact: c.impact } : {}),
      tokens: c.tokens,
      skills: (chunkSkills.get(c.id) ?? []).map((m) => ({ id: m.skill.id, reasons: m.reasons })),
      ...(chunkSkillsDropped.has(c.id) ? { skillsDropped: chunkSkillsDropped.get(c.id)! } : {}),
      groupReasons: c.groupReasons ?? [],
      hints: chunkHints.get(c.id)?.length ?? 0,
      timeoutMs: taskTimeoutMs(config.review, c.tokens),
    })),
    totalTokens: chunks.reduce((s, c) => s + c.tokens, 0),
    projectRules: rules.sources,
    routing,
    ...(stack ? { stack } : {}),
    analyzers: analysis.runs,
    skills: [...new Set([...chunkSkills.values()].flat().map((m) => m.skill.id))].sort(),
  };
  const instructionTokens = estimateTokens(instructionsBase) + PROMPT_OVERHEAD;
  const promptTokens = chunks.reduce(
    (n, c) =>
      n +
      c.tokens +
      instructionTokens +
      (chunkSkills.get(c.id) ?? []).reduce((k, m) => k + m.skill.tokens, 0) +
      (chunkHints.get(c.id)?.length ?? 0) * TOKENS_PER_HINT,
    0,
  );
  if (chunks.length) {
    const estimate = costOf(
      {
        provider: routing.review.provider,
        model: routing.review.model,
        usage: { inputTokens: promptTokens, outputTokens: 0, requests: chunks.length },
      },
      config.pricing,
    );
    plan.estimate = {
      inputTokens: promptTokens,
      ...(estimate ? { cost: { amount: estimate.amount, currency: estimate.currency } } : {}),
    };
  }
  emit({ type: 'plan', plan });
  if (req.dryRun) {
    await preflightP;
    return { plan, reports: [] };
  }

  // 4. Models: availability check (started in parallel above) -------------------------------------------
  const preflight = await preflightP;
  const routes: Partial<Record<Role, RoleRouting>> = {
    review: routing.review,
    ...(routing.critique ? { critique: routing.critique } : {}),
  };
  if (preflight) {
    const unresolved = preflight.unresolved[0];
    if (unresolved) throw new ReviewError(formatUnavailable(unresolved));
    for (const [role, ref] of Object.entries(preflight.routes) as Array<
      [Role, { provider: string; model?: string }]
    >) {
      const current = routes[role];
      if (current && (current.provider !== ref.provider || current.model !== ref.model)) {
        routes[role] = { provider: ref.provider, model: ref.model, reasoning: current.reasoning };
      }
    }
    for (const f of preflight.fallbacks) emit({ type: 'fallback', ...f });
  }
  throwIfAborted();

  // 5. Run ----------------------------------------------------------------------------------------------
  const store = new RunStore(path.resolve(repoRoot, config.output.dir));
  const startedAt = Date.now();
  const run: RunRecord = {
    schemaVersion: 1,
    id: newRunId(),
    command: req.command,
    status: 'running',
    createdAt: new Date(startedAt).toISOString(),
    repo: { root: repoRoot },
    target,
    options: {
      depth,
      selfCritique: config.review.selfCritique,
      minConfidence: config.review.minConfidence,
      minSeverity: config.review.minSeverity,
      skills: Array.isArray(config.review.skills) ? config.review.skills.join(',') : config.review.skills,
      tools: config.review.tools,
      authors: config.review.authors,
      maxChunkTokens: budget,
      concurrency: config.review.concurrency,
    },
    routing: { ...routes },
    fallbacks: [...(preflight?.fallbacks ?? [])],
    ...(refsInfo ? { refs: refsInfo } : {}),
    ...(stack
      ? {
          stack: stack.techs
            .filter((t) => t.score >= 0.6)
            .map(({ id, name, category, score }) => ({ id, name, category, score })),
        }
      : {}),
    analyzers: analysis.runs,
    skillsUsed: plan.skills,
    toolUsage: {},
    chunks: chunks.map((c) => ({
      id: c.id,
      files: c.files,
      contextFiles: c.contextFiles ?? [],
      ...(c.related?.length ? { related: c.related } : {}),
      ...(c.impact?.length ? { impact: c.impact } : {}),
      tokens: c.tokens,
      skills: (chunkSkills.get(c.id) ?? []).map((m) => m.skill.id),
      skillReasons: Object.fromEntries((chunkSkills.get(c.id) ?? []).map((m) => [m.skill.id, m.reasons])),
      ...(chunkSkillsDropped.has(c.id) ? { skillsDropped: chunkSkillsDropped.get(c.id)! } : {}),
      status: 'pending',
      findings: 0,
      hints: chunkHints.get(c.id)?.length ?? 0,
      timeoutMs: taskTimeoutMs(config.review, c.tokens),
    })),
    findings: [],
    rejected: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    warnings,
  };
  if (repo) {
    const remoteUrl = await repo.remoteUrl();
    const remote = parseRemote(remoteUrl);
    run.repo = { root: repoRoot, remote: remote?.webUrl ?? remoteUrl, platform: remote?.platform };
  }

  let saveChain: Promise<unknown> = store.save(run);
  const persist = () => {
    saveChain = saveChain.then(() => store.save(run)).catch(() => undefined);
    return saveChain;
  };

  const registry = req.providers ?? new ProviderRegistry(config, logger);
  const statusExclude = runsDirExclude(repoRoot, store.dir);
  // Only feeds a warning at the end: never let it abort the run (the run record is already saved).
  const statusBefore = repo ? await repo.statusPorcelain(statusExclude).catch(() => undefined) : undefined;
  let snapshot: ReviewRoot | undefined;
  let reports: string[] = [];
  /** Findings reported by the models plus static candidates. */
  const collected: Finding[] = [];
  /** How every reviewed part ended, for the coverage map. */
  const partResults: PartResult[] = [];
  /** Static hints the reviewing model saw and did not confirm (kept for auditing). */
  const hintRejected: Finding[] = [];
  const costBudget =
    config.review.maxCost === undefined
      ? undefined
      : new CostBudget(config.review.maxCost, config.pricing, {
          critiqueReserve: routes.critique ? CRITIQUE_RESERVE : 0,
          onUnpriced: (route) =>
            warn(
              `review.maxCost: the cost of ${route} is unknown (no price in \`pricing\`), so its calls do not count toward the limit.`,
            ),
        });
  const router = new ModelRouter(routes, {
    config,
    availableProviders,
    listings: preflight?.listings ?? listings,
    host: req.host,
    logger,
    signal: req.signal,
    emit,
    ...(costBudget ? { budget: costBudget } : {}),
  });
  const meter = new CostMeter(config.pricing);
  const chunkRecords = new Map(run.chunks.map((c) => [c.id, c]));
  let cache: ResultCache | undefined;
  let cacheUse: CacheUse | undefined;
  const currentRoute = (role: Role): CacheRoute => {
    const r = router.route(role);
    return { provider: r.provider, model: r.model, reasoning: r.reasoning };
  };

  try {
    // Agents read code from a detached, sanitized worktree: they never see (or touch) the user's
    // uncommitted work and never load the reviewed revision's agent instructions (CLAUDE.md, .claude/…).
    const usesAgents = Object.values(routes).some((r) => r && config.providers[r.provider]?.type === 'acp');
    const mayFallBack = config.models.onUnavailable !== 'fail' && config.models.allowCrossProvider;
    const isolate = config.review.isolation === 'always' || usesAgents || mayFallBack;
    let root = repoRoot;
    // Files mode reviews the working tree: the reviewed files are written over the snapshot of HEAD
    // (agent instruction / config files excepted) — or make up the whole review root when there is no
    // commit to check out (plain folder, repository without commits).
    const overlay: RootFile[] | undefined =
      target.kind === 'files'
        ? units.flatMap((u) => (u.content === undefined ? [] : [{ path: u.path, content: u.content }]))
        : undefined;
    const sha = target.headSha;
    if (chunks.length > 0 && repo && sha) {
      snapshot = await phase('snapshot', 'Preparing an isolated snapshot', async () => {
        await pruneStaleSnapshots(repo).catch(() => []);
        return createSnapshot(repo, sha, {
          forceIsolated: isolate || target.kind === 'files',
          overlay,
          onForcedExit: req.onForcedExit,
        });
      });
    } else if (chunks.length > 0 && overlay && isolate) {
      // API providers without a fallback read in place: their tools are read-only and confined to it.
      snapshot = await phase('snapshot', 'Preparing an isolated review root', () =>
        createFilesSnapshot(overlay, { onForcedExit: req.onForcedExit }),
      );
    }
    if (snapshot) {
      root = snapshot.root;
      if (snapshot.sanitized.length) {
        logger.debug(`snapshot: removed agent instruction files ${snapshot.sanitized.join(', ')}`);
      }
    }
    const git = repo !== undefined;
    // Installed dependencies of the user's checkout and caches (read-only, real paths checked per read).
    const dependencies =
      config.review.tools && config.review.dependencySources && repo ? dependencyRoots(repoRoot) : [];
    if (dependencies.length) {
      logger.debug(`dependency sources: ${dependencies.map((d) => `${d.label} ${d.dir}`).join('; ')}`);
    }

    // Answers for code (and every file the model read) reviewed before with the same instructions and model.
    const opened = chunks.length ? await openResultCache({ config, repoRoot, warn, logger }) : undefined;
    if (opened) {
      cache = opened.cache;
      cacheUse = {
        dir: opened.location.dir,
        hits: 0,
        misses: 0,
        critiqueHits: 0,
        critiqueMisses: 0,
        saved: { inputTokens: 0, outputTokens: 0 },
      };
    }

    // 6. Review chunks (largest first) ----------------------------------------------------------------
    await phase('review', `Reviewing ${chunks.length} chunk(s)`, async () => {
      const limit = pLimit(config.review.concurrency);
      const allFiles = units.filter((u) => u.status !== 'deleted').map((u) => u.path);
      const byId = new Map(chunks.map((c) => [c.id, c]));

      const instructionsFor = (chunk: Chunk) =>
        reviewInstructions({
          mode,
          depth,
          ...(chunk.pass ? { pass: chunk.pass } : {}),
          rules: rules.text,
          rulesOrigin: rules.origin,
          skills: chunkSkills.get(chunk.id) ?? [],
          project: config.project,
          readTools: config.review.tools,
          ...(dependencies.length ? { dependencies } : {}),
          ...(config.review.audit ? { audit: true } : {}),
        });
      const promptOptions = (chunk: Chunk, part: Chunk, hints: StaticHit[]) => ({
        target,
        chunk: part,
        totalChunks: chunks.length,
        otherFiles: allFiles,
        hints,
        stack: chunkStack.get(chunk.id),
        ...(config.review.audit ? { audit: true } : {}),
      });
      const buildTask = (
        chunk: Chunk,
        part: Chunk,
        hints: StaticHit[],
        limits: { timeoutMs: number; maxSteps: number },
      ): AgentTask => ({
        kind: 'findings',
        label: part.id,
        instructions: instructionsFor(chunk),
        prompt: reviewPrompt(promptOptions(chunk, part, hints)),
        reasoning: 'medium',
        readTools: config.review.tools,
        root,
        git,
        ...(dependencies.length ? { dependencyRoots: dependencies.map((d) => d.dir) } : {}),
        maxSteps: limits.maxSteps,
        timeoutMs: limits.timeoutMs,
        extendMs: Math.round(limits.timeoutMs * config.review.activeExtension),
        stallTimeoutMs: config.review.stallTimeoutMs,
        maxOutputTokens: reviewRole?.maxOutputTokens,
        signal: req.signal,
        onActivity: (a) => {
          if (a.kind === 'tool') emit({ type: 'chunk-activity', chunkId: chunk.id, tool: a.name });
        },
      });
      /** Result cache key of a task on a route (see `reviewPromptIdentity` for what counts). */
      const cacheKeyFor = (
        task: AgentTask,
        chunk: Chunk,
        part: Chunk,
        hints: StaticHit[],
        route: CacheRoute,
      ) =>
        reviewCacheKey({
          route,
          instructions: task.instructions,
          prompt: reviewPromptIdentity(promptOptions(chunk, part, hints)),
          readTools: task.readTools,
          git: task.git,
          maxOutputTokens: task.maxOutputTokens,
        });

      /** Findings of a chunk from reported items; claims of the hints they confirm. */
      const toChunkFindings = (
        items: ReportedFinding[],
        chunk: Chunk,
        hints: StaticHit[],
        provider: string,
        model: string | undefined,
      ) => {
        const hintById = new Map(hints.map((h) => [h.id, h]));
        const claimed = new Set<string>();
        const findings = items.map((r) => {
          const f = toFinding(r, {
            root,
            chunkId: chunk.id,
            provider,
            model,
            skills: chunkRecords.get(chunk.id)!.skills,
            files: allFiles,
          });
          f.origin = 'llm';
          const hint = r.hint ? hintById.get(r.hint) : undefined;
          // A claim counts only when the finding points at the hint's code.
          if (hint && claimsHint(f, hint)) {
            claimed.add(hint.id);
            f.tool = { analyzer: hint.analyzer, ruleId: hint.ruleId };
            if (hint.nonRejectable) {
              f.nonRejectable = true;
              mustReport.get(hint.id)?.claimedBy.add(f.id);
            }
          }
          return f;
        });
        return { findings, claimed };
      };

      /** One review task for a chunk (or a split part of one); throws with the usage it spent. */
      const reviewOnce = async (
        chunk: Chunk,
        part: Chunk,
        hints: StaticHit[],
        task: AgentTask,
      ): Promise<DoneOutcome> => {
        const result = await runRouted('review', task, router, registry);
        const spend: Spend[] = [...result.spend];
        let resolved = resolveFindings(result);
        let replyText = result.text;
        if (resolved.via === 'none' && result.text.trim()) {
          try {
            const repaired = await runRouted(
              'review',
              {
                ...task,
                label: `${part.id}-repair`,
                prompt: repairPrompt(result.text, part.files),
                readTools: false,
                maxSteps: 3,
                salvage: false,
              },
              router,
              registry,
            );
            spend.push(...repaired.spend);
            resolved = resolveFindings(repaired);
            replyText = `${result.text}\n\n--- repair ---\n${repaired.text}`;
          } catch (err) {
            throw attachSpend(err, [...spend, ...spendOf(err)]);
          }
        }
        // Neither the submit tool nor JSON in the reply (not even after the repair turn): the code was not
        // reviewed — a failed chunk, never a clean one.
        if (resolved.via === 'none') {
          throw attachSpend(new NoPayloadError('the model returned no findings payload', replyText), spend);
        }
        if (resolved.invalid) warn(`${part.id}: ${resolved.invalid} malformed finding(s) ignored`);
        for (const w of result.warnings) warn(`${part.id}: ${w}`);

        const { findings, claimed } = toChunkFindings(
          resolved.items,
          chunk,
          hints,
          result.provider,
          result.model,
        );
        await store.saveArtifact(run.id, part.id, {
          chunk: {
            id: part.id,
            files: part.files,
            contextFiles: part.contextFiles ?? [],
            ...(part.related?.length ? { related: part.related } : {}),
            tokens: part.tokens,
            skills: chunkRecords.get(chunk.id)!.skills,
          },
          provider: result.provider,
          model: result.model,
          stopReason: result.stopReason,
          toolCalls: result.toolCalls,
          toolUsage: result.toolUsage,
          ...(result.submission.toolLog?.length ? { toolLog: result.submission.toolLog } : {}),
          via: resolved.via,
          hints: hints.map((h) => h.id),
          claimedHints: [...claimed],
          reads: result.reads ?? [],
          instructions: task.instructions,
          prompt: task.prompt,
          reply: replyText,
          submission: result.submission,
          warnings: result.warnings,
        });
        return {
          kind: 'done',
          id: part.id,
          files: part.files,
          hints,
          spend,
          findings,
          claimed,
          items: resolved.items,
          reads: result.reads ?? [],
          provider: result.provider,
          ...(result.model ? { model: result.model } : {}),
          attempts: result.attempts,
          ...(result.toolUsage ? { toolUsage: result.toolUsage } : {}),
          ...(result.salvaged ? { salvaged: result.salvaged } : {}),
          ...(result.submission.audit?.length
            ? { audited: new Set(result.submission.audit.map((a) => a.name)).size }
            : {}),
        };
      };

      /** Remembers a complete answer (an early, salvaged one is partial: never cached). */
      const remember = async (out: DoneOutcome, task: AgentTask, chunk: Chunk, part: Chunk) => {
        if (!cache || out.salvaged || out.cached) return;
        const reads = await hashReads(root, out.reads ?? []);
        if (!reads) return;
        // The route the task ran on (after any fallback): what the next run looks up.
        const route = currentRoute('review');
        const usage = sumUsage(out.spend.map((x) => x.usage));
        const identities = new Map(out.hints.map((h) => [h.id, hintIdentity(h)]));
        await cache.set('review', cacheKeyFor(task, chunk, part, out.hints, route), {
          kind: 'result',
          items: mapHints(out.items ?? [], identities),
          provider: out.provider,
          ...(out.model ? { model: out.model } : {}),
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
          reads,
        } satisfies CachedReview);
      };

      /** A cached answer as a reviewed part: no model call, no usage. */
      const fromCache = async (
        entry: Extract<CachedReview, { kind: 'result' }>,
        chunk: Chunk,
        part: Chunk,
        hints: StaticHit[],
      ): Promise<DoneOutcome> => {
        const ids = new Map(hints.map((h) => [hintIdentity(h), h.id]));
        const items = mapHints(entry.items, ids);
        const { findings, claimed } = toChunkFindings(items, chunk, hints, entry.provider, entry.model);
        await store.saveArtifact(run.id, part.id, {
          chunk: { id: part.id, files: part.files, tokens: part.tokens },
          cached: true,
          provider: entry.provider,
          model: entry.model,
          hints: hints.map((h) => h.id),
          claimedHints: [...claimed],
          items,
        });
        return {
          kind: 'done',
          id: part.id,
          files: part.files,
          hints,
          spend: [],
          findings,
          claimed,
          provider: entry.provider,
          ...(entry.model ? { model: entry.model } : {}),
          attempts: 0,
          cached: { saved: entry.usage },
        };
      };

      const reviewHalves = async (
        chunk: Chunk,
        halves: [Chunk, Chunk],
        hints: StaticHit[],
        limits: { timeoutMs: number; maxSteps: number },
        level: number,
        notes: string[],
      ): Promise<PartOutcome[]> => {
        const out: PartOutcome[] = [];
        for (const half of halves) {
          const own = new Set(half.files);
          const halfLimits = { ...limits, timeoutMs: taskTimeoutMs(config.review, half.tokens) };
          const halfHints = hints.filter((h) => own.has(h.file));
          out.push(...(await reviewWithRecovery(chunk, half, halfHints, halfLimits, level + 1, notes)));
        }
        return out;
      };

      /**
       * Reviews a chunk: from the result cache when the same code (and every file the model read) was
       * reviewed before with the same instructions and model; otherwise by the model, recovering from
       * failures a smaller or longer task can fix: a chunk that ran out of time, steps, output or context is
       * split in two (twice at most; remembered for the next run), a single part that timed out gets one
       * retry with twice the time, a stalled agent one fresh retry.
       */
      const reviewWithRecovery = async (
        chunk: Chunk,
        part: Chunk,
        hints: StaticHit[],
        limits: { timeoutMs: number; maxSteps: number },
        level: number,
        notes: string[],
        retried = false,
      ): Promise<PartOutcome[]> => {
        const task = buildTask(chunk, part, hints, limits);
        const key = cache ? cacheKeyFor(task, chunk, part, hints, currentRoute('review')) : undefined;
        if (key && !retried) {
          const entry = await getReview(cache!, key, root);
          if (entry?.kind === 'result') {
            cacheUse!.hits++;
            cacheUse!.saved.inputTokens += entry.usage?.inputTokens ?? 0;
            cacheUse!.saved.outputTokens += entry.usage?.outputTokens ?? 0;
            return [await fromCache(entry, chunk, part, hints)];
          }
          const halves = entry?.kind === 'split' && level < MAX_SPLIT_LEVEL ? splitChunk(part) : undefined;
          if (halves) {
            notes.push(
              `${part.id}: split into ${halves.map((h) => h.id).join(' + ')} (as in an earlier run)`,
            );
            return reviewHalves(chunk, halves, hints, limits, level, notes);
          }
          cacheUse!.misses++;
        }
        try {
          const out = await reviewOnce(chunk, part, hints, task);
          await remember(out, task, chunk, part);
          return [out];
        } catch (err) {
          const failure = failureKindOf(err, req.signal);
          const failed: PartOutcome = {
            kind: 'failed',
            id: part.id,
            files: part.files,
            hints,
            spend: spendOf(err),
            err,
            failure,
          };
          if (failure === 'aborted' || router.fatal || req.signal?.aborted) return [failed];
          // What went wrong, for `runs` debugging (the reply of a model that handed nothing in).
          await store
            .saveArtifact(run.id, `${part.id}-failed${retried ? '-retry' : ''}`, {
              chunk: { id: part.id, files: part.files, tokens: part.tokens },
              failure,
              error: errorMessage(err),
              ...(err instanceof NoPayloadError ? { reply: err.reply } : {}),
              instructions: task.instructions,
              prompt: task.prompt,
            })
            .catch(() => undefined);
          // Failed attempts are not free: their usage stays in the record.
          const spent: PartOutcome = { kind: 'spent', id: part.id, files: part.files, spend: failed.spend };
          const halves = level < MAX_SPLIT_LEVEL && SPLITTABLE.has(failure) ? splitChunk(part) : undefined;
          if (halves) {
            notes.push(`${part.id}: ${failure} — split into ${halves.map((h) => h.id).join(' + ')}`);
            emit({ type: 'chunk-activity', chunkId: chunk.id, note: `${failure}: splitting` });
            if (key) await cache!.set('review', key, { kind: 'split' } satisfies CachedReview);
            return [spent, ...(await reviewHalves(chunk, halves, hints, limits, level, notes))];
          }
          const longer = Math.min(config.review.maxTimeoutMs, limits.timeoutMs * 2);
          const retry = retried
            ? undefined
            : failure === 'stalled'
              ? limits
              : failure === 'timeout' && longer > limits.timeoutMs
                ? { ...limits, timeoutMs: longer }
                : undefined;
          if (!retry) return [failed];
          const more =
            retry.timeoutMs > limits.timeoutMs ? ` with ${Math.round(retry.timeoutMs / 1000)}s` : '';
          notes.push(`${part.id}: ${failure} — retried${more}`);
          emit({ type: 'chunk-activity', chunkId: chunk.id, note: `${failure}: retrying` });
          return [spent, ...(await reviewWithRecovery(chunk, part, hints, retry, level, notes, true))];
        }
      };

      await Promise.all(
        scheduleOrder(chunks).map((id) =>
          limit(async () => {
            const chunk = byId.get(id)!;
            const rec = chunkRecords.get(chunk.id)!;
            if (req.signal?.aborted || router.fatal) {
              Object.assign(rec, {
                status: 'failed',
                failure: router.fatal ? failureKindOf(router.fatal) : 'aborted',
                error: router.fatal ? errorMessage(router.fatal) : 'aborted',
              });
              return;
            }
            const hints = chunkHints.get(chunk.id) ?? [];
            rec.status = 'running';
            emit({ type: 'chunk-start', chunk, record: rec });
            const started = Date.now();
            const notes: string[] = [];
            const outcomes = await reviewWithRecovery(
              chunk,
              chunk,
              hints,
              {
                timeoutMs: rec.timeoutMs ?? taskTimeoutMs(config.review, chunk.tokens),
                maxSteps: config.review.maxSteps,
              },
              0,
              notes,
            );

            const spend = outcomes.flatMap((o) => o.spend);
            const usage = sumUsage(spend.map((s) => s.usage));
            const cost = meter.add(spend);
            run.usage = sumUsage([run.usage, usage]);
            const done = outcomes.filter((o): o is DoneOutcome => o.kind === 'done');
            const failed = outcomes.filter((o): o is PartOutcome & { kind: 'failed' } => o.kind === 'failed');
            const toolCalls: Record<string, number> = {};
            for (const d of done) {
              collected.push(...d.findings);
              addCounts(toolCalls, d.toolUsage);
              if (d.salvaged) notes.push(`${d.id}: ${d.salvaged} — early answer`);
              // Hints the model saw but did not confirm: it acted as the false-positive filter — except
              // for secrets / vulnerable dependencies, which `mustReport` reports unless a claim survives.
              for (const h of d.hints) {
                if (d.claimed.has(h.id) || h.nonRejectable) continue;
                hintRejected.push({ ...staticFinding(h, chunk.id), droppedReason: 'hint-not-confirmed' });
              }
            }
            for (const f of failed) {
              if (f.failure !== 'aborted') {
                warn(`${f.id} failed (${f.failure}): ${errorMessage(f.err).split('\n')[0]}`);
              }
              // The model never answered: carry the strong hints as candidates for the critic (secrets and
              // vulnerable dependencies are reported through `mustReport`).
              for (const h of f.hints) {
                if (!h.nonRejectable && h.confidence >= STATIC_CANDIDATE_CONFIDENCE) {
                  collected.push(staticFinding(h, chunk.id));
                }
              }
            }
            addCounts(run.toolUsage!, toolCalls);
            for (const d of done) {
              partResults.push({
                files: d.files,
                kind: d.salvaged ? 'interrupted' : 'done',
                reads: d.reads ?? [],
              });
            }
            for (const f of failed) partResults.push({ files: f.files, kind: 'failed' });
            const last = done.at(-1);
            const fromCacheCount = done.filter((d) => d.cached).length;
            Object.assign(rec, {
              status: failed.length ? 'failed' : 'done',
              findings: done.reduce((n, d) => n + d.findings.length, 0),
              usage,
              ...(cost ? { cost } : {}),
              durationMs: Date.now() - started,
              toolCalls,
              ...(last ? { provider: last.provider, model: last.model } : {}),
              attempts: done.reduce((n, d) => n + d.attempts, 0) + outcomes.length - done.length,
              ...(notes.length ? { recovery: notes } : {}),
              ...(config.review.audit
                ? {
                    audit: {
                      listed: (chunk.declarations ?? []).filter((d) => d.kind !== 'removed').length,
                      audited: done.reduce((n, d) => n + (d.audited ?? 0), 0),
                    },
                  }
                : {}),
              ...(fromCacheCount
                ? { cached: fromCacheCount === outcomes.length ? ('all' as const) : ('partial' as const) }
                : {}),
            });
            if (failed.length) {
              const first = failed[0]!;
              rec.failure = first.failure;
              rec.error =
                first.failure === 'aborted'
                  ? 'aborted'
                  : failed.length > 1 || done.length
                    ? `${failed.length} of ${failed.length + done.length} parts failed: ${errorMessage(first.err)}`
                    : errorMessage(first.err);
            }
            emit({ type: 'chunk-done', chunk, record: rec });
            await persist();
          }),
        ),
      );
    });

    run.coverage = coverageMap(units, skipped, chunks, partResults);

    // 7. Validate + dedupe -------------------------------------------------------------------------
    const validated = await phase('validate', `Validating ${collected.length} raw finding(s)`, async () => {
      const first = validateFindings(collected, { root, units, mode });
      // Secrets / vulnerable dependencies: reported as static findings unless a claiming finding survived.
      const kept = new Set(first.kept.map((f) => f.id));
      const unreported = [...mustReport.values()]
        .filter((m) => ![...m.claimedBy].some((id) => kept.has(id)))
        .map((m) => staticFinding(m.hit, m.chunkId));
      if (unreported.length === 0) return first;
      const extra = validateFindings(unreported, { root, units, mode });
      return {
        ...first,
        kept: [...first.kept, ...extra.kept],
        dropped: [...first.dropped, ...extra.dropped],
      };
    });
    let checked = validated.kept;
    if (config.review.requireFailurePath) {
      const r = requireFailurePath(checked);
      checked = r.findings;
      if (r.lowered) logger.debug(`lowered ${r.lowered} finding(s) without a failure path`);
    }
    const { unique, merged } = dedupeFindings(checked);
    if (merged) logger.debug(`merged ${merged} duplicate finding(s)`);
    const rejected: Finding[] = [...validated.dropped, ...hintRejected];
    let final = unique;
    const aborted = () => req.signal?.aborted === true;

    /** Critic verdicts by finding: reused while the finding, its code and the files the critic read are unchanged. */
    const critiqueCache = (c: ResultCache, instructions: string): CritiqueCache => {
      const keyOf = (f: Finding, excerpt: string) =>
        critiqueCacheKey({
          route: currentRoute('critique'),
          instructions,
          finding: critiqueFindingIdentity(f),
          excerpt,
          readTools: config.review.tools,
        });
      return {
        get: (f, excerpt) => getVerdict(c, keyOf(f, excerpt), root),
        set: async (f, excerpt, verdict, reads) => {
          const hashed = await hashReads(root, reads);
          if (!hashed) return;
          const { id: _id, ...rest } = verdict;
          await c.set('critique', keyOf(f, excerpt), { ...rest, reads: hashed } satisfies CachedVerdict);
        },
      };
    };

    // 8. Self-critique ---------------------------------------------------------------------------------
    if (routes.critique && final.length > 0 && aborted()) {
      warn('Interrupted — self-critique skipped; findings are unverified.');
    } else if (routes.critique && final.length > 0) {
      const critique = routes.critique;
      await phase('critique', `Verifying ${final.length} finding(s)`, async () => {
        emit({ type: 'critique-start', findings: final.length, batches: Math.ceil(final.length / 8) });
        const outcome = await critiqueFindings(final, {
          provider: new RoutedProvider('critique', router, registry),
          model: critique.model,
          reasoning: critique.reasoning,
          mode,
          depth,
          root,
          git,
          readTools: config.review.tools,
          ...(dependencies.length ? { dependencies } : {}),
          maxSteps: config.review.maxSteps,
          timeoutMs: taskTimeoutMs(config.review, Math.max(8_000, Math.floor(budget / 2))),
          concurrency: config.review.concurrency,
          batchTokenBudget: Math.max(8_000, Math.floor(budget / 2)),
          signal: req.signal,
          onBatchDone: ({ batch, total }) => emit({ type: 'critique-progress', batch, total }),
          ...(cache ? { cache: critiqueCache(cache, critiqueInstructions(mode, depth, dependencies)) } : {}),
        });
        if (cacheUse) {
          cacheUse.critiqueHits += outcome.cachedVerdicts;
          cacheUse.critiqueMisses += final.length - outcome.cachedVerdicts;
        }
        final = outcome.kept;
        rejected.push(...outcome.rejected);
        meter.add(outcome.spend);
        run.usage = sumUsage([run.usage, ...outcome.spend.map((s) => s.usage)]);
        for (const w of outcome.warnings) warn(w);
      });
    }

    // 9. Confidence and severity thresholds (secrets / vulnerable deps are never dropped) ------------
    const min = config.review.minConfidence;
    const floor = SEVERITY_ORDER[config.review.minSeverity];
    const dropReason = (f: Finding): string | undefined =>
      f.nonRejectable
        ? undefined
        : f.confidence < min
          ? 'below-threshold'
          : SEVERITY_ORDER[f.severity] > floor
            ? 'below-severity'
            : undefined;
    for (const f of final) {
      const reason = dropReason(f);
      if (reason) rejected.push({ ...f, droppedReason: reason });
    }
    final = final.filter((f) => dropReason(f) === undefined);

    // 10. Authors ------------------------------------------------------------------------------------------
    if (config.review.authors && repo && final.length && !aborted()) {
      await phase('authors', 'Attributing authors (git blame)', async () => {
        const remote = parseRemote(await repo.remoteUrl());
        const attributed = await attributeFindings(final, {
          repo,
          sha: target.kind === 'diff' ? target.headSha : undefined,
          // A local snapshot exists on no forge: no links.
          linkSha: target.kind === 'diff' && target.local ? undefined : target.headSha,
          remote,
        });
        final = attributed.findings;
        for (const w of attributed.warnings) warn(w);
      });
    }

    final = fingerprintFindings(final, reviewRootReader(root));
    const advisoryBelow = config.review.advisoryConfidence;
    const isAdvisory = (f: Finding) =>
      !f.nonRejectable && (f.confidence < advisoryBelow || f.severity === 'info');
    run.findings = sortFindings(final.filter((f) => !isAdvisory(f)));
    const advisory = final.filter(isAdvisory);
    if (advisory.length) run.advisory = sortFindings(advisory);
    run.rejected = sortFindings(rejected);
    run.fallbacks = [...(preflight?.fallbacks ?? []), ...router.fallbacks];
    run.routing = { ...routes };
    const failed = run.chunks.filter((c) => c.status === 'failed').length;
    if (aborted()) warn('The run was interrupted before it finished.');
    const overBudget = run.chunks.filter((c) => c.failure === 'budget').length;
    if (costBudget && overBudget) {
      warn(
        `review.maxCost (${formatMoney({ ...costBudget.spent, amount: costBudget.max })}) was reached at ${formatMoney(costBudget.spent)}: ${overBudget} of ${run.chunks.length} chunk(s) were not reviewed.`,
      );
    }
    run.status = aborted()
      ? 'partial'
      : chunks.length > 0 && failed === chunks.length
        ? 'failed'
        : failed > 0
          ? 'partial'
          : 'completed';
  } catch (err) {
    run.status = isAbort(err, req.signal) ? 'partial' : 'failed';
    run.error = errorMessage(err);
    throw err;
  } finally {
    run.durationMs = Date.now() - startedAt;
    const cost = meter.summary();
    if (cost) run.cost = cost;
    if (cacheUse) run.cache = cacheUse;
    await cache
      ?.autoPrune({
        maxAgeMs: config.cache.maxAgeDays * 24 * 60 * 60 * 1000,
        maxBytes: config.cache.maxSizeMb * 1024 * 1024,
      })
      .catch(() => undefined);
    if (!req.providers) await registry.disposeAll();
    await snapshot?.dispose().catch(() => undefined);
    if (repo && statusBefore !== undefined) {
      const after = await repo.statusPorcelain(statusExclude).catch(() => statusBefore);
      if (after !== statusBefore)
        warn('The working tree changed while the review was running (check `git status`).');
    }
    await saveChain;
    const dir = await store.save(run);
    reports = await writeReports(run, config.output.formats, dir).catch(() => []);
    emit({ type: 'done', run });
    untap();
    await store.saveLog(run.id, runLog.text()).catch(() => undefined);
  }
  return { plan, run, runDir: store.runDir(run.id), reports };
}
