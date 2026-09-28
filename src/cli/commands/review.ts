import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as p from '@clack/prompts';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  type Config,
  type PartialConfig,
  REPORT_FORMATS,
  REVIEW_DEPTHS,
  type ReportFormat,
} from '../../config/schema';
import { type LocalChanges, NothingLocalError } from '../../git/local-changes';
import { detectProviders } from '../../providers/detect';
import { SEVERITY_ORDER } from '../../report/common';
import type { ReviewEvent } from '../../review/events';
import { runReview } from '../../review/pipeline';
import { EXPAND_LEVELS, REASONING_LEVELS, REVIEW_PASSES, SEVERITIES, type Severity } from '../../types';
import { EXIT, type GlobalOptions, loadCliConfig, makeLogger } from '../context';
import { installLifecycle } from '../lifecycle';
import { colorEnabled, createReviewUi, type ReviewUi, renderPlan } from '../ui';
import { addPublishTargetOptions, type PublishCliFlags, postRun } from './publish';

export interface ReviewFlags {
  depth?: string;
  essential?: boolean;
  full?: boolean;
  minSeverity?: string;
  base?: string;
  head?: string;
  /** --staged / --uncommitted: review changes not committed yet. */
  staged?: boolean;
  uncommitted?: boolean;
  provider?: string;
  model?: string;
  reasoning?: string;
  critiqueProvider?: string;
  critiqueModel?: string;
  critiqueReasoning?: string;
  selfCritique?: boolean;
  skills?: string;
  tools?: boolean;
  minConfidence?: string;
  authors?: boolean;
  format?: string;
  out?: string;
  maxChunkTokens?: string;
  maxCost?: string;
  concurrency?: string;
  timeout?: string;
  failOn?: string;
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  /** --offline / --no-fetch */
  offline?: boolean;
  fetch?: boolean;
  remote?: string;
  explainRefs?: boolean;
  /** Opt-in project analyzers (comma list), or false for --no-analyzers. */
  analyzers?: string | boolean;
  /** --no-cache */
  cache?: boolean;
  plain?: boolean;
  onUnavailable?: string;
  chunking?: string;
  expand?: string;
  passes?: string;
  /** Post the finished review to its pull / merge request (`--post`, with the publish target flags). */
  post?: boolean;
}

function parseEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${flag} must be one of: ${allowed.join(', ')} (got "${value}")`);
  }
  return value as T;
}

export function parseNumber(
  value: string | undefined,
  flag: string,
  opts: { min?: number; max?: number; int?: boolean } = {},
) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    (opts.int && !Number.isInteger(n)) ||
    (opts.min !== undefined && n < opts.min) ||
    (opts.max !== undefined && n > opts.max)
  ) {
    throw new Error(`${flag}: invalid value "${value}"`);
  }
  return n;
}

/** Translates non-role CLI flags into the highest-priority config layer. */
export function flagsToOverrides(f: ReviewFlags): PartialConfig {
  const review: NonNullable<PartialConfig['review']> = {};
  if (f.essential && f.full) throw new Error('Use either --essential or --full, not both.');
  const depth =
    parseEnum(f.depth, REVIEW_DEPTHS, '--depth') ?? (f.essential ? 'essential' : f.full ? 'full' : undefined);
  if (depth) review.depth = depth;
  const minSeverity = parseEnum(f.minSeverity, SEVERITIES, '--min-severity');
  if (minSeverity) review.minSeverity = minSeverity;
  if (f.selfCritique !== undefined) review.selfCritique = f.selfCritique;
  if (f.tools !== undefined) review.tools = f.tools;
  if (f.authors !== undefined) review.authors = f.authors;
  const minConfidence = parseNumber(f.minConfidence, '--min-confidence', { min: 0, max: 1 });
  if (minConfidence !== undefined) review.minConfidence = minConfidence;
  const maxChunkTokens = parseNumber(f.maxChunkTokens, '--max-chunk-tokens', { min: 1000, int: true });
  if (maxChunkTokens !== undefined) review.maxChunkTokens = maxChunkTokens;
  const maxCost = parseNumber(f.maxCost, '--max-cost', { min: 0.01 });
  if (maxCost !== undefined) review.maxCost = maxCost;
  const concurrency = parseNumber(f.concurrency, '--concurrency', { min: 1, max: 32, int: true });
  if (concurrency !== undefined) review.concurrency = concurrency;
  const timeout = parseNumber(f.timeout, '--timeout', { min: 10 });
  if (timeout !== undefined) review.timeout = timeout;
  if (f.skills) {
    review.skills =
      f.skills === 'auto' || f.skills === 'none'
        ? f.skills
        : f.skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
  }

  const out: PartialConfig = {};
  if (Object.keys(review).length) out.review = review;
  if (f.format) {
    const formats = f.format
      .split(',')
      .map((s) => parseEnum(s.trim(), REPORT_FORMATS, '--format')!) as ReportFormat[];
    out.output = { formats };
  }
  return out;
}

/**
 * Applies --provider/--model/--reasoning (and the critique variants) on top of the loaded config.
 * Switching the provider resets the model, since model ids are provider-specific.
 */
export function applyRoleFlags(config: Config, f: ReviewFlags): void {
  const reasoning = parseEnum(f.reasoning, REASONING_LEVELS, '--reasoning');
  const critiqueReasoning = parseEnum(f.critiqueReasoning, REASONING_LEVELS, '--critique-reasoning');
  const review = config.roles.review ?? { provider: f.provider ?? 'claude' };
  if (f.provider) Object.assign(review, { provider: f.provider, model: f.model });
  else if (f.model) review.model = f.model;
  if (reasoning) review.reasoning = reasoning;
  config.roles.review = review;

  // --provider switches the critic too, unless --critique-provider is given. `--model` is the review's:
  // without --critique-model the critic keeps the provider's critique model (see resolveRouting).
  const critiqueProvider = f.critiqueProvider ?? f.provider;
  if (critiqueProvider || f.critiqueModel || critiqueReasoning) {
    const critique = config.roles.critique ?? { provider: review.provider };
    if (critiqueProvider) {
      critique.provider = critiqueProvider;
      critique.model = f.critiqueModel;
    } else if (f.critiqueModel) critique.model = f.critiqueModel;
    if (critiqueReasoning) critique.reasoning = critiqueReasoning;
    config.roles.critique = critique;
  }
  for (const [role, rc] of Object.entries(config.roles)) {
    if (rc && !config.providers[rc.provider]) {
      throw new Error(
        `Unknown provider "${rc.provider}" for ${role}. Known: ${Object.keys(config.providers).join(', ')}`,
      );
    }
  }
}

/** In an interactive terminal with no config at all, ask which provider to use. */
async function interactiveDefaults(
  flags: ReviewFlags,
  hasConfig: boolean,
  available: ReturnType<typeof detectProviders>,
): Promise<void> {
  if (
    flags.yes ||
    flags.provider ||
    hasConfig ||
    flags.dryRun ||
    flags.json ||
    !process.stdin.isTTY ||
    !process.stderr.isTTY
  )
    return;
  const usable = available.filter((s) => s.available && s.type !== 'mock' && (!s.needsModel || flags.model));
  if (usable.length === 0) return;
  const io = { output: process.stderr };
  p.intro('code-reviewer', io);
  const provider = await p.select({
    ...io,
    message: 'Which provider should review the code?',
    options: usable.map((s) => ({
      value: s.id,
      label: s.label,
      hint: s.experimental ? 'experimental' : s.detail,
    })),
  });
  if (p.isCancel(provider)) throw new Error('Cancelled');
  flags.provider = provider;
  if (flags.selfCritique === undefined) {
    const critique = await p.confirm({
      ...io,
      message: 'Run a self-critique pass to filter false positives?',
      initialValue: true,
    });
    if (p.isCancel(critique)) throw new Error('Cancelled');
    flags.selfCritique = critique;
  }
  p.outro(pc.dim('Tip: `code-reviewer init` saves these choices.'));
}

/** Flags that map onto config sections other than roles (applied after loading). */
export function applyRunFlags(config: Config, f: ReviewFlags): void {
  if (f.remote) config.git.remote = f.remote;
  const onUnavailable = parseEnum(f.onUnavailable, ['ask', 'fallback', 'fail'] as const, '--on-unavailable');
  if (onUnavailable) config.models.onUnavailable = onUnavailable;
  const chunking = parseEnum(f.chunking, ['smart', 'directory'] as const, '--chunking');
  if (chunking) config.review.chunking = chunking;
  const expand = parseEnum(f.expand, EXPAND_LEVELS, '--expand');
  if (expand) config.review.expand = expand;
  if (f.passes) {
    const passes = [
      ...new Set(
        f.passes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    config.review.passes = passes.map((p) => parseEnum(p, REVIEW_PASSES, '--passes')!);
  }
  if (f.analyzers === false) {
    config.analyzers.builtin = false;
    config.analyzers.external = 'off';
  }
  if (f.cache === false) config.cache.enabled = false;
}

/** `--staged` / `--uncommitted`, checked against the flags they cannot be combined with. */
function localChangesFrom(f: ReviewFlags & PublishCliFlags): LocalChanges | undefined {
  if (f.staged && f.uncommitted) throw new Error('Pass either --staged or --uncommitted, not both.');
  const local = f.staged ? 'staged' : f.uncommitted ? 'uncommitted' : undefined;
  if (!local) return undefined;
  if (f.head) throw new Error(`--${local} reviews the local checkout: it cannot be combined with --head.`);
  if (f.post) {
    throw new Error(`--${local} changes are on no pull request: commit and push them to use --post.`);
  }
  return local;
}

/** `--analyzers eslint,tsc` → opt-in project analyzers. */
function projectAnalyzersFrom(f: ReviewFlags): string[] | undefined {
  if (typeof f.analyzers !== 'string') return undefined;
  return f.analyzers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function execute(
  command: 'review' | 'files',
  paths: string[],
  flags: ReviewFlags & PublishCliFlags,
  globals: GlobalOptions,
): Promise<number> {
  const logger = makeLogger(globals);
  const lifecycle = installLifecycle();
  let ui: ReviewUi | undefined;
  try {
    const failOn = parseEnum(flags.failOn, SEVERITIES, '--fail-on') as Severity | undefined;
    const local = localChangesFrom(flags);
    const loaded = await loadCliConfig(globals, flagsToOverrides(flags));
    await interactiveDefaults(flags, loaded.sources.length > 0, detectProviders(loaded.config));
    if (flags.selfCritique !== undefined) loaded.config.review.selfCritique = flags.selfCritique;
    applyRoleFlags(loaded.config, flags);
    applyRunFlags(loaded.config, flags);
    for (const src of loaded.sources) logger.debug(`config: ${src}`);

    const config = loaded.config;
    ui = createReviewUi({
      mode: flags.plain ? 'plain' : config.ui.mode,
      hyperlinks: config.ui.hyperlinks,
      verbose: globals.verbose === true,
      cwd: loaded.cwd,
      root: loaded.repo?.root,
    });
    const activeUi = ui;
    logger.setSink((line) => activeUi.log(line));
    lifecycle.onInterrupt(() =>
      activeUi.log(
        pc.yellow(
          'Interrupted — cancelling agent sessions and saving a partial run (Ctrl+C again to force quit)',
        ),
      ),
    );
    // A forced exit must leave the terminal usable (cursor shown, live area cleared).
    lifecycle.onForcedExit(() => activeUi.stop());

    const onEvent = (e: ReviewEvent) => {
      activeUi.onEvent(e);
      if (e.type === 'refs' && flags.explainRefs && !flags.dryRun)
        activeUi.log(...e.refs.explanation.map((l) => pc.dim(`  ${l}`)));
    };
    const outcome = await runReview({
      command,
      cwd: loaded.cwd,
      base: flags.base,
      head: flags.head,
      ...(local ? { local } : {}),
      paths,
      config,
      logger,
      dryRun: flags.dryRun,
      offline: flags.offline === true || flags.fetch === false,
      projectAnalyzers: projectAnalyzersFrom(flags),
      signal: lifecycle.signal,
      host: activeUi,
      onForcedExit: (cleanup) => lifecycle.onForcedExit(cleanup),
      onEvent,
    });

    if (flags.dryRun) {
      activeUi.stop();
      logger.setSink(undefined);
      if (flags.post) logger.note('--post: nothing is posted with --dry-run (no review ran).');
      if (flags.json) process.stdout.write(`${JSON.stringify(outcome.plan, null, 2)}\n`);
      else
        process.stderr.write(
          `${renderPlan(outcome.plan, { color: colorEnabled(process.stderr, process.env), cwd: loaded.cwd })}\n`,
        );
      return EXIT.ok;
    }
    const run = outcome.run!;
    let reports = outcome.reports;
    if (flags.out) {
      const outDir = path.resolve(loaded.cwd, flags.out);
      await mkdir(outDir, { recursive: true });
      reports = await Promise.all(
        reports.map(async (r) => {
          const dest = path.join(outDir, path.basename(r));
          await cp(r, dest);
          return dest;
        }),
      );
    }
    activeUi.finish(run, { reports, runDir: outcome.runDir });
    logger.setSink(undefined);
    if (flags.json) process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    // After the run and its reports are saved: a publishing failure never loses them.
    const posted =
      flags.post && !lifecycle.interrupted
        ? await postRun({ run, repo: loaded.repo, config, flags, logger, signal: lifecycle.signal })
        : true;

    if (lifecycle.interrupted) return lifecycle.interruptExitCode ?? EXIT.error;
    if (run.status === 'failed') return EXIT.error;
    if (!posted) return EXIT.error;
    if (failOn && run.findings.some((f) => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[failOn]))
      return EXIT.findings;
    // A gate must not pass on code that was never reviewed.
    const failedChunks = run.chunks.filter((c) => c.status === 'failed').length;
    if (failOn && failedChunks > 0) {
      logger.error(
        `${failedChunks} of ${run.chunks.length} chunk(s) failed: part of the change was not reviewed (--fail-on ${failOn}).`,
      );
      return EXIT.error;
    }
    return EXIT.ok;
  } catch (err) {
    logger.setSink(undefined);
    // Nothing staged (e.g. `git commit --amend` of the message only): an empty review, not a failure.
    if (err instanceof NothingLocalError) {
      ui?.stop();
      logger.note(err.message);
      return EXIT.ok;
    }
    if (ui) ui.fail(err as Error);
    else logger.error((err as Error).message);
    if (lifecycle.interrupted) return lifecycle.interruptExitCode ?? EXIT.error;
    return EXIT.error;
  } finally {
    logger.setSink(undefined);
    lifecycle.dispose();
  }
}

/** Models, depth, critique, skills and thresholds: shared by `review`, `files` and `eval`. */
export function addTuningOptions(cmd: Command): Command {
  return cmd
    .option('--provider <id>', 'provider for the review (and critique, unless --critique-provider)')
    .option('--model <id>', 'model for the review role')
    .option('--reasoning <level>', `reasoning effort: ${REASONING_LEVELS.join('|')}`)
    .option('--critique-provider <id>', 'provider for the self-critique pass')
    .option('--critique-model <id>', 'model for the self-critique pass')
    .option('--critique-reasoning <level>', 'reasoning effort for the self-critique pass')
    .option(
      '--depth <depth>',
      'essential (serious production issues only, fewer tokens) | full (every real defect)',
    )
    .option('--essential', 'same as --depth essential')
    .option('--full', 'same as --depth full')
    .option('--min-severity <severity>', `drop findings below this severity (${SEVERITIES.join('|')})`)
    .option('--self-critique', 'verify findings with a second pass (default from config)')
    .option('--no-self-critique', 'skip the verification pass')
    .option('--skills <mode>', 'auto | none | comma-separated skill ids')
    .option('--tools', 'let the model use read-only tools (default)')
    .option('--no-tools', 'disable read-only tools (the model sees only the prompt)')
    .option('--min-confidence <0..1>', 'drop findings below this confidence');
}

/** Chunk size, timeouts, chunking, the static pre-pass and model fallback: shared by `review`, `files` and `eval`. */
export function addRunLimitOptions(cmd: Command): Command {
  return cmd
    .option('--max-chunk-tokens <n>', 'token budget of code per chunk')
    .option('--timeout <seconds>', 'fixed timeout per LLM task (default: auto, scales with chunk size)')
    .option('--chunking <mode>', 'smart (related files together) | directory')
    .option(
      '--passes <list>',
      'review passes per chunk: general | local,contracts (changed lines, then consumers)',
    )
    .option(
      '--expand <level>',
      'related unchanged code per chunk: off | map (file:line of usages and called definitions, default) | refs (plus excerpts) | deep',
    )
    .option('--no-analyzers', 'skip the static-analysis pre-pass')
    .option('--on-unavailable <mode>', 'when a model is unavailable: ask | fallback | fail');
}

function addReviewOptions(cmd: Command): Command {
  const tuned = addTuningOptions(cmd)
    .option('--authors', 'attribute findings to authors via git blame')
    .option('--no-authors', 'do not attribute authors')
    .option('--format <list>', `report formats: ${REPORT_FORMATS.join(',')}`)
    .option('--out <dir>', 'also copy the reports into this directory')
    .option('--concurrency <n>', 'parallel LLM calls')
    .option('--max-cost <usd>', 'stop starting model calls once the run has spent this much (review.maxCost)')
    .option(
      '--fail-on <severity>',
      `exit with code 1 if a finding of this severity or worse remains (${SEVERITIES.join('|')})`,
    )
    .option(
      '--analyzers <ids>',
      'also run these opt-in project analyzers (eslint,tsc,golangci-lint,phpstan,semgrep,osv-scanner)',
    );
  return addRunLimitOptions(tuned)
    .option('--no-cache', 'review everything again: do not reuse or store cached model answers')
    .option('--plain', 'plain progress lines instead of the live dashboard')
    .option('--dry-run', 'show files, chunks, skills and hints without calling any model')
    .option('--json', 'print the run (or the plan with --dry-run) as JSON on stdout')
    .option('-y, --yes', 'never prompt interactively');
}

export function registerReviewCommands(program: Command): void {
  const review = addReviewOptions(
    program
      .command('review')
      .description('review the changes between two refs (like a pull request: merge-base(base, head)..head)')
      .option(
        '-b, --base <ref>',
        'base branch; a bare name means the freshly fetched remote branch (default: auto)',
      )
      .option('--from <ref>', 'alias of --base')
      .option('--head <ref>', 'head ref to review (default: HEAD, including unpushed commits)')
      .option('--to <ref>', 'alias of --head')
      .option('--staged', 'review the staged changes, as `git commit` would record them (base: HEAD)')
      .option(
        '--uncommitted',
        'review all uncommitted changes, untracked files included (base: HEAD; with --base, the branch too)',
      )
      .option('--remote <name>', 'remote to compare against (default: upstream remote, else origin)')
      .option('--offline', 'do not fetch or query the forge; use local refs only')
      .option('--no-fetch', 'alias of --offline')
      .option('--explain-refs', 'print how base and head were chosen'),
  ).action(async (opts: ReviewFlags & PublishCliFlags & { from?: string; to?: string }, cmd: Command) => {
    opts.base ??= opts.from;
    opts.head ??= opts.to;
    process.exitCode = await execute('review', [], opts, cmd.optsWithGlobals());
  });
  addPublishTargetOptions(
    review.option(
      '--post',
      'post the review to its GitHub pull request / GitLab merge request (see docs/ci.md)',
    ),
  );

  addReviewOptions(
    program
      .command('files')
      .description('review whole files or folders (not a diff)')
      .argument('[paths...]', 'files or directories (default: current directory)'),
  ).action(async (paths: string[], opts: ReviewFlags, cmd: Command) => {
    process.exitCode = await execute('files', paths, opts, cmd.optsWithGlobals());
  });
}
