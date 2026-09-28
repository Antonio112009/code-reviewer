import { type AnthropicProvider as AnthropicSdk, createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { AnthropicProviderConfig } from '../config/schema';
import { runAiSdkTask } from './ai-sdk-agent';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from './types';

/**
 * The Anthropic API directly (Vercel AI SDK), with the key from `ANTHROPIC_API_KEY`. Unlike an agent such as
 * Claude Code, a task carries only our instructions, prompt and tools, and the API caches the growing prompt
 * of the tool loop (request-level `cache_control`).
 */
export class AnthropicProvider implements Provider {
  readonly kind = 'api' as const;
  private readonly anthropic: AnthropicSdk;

  constructor(
    readonly id: string,
    private readonly cfg: AnthropicProviderConfig,
    /** Test hook: the language model for a model id (default: the Anthropic API). */
    private readonly modelFor?: (modelId: string) => LanguageModel,
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
    return runAiSdkTask(task, {
      providerId: this.id,
      label: 'Anthropic API',
      model: this.modelFor?.(modelId) ?? this.anthropic(modelId),
      modelId,
      caching: { kind: 'request', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
    });
  }

  async dispose(): Promise<void> {}
}
