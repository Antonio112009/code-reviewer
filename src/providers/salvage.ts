import { SUBMIT_TOOLS, type SubmitKind } from '../tools/definitions';
import { extractJson } from '../util/json';

/** Longest extra turn granted to collect an early answer. */
const MAX_SALVAGE_MS = 90_000;
const MIN_SALVAGE_MS = 30_000;

/** Stop reasons (ACP and AI SDK) of a turn cut off by an output or step limit. */
const LIMIT_STOPS: Record<string, string> = {
  max_tokens: 'the answer hit the output token limit',
  length: 'the answer hit the output token limit',
  max_turn_requests: 'the step limit was reached',
};

/**
 * Why a turn that submitted nothing should get one more short turn to submit what it has, or undefined
 * when it ended normally (or was aborted / refused).
 */
export function salvageReason(
  stopReason: string | undefined,
  interruptedBy: 'timeout' | 'stalled' | undefined,
): string | undefined {
  if (interruptedBy === 'timeout') return 'the time limit was reached';
  if (interruptedBy === 'stalled') return 'no progress was made for a while';
  return stopReason ? LIMIT_STOPS[stopReason] : undefined;
}

/**
 * A turn that ended on its own but handed in nothing: no submit call (checked by the caller) and no JSON
 * payload in its reply. Models sometimes finish a review — typically a clean one — with prose or nothing.
 */
export function endedWithoutSubmitting(stopReason: string | undefined, text: string): boolean {
  return stopReason === 'end_turn' && extractJson(text) === undefined;
}

/** Follow-up prompt for a turn that ended without submitting (its review itself is complete). */
export function submitReminderPrompt(kind: SubmitKind): string {
  const tool = SUBMIT_TOOLS[kind].name;
  const what =
    kind === 'findings'
      ? 'every defect you found (an empty list if there are none)'
      : 'a verdict for every finding you were given';
  return `You ended your turn without calling \`${tool}\`, so your review was not recorded. Do not read, search or open anything else. Call \`${tool}\` now with ${what}.`;
}

/** Time for the extra turn: a quarter of the task's timeout, within 30–90 s (never more than the task had). */
export function salvageTimeoutMs(taskTimeoutMs: number): number {
  const floor = Math.min(MIN_SALVAGE_MS, taskTimeoutMs);
  return Math.min(MAX_SALVAGE_MS, Math.max(floor, Math.round(taskTimeoutMs / 4)));
}

/** Follow-up prompt that asks for the results gathered so far through the submit tool. */
export function salvagePrompt(kind: SubmitKind, why: string): string {
  const tool = SUBMIT_TOOLS[kind].name;
  const what =
    kind === 'findings'
      ? 'the defects you have already confirmed (an empty list if there are none). Report only what the code you have seen supports'
      : 'a verdict for every finding you were given; use `uncertain` for those you could not check';
  return `Stop here: ${why}. Do not read, search or open anything else. Call \`${tool}\` now with ${what}. Keep each description short.`;
}
