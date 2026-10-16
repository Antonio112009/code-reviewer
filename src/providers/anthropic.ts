import { type AnthropicProvider as AnthropicSdk, createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { AnthropicProviderConfig } from '../config/schema';
import { runAiSdkTask } from './ai-sdk-agent';
import { type BatchOptions, BatchTimeout, runBatchTask } from './anthropic-batch';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from './types';

/** Longest wait for a batch answer before the task falls back to a regular request. */
export const BATCH_MAX_WAIT_MS = 20 * 60_000;

/**
 * The Anthropic API directly (Vercel AI SDK), with the key from `ANTHROPIC_API_KEY`. Unlike an agent such as
 * Claude Code, a task carries only our instructions, prompt and tools, and the API caches the growing prompt
 * of the tool loop (request-level `cache_control`). A task marked `batch` without read tools goes through the
 * Message Batches API at half the price, falling back to a regular request when the batch takes too long.
 */
export class AnthropicProvider implements Provider {
  readonly kind = 'api' as const;
  private readonly anthropic: AnthropicSdk;

  constructor(
    readonly id: string,
    private readonly cfg: AnthropicProviderConfig,
    /** Test hook: the language model for a model id (default: the Anthropic API). */
    private readonly modelFor?: (modelId: string) => LanguageModel,
    /** Test hook: batch transport overrides (fetch, sleep, waits). */
    private readonly batchHooks?: Partial<BatchOptions>,
  ) {
    this.anthropic = createAnthropic({});
  }

  async run(task: AgentTask): Promise<AgentResult> {
    const modelId = task.model ?? this.cfg.defaultModel;
    if (!modelId) {
      throw new ProviderError(
        `No model configured for the Anthropic provider "${this.id}". Set roles.<role>.model or providers.${this.id}.defaultModel.`,
        this.id,
      );
    }
    if (!this.modelFor && !process.env.ANTHROPIC_API_KEY?.trim()) {
      throw new ProviderError(
        'ANTHROPIC_API_KEY is not set: the Anthropic provider needs an API key.',
        this.id,
      );
    }
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const warnings: string[] = [];
    if (task.batch && !task.readTools && apiKey && (!this.modelFor || this.batchHooks)) {
      try {
        return await runBatchTask(task, {
          providerId: this.id,
          modelId,
          apiKey,
          maxWaitMs: BATCH_MAX_WAIT_MS,
          ...this.batchHooks,
        });
      } catch (err) {
        if (!(err instanceof BatchTimeout)) throw err;
        warnings.push(`${task.label}: ${err.message}; answered by a regular request instead`);
      }
    }
    const result = await runAiSdkTask(task, {
      providerId: this.id,
      label: 'Anthropic API',
      model: this.modelFor?.(modelId) ?? this.anthropic(modelId),
      modelId,
      caching: { kind: 'request', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
    });
    return warnings.length ? { ...result, warnings: [...warnings, ...result.warnings] } : result;
  }

  async dispose(): Promise<void> {}
}
