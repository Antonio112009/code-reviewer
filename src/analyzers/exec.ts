import { type RunResult, runManaged } from '../util/processes';
import type { AnalyzerContext } from './types';

/** A failed or timed-out tool run; the runner turns it into an `AnalyzerRun` status. */
export class AnalyzerError extends Error {
  constructor(
    readonly status: 'failed' | 'timeout' | 'skipped',
    reason: string,
  ) {
    super(reason);
  }
}

const MAX_OUTPUT = 16 * 1024 * 1024;

/**
 * Runs the analyzer's resolved tool with `args` under the process registry: remaining time budget as
 * timeout, the analyzer's AbortSignal, the scrubbed env. Throws `AnalyzerError` on timeout/abort and on
 * exit codes outside `okCodes`.
 */
export async function execTool(
  ctx: AnalyzerContext,
  args: string[],
  opts: { cwd: string; okCodes?: number[]; input?: string; label?: string },
): Promise<RunResult> {
  const tool = ctx.tool;
  if (!tool) throw new AnalyzerError('failed', 'no executable resolved');
  const remaining = ctx.deadline - Date.now();
  if (remaining <= 0) throw new AnalyzerError('timeout', `timed out after ${ctx.timeoutMs} ms`);
  if (ctx.signal.aborted) throw new AnalyzerError('failed', 'interrupted');
  let res: RunResult;
  try {
    res = await runManaged(tool.command, [...tool.prefixArgs, ...args], {
      label: opts.label ?? 'analyzer',
      cwd: opts.cwd,
      env: ctx.env,
      input: opts.input,
      timeoutMs: remaining,
      signal: ctx.signal,
      maxBuffer: MAX_OUTPUT,
      registry: ctx.registry,
    });
  } catch (err) {
    throw new AnalyzerError('failed', (err as Error).message);
  }
  if (res.timedOut || Date.now() >= ctx.deadline) {
    throw new AnalyzerError('timeout', `timed out after ${ctx.timeoutMs} ms`);
  }
  if (res.aborted) throw new AnalyzerError('failed', 'interrupted');
  const ok = opts.okCodes ?? [0];
  if (res.exitCode === null || !ok.includes(res.exitCode)) {
    const detail = firstLine(res.stderr) || firstLine(res.stdout);
    throw new AnalyzerError(
      'failed',
      `exited with ${res.exitCode ?? res.signal}${detail ? `: ${detail}` : ''}`,
    );
  }
  return res;
}

/** First non-empty line, trimmed and capped (for failure reasons). */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const t = line.trim();
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

/** Parses JSON tool output; throws `AnalyzerError` with a short reason when it is not JSON. */
export function parseJsonOutput(text: string, what: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new AnalyzerError('failed', `${what}: empty output`);
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AnalyzerError('failed', `${what}: output is not JSON (${firstLine(trimmed)})`);
  }
}
