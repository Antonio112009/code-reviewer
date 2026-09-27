import type { Config } from '../config/schema';
import type { InteractionHost } from '../review/events';
import type { Role } from '../types';
import type { Logger } from '../util/logger';

export type ModelTier = 'frontier' | 'balanced' | 'fast';

export interface ModelRef {
  provider: string;
  model?: string;
}

export interface ModelListing {
  provider: string;
  /** Model ids the provider offers (for ACP: the `model` config option values), or 'unknown'. */
  models: string[] | 'unknown';
  source: 'acp-config' | 'bedrock-api' | 'catalog';
  error?: string;
  /** Display names by model id (ACP option names), when the provider reports them. */
  labels?: Record<string, string>;
  /** The model the agent uses when none is set (ACP `currentValue` of the model option). */
  current?: string;
}

export type ErrorClass = 'unavailable' | 'transient' | 'refusal' | 'too-long' | 'auth' | 'unknown';

export interface FallbackRequest {
  role: Role;
  failed: ModelRef;
  reason: string;
  config: Config;
  /** Providers usable on this machine (from detectProviders). */
  availableProviders: string[];
  listings?: Map<string, ModelListing>;
  host?: InteractionHost;
  logger: Logger;
  /** Models that already failed in this run; never proposed again. */
  tried?: ModelRef[];
  /** Run abort signal: an aborted run never prompts and gets no replacement. */
  signal?: AbortSignal;
}
