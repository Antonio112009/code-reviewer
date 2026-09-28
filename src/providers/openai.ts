import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { OpenAiProviderConfig } from '../config/schema';
import { runAiSdkTask } from './ai-sdk-agent';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from './types';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_KEY_ENV = 'OPENAI_API_KEY';

/** Where requests go and which environment variable holds the key (`undefined`: no authentication). */
export function openAiEndpoint(cfg: OpenAiProviderConfig): { baseUrl: string; keyEnv?: string } {
  const keyEnv = cfg.apiKeyEnv ?? DEFAULT_OPENAI_KEY_ENV;
  return {
    baseUrl: (cfg.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, ''),
    ...(keyEnv === 'none' ? {} : { keyEnv }),
  };
}

/**
 * An OpenAI-compatible chat completions API (OpenAI, OpenRouter, Ollama, vLLM, LM Studio, LiteLLM, …) through the
 * shared AI SDK tool loop. The model must support tool calling: findings come in through `submit_findings`.
 */
export class OpenAiProvider implements Provider {
  readonly kind = 'api' as const;
  private readonly endpoint: { baseUrl: string; keyEnv?: string };

  constructor(
    readonly id: string,
    private readonly cfg: OpenAiProviderConfig,
    /** Test hook: the language model for a model id (default: the configured API). */
    private readonly modelFor?: (modelId: string) => LanguageModel,
  ) {
    this.endpoint = openAiEndpoint(cfg);
  }

  async run(task: AgentTask): Promise<AgentResult> {
    const modelId = task.model ?? this.cfg.defaultModel;
    if (!modelId) {
      throw new ProviderError(
        `No model configured for the OpenAI-compatible provider "${this.id}". Pass --model, or set roles.<role>.model or providers.${this.id}.defaultModel.`,
        this.id,
      );
    }
    const { baseUrl, keyEnv } = this.endpoint;
    const apiKey = keyEnv ? process.env[keyEnv]?.trim() : undefined;
    if (!this.modelFor && keyEnv && !apiKey) {
      throw new ProviderError(
        `${keyEnv} is not set: the provider "${this.id}" (${baseUrl}) needs an API key. For a server without authentication, set providers.${this.id}.apiKeyEnv to "none".`,
        this.id,
      );
    }
    const model =
      this.modelFor?.(modelId) ??
      createOpenAICompatible({
        name: this.id,
        baseURL: baseUrl,
        ...(apiKey ? { apiKey } : {}),
        includeUsage: true,
      }).chatModel(modelId);
    return runAiSdkTask(task, {
      providerId: this.id,
      label: `OpenAI-compatible API (${new URL(baseUrl).host})`,
      model,
      modelId,
      reasoning: this.cfg.reasoningEffort === true,
    });
  }

  async dispose(): Promise<void> {}
}
