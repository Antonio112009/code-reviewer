import path from 'node:path';
import type { Command } from 'commander';
import { builtinCorpusDir, filterCases, loadCases } from '../../eval/cases';
import { compareResults } from '../../eval/compare';
import { DEFAULT_TOLERANCE } from '../../eval/metrics';
import { type EvalEvent, runEval } from '../../eval/runner';
import { loadEvalResult, saveEvalResult } from '../../eval/store';
import type { EvalResult } from '../../eval/types';
import { formatDuration, formatTokens } from '../../report/common';
import { resolveRouting } from '../../review/pipeline';
import { newRunId } from '../../util/ids';
import type { Logger } from '../../util/logger';
import { PROJECT_DIR, toPosix } from '../../util/paths';
import { EXIT, type GlobalOptions, loadCliConfig, makeLogger } from '../context';
import { installLifecycle } from '../lifecycle';
import { colorEnabled } from '../ui';
import { pct, renderComparison, renderEvalSummary } from '../ui/eval';
import { createTheme, unicodeEnabled } from '../ui/theme';
import {
  addRunLimitOptions,
  addTuningOptions,
  applyRoleFlags,
  applyRunFlags,
  flagsToOverrides,
  parseNumber,
  type ReviewFlags,
} from './review';

interface EvalFlags extends ReviewFlags {
  filter?: string;
  repeat?: string;
  tolerance?: string;
  compare?: string;
  minRecall?: string;
  minPrecision?: string;
  keep?: boolean;
}

/** Default parent of eval directories: `.code-reviewer/evals` of the current repository (or directory). */
export function defaultEvalsDir(root: string): string {
  return path.join(root, PROJECT_DIR, 'evals');
}

/** Progress lines on stderr (through the logger, which sanitises case ids and model text). */
function progress(logger: Logger, repeat: number): (e: EvalEvent) => void {
  const label = (id: string, pass: number) => (repeat > 1 ? `${id} (run ${pass}/${repeat})` : id);
  return (e) => {
    switch (e.type) {
      case 'case-start':
        logger.step(`[${e.index + 1}/${e.total}] ${label(e.case.id, e.repeat)}`);
        break;
      case 'case-run': {
        const name = label(e.case.id, e.run.repeat);
        const m = e.run.metrics;
        const outcome = e.case.expect.length
          ? `${m.found}/${m.expected} found, ${m.unexpected} unexpected`
          : `clean change, ${m.falsePositives} false positive(s)`;
        const cost = `${formatTokens(m.inputTokens + m.outputTokens)} tokens · ${formatDuration(m.durationMs)}`;
        if (e.run.status === 'error' || e.run.status === 'failed') {
          logger.error(`${name}: ${e.run.error ?? 'every chunk failed'}`);
        } else if (e.run.status === 'interrupted') logger.warn(`${name}: interrupted`);
        else if (m.failedChunks > 0)
          logger.warn(`${name}: ${outcome} · ${m.failedChunks} failed chunk(s) · ${cost}`);
        else logger.success(`${name}: ${outcome} · ${cost}`);
        break;
      }
      case 'case-error':
        logger.error(`${e.case.id}: ${e.error}`);
        break;
      case 'warning':
        logger.debug(`${e.case?.id ?? 'eval'}: ${e.message}`);
        break;
    }
  };
}

/** Exit code for the finished eval: errors first (the numbers are incomplete), then the quality gates. */
export function evalExitCode(
  result: EvalResult,
  gates: { minRecall?: number; minPrecision?: number },
  logger: Logger,
): number {
  const agg = result.aggregate;
  if (agg.errors > 0) {
    logger.error(`${agg.errors} run(s) failed: the numbers are incomplete (failed runs count as missed).`);
    return EXIT.error;
  }
  let code: number = EXIT.ok;
  const check = (name: string, value: number | null, min: number | undefined, what: string) => {
    if (min === undefined) return;
    if (value === null) {
      logger.warn(`--min-${name} ${min}: not applicable (${what}).`);
    } else if (value + 1e-9 < min) {
      logger.error(`${name} ${pct(value)} is below --min-${name} ${pct(min)}`);
      code = EXIT.findings;
    }
  };
  check('recall', agg.recall, gates.minRecall, 'no expected defects in the selected cases');
  check('precision', agg.precision, gates.minPrecision, 'no findings were reported');
  return code;
}

async function executeEval(paths: string[], flags: EvalFlags, globals: GlobalOptions): Promise<number> {
  const logger = makeLogger(globals);
  const lifecycle = installLifecycle();
  try {
    const repeat = parseNumber(flags.repeat, '--repeat', { min: 1, max: 100, int: true }) ?? 1;
    const concurrency = parseNumber(flags.concurrency, '--concurrency', { min: 1, max: 32, int: true }) ?? 1;
    const tolerance =
      parseNumber(flags.tolerance, '--tolerance', { min: 0, max: 1000, int: true }) ?? DEFAULT_TOLERANCE;
    const minRecall = parseNumber(flags.minRecall, '--min-recall', { min: 0, max: 1 });
    const minPrecision = parseNumber(flags.minPrecision, '--min-precision', { min: 0, max: 1 });
    const filter = (flags.filter ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // `--concurrency` means cases in parallel here; LLM calls per review keep `review.concurrency`.
    const reviewFlags: ReviewFlags = { ...flags, concurrency: undefined };
    const loaded = await loadCliConfig(globals, flagsToOverrides(reviewFlags));
    applyRoleFlags(loaded.config, reviewFlags);
    applyRunFlags(loaded.config, reviewFlags);
    for (const src of loaded.sources) logger.debug(`config: ${src}`);
    const cwd = loaded.cwd;

    const cases = filterCases(await loadCases(paths, cwd), filter);
    if (cases.length === 0)
      throw new Error(filter.length ? `No case matches --filter ${flags.filter}` : 'No cases found');
    const evalsDir = flags.out ? path.resolve(cwd, flags.out) : defaultEvalsDir(loaded.repo?.root ?? cwd);
    // Before the run: a mistyped reference must not cost a whole eval.
    const previous = flags.compare ? await loadEvalResult(flags.compare, { cwd, evalsDir }) : undefined;

    const id = newRunId();
    const dir = path.join(evalsDir, id);
    const routing = resolveRouting(loaded.config);
    const model = (r: { provider: string; model?: string }) => `${r.provider}${r.model ? `:${r.model}` : ''}`;
    logger.step(
      `Evaluating ${cases.length} case(s)${repeat > 1 ? ` × ${repeat}` : ''} · review ${model(routing.review)}${routing.critique ? ` · critique ${model(routing.critique)}` : ' · no self-critique'} · ${loaded.config.review.depth} depth`,
    );
    lifecycle.onInterrupt(() =>
      logger.warn(
        'Interrupted — cancelling the running reviews and saving a partial result (Ctrl+C again to force quit)',
      ),
    );

    const result = await runEval({
      cases,
      config: loaded.config,
      logger,
      id,
      dir,
      tolerance,
      repeat,
      concurrency,
      keep: flags.keep,
      corpus: paths.length ? paths.map((p) => toPosix(path.resolve(cwd, p))) : [toPosix(builtinCorpusDir())],
      filter,
      signal: lifecycle.signal,
      onForcedExit: (cleanup) => lifecycle.onForcedExit(cleanup),
      onEvent: progress(logger, repeat),
    });
    if (previous) result.comparison = compareResults(previous.result, result, previous.file);
    const file = await saveEvalResult(dir, result);

    if (!globals.quiet) {
      const theme = createTheme(colorEnabled(process.stderr, process.env), unicodeEnabled(process.env));
      const out = [renderEvalSummary(result, theme)];
      if (result.comparison)
        out.push('', renderComparison(result.comparison, theme, result.aggregate.costCurrency));
      out.push('', theme.c.dim(`Saved ${file} (review runs in ${path.join(dir, 'runs')})`));
      process.stderr.write(`\n${out.join('\n')}\n`);
    }
    if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (lifecycle.interrupted) return lifecycle.interruptExitCode ?? EXIT.error;
    return evalExitCode(result, { minRecall, minPrecision }, logger);
  } catch (err) {
    logger.error((err as Error).message);
    if (lifecycle.interrupted) return lifecycle.interruptExitCode ?? EXIT.error;
    return EXIT.error;
  } finally {
    lifecycle.dispose();
  }
}

export function registerEvalCommand(program: Command): void {
  const cmd = program
    .command('eval')
    .description('measure review quality on cases with known defects: recall, precision, false positives')
    .argument('[paths...]', 'case files or directories (default: the built-in corpus)')
    .option(
      '--filter <terms>',
      'only cases with this tag, id glob or id prefix (comma-separated, any matches)',
    )
    .option('--repeat <n>', 'review every case n times to measure LLM variance (default 1)')
    .option('--concurrency <n>', 'cases reviewed in parallel (default 1)')
    .option(
      '--tolerance <lines>',
      `lines a finding may be away from an expected defect (default ${DEFAULT_TOLERANCE})`,
    )
    .option('--out <dir>', 'parent directory of eval results (default: .code-reviewer/evals)')
    .option(
      '--compare <result>',
      'show deltas against a previous result: result.json, its directory, an id or "latest"',
    )
    .option('--min-recall <0..1>', 'exit with code 1 when recall is below this (CI gate)')
    .option('--min-precision <0..1>', 'exit with code 1 when precision is below this (CI gate)')
    .option('--keep', 'keep the temporary case repositories (debugging)')
    .option('--json', 'print the eval result as JSON on stdout');
  addRunLimitOptions(addTuningOptions(cmd)).action(
    async (paths: string[], opts: EvalFlags, command: Command) => {
      process.exitCode = await executeEval(paths, opts, command.optsWithGlobals());
    },
  );
}
