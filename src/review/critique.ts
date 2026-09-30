import { readFileSync } from 'node:fs';
import pLimit from 'p-limit';
import { estimateTokens } from '../chunking/tokens';
import type { ReviewDepth } from '../config/schema';
import type { AgentResult, AgentTask, Provider } from '../providers/types';
import type { DependencyRoot } from '../tools/dependencies';
import type { FailureKind, Finding, ReasoningLevel, ReportedVerdict, RunTarget } from '../types';
import { resolveInside } from '../util/paths';
import { failureKindOf, type Spend, spendOf, spendOfResult } from './execute';
import { resolveVerdicts } from './findings';
import { critiqueInstructions, critiquePrompt } from './prompts';

const MAX_FINDINGS_PER_BATCH = 8;
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
  const excerpts = new Map(
    findings.map((f) => [f.id, excerpt(opts.root, f, opts.changedLines?.get(f.file))]),
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
        originalConfidence: original.confidence,
        originalSeverity: v.severity && v.severity !== original.severity ? original.severity : undefined,
        ...(v.title?.trim() && v.title.trim() !== original.title ? { originalTitle: original.title } : {}),
      },
      severity: v.severity,
      ...(v.title?.trim() && v.title.trim() !== original.title ? { title: v.title.trim() } : {}),
      ...(v.replacementOk !== undefined ? { replacementOk: v.replacementOk } : {}),
    });
  let cachedVerdicts = 0;
  const pending: Finding[] = [];
  for (const f of findings) {
    const known = await opts.cache?.get(f, excerpts.get(f.id)!).catch(() => undefined);
    if (known) {
      record(f, known);
      cachedVerdicts++;
    } else pending.push(f);
  }
  const batches = makeBatches(pending, excerpts, opts.batchTokenBudget);
  const limit = pLimit(opts.concurrency);
  const spend: Spend[] = [];
  const warnings: string[] = [];

  const runBatch = async (batch: Finding[], label: string, canSplit: boolean): Promise<void> => {
    const task: AgentTask = {
      kind: 'verdicts',
      label: `critique-${label}`,
      instructions: critiqueInstructions(opts.mode, opts.depth, opts.dependencies),
      prompt: critiquePrompt(batch, excerpts),
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
        warnings.push(`critique ${label}: ${kind} — retrying as two smaller batches`);
        await runBatch(batch.slice(0, half), `${label}.1`, false);
        await runBatch(batch.slice(half), `${label}.2`, false);
        return;
      }
      warnings.push(`critique batch ${label} failed: ${(err as Error).message}`);
      return;
    }
    spend.push(...spendOfResult(result, opts.provider.id));
    warnings.push(...result.warnings.map((w) => `critique ${label}: ${w}`));
    const resolved = resolveVerdicts(result);
    for (const v of resolved.items) {
      const original = batch.find((f) => f.id === v.id);
      if (!original) continue;
      record(original, v);
      // An early (salvaged) answer may be a guess made in a hurry: not remembered.
      if (!result.salvaged) {
        await opts.cache
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
        opts.onBatchDone?.({ batch: i + 1, total: batches.length });
      }),
    ),
  );

  const kept: Finding[] = [];
  const rejected: Finding[] = [];
  for (const f of findings) {
    const v = verdicts.get(f.id);
    if (!v?.verdict) {
      // No verdict (batch failed or id omitted): keep the reviewer's view, but flag it.
      kept.push({
        ...f,
        critique: {
          verdict: 'uncertain',
          confidence: f.confidence,
          reason: 'not verified (critic returned no verdict)',
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
function makeBatches(findings: Finding[], excerpts: Map<string, string>, budget: number): Finding[][] {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const batches: Finding[][] = [];
  let current: Finding[] = [];
  let tokens = 0;
  for (const group of byFile.values()) {
    for (const f of group) {
      const t = estimateTokens(excerpts.get(f.id) ?? '') + estimateTokens(f.description) + 100;
      if (current.length && (current.length >= MAX_FINDINGS_PER_BATCH || tokens + t > budget)) {
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
