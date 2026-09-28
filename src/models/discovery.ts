import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AwsClient } from 'aws4fetch';
import type {
  AcpProviderConfig,
  BedrockProviderConfig,
  OpenAiProviderConfig,
  ProviderConfig,
} from '../config/schema';
import {
  AcpConnection,
  type AgentEndpoint,
  DEFAULT_TIMEOUTS,
  describeError,
  selectValuesOf,
} from '../providers/acp/connection';
import { findExecutable, PRESETS } from '../providers/acp/presets';
import { openAiEndpoint } from '../providers/openai';
import type { Logger } from '../util/logger';
import { catalogFor } from './catalog';
import type { ModelListing } from './types';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface ListModelsOptions {
  logger: Logger;
  /**
   * Working directory of the command. Agents are deliberately NOT probed here: a session in the reviewed
   * checkout could load its agent settings (e.g. Claude Code hooks); discovery uses an empty temp dir.
   */
  cwd: string;
  signal?: AbortSignal;
  /** Bound for one provider's discovery (agent start + session/new, or the Bedrock calls). */
  timeoutMs?: number;
  /** Skip the per-process cache. */
  refresh?: boolean;
  /** Test hook: connect to an in-process ACP agent instead of launching the preset. */
  endpoint?: () => AgentEndpoint;
  /** Test hook: HTTP client for the Bedrock control plane and OpenAI-compatible `/models`. */
  fetch?: typeof fetch;
  /** Test hook: AWS credentials instead of the default provider chain. */
  credentials?: () => Promise<AwsCredentials>;
}

const BEDROCK_TIMEOUT_MS = 15_000;
const OPENAI_TIMEOUT_MS = 10_000;
/** Bounds a `/models` answer (OpenRouter lists several hundred models). */
const MAX_OPENAI_MODELS = 2_000;
const MAX_PROFILE_PAGES = 10;
/** Region names only: the region becomes part of a URL that receives signed requests. */
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;

const cache = new Map<string, Promise<ModelListing>>();

/** Forgets cached listings (tests, `--refresh`). */
export function clearModelListingCache(): void {
  cache.clear();
}

/**
 * Lists the models a provider can use right now without spending tokens: ACP agents are started and asked
 * for a throw-away session's `model` config option; Bedrock is asked for its inference profiles and
 * on-demand foundation models. Never throws: failures yield `models: 'unknown'` with `error`.
 * Results are cached per process (aborted attempts are not).
 */
export function listModels(
  providerId: string,
  cfg: ProviderConfig,
  opts: ListModelsOptions,
): Promise<ModelListing> {
  const hooked = opts.endpoint || opts.fetch || opts.credentials;
  const key = `${providerId}\u0000${JSON.stringify(cfg)}`;
  if (!hooked && !opts.refresh) {
    const cached = cache.get(key);
    if (cached) return cached;
  }
  const pending = discover(providerId, cfg, opts).catch(
    (err: unknown): ModelListing => ({
      provider: providerId,
      models: 'unknown',
      source: sourceOf(cfg),
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  if (!hooked) {
    cache.set(key, pending);
    void pending.then((l) => {
      if (l.error === 'aborted' && cache.get(key) === pending) cache.delete(key);
    });
  }
  return pending;
}

async function discover(
  providerId: string,
  cfg: ProviderConfig,
  opts: ListModelsOptions,
): Promise<ModelListing> {
  if (opts.signal?.aborted)
    return { provider: providerId, models: 'unknown', source: 'catalog', error: 'aborted' };
  switch (cfg.type) {
    case 'mock':
      return { provider: providerId, models: ['mock'], source: 'catalog' };
    case 'acp':
      return listAcpModels(providerId, cfg, opts);
    case 'bedrock':
      return listBedrockModels(providerId, cfg, opts);
    case 'anthropic':
      return catalogListing(providerId, cfg);
    case 'openai':
      return listOpenAiModels(providerId, cfg, opts);
  }
}

function sourceOf(cfg: ProviderConfig): ModelListing['source'] {
  switch (cfg.type) {
    case 'bedrock':
      return 'bedrock-api';
    case 'acp':
      return 'acp-config';
    case 'openai':
      return 'openai-api';
    default:
      return 'catalog';
  }
}

// ---------------------------------------------------------------------------------------------------------
// ACP
// ---------------------------------------------------------------------------------------------------------

function catalogListing(providerId: string, cfg: ProviderConfig, error?: string): ModelListing {
  const ids = catalogFor(cfg).map((m) => m.id);
  return {
    provider: providerId,
    models: ids.length ? ids : 'unknown',
    source: 'catalog',
    ...(error ? { error } : {}),
  };
}

async function listAcpModels(
  providerId: string,
  cfg: AcpProviderConfig,
  opts: ListModelsOptions,
): Promise<ModelListing> {
  const preset = PRESETS[cfg.preset];
  const failed = (error: string): ModelListing => ({
    provider: providerId,
    models: 'unknown',
    source: 'acp-config',
    error,
  });
  let endpoint: AgentEndpoint;
  if (opts.endpoint) {
    endpoint = opts.endpoint();
  } else {
    // Copilot fixes the model per process (`--model`); its sessions offer no model option to read.
    if (preset.perProcessModel) return catalogListing(providerId, cfg);
    if (preset.cli && !cfg.command && !findExecutable(preset.cli)) {
      return failed(`\`${preset.cli}\` CLI not found on PATH`);
    }
    const spec = preset.launch(cfg, { reasoning: 'medium' });
    if (!spec) return failed(preset.cli ? `\`${preset.cli}\` not found on PATH` : 'no command configured');
    endpoint = { kind: 'process', spec };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUTS.setupMs;
  const probeDir = await mkdtemp(path.join(tmpdir(), 'code-reviewer-models-'));
  const opening = AcpConnection.open(
    endpoint,
    preset,
    opts.logger,
    { ...DEFAULT_TIMEOUTS, setupMs: timeoutMs },
    cfg,
  );
  let conn: AcpConnection | undefined;
  try {
    const probe = opening.then((c) => {
      conn = c;
      return c.probeConfigOptions(probeDir);
    });
    const { configOptions } = await raceAbort(probe, opts.signal);
    const opt =
      configOptions.find((o) => o.category === 'model') ??
      configOptions.find((o) => o.id.toLowerCase() === 'model');
    const values = opt ? selectValuesOf(opt) : [];
    if (!opt || !values.length) {
      opts.logger.debug(`[models] ${providerId}: the agent offers no model option`);
      return catalogListing(providerId, cfg, 'the agent offers no model option');
    }
    const labels: Record<string, string> = {};
    for (const v of values) if (v.name && v.name !== v.value) labels[v.value] = v.name;
    return {
      provider: providerId,
      models: [...new Set(values.map((v) => v.value))],
      source: 'acp-config',
      ...(Object.keys(labels).length ? { labels } : {}),
      ...(opt.currentValue !== undefined && opt.currentValue !== null
        ? { current: String(opt.currentValue) }
        : {}),
    };
  } catch (err) {
    if (isAbort(err)) return failed('aborted');
    return failed(describeError(err));
  } finally {
    if (conn) await conn.close();
    else void opening.then((c) => c.close()).catch(() => undefined);
    await rm(probeDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Bedrock
// ---------------------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface InferenceProfilesPage {
  inferenceProfileSummaries?: Array<{ inferenceProfileId?: string; status?: string }>;
  nextToken?: string;
}

interface FoundationModelsPage {
  modelSummaries?: Array<{
    modelId?: string;
    inferenceTypesSupported?: string[];
    modelLifecycle?: { status?: string };
  }>;
}

async function listBedrockModels(
  providerId: string,
  cfg: BedrockProviderConfig,
  opts: ListModelsOptions,
): Promise<ModelListing> {
  const failed = (error: string): ModelListing => ({
    provider: providerId,
    models: 'unknown',
    source: 'bedrock-api',
    error,
  });
  const region = cfg.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  if (!REGION.test(region)) return failed(`invalid AWS region "${region}"`);
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? BEDROCK_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const doFetch = opts.fetch ?? fetch;

  let authorize: (url: string) => Promise<Request>;
  try {
    const bearer = !opts.credentials ? process.env.AWS_BEARER_TOKEN_BEDROCK : undefined;
    if (bearer) {
      authorize = async (url) =>
        new Request(url, {
          headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
          signal,
        });
    } else {
      const resolve = opts.credentials ?? fromNodeProviderChain(cfg.profile ? { profile: cfg.profile } : {});
      const creds = await raceAbort(Promise.resolve(resolve()), signal);
      const client = new AwsClient({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
        service: 'bedrock',
        region,
        retries: 0,
      });
      authorize = (url) =>
        client.sign(url, { method: 'GET', headers: { accept: 'application/json' }, signal });
    }
  } catch (err) {
    if (opts.signal?.aborted) return failed('aborted');
    return failed(`AWS credentials: ${errorText(err)}`);
  }

  const base = `https://bedrock.${region}.amazonaws.com`;
  const get = async <T>(pathAndQuery: string): Promise<T> => {
    const res = await doFetch(await authorize(`${base}${pathAndQuery}`), { signal });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, awsErrorText(res, body));
    return JSON.parse(body) as T;
  };

  const listProfiles = async (): Promise<string[]> => {
    const ids: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_PROFILE_PAGES; page++) {
      const query = new URLSearchParams({ typeEquals: 'SYSTEM_DEFINED', maxResults: '1000' });
      if (token) query.set('nextToken', token);
      const data = await get<InferenceProfilesPage>(`/inference-profiles?${query}`);
      for (const p of data.inferenceProfileSummaries ?? []) {
        if (p.inferenceProfileId && (!p.status || p.status === 'ACTIVE')) ids.push(p.inferenceProfileId);
      }
      token = data.nextToken;
      if (!token) break;
    }
    return ids;
  };
  const listOnDemand = async (): Promise<string[]> => {
    const data = await get<FoundationModelsPage>('/foundation-models?byProvider=anthropic');
    return (data.modelSummaries ?? [])
      .filter((m) => m.modelId && (m.inferenceTypesSupported ?? []).includes('ON_DEMAND'))
      .filter((m) => m.modelLifecycle?.status !== 'EOL')
      .map((m) => m.modelId!);
  };

  const [profiles, onDemand] = await Promise.allSettled([listProfiles(), listOnDemand()]);
  if (opts.signal?.aborted) return failed('aborted');
  if (profiles.status === 'rejected') return failed(errorText(profiles.reason));
  const models = [
    ...new Set([...profiles.value, ...(onDemand.status === 'fulfilled' ? onDemand.value : [])]),
  ];
  models.sort();
  return {
    provider: providerId,
    models,
    source: 'bedrock-api',
    ...(onDemand.status === 'rejected' ? { error: `foundation models: ${errorText(onDemand.reason)}` } : {}),
  };
}

function awsErrorText(res: Response, body: string): string {
  const type = (res.headers.get('x-amzn-errortype') ?? '').split(':')[0];
  let message = body.trim();
  try {
    const parsed = JSON.parse(body) as { message?: string; Message?: string };
    message = parsed.message ?? parsed.Message ?? message;
  } catch {
    // not JSON
  }
  return `HTTP ${res.status}${type ? ` ${type}` : ''}${message ? `: ${message.slice(0, 300)}` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------
// OpenAI-compatible APIs
// ---------------------------------------------------------------------------------------------------------

/** `GET {baseUrl}/models` (OpenAI, OpenRouter, Ollama, vLLM, LM Studio and LiteLLM all serve it). */
async function listOpenAiModels(
  providerId: string,
  cfg: OpenAiProviderConfig,
  opts: ListModelsOptions,
): Promise<ModelListing> {
  const failed = (error: string): ModelListing => ({
    provider: providerId,
    models: 'unknown',
    source: 'openai-api',
    error,
  });
  const { baseUrl, keyEnv } = openAiEndpoint(cfg);
  const key = keyEnv ? process.env[keyEnv]?.trim() : undefined;
  if (keyEnv && !key) return failed(`${keyEnv} is not set`);
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? OPENAI_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const res = await (opts.fetch ?? fetch)(`${baseUrl}/models`, {
      headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      signal,
    });
    const body = await res.text();
    if (!res.ok) return failed(`HTTP ${res.status}${openAiErrorText(body)}`);
    const data = JSON.parse(body) as { data?: unknown };
    if (!Array.isArray(data.data)) return failed('unexpected /models answer (no "data" list)');
    const ids = data.data
      .map((m: { id?: unknown }) => m?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
    const models = [...new Set(ids)].slice(0, MAX_OPENAI_MODELS).sort();
    return { provider: providerId, models, source: 'openai-api' };
  } catch (err) {
    if (opts.signal?.aborted) return failed('aborted');
    return failed(errorText(err));
  }
}

function openAiErrorText(body: string): string {
  let message = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string };
    const m = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    if (typeof m === 'string') message = m;
  } catch {
    // not JSON
  }
  return message ? `: ${message.slice(0, 300)}` : '';
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return 'timed out';
    return err.message.split('\n')[0]!.slice(0, 300);
  }
  return String(err);
}

// ---------------------------------------------------------------------------------------------------------

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Rejects with an AbortError as soon as `signal` aborts; `p` keeps running but its failure is handled. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  p.catch(() => undefined);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error && reason.name === 'TimeoutError') return reason;
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
