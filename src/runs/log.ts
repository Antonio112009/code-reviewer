import type { ReviewEvent } from '../review/events';
import type { LogLevel } from '../util/logger';

/** A run's log is capped: a runaway agent must not fill the disk. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LINE = 4_000;

function clip(text: string): string {
  return text.length > MAX_LINE
    ? `${text.slice(0, MAX_LINE)}…(${text.length - MAX_LINE} more characters)`
    : text;
}

/** `chunk c001 done: 2 finding(s), claude:sonnet, 1 attempt(s), 41s` — what a chunk ended with. */
function chunkDone(e: Extract<ReviewEvent, { type: 'chunk-done' }>): string {
  const r = e.record;
  const parts = [
    r.status === 'failed' ? `${r.failure ?? 'error'}: ${r.error ?? ''}` : `${r.findings} finding(s)`,
    [r.provider, r.model].filter(Boolean).join(':'),
    r.attempts !== undefined ? `${r.attempts} attempt(s)` : '',
    r.durationMs !== undefined ? `${Math.round(r.durationMs / 1000)}s` : '',
    r.usage
      ? `tokens in ${r.usage.inputTokens}${r.usage.cachedInputTokens ? ` (+${r.usage.cachedInputTokens} cached)` : ''} out ${r.usage.outputTokens}${r.usage.estimated ? ' (estimated)' : ''}`
      : '',
    r.cost ? `cost ${r.cost.amount.toFixed(4)} ${r.cost.currency}` : '',
    r.cached ? `cached: ${r.cached}` : '',
    ...(r.recovery ?? []).map((n) => `recovery: ${n}`),
  ].filter(Boolean);
  return `chunk ${r.id} ${r.status}: ${parts.join(', ')}`;
}

/** One log line for the pipeline events worth keeping (tool calls are logged by the providers). */
export function describeEvent(e: ReviewEvent): string | undefined {
  switch (e.type) {
    case 'phase':
      return `phase ${e.phase}: ${e.message}`;
    case 'phase-done':
      return `phase ${e.phase} done in ${e.durationMs}ms`;
    case 'refs':
      return e.target.kind === 'diff'
        ? `refs ${e.target.base}..${e.target.head} (merge-base ${e.target.mergeBase}, head ${e.target.headSha}); ${e.refs.explanation.join('; ')}`
        : undefined;
    case 'analyzers':
      return `analyzers: ${e.runs.map((r) => `${r.id} ${r.status}${r.reason ? ` (${r.reason})` : ''}`).join(', ')}; ${e.hits} hit(s)`;
    case 'plan': {
      const p = e.plan;
      const routes = Object.entries(p.routing)
        .map(([role, r]) => (r ? `${role} ${r.provider}:${r.model ?? 'default'} (${r.reasoning})` : ''))
        .filter(Boolean)
        .join(', ');
      return `plan: ${p.units} file(s) in ${p.chunks.length} chunk(s), ${p.totalTokens} tokens, budget ${p.budget}, depth ${p.depth}; ${routes}; skipped ${p.skipped.length}`;
    }
    case 'chunk-start':
      return `chunk ${e.chunk.id} start: ${e.chunk.files.join(', ')} (${e.chunk.tokens} tokens; skills ${e.record.skills.join(', ') || 'none'}; ${e.record.hints ?? 0} hint(s))`;
    case 'chunk-activity':
      return e.note ? `chunk ${e.chunkId}: ${e.note}` : undefined;
    case 'chunk-done':
      return chunkDone(e);
    case 'critique-start':
      return `critique: ${e.findings} finding(s) in ${e.batches} batch(es)`;
    case 'fallback':
      return `fallback ${e.role}: ${e.from} -> ${e.to} (${e.reason})`;
    case 'warning':
      return `warning: ${e.message}`;
    case 'done': {
      const r = e.run;
      const cost = r.cost
        ? `, cost ${r.cost.amount.toFixed(4)} ${r.cost.currency}${r.cost.unknownTasks ? ` + ${r.cost.unknownTasks} unknown` : ''}`
        : '';
      const cache = r.cache ? `, cache ${r.cache.hits}/${r.cache.hits + r.cache.misses} chunks` : '';
      return `done: ${r.status}, ${r.findings.length} finding(s), ${r.rejected.length} rejected, tokens in ${r.usage.inputTokens} (+${r.usage.cachedInputTokens ?? 0} cached) out ${r.usage.outputTokens}${cost}${cache}`;
    }
    default:
      return undefined;
  }
}

/**
 * Everything a run logged — debug messages included, whatever `--verbose` says — and its main events,
 * saved as `run.log` next to the run so a failed or odd run (in CI above all) can be understood later.
 */
export class RunLog {
  private readonly lines: string[] = [];
  private bytes = 0;
  private truncated = false;

  constructor(private readonly now: () => Date = () => new Date()) {}

  add(level: Exclude<LogLevel, 'silent'>, message: string): void {
    this.push(`${level.toUpperCase().padEnd(5)} ${message}`);
  }

  event(e: ReviewEvent): void {
    const line = describeEvent(e);
    if (line) this.push(`EVENT ${line}`);
  }

  private push(text: string): void {
    if (this.truncated) return;
    const line = `${this.now().toISOString()} ${clip(text)}`;
    if (this.bytes + line.length > MAX_BYTES) {
      this.truncated = true;
      this.lines.push(`${this.now().toISOString()} (log truncated at ${MAX_BYTES} bytes)`);
      return;
    }
    this.lines.push(line);
    this.bytes += line.length + 1;
  }

  text(): string {
    return this.lines.length ? `${this.lines.join('\n')}\n` : '';
  }
}
