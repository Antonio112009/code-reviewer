import { type AmazonBedrockProvider, createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { LanguageModel } from 'ai';
import { AWS_REGION_RE, type BedrockProviderConfig } from '../config/schema';
import { runAiSdkTask } from './ai-sdk-agent';
import { bedrockRegion } from './aws';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from './types';

/** Bedrock prompt caching (cache points) is offered for Anthropic's models. */
const CACHEABLE_MODEL = /anthropic|claude/i;

/**
 * AWS Bedrock through the Vercel AI SDK (Converse API).
 * Credentials: AWS_BEARER_TOKEN_BEDROCK, or the standard AWS chain (env, profile, SSO, IMDS).
 */
export class BedrockProvider implements Provider {
  readonly kind = 'api' as const;
  private readonly bedrock: AmazonBedrockProvider;

  constructor(
    readonly id: string,
    private readonly cfg: BedrockProviderConfig,
    /** Test hook: the language model for a model id (default: Bedrock). */
    private readonly modelFor?: (modelId: string) => LanguageModel,
  ) {
    const region = bedrockRegion(cfg);
    if (!AWS_REGION_RE.test(region)) {
      throw new ProviderError(`Invalid AWS region "${region}" for Bedrock provider "${id}"`, id);
    }
    // The AI SDK only reads static env credentials by itself; the node chain adds profiles and SSO.
    const useChain = !process.env.AWS_BEARER_TOKEN_BEDROCK;
    this.bedrock = createAmazonBedrock({
      region,
      ...(useChain
        ? { credentialProvider: fromNodeProviderChain(cfg.profile ? { profile: cfg.profile } : {}) }
        : {}),
    });
  }

  async run(task: AgentTask): Promise<AgentResult> {
    const modelId = task.model ?? this.cfg.defaultModel;
    if (!modelId) {
      throw new ProviderError(
        `No model configured for Bedrock provider "${this.id}". Set roles.<role>.model or providers.${this.id}.defaultModel (e.g. an inference profile id).`,
        this.id,
      );
    }
    return runAiSdkTask(task, {
      providerId: this.id,
      label: 'Bedrock',
      model: this.modelFor?.(modelId) ?? this.bedrock(modelId),
      modelId,
      ...(CACHEABLE_MODEL.test(modelId)
        ? { caching: { kind: 'messages', marker: { bedrock: { cachePoint: { type: 'default' } } } } }
        : {}),
    });
  }

  async dispose(): Promise<void> {}
}
