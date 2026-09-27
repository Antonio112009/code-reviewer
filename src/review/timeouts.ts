import type { ReviewSettings } from '../config/schema';

/** Fixed overhead of an agent turn (startup, tool discovery, final answer). */
const BASE_MS = 120_000;
/** Additional time per 1k tokens of code in the prompt (reading + tool calls scale with size). */
const PER_KTOKEN_MS = 12_000;
const MIN_MS = 60_000;

/**
 * Timeout for one task. `auto` scales with the prompt size so small chunks fail fast when an agent hangs
 * while large chunks get room; the result is always capped by `maxTimeoutMs`.
 */
export function taskTimeoutMs(
  settings: Pick<ReviewSettings, 'timeout' | 'maxTimeoutMs'>,
  promptTokens: number,
): number {
  const raw =
    settings.timeout === 'auto'
      ? BASE_MS + Math.ceil(promptTokens / 1000) * PER_KTOKEN_MS
      : Math.round(settings.timeout * 1000);
  return Math.min(settings.maxTimeoutMs, Math.max(MIN_MS, raw));
}
