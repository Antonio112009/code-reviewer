import { type AmazonBedrockProvider, createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { generateText, hasToolCall, isStepCount } from 'ai';
import { AWS_REGION_RE, type BedrockProviderConfig } from '../config/schema';
import { toAiSdkTools } from '../tools/ai-sdk';
import { SUBMIT_TOOLS, toolsFor } from '../tools/definitions';
import { SubmissionCollector } from '../tools/submission';
import { bedrockRegion } from './aws';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from './types';

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

    try {
      const result = await generateText({
        model: this.bedrock(modelId),
        instructions: task.instructions,
        prompt: task.prompt,
        tools,
        stopWhen: [isStepCount(task.maxSteps), hasToolCall(SUBMIT_TOOLS[task.kind].name)],
        reasoning: task.reasoning === 'none' ? 'none' : task.reasoning,
        maxOutputTokens: task.maxOutputTokens,
        abortSignal: AbortSignal.any(signals),
        maxRetries: 3,
      });
      const toolCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
      return {
        submission: collector.submission,
        text: result.text,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens ?? undefined,
          cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? undefined,
        },
        model: modelId,
        stopReason: result.finishReason,
        toolCalls,
        toolUsage,
        warnings: (result.warnings ?? []).map((w) => JSON.stringify(w)),
      };
    } catch (err) {
      throw new ProviderError(`Bedrock call failed (${modelId}): ${(err as Error).message}`, this.id, {
        cause: err,
      });
    }
  }

  async dispose(): Promise<void> {}
}
