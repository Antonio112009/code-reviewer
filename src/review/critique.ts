import { readFileSync } from 'node:fs';
import pLimit from 'p-limit';
import { callsIn } from '../chunking/expand';
import { estimateTokens } from '../chunking/tokens';
import type { ReviewDepth } from '../config/schema';
import type { AgentResult, AgentTask, Provider } from '../providers/types';
import { findDefinitions } from '../tools/definitions';
import type { DependencyRoot } from '../tools/dependencies';
import type { FailureKind, Finding, ReasoningLevel, ReportedVerdict, RunTarget } from '../types';
import { resolveInside } from '../util/paths';
import { failureKindOf, type Spend, spendOf, spendOfResult } from './execute';
import { resolveVerdicts } from './findings';
import {
  critiqueInstructions,
  critiquePrompt,
  secondOpinionInstructions,
  secondOpinionPrompt,
} from './prompts';

const MAX_FINDINGS_PER_BATCH = 8;
/** A second opinion digs deeper: few findings per task, each with the full step budget. */
const MAX_FINDINGS_PER_SECOND_OPINION = 2;
const NOT_VERIFIED = 'not verified (critic returned no verdict)';
/** Callee definitions listed per finding: calls looked up, definitions shown per call, lines scanned. */
const MAX_CALLS = 8;
const MAX_DEFINITIONS = 3;
const MAX_CALL_LINES = 40;
/** A name defined in more places than this says nothing about which one the call reaches. */
const TOO_MANY_DEFINITIONS = 6;
/** Test code by path: a test directory, a `.test.` / `_test.` / `test_` file name, a `FooTest.java` class. */
const TEST_PATHS = [
  /(?:^|\/)(?:tests?|__tests__|__mocks__|spec|mocks?|testdata|fixtures)\//i,
  /[._-](?:test|spec|mock)s?\.[^/]*$/i,
  /(?:^|\/)test_[^/]*\.py$/i,
  // case-sensitive: `OrderTest.java`, not `Latest.java`
  /[a-z0-9](?:Tests?|IT)\.(?:java|kt|cs)$/,
];

export function isTestFile(file: string): boolean {
  return TEST_PATHS.some((re) => re.test(file));
}
const EXCERPT_CONTEXT = 15;

export interface CritiqueOptions {
  provider: Provider;
  model?: string;
  reasoning: ReasoningLevel;
  mode: RunTarget['kind'];
  /** Review depth: `essential` also rejects findings without serious production impact. */
  depth?: ReviewDepth;
  root: string;
  git: boolean;
  readTools: boolean;
  /** Installed dependency sources the critic may read (see `tools/dependencies.ts`). */
  dependencies?: DependencyRoot[];
  maxSteps: number;
  timeoutMs: number;
  concurrency: number;
  batchTokenBudget: number;
  signal?: AbortSignal;
  onBatchDone?: (info: { batch: number; total: number }) => void;
  /** Verdicts of earlier runs: findings with one are not sent to the critic again. */
  cache?: CritiqueCache;
  /** Diff reviews: the lines of each file the change added or modified, marked `+` in the excerpts. */
  changedLines?: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * A second verifier for findings the first one kept with a confidence in [min, max): it is asked to refute
   * each one with code the first did not read, and its verdict replaces the first (`critique.firstOpinion`).
   */
  secondOpinion?: { min: number; max: number; cache?: CritiqueCache };
}

/** One verification pass: what the verifier is told and how findings are grouped. */
interface Pass {
  label: string;
  instructions: string;
  prompt: (findings: Finding[], excerpts: Map<string, string>) => string;
  maxPerBatch: number;
  cache?: CritiqueCache;
  /** Reports batch progress (the first pass). */
  progress: boolean;
}

/** Verdict store keyed by a finding and its code excerpt (see the result cache in `src/cache/`). */
export interface CritiqueCache {
  get(f: Finding, excerpt: string): Promise<Omit<ReportedVerdict, 'id'> | undefined>;
  /** Called for each fresh verdict of a complete answer, with the files the critic read. */
  set(f: Finding, excerpt: string, verdict: ReportedVerdict, reads: string[]): Promise<void>;
}

export interface CritiqueOutcome {
  kept: Finding[];
  rejected: Finding[];
  /** Usage of every critique call, failed ones included. */
  spend: Spend[];
  warnings: string[];
  /** Findings whose verdict came from the cache. */
  cachedVerdicts: number;
  /** Findings that went to a second verifier (`secondOpinion`). */
  secondOpinions?: number;
}

/** Failures a smaller batch can fix: out of time, steps, output or context. */
const SPLITTABLE: ReadonlySet<FailureKind> = new Set([
  'timeout',
  'step-limit',
  'output-limit',
  'context-limit',
]);

/**
 * Second pass: a (usually stronger) model re-checks every finding against the code and returns a
 * verdict. Rejected findings are removed; confidence is replaced by the critic's calibrated value.
 * A batch that runs out of time, steps or output is retried once as two smaller batches.
 */
export async function critiqueFindings(findings: Finding[], opts: CritiqueOptions): Promise<CritiqueOutcome> {
  const first = await runPass(findings, opts, {
    label: 'critique',
    instructions: critiqueInstructions(opts.mode, opts.depth, opts.dependencies),
    prompt: critiquePrompt,
    maxPerBatch: MAX_FINDINGS_PER_BATCH,
    cache: opts.cache,
    progress: true,
  });
  const range = opts.secondOpinion;
  if (!range || opts.signal?.aborted) return first;
  // Secrets and vulnerable dependencies cannot be dismissed, unverified findings have no first opinion.
  const borderline = first.kept.filter(
    (f) =>
      !f.nonRejectable &&
      f.critique !== undefined &&
      f.critique.reason !== NOT_VERIFIED &&
      f.confidence >= range.min &&
      f.confidence < range.max,
  );
  if (borderline.length === 0) return first;
  const second = await runPass(borderline, opts, {
    label: 'second-opinion',
    instructions: secondOpinionInstructions(opts.mode, opts.depth, opts.dependencies),
    prompt: secondOpinionPrompt,
    maxPerBatch: MAX_FINDINGS_PER_SECOND_OPINION,
    cache: range.cache,
    progress: false,
  });
  const again = new Map([...second.kept, ...second.rejected].map((f) => [f.id, f]));
  return {
    kept: first.kept.flatMap((f) => {
      const s = again.get(f.id);
      return s ? (s.droppedReason ? [] : [s]) : [f];
    }),
    rejected: [...first.rejected, ...second.rejected],
    spend: [...first.spend, ...second.spend],
    warnings: [...first.warnings, ...second.warnings],
    cachedVerdicts: first.cachedVerdicts,
    secondOpinions: borderline.length,
  };
}

async function runPass(findings: Finding[], opts: CritiqueOptions, pass: Pass): Promise<CritiqueOutcome> {
  const lookups = pLimit(8);
  const excerpts = new Map(
    await Promise.all(
      findings.map((f) =>
        lookups(async (): Promise<[string, string]> => {
          const code = excerpt(opts.root, f, opts.changedLines?.get(f.file));
          const callees = opts.git ? await calleeNotes(opts.root, f).catch(() => '') : '';
          return [f.id, callees ? `${code}\n${callees}` : code];
        }),
      ),
    ),
  );
  const verdicts = new Map<
    string,
    { verdict: Finding['critique']; severity?: Finding['severity']; title?: string; replacementOk?: boolean }
  >();
  const record = (original: Finding, v: Omit<ReportedVerdict, 'id'>) =>
    verdicts.set(original.id, {
      verdict: {
        verdict: v.verdict,
        confidence: v.confidence,
        reason: v.reason,
        // A second opinion keeps what the reviewer wrote (the first verifier may have corrected it).
        originalConfidence: original.critique?.originalConfidence ?? original.confidence,
        originalSeverity:
          v.severity && v.severity !== original.severity
            ? (original.critique?.originalSeverity ?? original.severity)
            : original.critique?.originalSeverity,
        ...(v.title?.trim() && v.title.trim() !== original.title
          ? { originalTitle: original.critique?.originalTitle ?? original.title }
          : original.critique?.originalTitle
            ? { originalTitle: original.critique.originalTitle }
            : {}),
        ...(original.critique
          ? {
              firstOpinion: {
                verdict: original.critique.verdict,
                confidence: original.critique.confidence,
                reason: original.critique.reason,
              },
            }
          : {}),
      },
      severity: v.severity,
      ...(v.title?.trim() && v.title.trim() !== original.title ? { title: v.title.trim() } : {}),
      ...(v.replacementOk !== undefined ? { replacementOk: v.replacementOk } : {}),
    });
  let cachedVerdicts = 0;
  const pending: Finding[] = [];
  for (const f of findings) {
    const known = await pass.cache?.get(f, excerpts.get(f.id)!).catch(() => undefined);
    if (known) {
      record(f, known);
      cachedVerdicts++;
    } else pending.push(f);
  }
  const batches = makeBatches(pending, excerpts, opts.batchTokenBudget, pass.maxPerBatch);
  const limit = pLimit(opts.concurrency);
  const spend: Spend[] = [];
  const warnings: string[] = [];

  const runBatch = async (batch: Finding[], label: string, canSplit: boolean): Promise<void> => {
    const task: AgentTask = {
      kind: 'verdicts',
      label: `${pass.label}-${label}`,
      instructions: pass.instructions,
      prompt: pass.prompt(batch, excerpts),
      model: opts.model,
      reasoning: opts.reasoning,
      readTools: opts.readTools,
      root: opts.root,
      git: opts.git,
      ...(opts.dependencies?.length ? { dependencyRoots: opts.dependencies.map((d) => d.dir) } : {}),
      maxSteps: opts.maxSteps,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    };
    let result: AgentResult;
    try {
      result = await opts.provider.run(task);
    } catch (err) {
      spend.push(...spendOf(err));
      const kind = failureKindOf(err, opts.signal);
      if (canSplit && batch.length > 1 && SPLITTABLE.has(kind)) {
        const half = Math.ceil(batch.length / 2);
        warnings.push(`${pass.label} ${label}: ${kind} — retrying as two smaller batches`);
        await runBatch(batch.slice(0, half), `${label}.1`, false);
        await runBatch(batch.slice(half), `${label}.2`, false);
        return;
      }
      warnings.push(`${pass.label} batch ${label} failed: ${(err as Error).message}`);
      return;
    }
    spend.push(...spendOfResult(result, opts.provider.id));
    warnings.push(...result.warnings.map((w) => `${pass.label} ${label}: ${w}`));
    const resolved = resolveVerdicts(result);
    for (const v of resolved.items) {
      const original = batch.find((f) => f.id === v.id);
      if (!original) continue;
      record(original, v);
      // An early (salvaged) answer may be a guess made in a hurry: not remembered.
      if (!result.salvaged) {
        await pass.cache
          ?.set(original, excerpts.get(original.id)!, v, result.reads ?? [])
          .catch(() => undefined);
      }
    }
  };

  await Promise.all(
    batches.map((batch, i) =>
      limit(async () => {
        if (opts.signal?.aborted) return; // leave these findings unverified
        await runBatch(batch, String(i + 1), true);
        if (pass.progress) opts.onBatchDone?.({ batch: i + 1, total: batches.length });
      }),
    ),
  );

  const kept: Finding[] = [];
  const rejected: Finding[] = [];
  for (const f of findings) {
    const v = verdicts.get(f.id);
    if (!v?.verdict && f.critique) {
      // A second opinion that did not arrive: the first verdict stands.
      kept.push(f);
      continue;
    }
    if (!v?.verdict) {
      // No verdict (batch failed or id omitted): keep the reviewer's view, but flag it.
      kept.push({
        ...f,
        critique: {
          verdict: 'uncertain',
          confidence: f.confidence,
          reason: NOT_VERIFIED,
          originalConfidence: f.confidence,
        },
      });
      continue;
    }
    const updated: Finding = {
      ...f,
      confidence: v.verdict.confidence,
      severity: v.severity ?? f.severity,
      ...(v.title ? { title: v.title } : {}),
      critique: v.verdict,
      ...(f.replacement !== undefined ? { replacementOk: v.replacementOk === true } : {}),
    };
    if (v.verdict.verdict === 'rejected' && f.nonRejectable) {
      // Secrets / vulnerable dependencies: the critic may downgrade them, never drop them.
      kept.push({
        ...updated,
        severity: v.severity ?? 'info',
        confidence: Math.max(updated.confidence, 0.5),
        critique: {
          ...v.verdict,
          verdict: 'uncertain',
          reason: `${v.verdict.reason} (kept: cannot be dismissed automatically)`,
        },
      });
    } else if (v.verdict.verdict === 'rejected') rejected.push({ ...updated, droppedReason: 'critique' });
    else kept.push(updated);
  }
  return { kept, rejected, spend, warnings, cachedVerdicts };
}

/**
 * Where the functions called on a finding's lines are defined: the code a claim about what happens "in
 * there" has to be checked against (the implementation behind an interface or handler call above all).
 * Verifiers rarely look these up themselves. Names with no definition in the repository (library calls) or
 * with too many are left out; test files only count when nothing else defines the name.
 */
async function calleeNotes(root: string, f: Finding): Promise<string> {
  let lines: string[];
  try {
    lines = readFileSync(resolveInside(root, f.file), 'utf8').split('\n');
  } catch {
    return '';
  }
  const reported = lines.slice(f.startLine - 1, Math.min(f.endLine, f.startLine - 1 + MAX_CALL_LINES));
  const notes: string[] = [];
  for (const name of callsIn(reported).slice(0, MAX_CALLS)) {
    const all = (await findDefinitions(name, { root, git: true }))
      .map((line) => /^(.+?):(\d+):(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ file: m[1]!, line: Number(m[2]), code: m[3]!.trim() }))
      // the definition inside the reported lines is already in the excerpt
      .filter((d) => !(d.file === f.file && d.line >= f.startLine && d.line <= f.endLine));
    const product = all.filter((d) => !isTestFile(d.file));
    const defs = product.length ? product : all;
    if (defs.length === 0 || defs.length > TOO_MANY_DEFINITIONS) continue;
    for (const d of defs.slice(0, MAX_DEFINITIONS)) {
      notes.push(`- ${name}: ${d.file}:${d.line}  ${d.code.slice(0, 140)}`);
    }
  }
  return notes.length
    ? `Defined elsewhere, called on the reported lines of ${f.id} (read the one the call reaches before judging what happens in it):\n${notes.join('\n')}`
    : '';
}

function excerpt(root: string, f: Finding, changed?: ReadonlySet<number>): string {
  let lines: string[];
  try {
    lines = readFileSync(resolveInside(root, f.file), 'utf8').split('\n');
  } catch {
    return `### ${f.id} — ${f.file} (file not readable)`;
  }
  const start = Math.max(1, f.startLine - EXCERPT_CONTEXT);
  const end = Math.min(lines.length, f.endLine + EXCERPT_CONTEXT);
  const width = String(end).length;
  const body = lines
    .slice(start - 1, end)
    .map((l, i) => {
      const n = start + i;
      const mark = n >= f.startLine && n <= f.endLine ? '>' : ' ';
      const plus = changed ? (changed.has(n) ? '+' : ' ') : '';
      return `${String(n).padStart(width)} ${plus}${mark} ${l}`;
    })
    .join('\n');
  const legend = changed
    ? '">" marks the reported lines, "+" the lines this change added or modified'
    : '">" marks the reported lines';
  return `### ${f.id} — ${f.file}:${f.startLine}-${f.endLine} (${legend})\n\`\`\`\n${body}\n\`\`\``;
}

/** Groups findings by file into batches bounded by count and prompt size. */
function makeBatches(
  findings: Finding[],
  excerpts: Map<string, string>,
  budget: number,
  maxPerBatch: number,
): Finding[][] {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const batches: Finding[][] = [];
  let current: Finding[] = [];
  let tokens = 0;
  for (const group of byFile.values()) {
    for (const f of group) {
      const t = estimateTokens(excerpts.get(f.id) ?? '') + estimateTokens(f.description) + 100;
      if (current.length && (current.length >= maxPerBatch || tokens + t > budget)) {
        batches.push(current);
        current = [];
        tokens = 0;
      }
      current.push(f);
      tokens += t;
    }
  }
  if (current.length) batches.push(current);
  return batches;
}
