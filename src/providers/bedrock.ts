import { type AmazonBedrockProvider, createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { generateText, hasToolCall, isStepCount, type LanguageModel } from 'ai';
import { AWS_REGION_RE, type BedrockProviderConfig } from '../config/schema';
import { toAiSdkTools } from '../tools/ai-sdk';
import { SUBMIT_TOOLS, toolsFor } from '../tools/definitions';
import { SubmissionCollector } from '../tools/submission';
import { bedrockRegion } from './aws';
import { salvagePrompt } from './salvage';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from './types';

/** Share of the task timeout after which the next step is the last one. */
const WRAP_UP_SHARE = 0.8;

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
    // Past this point a new step only submits: a slow tool loop still ends with an answer.
    const wrapUpAt = Date.now() + task.timeoutMs * WRAP_UP_SHARE;
    let salvaged: string | undefined;

    try {
      const result = await generateText({
        model: this.modelFor?.(modelId) ?? this.bedrock(modelId),
        instructions: task.instructions,
        prompt: task.prompt,
        tools,
        stopWhen: [isStepCount(task.maxSteps), hasToolCall(submit)],
        // The last step (or a step after most of the time is gone) offers only the submit tool and asks for
        // the findings so far. Not a forced tool choice: that is rejected together with extended thinking.
        prepareStep: ({ stepNumber }) => {
          if (task.salvage === false || task.maxSteps < 2 || collector.submitted) return undefined;
          const why =
            stepNumber >= task.maxSteps - 1
              ? 'this is the last step'
              : Date.now() >= wrapUpAt
                ? 'the time limit is close'
                : undefined;
          if (!why) return undefined;
          salvaged = why;
          return {
            activeTools: [submit],
            instructions: `${task.instructions}\n\n${salvagePrompt(task.kind, why)}`,
          };
        },
        reasoning: task.reasoning === 'none' ? 'none' : task.reasoning,
        maxOutputTokens: task.maxOutputTokens,
        abortSignal: AbortSignal.any(signals),
        maxRetries: 3,
      });
      const toolCalls = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
      const input = result.usage.inputTokens ?? 0;
      const cached = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
      // Every step used without a submission: report it like an agent's step limit.
      const outOfSteps =
        !collector.submitted && result.finishReason === 'tool-calls' && result.steps.length >= task.maxSteps;
      return {
        submission: collector.submission,
        text: result.text,
        usage: {
          inputTokens: result.usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, input - cached),
          outputTokens: result.usage.outputTokens ?? 0,
          reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens ?? undefined,
          cachedInputTokens: cached || undefined,
          requests: result.steps.length,
        },
        model: modelId,
        stopReason: outOfSteps ? 'max_turn_requests' : result.finishReason,
        ...(salvaged && collector.submitted ? { salvaged } : {}),
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
      throw new ProviderError(`Bedrock call failed (${modelId}): ${(err as Error).message}`, this.id, {
        cause: err,
      });
    }
  }

  async dispose(): Promise<void> {}
}
