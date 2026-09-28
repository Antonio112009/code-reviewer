import { formatMoney } from '../models/pricing';
import type {
  AnalyzerRun,
  FailureKind,
  FileCoverage,
  Finding,
  Role,
  RunRecord,
  RunTarget,
  Severity,
  StackProfile,
  TechCategory,
} from '../types';
import { SEVERITIES } from '../types';

/** CSI, OSC (BEL or ST terminated) and two-byte escape sequences. */
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/g;
/** C0/C1 control characters except tab, line feed and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Bidirectional overrides/isolates (Trojan Source) and directional marks. */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Removes terminal escape sequences, control characters (keeping `\t`, `\n`, `\r`) and bidi controls
 * from untrusted text (model output, repository paths) before it is rendered anywhere.
 */
export function stripUnsafeChars(s: string): string {
  return s.replace(ANSI_ESCAPE, '').replace(CONTROL_CHARS, '').replace(BIDI_CONTROLS, '');
}

/** Project page, linked from SARIF tool metadata and pull request comments. */
export const TOOL_INFO_URI = 'https://github.com/antonio112009/code-reviewer';

/**
 * Cuts `s` to at most `max` characters (an ellipsis marks the cut) without splitting a surrogate pair.
 * Untrusted text is clipped before it is escaped or sent anywhere.
 */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = Math.max(0, max - 1);
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${s.slice(0, end)}…`;
}

/**
 * A repository-relative posix path, or undefined for anything that is not one (absolute, drive letter,
 * `.`/`..`/empty segments). A run.json can come from the checkout, so its paths are checked before they are
 * written into SARIF, Code Quality reports or API requests.
 */
export function safeRepoPath(file: unknown): string | undefined {
  if (typeof file !== 'string') return undefined;
  const p = stripUnsafeChars(file).replace(/\\/g, '/');
  if (!p || p.length > 4096 || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return undefined;
  return p.split('/').some((s) => s === '' || s === '.' || s === '..') ? undefined : p;
}

/** Severity rank: lower is worse (critical = 0). */
export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 };

/** Findings by severity (worst first), then confidence (highest first), then file and line. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.confidence - a.confidence ||
      a.file.localeCompare(b.file) ||
      a.startLine - b.startLine,
  );
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const f of findings) if (f.severity in counts) counts[f.severity]++;
  return counts;
}

/** `420ms`, `3.2s`, `38s`, `1m 02s`, `1h 05m`; `—` when unknown. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  const v = Math.max(0, ms);
  if (v < 1000) return `${Math.round(v)}ms`;
  if (v < 10_000) return `${(Math.floor(v / 100) / 10).toFixed(1)}s`;
  const s = Math.round(v / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Compact token count: `950`, `4.8k`, `48k`, `1.2M`. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function tokensLabel(run: RunRecord): string {
  const u = run.usage;
  const approx = u.estimated ? '≥' : '';
  const cacheParts = [
    u.cachedInputTokens ? `+${formatNumber(u.cachedInputTokens)} cached` : '',
    u.cacheWriteTokens ? `${formatNumber(u.cacheWriteTokens)} written to cache` : '',
  ].filter(Boolean);
  const cached = cacheParts.length ? ` (${cacheParts.join(', ')})` : '';
  const reasoning = u.reasoningTokens ? `, reasoning ${formatNumber(u.reasoningTokens)}` : '';
  const requests = u.requests ? `, ${formatNumber(u.requests)} request${u.requests === 1 ? '' : 's'}` : '';
  const note = u.estimated ? ' (partly estimated: the provider did not report token counts)' : '';
  return `in ${approx}${formatNumber(u.inputTokens)}${cached} / out ${approx}${formatNumber(u.outputTokens)}${reasoning}${requests}${note}`;
}

/**
 * `$0.42 (reported by the provider)`, `~$0.31 (estimated tokens × pricing)`, `$0.42 + unknown (…)`, or
 * `unknown — …`; undefined for runs without cost data.
 */
export function costLabel(run: Pick<RunRecord, 'cost'>): string | undefined {
  const c = run.cost;
  if (!c) return undefined;
  const hint = c.unpriced.length
    ? `no price for ${c.unpriced.join(', ')}; set \`pricing\` in the config`
    : '';
  if (c.basis.length === 0) return `unknown — ${hint || 'the provider reported no cost'}`;
  const approx = c.basis.includes('estimated') ? '~' : '';
  const how = c.basis
    .map((b) =>
      b === 'reported'
        ? 'reported by the provider'
        : b === 'priced'
          ? 'tokens × pricing'
          : 'estimated tokens × pricing',
    )
    .join(', ');
  const known = `${approx}${formatMoney(c)}`;
  if (c.unknownTasks === 0) return `${known} (${how})`;
  return `${known} + unknown (${how}; ${c.unknownTasks} model call${c.unknownTasks === 1 ? '' : 's'} without cost: ${hint})`;
}

/**
 * `4 of 5 chunks and 3 of 3 verdicts from the cache, ≈ 120k tokens saved`; undefined when the cache was off.
 */
export function cacheLabel(run: Pick<RunRecord, 'cache'>): string | undefined {
  const c = run.cache;
  if (!c) return undefined;
  const parts = [`${c.hits} of ${c.hits + c.misses} chunk${c.hits + c.misses === 1 ? '' : 's'}`];
  if (c.critiqueHits + c.critiqueMisses > 0) {
    const verdicts = c.critiqueHits + c.critiqueMisses;
    parts.push(`${c.critiqueHits} of ${verdicts} verdict${verdicts === 1 ? '' : 's'}`);
  }
  const saved = c.saved.inputTokens + c.saved.outputTokens;
  return `${parts.join(' and ')} from the cache${saved ? `, ≈ ${formatTokens(saved)} tokens saved` : ''}`;
}

const FAILURE_ADVICE: Record<FailureKind, string> = {
  timeout: 'ran out of time — raise review.timeout / review.maxTimeoutMs, or lower --max-chunk-tokens',
  stalled:
    'the agent stopped responding — check it with `code-reviewer providers test`, or raise review.stallTimeoutMs',
  'step-limit': 'used every tool step — raise review.maxSteps (API providers) or lower --max-chunk-tokens',
  'output-limit':
    'the answer hit the output limit — raise roles.review.maxOutputTokens or lower --max-chunk-tokens',
  'context-limit':
    'the prompt exceeds the context window — set roles.review.contextWindow or lower --max-chunk-tokens',
  'no-output': 'answered without findings, even after a repair turn — try another model (--model)',
  refusal: 'the model declined — use another model (--model or models.fallbacks)',
  unavailable: 'no usable model — see `code-reviewer providers list` and models.fallbacks',
  auth: 'credentials missing or expired — log in to the provider again',
  budget:
    'review.maxCost was reached before this part was reviewed — raise it (--max-cost), or review less (essential depth, fewer passes)',
  aborted: 'interrupted',
  error: 'unexpected error — rerun with --verbose for details',
};

/** What went wrong with a failed chunk and what to change, e.g. `timeout: ran out of time — raise …`. */
export function failureAdvice(kind: FailureKind | undefined): string {
  return kind ? `${kind}: ${FAILURE_ADVICE[kind] ?? FAILURE_ADVICE.error}` : FAILURE_ADVICE.error;
}

/** `provider:model (reasoning level)` for a role, or undefined when the role is off. */
export function routingLabel(run: Pick<RunRecord, 'routing'>, role: Role): string | undefined {
  const r = run.routing[role];
  if (!r) return undefined;
  return `${r.provider}${r.model ? `:${r.model}` : ''} (reasoning ${r.reasoning})`;
}

export function targetLabel(run: Pick<RunRecord, 'target'>): string {
  if (run.target.kind === 'diff') {
    return `diff ${run.target.base}..${run.target.head} (merge-base ${run.target.mergeBase.slice(0, 8)}, head ${run.target.headSha.slice(0, 8)})`;
  }
  return `files ${run.target.paths.length ? run.target.paths.join(', ') : '.'}`;
}

/** Short review target: `origin/develop … feature/login` or `files src, lib`. */
export function refsLabel(target: RunTarget, ellipsis = '…'): string {
  if (target.kind === 'diff') return `${target.base} ${ellipsis} ${target.head}`;
  return `files ${target.paths.length ? target.paths.join(', ') : '.'}`;
}

/** One-line summary used by the CLI, the reports and `runs list`. */
export function summaryLine(run: RunRecord): string {
  const c = severityCounts(run.findings);
  const parts = (Object.keys(c) as Severity[]).filter((s) => c[s] > 0).map((s) => `${c[s]} ${s}`);
  const total = run.findings.length;
  const head = total === 0 ? 'No findings' : `${total} finding${total === 1 ? '' : 's'}: ${parts.join(', ')}`;
  const byCritique = run.rejected.filter((f) => f.droppedReason === 'critique').length;
  const byThreshold = run.rejected.filter((f) => f.droppedReason === 'below-threshold').length;
  const bySeverity = run.rejected.filter((f) => f.droppedReason === 'below-severity').length;
  const byValidation = run.rejected.length - byCritique - byThreshold - bySeverity;
  const extras = [
    byCritique ? `${byCritique} rejected by self-critique` : '',
    byThreshold ? `${byThreshold} below confidence threshold ${run.options.minConfidence}` : '',
    bySeverity ? `${bySeverity} below severity ${run.options.minSeverity ?? 'major'}` : '',
    byValidation ? `${byValidation} dropped by validation` : '',
  ].filter(Boolean);
  return extras.length ? `${head} · ${extras.join(' · ')}` : head;
}

// ---------------------------------------------------------------------------
// Detected stack
// ---------------------------------------------------------------------------

export interface StackEntry {
  id: string;
  name: string;
  category: TechCategory;
  score: number;
}

/** Techs below this combined score are not shown in summaries (unless a package root lists them). */
export const STACK_DISPLAY_MIN_SCORE = 0.5;

const CATEGORY_ORDER: Record<TechCategory, number> = {
  framework: 0,
  database: 1,
  orm: 2,
  cloud: 3,
  infra: 4,
  ci: 5,
  tool: 6,
  runtime: 7,
  language: 8,
};

/**
 * Techs worth showing, most relevant first (frameworks, databases, ORMs, infra, …; languages last).
 * For a {@link StackProfile}, techs listed by a package root always count as detected.
 */
export function stackEntries(stack: StackProfile | StackEntry[] | undefined): StackEntry[] {
  if (!stack) return [];
  const list: StackEntry[] = Array.isArray(stack) ? stack : stack.techs;
  const active = Array.isArray(stack) ? undefined : new Set(stack.packages.flatMap((p) => p.techs));
  return list
    .filter((t) => active?.has(t.id) || t.score >= STACK_DISPLAY_MIN_SCORE)
    .sort(
      (a, b) =>
        (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9) ||
        b.score - a.score ||
        a.name.localeCompare(b.name),
    );
}

/**
 * `Next.js · React · PostgreSQL · Prisma · Docker +2`. Languages are listed only when nothing else was
 * detected (they are obvious from the file list).
 */
export function stackSummary(stack: StackProfile | StackEntry[] | undefined, max = 6, sep = ' · '): string {
  const entries = stackEntries(stack);
  const nonLang = entries.filter((t) => t.category !== 'language');
  const shown = nonLang.length ? nonLang : entries;
  if (shown.length === 0) return '';
  const head = shown.slice(0, max).map((t) => t.name);
  return shown.length > max ? `${head.join(sep)} +${shown.length - max}` : head.join(sep);
}

// ---------------------------------------------------------------------------
// Static analyzers
// ---------------------------------------------------------------------------

export const ANALYZER_STATUS_SYMBOL: Record<AnalyzerRun['status'], string> = {
  ok: '✓',
  skipped: '–',
  failed: '✖',
  timeout: '⏱',
};

/** `secretlint ✓ 2 hints · patterns ✓ 5 hints · shellcheck –` */
export function analyzersSummary(
  runs: AnalyzerRun[] | undefined,
  symbols: Record<AnalyzerRun['status'], string> = ANALYZER_STATUS_SYMBOL,
  sep = ' · ',
): string {
  if (!runs?.length) return '';
  return runs
    .map((r) => {
      const hits = r.status === 'ok' && r.hits > 0 ? ` ${r.hits} hint${r.hits === 1 ? '' : 's'}` : '';
      return `${r.label} ${symbols[r.status] ?? r.status}${hits}`;
    })
    .join(sep);
}

// ---------------------------------------------------------------------------
// Skills, tools, rejections, fallbacks
// ---------------------------------------------------------------------------

/** Skills with the number of chunks that used them, most used first. */
export function skillUsage(
  run: Pick<RunRecord, 'chunks' | 'skillsUsed'>,
): Array<{ id: string; chunks: number }> {
  const counts = new Map<string, number>();
  for (const c of run.chunks) for (const s of new Set(c.skills)) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const s of run.skillsUsed ?? []) if (!counts.has(s)) counts.set(s, 0);
  return [...counts]
    .map(([id, chunks]) => ({ id, chunks }))
    .sort((a, b) => b.chunks - a.chunks || a.id.localeCompare(b.id));
}

/** Tool calls by tool name across the run (run.toolUsage, else summed over chunks), most used first. */
export function toolUsage(
  run: Pick<RunRecord, 'chunks' | 'toolUsage'>,
): Array<{ tool: string; calls: number }> {
  let usage = run.toolUsage;
  if (!usage || Object.keys(usage).length === 0) {
    usage = {};
    for (const c of run.chunks) {
      for (const [tool, n] of Object.entries(c.toolCalls ?? {})) usage[tool] = (usage[tool] ?? 0) + n;
    }
  }
  return Object.entries(usage)
    .filter(([, n]) => n > 0)
    .map(([tool, calls]) => ({ tool, calls }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
}

/** `read_file×4 grep×2` (sorted by count). */
export function toolCallsLabel(calls: Record<string, number> | undefined, times = '×', sep = ' '): string {
  return Object.entries(calls ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tool, n]) => `${tool}${times}${n}`)
    .join(sep);
}

const REASON_LABELS: Record<string, string> = {
  critique: 'rejected by critique',
  'unknown-file': 'unknown file',
  'line-out-of-range': 'line out of range',
  'outside-changed-lines': 'outside the changed lines',
  duplicate: 'duplicate',
};

/** Human label for a `droppedReason`. */
export function rejectionLabel(
  reason: string | undefined,
  options: Pick<RunRecord['options'], 'minConfidence' | 'minSeverity'>,
): string {
  if (!reason) return 'dropped';
  if (reason === 'below-threshold') return `below confidence ${options.minConfidence}`;
  if (reason === 'below-severity') return `below severity ${options.minSeverity ?? 'major'}`;
  return REASON_LABELS[reason] ?? reason.replace(/-/g, ' ');
}

/** `essential (critical/major only)` / `full` — how deep the run went (older runs: full). */
export function depthLabel(run: Pick<RunRecord, 'options'>): string {
  const depth = run.options.depth ?? 'full';
  const floor = run.options.minSeverity;
  const shown = floor && floor !== 'info' ? SEVERITIES.slice(0, SEVERITIES.indexOf(floor) + 1).join('/') : '';
  return shown && shown !== 'critical/major/minor/info' ? `${depth} (${shown} only)` : depth;
}

/** Rejected findings grouped by reason, most frequent first. */
export function rejectedByReason(
  run: Pick<RunRecord, 'rejected' | 'options'>,
): Array<{ reason: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of run.rejected) {
    const reason = f.droppedReason ?? 'dropped';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, count, label: rejectionLabel(reason, run.options) }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** `review: claude:opus → claude:sonnet (model unavailable)` */
export function fallbackLabel(
  f: { role: Role; from: string; to: string; reason: string },
  arrow = '→',
): string {
  return `${f.role}: ${f.from} ${arrow} ${f.to}${f.reason ? ` (${f.reason})` : ''}`;
}

/** `claude:sonnet` for a chunk that reported its provider/model. */
export function chunkModelLabel(c: { provider?: string; model?: string }): string {
  if (!c.provider && !c.model) return '';
  return [c.provider, c.model].filter(Boolean).join(':');
}

const COVERAGE_WORDS: Record<FileCoverage['status'], string> = {
  reviewed: 'reviewed',
  interrupted: 'interrupted (early answer)',
  partial: 'partly failed',
  failed: 'not reviewed',
  skipped: 'skipped',
};

/** Status of a file in the coverage map, in words. */
export function coverageStatus(f: FileCoverage): string {
  return `${COVERAGE_WORDS[f.status]}${f.reason ? `: ${f.reason}` : ''}`;
}

/** `12 of 14 changed files reviewed in full · 1 not reviewed · 1 skipped`, or undefined without a map. */
export function coverageLabel(run: RunRecord): string | undefined {
  const cov = run.coverage;
  if (!cov?.length) return undefined;
  const count = (s: FileCoverage['status']) => cov.filter((f) => f.status === s).length;
  const parts = [`${count('reviewed')} of ${cov.length} changed files reviewed in full`];
  for (const s of ['interrupted', 'partial', 'failed', 'skipped'] as const) {
    if (count(s)) parts.push(`${count(s)} ${COVERAGE_WORDS[s]}`);
  }
  return parts.join(' · ');
}

/** Rows of the coverage table: file, changed lines, status, opened by the model, findings (kept). */
export function coverageRows(run: RunRecord): Array<[string, number, string, boolean, number]> {
  const findings = new Map<string, number>();
  for (const f of run.findings) findings.set(f.file, (findings.get(f.file) ?? 0) + 1);
  return (run.coverage ?? []).map((f) => [
    f.path,
    f.changed,
    coverageStatus(f),
    f.opened === true,
    findings.get(f.path) ?? 0,
  ]);
}
