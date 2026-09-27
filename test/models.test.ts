import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/load';
import type { Config } from '../src/config/schema';
import {
  alternativesFor,
  checkRoleModels,
  classifyError,
  detectReplyError,
  type FallbackRequest,
  formatUnavailable,
  listModels,
  type ModelListing,
  modelStatus,
  type ProviderInfo,
  parseRef,
  preflightModels,
  rememberFallback,
  resolveFallback,
  tierOf,
} from '../src/models';
import { ProviderError } from '../src/providers/types';
import { silentLogger } from '../src/util/logger';
import { testConfig } from './helpers';

const prompts = vi.hoisted(() => ({ select: vi.fn(), confirm: vi.fn() }));
vi.mock('@clack/prompts', () => ({
  select: prompts.select,
  confirm: prompts.confirm,
  isCancel: (v: unknown) => typeof v === 'symbol',
}));

let home: string;
let savedHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'cr-models-'));
  savedHome = process.env.CODE_REVIEWER_HOME;
  process.env.CODE_REVIEWER_HOME = home;
  prompts.select.mockReset();
  prompts.confirm.mockReset();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.CODE_REVIEWER_HOME;
  else process.env.CODE_REVIEWER_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------

describe('classifyError', () => {
  const apiError = (statusCode: number, message: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(message), { name: 'AI_APICallError', statusCode, isRetryable: false, ...extra });

  const cases: Array<[string, unknown, string]> = [
    // unavailable
    ['invalid Bedrock model id', apiError(400, 'The provided model identifier is invalid.'), 'unavailable'],
    [
      'bare id without on-demand throughput',
      apiError(
        400,
        'Invocation of model ID anthropic.claude-sonnet-5 with on-demand throughput isn’t supported. Retry your request with the ID or ARN of an inference profile that contains this model.',
      ),
      'unavailable',
    ],
    [
      'no model access (403)',
      apiError(403, "You don't have access to the model with the specified model ID."),
      'unavailable',
    ],
    [
      'IAM denies InvokeModel',
      apiError(
        403,
        'AccessDeniedException: User: arn:aws:iam::1:user/x is not authorized to perform: bedrock:InvokeModel',
      ),
      'unavailable',
    ],
    [
      'FTU form not filled (404)',
      apiError(404, 'Model use case details have not been submitted for this account.', {
        data: { __type: 'FTUFormNotFilled' },
      }),
      'unavailable',
    ],
    ['plain 404', apiError(404, 'Not Found'), 'unavailable'],
    [
      'Codex ChatGPT-account reply text',
      '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.6-sol\' model is not supported when using Codex with a ChatGPT account."}}',
      'unavailable',
    ],
    [
      'Claude Code selected-model error',
      "There's an issue with the selected model (claude-opus-9). It may not exist or you may not have access to it. Run /model to pick a different model.",
      'unavailable',
    ],
    [
      'unknown model',
      new ProviderError('Gemini CLI (ACP): Unknown model: gemini-9', 'gemini'),
      'unavailable',
    ],
    [
      'quota exhausted (429)',
      apiError(429, 'You exceeded your current quota, please check your plan'),
      'unavailable',
    ],
    // transient
    [
      'throttling (429)',
      apiError(429, 'Too many tokens, please wait before trying again.', { isRetryable: true }),
      'transient',
    ],
    ['overloaded (529)', apiError(529, 'Overloaded'), 'transient'],
    ['service unavailable (503)', apiError(503, 'Service Unavailable'), 'transient'],
    ['connection reset', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), 'transient'],
    ['ACP setup timeout', new Error('session/new timed out after 60s'), 'transient'],
    [
      'ProviderError wrapping an API 500',
      new ProviderError('Bedrock call failed (m): Internal error', 'bedrock', {
        cause: apiError(500, 'Internal error'),
      }),
      'transient',
    ],
    [
      'AI SDK RetryError',
      Object.assign(new Error('Failed after 3 attempts.'), {
        name: 'AI_RetryError',
        lastError: apiError(429, 'Rate exceeded'),
      }),
      'transient',
    ],
    ['raw text with status', 'API Error: 500 {"type":"error","error":{"type":"api_error"}}', 'transient'],
    // refusal
    ['stop reason string', 'refusal', 'refusal'],
    ['AI SDK finish reason', { finishReason: 'content-filter' }, 'refusal'],
    ['guardrail', new Error('guardrail_intervened'), 'refusal'],
    // too-long
    ['Bedrock input too long', apiError(400, 'Input is too long for requested model.'), 'too-long'],
    ['Anthropic prompt too long', 'prompt is too long: 250000 tokens > 200000 maximum', 'too-long'],
    ['context window exceeded', { message: 'model_context_window_exceeded' }, 'too-long'],
    // auth
    [
      'expired AWS token',
      new Error('ExpiredTokenException: The security token included in the request is expired'),
      'auth',
    ],
    [
      'invalid AWS token (403)',
      apiError(403, 'The security token included in the request is invalid.', {
        name: 'UnrecognizedClientException',
      }),
      'auth',
    ],
    [
      'Claude Code OAuth expired',
      'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}',
      'auth',
    ],
    ['not logged in', 'Invalid API key · Please run /login', 'auth'],
    ['plain 401', apiError(401, 'Unauthorized'), 'auth'],
    // unknown
    ['user abort', Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }), 'unknown'],
    ['bad parameter', apiError(400, 'max_tokens: 200000 > 128000'), 'unknown'],
    ['nothing', undefined, 'unknown'],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(classifyError(input)).toBe(expected);
  });

  it('recognises error replies but not review prose', () => {
    expect(detectReplyError('{"type":"error","status":400,"error":{"message":"nope"}}')).toBeDefined();
    expect(detectReplyError("There's an issue with the selected model (x). It may not exist.")).toBeDefined();
    expect(
      detectReplyError('The retry loop ignores timeouts and rate limits, so a 429 is retried forever.'),
    ).toBe(undefined);
    expect(detectReplyError(`Findings:\n${'The model is not supported here. '.repeat(40)}`)).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------------------------------------

function configWith(over: (c: Config) => void = () => {}): Config {
  return testConfig((c) => {
    c.providers = {
      claude: { type: 'acp', preset: 'claude' },
      codex: { type: 'acp', preset: 'codex' },
      copilot: { type: 'acp', preset: 'copilot' },
      bedrock: { type: 'bedrock' },
      mock: { type: 'mock' },
    };
    c.roles = { review: { provider: 'claude', model: 'opus', reasoning: 'medium' } };
    over(c);
  });
}

const CLAUDE_LISTING: ModelListing = {
  provider: 'claude',
  models: ['default', 'opus', 'sonnet', 'haiku'],
  source: 'acp-config',
  current: 'default',
};

function infos(config: Config, available: string[], listings: ModelListing[] = []): ProviderInfo[] {
  return Object.entries(config.providers).map(([id, cfg]) => ({
    id,
    config: cfg,
    available: available.includes(id),
    listing: listings.find((l) => l.provider === id),
  }));
}

describe('catalog', () => {
  it('maps models to tiers', () => {
    expect(tierOf('bedrock', 'us.anthropic.claude-sonnet-5')).toBe('balanced');
    expect(tierOf('bedrock', 'global.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('fast');
    expect(tierOf('acp:claude', 'opus')).toBe('frontier');
    expect(tierOf({ type: 'acp', preset: 'codex' }, 'gpt-5.6-luna')).toBe('fast');
    expect(tierOf('codex', 'gpt-5.5')).toBe('frontier');
    expect(tierOf('copilot', 'claude-sonnet-4.5')).toBe('balanced');
    expect(tierOf('claude', 'opus[1m]')).toBe('frontier');
    expect(tierOf('claude', 'default')).toBe(undefined);
    expect(tierOf('bedrock', 'meta.llama4-maverick')).toBe(undefined);
  });

  it('parses provider:model refs (Bedrock ids contain colons)', () => {
    expect(parseRef('bedrock:global.anthropic.claude-haiku-4-5-20251001-v1:0')).toEqual({
      provider: 'bedrock',
      model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    });
    expect(parseRef('claude')).toEqual({ provider: 'claude' });
  });

  it('matches listings like the ACP session setup', () => {
    expect(modelStatus(CLAUDE_LISTING, 'OPUS')).toBe('available');
    expect(modelStatus({ ...CLAUDE_LISTING, models: ['opus[1m]'] }, 'opus')).toBe('available');
    expect(modelStatus(CLAUDE_LISTING, 'claude-opus-9')).toBe('unavailable');
    expect(modelStatus({ ...CLAUDE_LISTING, models: 'unknown' }, 'x')).toBe('unverified');
    expect(modelStatus({ provider: 'copilot', models: ['a'], source: 'catalog' }, 'x')).toBe('unverified');
    const bedrock: ModelListing = {
      provider: 'bedrock',
      models: ['us.anthropic.claude-sonnet-5'],
      source: 'bedrock-api',
    };
    expect(modelStatus(bedrock, 'eu.anthropic.claude-sonnet-5')).toBe('unavailable');
  });

  it('proposes same-tier models first, own provider before others, then nearer tiers', () => {
    const config = configWith();
    const providers = infos(config, ['claude', 'codex', 'mock'], [CLAUDE_LISTING]);
    // Codex cannot be confined to read-only: never picked automatically, only offered with the risk shown.
    expect(
      alternativesFor({ provider: 'claude', model: 'opus' }, 'frontier', providers).map((a) => a.provider),
    ).toEqual(['claude', 'claude']);
    const alts = alternativesFor({ provider: 'claude', model: 'opus' }, 'frontier', providers, {
      includeUnconfined: true,
    });
    expect(alts.every((a) => (a.provider === 'codex') === (a.unconfined === true))).toBe(true);
    expect(alts.map((a) => `${a.provider}:${a.model}:${a.status}`)).toEqual([
      'codex:gpt-5.6-sol:unverified',
      'codex:gpt-5.5:unverified',
      'claude:sonnet:available',
      'codex:gpt-5.6-terra:unverified',
      'claude:haiku:available',
      'codex:gpt-5.6-luna:unverified',
    ]);
    expect(alts.every((a) => !a.crossesKind)).toBe(true);
  });

  it('maps a Codex model to the equivalent Claude model and filters by listings', () => {
    const config = configWith();
    const bedrockListing: ModelListing = {
      provider: 'bedrock',
      models: [
        'global.anthropic.claude-opus-4-8',
        'meta.llama4',
        'us.anthropic.claude-3-haiku-20240307-v1:0',
      ],
      source: 'bedrock-api',
    };
    const alts = alternativesFor(
      { provider: 'codex', model: 'gpt-5.6-sol' },
      'frontier',
      infos(config, ['claude', 'codex', 'bedrock'], [CLAUDE_LISTING, bedrockListing]),
      { sameTierOnly: true },
    );
    expect(alts.map((a) => `${a.provider}:${a.model}`)).toEqual([
      'codex:gpt-5.5',
      'claude:opus',
      'bedrock:global.anthropic.claude-opus-4-8',
    ]);
    expect(alts.find((a) => a.provider === 'bedrock')?.crossesKind).toBe(true);
    expect(
      alternativesFor(
        { provider: 'codex', model: 'gpt-5.6-sol' },
        'frontier',
        infos(config, ['claude', 'codex']),
        {
          sameTierOnly: true,
          allowCrossProvider: false,
        },
      ).map((a) => a.model),
    ).toEqual(['gpt-5.5']);
  });
});

// ---------------------------------------------------------------------------------------------------------

function request(config: Config, over: Partial<FallbackRequest> = {}): FallbackRequest {
  return {
    role: 'review',
    failed: { provider: 'claude', model: 'opus' },
    reason: 'model unavailable',
    config,
    availableProviders: ['claude', 'codex', 'mock'],
    listings: new Map([['claude', CLAUDE_LISTING]]),
    logger: silentLogger,
    ...over,
  };
}

function fakeHost(interactive: boolean) {
  return { interactive, pause: vi.fn(), resume: vi.fn() };
}

describe('resolveFallback', () => {
  it('fail: never replaces', async () => {
    const config = configWith((c) => {
      c.models.onUnavailable = 'fail';
      c.models.fallbacks = { 'claude:opus': ['codex:gpt-5.6-sol'] };
    });
    expect(await resolveFallback(request(config))).toBe(undefined);
  });

  it('fallback: first usable configured entry', async () => {
    const config = configWith((c) => {
      c.models.onUnavailable = 'fallback';
      c.models.fallbacks = {
        'claude:opus': [
          'copilot:gpt-5.6-sol',
          'claude:claude-opus-9',
          'codex:gpt-5.6-terra',
          'codex:gpt-5.6-sol',
        ],
      };
    });
    // copilot is not available here; claude does not list claude-opus-9
    expect(await resolveFallback(request(config))).toEqual({ provider: 'codex', model: 'gpt-5.6-terra' });
  });

  it('fallback: same-tier catalog alternative when no chain is configured', async () => {
    const config = configWith((c) => {
      c.models.onUnavailable = 'fallback';
    });
    // the only same-tier alternative is Codex, which may run the reviewed code: not chosen on its own
    expect(await resolveFallback(request(config))).toBe(undefined);
    const chained = configWith((c) => {
      c.models.onUnavailable = 'fallback';
      c.models.fallbacks = { 'claude:opus': ['codex:gpt-5.6-sol'] };
    });
    expect(await resolveFallback(request(chained))).toEqual({ provider: 'codex', model: 'gpt-5.6-sol' });

    const sameProviderOnly = configWith((c) => {
      c.models.onUnavailable = 'fallback';
      c.models.allowCrossProvider = false;
    });
    // claude lists no other frontier model and the tier is never dropped silently
    expect(await resolveFallback(request(sameProviderOnly))).toBe(undefined);
  });

  it('fallback: never switches from an API provider to a local agent on its own', async () => {
    const config = configWith((c) => {
      c.models.onUnavailable = 'fallback';
    });
    const req = request(config, {
      failed: { provider: 'bedrock', model: 'global.anthropic.claude-opus-5-5' },
      availableProviders: ['bedrock', 'claude', 'codex'],
      listings: new Map([
        [
          'bedrock',
          {
            provider: 'bedrock',
            models: ['global.anthropic.claude-opus-4-8', 'global.anthropic.claude-sonnet-5'],
            source: 'bedrock-api',
          },
        ],
      ]),
    });
    expect(await resolveFallback(req)).toEqual({
      provider: 'bedrock',
      model: 'global.anthropic.claude-opus-4-8',
    });
    const noBedrockFrontier = request(config, {
      ...req,
      failed: { provider: 'bedrock', model: 'global.anthropic.claude-opus-4-8' },
      tried: [{ provider: 'bedrock', model: 'global.anthropic.claude-opus-5-5' }],
    });
    expect(await resolveFallback(noBedrockFrontier)).toBe(undefined);
  });

  it('fallback: a failed agent default is replaced by a listed model of its tier, never by itself', async () => {
    const config = configWith((c) => {
      c.models.onUnavailable = 'fallback';
    });
    const codex: ModelListing = {
      provider: 'codex',
      models: ['gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
      source: 'acp-config',
      current: 'gpt-6-luna',
    };
    const req = request(config, { failed: { provider: 'codex' }, listings: new Map([['codex', codex]]) });
    expect(await resolveFallback(req)).toEqual({ provider: 'codex', model: 'gpt-5.6-luna' });
  });

  it('ask without a terminal: configured chain only', async () => {
    const withChain = configWith((c) => {
      c.models.fallbacks = { 'claude:opus': ['codex:gpt-5.6-sol'] };
    });
    expect(await resolveFallback(request(withChain, { host: fakeHost(false) }))).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-sol',
    });
    const withoutChain = configWith();
    expect(await resolveFallback(request(withoutChain, { host: fakeHost(false) }))).toBe(undefined);
    expect(prompts.select).not.toHaveBeenCalled();
  });

  it('ask on a terminal: pauses the UI, lists alternatives and returns the choice (once per model)', async () => {
    const config = configWith((c) => {
      c.models.fallbacks = { 'claude:opus': ['codex:gpt-5.6-terra'] };
    });
    prompts.select.mockResolvedValue('codex:gpt-5.6-sol');
    prompts.confirm.mockResolvedValue(false);
    const host = fakeHost(true);
    const [a, b] = await Promise.all([
      resolveFallback(request(config, { host })),
      resolveFallback(request(config, { host, role: 'critique' })),
    ]);
    expect(a).toEqual({ provider: 'codex', model: 'gpt-5.6-sol' });
    expect(b).toEqual(a);
    expect(prompts.select).toHaveBeenCalledTimes(1);
    expect(host.pause).toHaveBeenCalledTimes(1);
    expect(host.resume).toHaveBeenCalledTimes(1);
    const options = prompts.select.mock.calls[0]![0].options as Array<{
      value: string;
      label: string;
      hint?: string;
    }>;
    expect(options.map((o) => o.label)).toEqual([
      'codex:gpt-5.6-terra',
      'codex:gpt-5.6-sol',
      'codex:gpt-5.5',
      'claude:sonnet',
      'claude:haiku',
      'codex:gpt-5.6-luna',
      'Stop the run',
    ]);
    expect(options[0]!.hint).toContain('configured fallback');
    expect(options[3]!.hint).toContain('balanced · available');
    expect(options[1]!.hint).toContain('frontier · unverified · other provider');
    expect(readdirSync(home)).toEqual([]);
  });

  it('ask on a terminal: "Stop the run" and Ctrl+C give no replacement', async () => {
    prompts.select.mockImplementation(async (opts: { options: Array<{ value: string; label: string }> }) => {
      return opts.options.find((o) => o.label === 'Stop the run')!.value;
    });
    expect(await resolveFallback(request(configWith(), { host: fakeHost(true) }))).toBe(undefined);
    prompts.select.mockResolvedValue(Symbol('clack:cancel'));
    expect(await resolveFallback(request(configWith(), { host: fakeHost(true) }))).toBe(undefined);
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  it('remembers the choice in the global config, keeping comments', async () => {
    writeFileSync(
      path.join(home, 'config.yaml'),
      '# my settings\nroles:\n  review:\n    provider: claude # keep me\nmodels:\n  fallbacks:\n    "claude:opus": [codex:gpt-5.5]\n',
    );
    prompts.select.mockResolvedValue('codex:gpt-5.6-sol');
    prompts.confirm.mockResolvedValue(true);
    const result = await resolveFallback(request(configWith(), { host: fakeHost(true) }));
    expect(result).toEqual({ provider: 'codex', model: 'gpt-5.6-sol' });
    const text = readFileSync(path.join(home, 'config.yaml'), 'utf8');
    expect(text).toContain('# my settings');
    expect(text).toContain('# keep me');
    const cwd = mkdtempSync(path.join(tmpdir(), 'cr-models-cwd-'));
    try {
      const { config } = await loadConfig({ cwd, stopDir: cwd });
      expect(config.models.fallbacks['claude:opus']).toEqual(['codex:gpt-5.6-sol', 'codex:gpt-5.5']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('creates the global config when missing; JSON configs stay JSON', async () => {
    const file = await rememberFallback(
      { provider: 'bedrock', model: 'global.anthropic.claude-opus-5-5' },
      { provider: 'bedrock', model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0' },
    );
    expect(file).toBe(path.join(home, 'config.yaml'));
    const cwd = mkdtempSync(path.join(tmpdir(), 'cr-models-cwd-'));
    try {
      const { config } = await loadConfig({ cwd, stopDir: cwd });
      expect(config.models.fallbacks['bedrock:global.anthropic.claude-opus-5-5']).toEqual([
        'bedrock:global.anthropic.claude-haiku-4-5-20251001-v1:0',
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    rmSync(file);

    writeFileSync(path.join(home, 'config.json'), JSON.stringify({ review: { concurrency: 2 } }));
    await rememberFallback(
      { provider: 'claude', model: 'opus' },
      { provider: 'codex', model: 'gpt-5.6-sol' },
    );
    expect(JSON.parse(readFileSync(path.join(home, 'config.json'), 'utf8'))).toEqual({
      review: { concurrency: 2 },
      models: { fallbacks: { 'claude:opus': ['codex:gpt-5.6-sol'] } },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

interface AgentLog {
  cwd?: string;
  prompts: number;
}

function modelAgent(log: AgentLog, configOptions: acp.SessionConfigOption[]): acp.AgentApp {
  return acp
    .agent({ name: 'fake-agent' })
    .onRequest(acp.methods.agent.initialize, async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: 'fake-agent', version: '1.0.0' },
    }))
    .onRequest(acp.methods.agent.session.new, async ({ params }) => {
      log.cwd = params.cwd;
      return { sessionId: 's-1', configOptions };
    })
    .onRequest(acp.methods.agent.session.prompt, async () => {
      log.prompts++;
      return { stopReason: 'end_turn' as const };
    });
}

const MODEL_OPTION: acp.SessionConfigOption = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'default',
  options: [
    { value: 'default', name: 'Default (recommended)' },
    { value: 'opus', name: 'Opus' },
    { value: 'sonnet', name: 'Sonnet' },
    { value: 'haiku', name: 'Haiku' },
  ],
};

describe('listModels', () => {
  it('mock', async () => {
    expect(await listModels('mock', { type: 'mock' }, { logger: silentLogger, cwd: process.cwd() })).toEqual({
      provider: 'mock',
      models: ['mock'],
      source: 'catalog',
    });
  });

  it('reads the model option of a throw-away ACP session outside the checkout, without prompting', async () => {
    const log: AgentLog = { prompts: 0 };
    const listing = await listModels(
      'claude',
      { type: 'acp', preset: 'claude' },
      {
        logger: silentLogger,
        cwd: process.cwd(),
        endpoint: () => ({ kind: 'app', app: modelAgent(log, [MODEL_OPTION]) }),
      },
    );
    expect(listing).toEqual({
      provider: 'claude',
      models: ['default', 'opus', 'sonnet', 'haiku'],
      source: 'acp-config',
      labels: { default: 'Default (recommended)', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' },
      current: 'default',
    });
    expect(log.prompts).toBe(0);
    expect(log.cwd).toBeDefined();
    expect(path.resolve(log.cwd!)).not.toBe(path.resolve(process.cwd()));
  });

  it('falls back to the catalog when the agent has no model option, and reports agent failures', async () => {
    const log: AgentLog = { prompts: 0 };
    const noOption = await listModels(
      'codex',
      { type: 'acp', preset: 'codex' },
      {
        logger: silentLogger,
        cwd: process.cwd(),
        endpoint: () => ({ kind: 'app', app: modelAgent(log, []) }),
      },
    );
    expect(noOption.source).toBe('catalog');
    expect(noOption.models).toContain('gpt-5.6-sol');

    const broken = acp.agent({ name: 'broken' }).onRequest(acp.methods.agent.initialize, async () => {
      throw acp.RequestError.internalError(undefined, 'not logged in');
    });
    const failed = await listModels(
      'claude',
      { type: 'acp', preset: 'claude' },
      { logger: silentLogger, cwd: process.cwd(), endpoint: () => ({ kind: 'app', app: broken }) },
    );
    expect(failed.models).toBe('unknown');
    expect(failed.error).toMatch(/not logged in|initialize/);
  });

  it('lists Bedrock profiles and on-demand models with signed requests', async () => {
    const requests: Request[] = [];
    const fetchMock = (async (input: Request) => {
      requests.push(input);
      const url = new URL(input.url);
      if (url.pathname === '/inference-profiles') {
        return Response.json({
          inferenceProfileSummaries: [
            { inferenceProfileId: 'us.anthropic.claude-sonnet-5', status: 'ACTIVE' },
            { inferenceProfileId: 'global.anthropic.claude-opus-4-8', status: 'ACTIVE' },
          ],
        });
      }
      return Response.json({
        modelSummaries: [
          { modelId: 'anthropic.claude-opus-4-8', inferenceTypesSupported: ['INFERENCE_PROFILE'] },
          { modelId: 'anthropic.claude-3-haiku-20240307-v1:0', inferenceTypesSupported: ['ON_DEMAND'] },
        ],
      });
    }) as unknown as typeof fetch;
    const listing = await listModels(
      'bedrock',
      { type: 'bedrock', region: 'us-west-2' },
      {
        logger: silentLogger,
        cwd: process.cwd(),
        fetch: fetchMock,
        credentials: async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' }),
      },
    );
    expect(listing).toEqual({
      provider: 'bedrock',
      models: [
        'anthropic.claude-3-haiku-20240307-v1:0',
        'global.anthropic.claude-opus-4-8',
        'us.anthropic.claude-sonnet-5',
      ],
      source: 'bedrock-api',
    });
    expect(requests.map((r) => new URL(r.url).host)).toEqual([
      'bedrock.us-west-2.amazonaws.com',
      'bedrock.us-west-2.amazonaws.com',
    ]);
    const profiles = requests.find((r) => new URL(r.url).pathname === '/inference-profiles')!;
    expect(profiles.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(new URL(profiles.url).searchParams.get('typeEquals')).toBe('SYSTEM_DEFINED');
  });

  it('reports Bedrock access errors as unknown and refuses odd regions', async () => {
    const denied = (async () =>
      new Response(
        JSON.stringify({ message: 'User is not authorized to perform: bedrock:ListInferenceProfiles' }),
        {
          status: 403,
          headers: { 'x-amzn-errortype': 'AccessDeniedException:http://internal.amazon.com/' },
        },
      )) as unknown as typeof fetch;
    const credentials = async () => ({ accessKeyId: 'AKID', secretAccessKey: 's' });
    const listing = await listModels(
      'bedrock',
      { type: 'bedrock', region: 'eu-central-1' },
      { logger: silentLogger, cwd: process.cwd(), fetch: denied, credentials },
    );
    expect(listing.models).toBe('unknown');
    expect(listing.error).toMatch(/HTTP 403 AccessDeniedException: User is not authorized/);

    const fetchSpy = vi.fn();
    const evil = await listModels(
      'bedrock',
      { type: 'bedrock', region: 'evil.example.com#' },
      { logger: silentLogger, cwd: process.cwd(), fetch: fetchSpy as unknown as typeof fetch, credentials },
    );
    expect(evil.error).toMatch(/invalid AWS region/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('preflight', () => {
  it('flags a role model the provider does not offer and resolves a replacement', async () => {
    const config = configWith((c) => {
      c.models.onUnavailable = 'fallback';
      c.roles = { review: { provider: 'claude', model: 'claude-opus-9', reasoning: 'medium' } };
    });
    const log: AgentLog = { prompts: 0 };
    const options = {
      config,
      routes: { review: { provider: 'claude', model: 'claude-opus-9' } },
      availableProviders: ['claude', 'codex'],
      logger: silentLogger,
      cwd: process.cwd(),
      listings: new Map<string, ModelListing>([
        ['codex', { provider: 'codex', models: ['gpt-5.6-sol', 'gpt-5.6-terra'], source: 'acp-config' }],
      ]),
      discovery: { endpoint: () => ({ kind: 'app' as const, app: modelAgent(log, [MODEL_OPTION]) }) },
    };
    const { checks } = await checkRoleModels(options);
    expect(checks[0]).toMatchObject({ role: 'review', status: 'unavailable', tier: 'frontier' });
    expect(checks[0]!.reason).toMatch(/not offered by claude \(offers: default, opus, sonnet, haiku\)/);
    expect(checks[0]!.alternatives.slice(0, 2).map((a) => `${a.provider}:${a.model}`)).toEqual([
      'claude:opus',
      'codex:gpt-5.6-sol',
    ]);
    expect(formatUnavailable(checks[0]!)).toMatch(/Alternatives: claude:opus \(frontier, available\)/);

    const result = await preflightModels({ ...options, config: structuredClone(config) });
    expect(result.routes.review).toEqual({ provider: 'claude', model: 'opus' });
    expect(result.fallbacks).toEqual([
      { role: 'review', from: 'claude:claude-opus-9', to: 'claude:opus', reason: checks[0]!.reason },
    ]);
    expect(result.unresolved).toEqual([]);
    expect(log.prompts).toBe(0);
  });

  it('treats a missing provider as unavailable and keeps unverified models', async () => {
    const config = configWith((c) => {
      c.models.onUnavailable = 'fail';
    });
    const result = await preflightModels({
      config,
      routes: { review: { provider: 'claude', model: 'opus' }, critique: { provider: 'mock' } },
      availableProviders: ['mock'],
      logger: silentLogger,
      cwd: process.cwd(),
    });
    expect(result.checks.map((c) => c.status)).toEqual(['unavailable', 'unverified']);
    expect(result.unresolved[0]!.reason).toMatch(/not available on this machine/);
    expect(result.routes.critique).toEqual({ provider: 'mock' });
  });
});
