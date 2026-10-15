import { createOpenAI } from '@ai-sdk/openai';
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

/** Whether the endpoint is OpenAI's own API, which gets the Responses API instead of chat completions. */
export function isOpenAiApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

/**
 * An OpenAI-compatible chat completions API (OpenAI, OpenRouter, Ollama, vLLM, LM Studio, LiteLLM, …) through the
 * shared AI SDK tool loop. The model must support tool calling: findings come in through `submit_findings`.
 *
 * OpenAI's own API goes through the Responses API: its current reasoning models (GPT-5.6 and later) refuse
 * function tools together with reasoning on chat completions. There the role's reasoning level is sent by
 * default (`reasoningEffort: false` turns it off for a model without reasoning).
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
    const responses = isOpenAiApi(baseUrl);
    const model =
      this.modelFor?.(modelId) ??
      (responses
        ? createOpenAI({ baseURL: baseUrl, ...(apiKey ? { apiKey } : {}) }).responses(modelId)
        : createOpenAICompatible({
            name: this.id,
            baseURL: baseUrl,
            ...(apiKey ? { apiKey } : {}),
            includeUsage: true,
          }).chatModel(modelId));
    return runAiSdkTask(task, {
      providerId: this.id,
      label: responses ? 'OpenAI API' : `OpenAI-compatible API (${new URL(baseUrl).host})`,
      model,
      modelId,
      reasoning: this.cfg.reasoningEffort ?? responses,
    });
  }

  async dispose(): Promise<void> {}
}
