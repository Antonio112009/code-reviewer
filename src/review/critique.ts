import { readFileSync } from 'node:fs';
import pLimit from 'p-limit';
import { estimateTokens } from '../chunking/tokens';
import type { ReviewDepth } from '../config/schema';
import type { AgentResult, AgentTask, Provider } from '../providers/types';
import type { Finding, ReasoningLevel, RunTarget, Usage } from '../types';
import { resolveInside } from '../util/paths';
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
  maxSteps: number;
  timeoutMs: number;
  concurrency: number;
  batchTokenBudget: number;
  signal?: AbortSignal;
  onBatchDone?: (info: { batch: number; total: number; result?: AgentResult; error?: Error }) => void;
}

export interface CritiqueOutcome {
  kept: Finding[];
  rejected: Finding[];
  usage: Usage[];
  warnings: string[];
}

/**
 * Second pass: a (usually stronger) model re-checks every finding against the code and returns a
 * verdict. Rejected findings are removed; confidence is replaced by the critic's calibrated value.
 */
export async function critiqueFindings(findings: Finding[], opts: CritiqueOptions): Promise<CritiqueOutcome> {
  const excerpts = new Map(findings.map((f) => [f.id, excerpt(opts.root, f)]));
  const batches = makeBatches(findings, excerpts, opts.batchTokenBudget);
  const limit = pLimit(opts.concurrency);
  const verdicts = new Map<string, { verdict: Finding['critique']; severity?: Finding['severity'] }>();
  const usage: Usage[] = [];
  const warnings: string[] = [];

  await Promise.all(
    batches.map((batch, i) =>
      limit(async () => {
        if (opts.signal?.aborted) return; // leave these findings unverified
        const task: AgentTask = {
          kind: 'verdicts',
          label: `critique-${i + 1}`,
          instructions: critiqueInstructions(opts.mode, opts.depth),
          prompt: critiquePrompt(batch, excerpts),
          model: opts.model,
          reasoning: opts.reasoning,
          readTools: opts.readTools,
          root: opts.root,
          git: opts.git,
          maxSteps: opts.maxSteps,
          timeoutMs: opts.timeoutMs,
          signal: opts.signal,
        };
        try {
          const result = await opts.provider.run(task);
          if (result.usage) usage.push(result.usage);
          warnings.push(...result.warnings.map((w) => `critique ${i + 1}: ${w}`));
          const resolved = resolveVerdicts(result);
          for (const v of resolved.items) {
            const original = batch.find((f) => f.id === v.id);
            if (!original) continue;
            verdicts.set(v.id, {
              verdict: {
                verdict: v.verdict,
                confidence: v.confidence,
                reason: v.reason,
                originalConfidence: original.confidence,
                originalSeverity:
                  v.severity && v.severity !== original.severity ? original.severity : undefined,
              },
              severity: v.severity,
            });
          }
          opts.onBatchDone?.({ batch: i + 1, total: batches.length, result });
        } catch (err) {
          warnings.push(`critique batch ${i + 1} failed: ${(err as Error).message}`);
          opts.onBatchDone?.({ batch: i + 1, total: batches.length, error: err as Error });
        }
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
      critique: v.verdict,
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
  return { kept, rejected, usage, warnings };
}

function excerpt(root: string, f: Finding): string {
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
      return `${String(n).padStart(width)} ${mark} ${l}`;
    })
    .join('\n');
  return `### ${f.id} — ${f.file}:${f.startLine}-${f.endLine} (">" marks the reported lines)\n\`\`\`\n${body}\n\`\`\``;
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
