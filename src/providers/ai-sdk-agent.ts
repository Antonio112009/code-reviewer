import { generateText, hasToolCall, isStepCount, type LanguageModel, type ModelMessage } from 'ai';
import { toAiSdkTools } from '../tools/ai-sdk';
import { SUBMIT_TOOLS, toolsFor } from '../tools/definitions';
import { SubmissionCollector } from '../tools/submission';
import { mayAskForMore, salvagePrompt } from './salvage';
import { type AgentResult, type AgentTask, ProviderError } from './types';

/** Share of the task timeout after which the next step is the last one. */
const WRAP_UP_SHARE = 0.8;

type ProviderOptions = NonNullable<ModelMessage['providerOptions']>;

/**
 * Prompt caching for the tool loop, where every step sends the whole conversation again:
 * - `request`: provider options that let the API cache the prompt prefix by itself (Anthropic's request-level
 *   `cache_control`);
 * - `messages`: a cache point on the instructions and on the newest message of each step (Bedrock
 *   `cachePoint`); older points are moved, never piled up (providers allow only a few per request).
 */
export type PromptCaching =
  | { kind: 'request'; providerOptions: ProviderOptions }
  | { kind: 'messages'; marker: ProviderOptions };

export interface AiSdkModel {
  providerId: string;
  /** For error messages: `Bedrock`, `Anthropic API`. */
  label: string;
  model: LanguageModel;
  modelId: string;
  caching?: PromptCaching;
  /** Send the task's reasoning level (default true); some OpenAI-compatible models reject `reasoning_effort`. */
  reasoning?: boolean;
}

/** Messages with the cache marker on the newest one only (other providerOptions kept). */
export function withCachePoint(messages: ModelMessage[], marker: ProviderOptions): ModelMessage[] {
  const keys = Object.keys(marker);
  return messages.map((m, i) => {
    const rest = { ...(m.providerOptions ?? {}) };
    for (const k of keys) delete rest[k];
    const providerOptions = i === messages.length - 1 ? { ...rest, ...marker } : rest;
    const { providerOptions: _old, ...message } = m;
    return (Object.keys(providerOptions).length ? { ...message, providerOptions } : message) as ModelMessage;
  });
}

/**
 * One task as an AI SDK tool loop (read-only tools and the submit tool), shared by the direct API providers:
 * the last step — or one after most of the time is gone — offers only the submit tool and asks for the
 * findings so far; a loop that used every step without submitting reports `max_turn_requests`.
 * Findings are submitted as they are verified, so a review continues after a submission until the model
 * answers without a tool call (or wraps up); verdicts end the loop on their first submission.
 */
export async function runAiSdkTask(task: AgentTask, m: AiSdkModel): Promise<AgentResult> {
  const collector = new SubmissionCollector();
  const toolUsage: Record<string, number> = {};
  const tools = toAiSdkTools(
    toolsFor(task.kind, task.readTools, { skills: task.skills }),
    { root: task.root, git: task.git, collector, skills: task.skills },
    (name) => {
      toolUsage[name] = (toolUsage[name] ?? 0) + 1;
      task.onActivity?.({ kind: 'tool', name });
    },
  );
  const signals = [AbortSignal.timeout(task.timeoutMs), ...(task.signal ? [task.signal] : [])];
  const submit = SUBMIT_TOOLS[task.kind].name;
  const wrapUpAt = Date.now() + task.timeoutMs * WRAP_UP_SHARE;
  const caching = m.caching;
  const marker = caching?.kind === 'messages' ? caching.marker : undefined;
  const instructions = (text: string) =>
    marker ? { role: 'system' as const, content: text, providerOptions: marker } : text;
  const incremental = task.kind === 'findings';
  let salvaged: string | undefined;

  try {
    const result = await generateText({
      model: m.model,
      instructions: instructions(task.instructions),
      prompt: task.prompt,
      tools,
      stopWhen: incremental
        ? // A submission during the wrap-up is the last one.
          [isStepCount(task.maxSteps), (run) => salvaged !== undefined && hasToolCall(submit)(run)]
        : [isStepCount(task.maxSteps), hasToolCall(submit)],
      ...(caching?.kind === 'request' ? { providerOptions: caching.providerOptions } : {}),
      // Not a forced tool choice for the last step: that is rejected together with extended thinking.
      prepareStep: ({ stepNumber, messages }) => {
        const cached = marker ? { messages: withCachePoint(messages, marker) } : {};
        if (task.salvage === false || task.maxSteps < 2 || !mayAskForMore(task.kind, collector.submitted)) {
          return cached;
        }
        const why =
          stepNumber >= task.maxSteps - 1
            ? 'this is the last step'
            : Date.now() >= wrapUpAt
              ? 'the time limit is close'
              : undefined;
        if (!why) return cached;
        salvaged = why;
        const prompt = salvagePrompt(task.kind, why, collector.submitted);
        return {
          ...cached,
          activeTools: [submit],
          instructions: instructions(`${task.instructions}\n\n${prompt}`),
        };
      },
      ...(m.reasoning === false ? {} : { reasoning: task.reasoning }),
      maxOutputTokens: task.maxOutputTokens,
      abortSignal: AbortSignal.any(signals),
      maxRetries: 3,
    });
    const toolCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
    const details = result.usage.inputTokenDetails;
    const cacheRead = details?.cacheReadTokens ?? 0;
    const cacheWrite = details?.cacheWriteTokens ?? 0;
    const input = result.usage.inputTokens ?? 0;
    // Every step used without a submission: report it like an agent's step limit.
    const outOfSteps =
      !collector.submitted && result.finishReason === 'tool-calls' && result.steps.length >= task.maxSteps;
    return {
      submission: collector.submission,
      text: result.text,
      usage: {
        inputTokens: details?.noCacheTokens ?? Math.max(0, input - cacheRead - cacheWrite),
        outputTokens: result.usage.outputTokens ?? 0,
        reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens ?? undefined,
        cachedInputTokens: cacheRead || undefined,
        cacheWriteTokens: cacheWrite || undefined,
        requests: result.steps.length,
      },
      model: m.modelId,
      stopReason: outOfSteps ? 'max_turn_requests' : result.finishReason,
      ...(salvaged && collector.submitted ? { salvaged } : {}),
      ...(collector.submission.reads ? { reads: collector.submission.reads } : {}),
      toolCalls,
      toolUsage,
      warnings: [
        ...(result.warnings ?? []).map((w) => JSON.stringify(w)),
        ...(salvaged && collector.submitted
          ? [`${salvaged}: the model submitted what it had found so far`]
          : []),
      ],
    };
  } catch (err) {
    throw new ProviderError(
      `${m.label} call failed (${m.modelId}): ${(err as Error).message}`,
      m.providerId,
      {
        cause: err,
      },
    );
  }
}
