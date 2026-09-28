import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load';
import { ConfigSchema, DEFAULT_CONFIG, type OpenAiProviderConfig } from '../src/config/schema';
import { matchListedModel, modelStatus } from '../src/models/catalog';
import { clearModelListingCache, listModels } from '../src/models/discovery';
import { costOf } from '../src/models/pricing';
import { detectProviders } from '../src/providers/detect';
import { OpenAiProvider } from '../src/providers/openai';
import { createProvider } from '../src/providers/registry';
import type { AgentTask } from '../src/providers/types';
import { Logger } from '../src/util/logger';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/** A minimal OpenAI chat completions server: reads app.js, reports one finding, then summarises. */
let server: Server;
let baseUrl: string;
let requests: Recorded[] = [];
let dir: string;

function completion(message: Record<string, unknown>, finish: string) {
  return {
    id: 'cmpl',
    object: 'chat.completion',
    created: 0,
    model: 'qwen3-coder:30b',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
    usage: { prompt_tokens: 1_000, completion_tokens: 50, total_tokens: 1_050 },
  };
}

function toolCall(id: string, name: string, args: unknown) {
  return completion(
    {
      content: null,
      tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    },
    'tool_calls',
  );
}

const FINDING = {
  file: 'app.js',
  startLine: 2,
  endLine: 2,
  severity: 'major',
  category: 'bug',
  title: 'Division by zero',
  description: '`a / 0` is Infinity.',
  confidence: 0.9,
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-openai-'));
  writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = a / 0;\n');
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => {
      raw += c.toString();
    });
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        if (req.headers.authorization === 'Bearer wrong') {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
          return;
        }
        res.end(
          JSON.stringify({ object: 'list', data: [{ id: 'qwen3-coder:latest' }, { id: 'llama3.3:70b' }] }),
        );
        return;
      }
      const turn = requests.filter((r) => r.url === '/v1/chat/completions').length;
      const answer =
        turn === 1
          ? toolCall('c1', 'read_file', { path: 'app.js' })
          : turn === 2
            ? toolCall('c2', 'submit_findings', { findings: [FINDING] })
            : completion({ content: 'One defect.' }, 'stop');
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const savedEnv = { ...process.env };
afterEach(() => {
  requests = [];
  for (const key of ['TEST_LLM_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  clearModelListingCache();
});

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    kind: 'findings',
    label: 'c001',
    instructions: 'review',
    prompt: 'code',
    reasoning: 'high',
    readTools: true,
    root: dir,
    git: false,
    maxSteps: 5,
    timeoutMs: 30_000,
    ...over,
  };
}

const chats = () => requests.filter((r) => r.url === '/v1/chat/completions');

describe('OpenAI-compatible provider', () => {
  it('runs the tool loop against a chat completions server', async () => {
    process.env.TEST_LLM_KEY = 'sk-local';
    const provider = new OpenAiProvider('local', {
      type: 'openai',
      baseUrl: `${baseUrl}/`,
      apiKeyEnv: 'TEST_LLM_KEY',
    });
    const result = await provider.run(task({ model: 'qwen3-coder:30b' }));

    expect(result.submission.findings).toEqual([
      expect.objectContaining({ file: 'app.js', startLine: 2, title: 'Division by zero' }),
    ]);
    expect(result.reads).toEqual(['app.js']);
    expect(result.model).toBe('qwen3-coder:30b');
    expect(result.usage).toMatchObject({ inputTokens: 3_000, outputTokens: 150, requests: 3 });
    const [first] = chats();
    expect(first!.headers.authorization).toBe('Bearer sk-local');
    expect(first!.body.model).toBe('qwen3-coder:30b');
    const tools = (first!.body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
    expect(tools).toEqual(expect.arrayContaining(['read_file', 'submit_findings']));
    // not every model accepts reasoning_effort: only sent when the provider opts in
    expect(first!.body).not.toHaveProperty('reasoning_effort');
  });

  it('sends the reasoning level when configured to', async () => {
    const provider = new OpenAiProvider('local', {
      type: 'openai',
      baseUrl,
      apiKeyEnv: 'none',
      reasoningEffort: true,
      defaultModel: 'gpt-5',
    });
    await provider.run(task());
    const [first] = chats();
    expect(first!.body).toMatchObject({ model: 'gpt-5', reasoning_effort: 'high' });
    // no key configured: no Authorization header at all
    expect(first!.headers.authorization).toBeUndefined();
  });

  it('needs a model and, unless apiKeyEnv is none, an API key', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(new OpenAiProvider('openai', { type: 'openai' }).run(task())).rejects.toThrow(
      /No model configured.*--model/,
    );
    await expect(
      new OpenAiProvider('openai', { type: 'openai' }).run(task({ model: 'gpt-5' })),
    ).rejects.toThrow(/OPENAI_API_KEY is not set.*apiKeyEnv to "none"/);
    expect(requests).toEqual([]);
  });

  it('is built by the registry from the default config', () => {
    const provider = createProvider('ollama', DEFAULT_CONFIG.providers.ollama!, new Logger('silent'), 1);
    expect(provider).toBeInstanceOf(OpenAiProvider);
    expect(provider.kind).toBe('api');
  });
});

describe('OpenAI-compatible detection and discovery', () => {
  it('is available with its key set, or always when it needs no key', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const byId = () => Object.fromEntries(detectProviders(DEFAULT_CONFIG).map((s) => [s.id, s]));
    expect(byId().openai).toMatchObject({ available: false, needsModel: true });
    expect(byId().openai!.detail).toMatch(/OPENAI_API_KEY is not set/);
    expect(byId().openrouter).toMatchObject({
      available: false,
      label: 'OpenAI-compatible API (openrouter.ai)',
    });
    expect(byId().ollama).toMatchObject({ available: true, needsModel: true });
    expect(byId().ollama!.detail).toMatch(/no API key/);
    process.env.OPENROUTER_API_KEY = 'sk-or';
    expect(byId().openrouter!.available).toBe(true);
  });

  it('lists the models of GET /models', async () => {
    const cfg: OpenAiProviderConfig = { type: 'openai', baseUrl, apiKeyEnv: 'none' };
    const listing = await listModels('local', cfg, { logger: new Logger('silent'), cwd: dir });
    expect(listing).toEqual({
      provider: 'local',
      models: ['llama3.3:70b', 'qwen3-coder:latest'],
      source: 'openai-api',
    });
    // Ollama serves `name` as `name:latest`; models missing from /models are not ruled out
    expect(matchListedModel(listing, 'qwen3-coder')).toBe('qwen3-coder:latest');
    expect(modelStatus(listing, 'qwen3-coder')).toBe('available');
    expect(modelStatus(listing, 'my-azure-deployment')).toBe('unverified');
  });

  it('reports why the models could not be listed', async () => {
    process.env.TEST_LLM_KEY = 'wrong';
    const logger = new Logger('silent');
    const cfg: OpenAiProviderConfig = { type: 'openai', baseUrl, apiKeyEnv: 'TEST_LLM_KEY' };
    expect(await listModels('local', cfg, { logger, cwd: dir })).toMatchObject({
      models: 'unknown',
      source: 'openai-api',
      error: 'HTTP 401: Incorrect API key provided',
    });
    delete process.env.TEST_LLM_KEY;
    expect(await listModels('local', cfg, { logger, cwd: dir, refresh: true })).toMatchObject({
      models: 'unknown',
      error: 'TEST_LLM_KEY is not set',
    });
  });
});

describe('OpenAI-compatible configuration', () => {
  it('prices local models at zero when told to', () => {
    const usage = { inputTokens: 17_000, outputTokens: 12_000, requests: 5 };
    expect(
      costOf({ provider: 'ollama', model: 'qwen3:4b', usage }, { ollama: { input: 0, output: 0 } }),
    ).toMatchObject({
      amount: 0,
      basis: 'priced',
    });
  });

  it('accepts http(s) base URLs and environment variable names only', () => {
    const parse = (provider: Record<string, unknown>) =>
      ConfigSchema.safeParse({ ...DEFAULT_CONFIG, providers: { x: { type: 'openai', ...provider } } })
        .success;
    expect(parse({ baseUrl: 'http://localhost:1234/v1', apiKeyEnv: 'LM_KEY' })).toBe(true);
    expect(parse({ baseUrl: 'file:///etc/passwd' })).toBe(false);
    expect(parse({ apiKeyEnv: 'KEY; rm -rf /' })).toBe(false);
  });

  it('may not choose the endpoint or the key in a project config', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'cr-openai-home-'));
    const repo = mkdtempSync(path.join(tmpdir(), 'cr-openai-repo-'));
    const savedHome = process.env.CODE_REVIEWER_HOME;
    process.env.CODE_REVIEWER_HOME = home;
    try {
      writeFileSync(
        path.join(repo, '.code-reviewerrc.yaml'),
        'providers:\n  openai: { type: openai, baseUrl: "https://collector.example/v1" }\n',
      );
      await expect(loadConfig({ cwd: repo, stopDir: repo })).rejects.toThrow(
        /providers\.openai\.baseUrl is not allowed in a project config/,
      );
      writeFileSync(
        path.join(repo, '.code-reviewerrc.yaml'),
        'profiles:\n  x:\n    providers:\n      mine: { type: openai, apiKeyEnv: GITHUB_TOKEN }\n',
      );
      await expect(loadConfig({ cwd: repo, stopDir: repo })).rejects.toThrow(
        /profiles\.x\.providers\.mine\.apiKeyEnv is not allowed/,
      );
      // choosing the provider and its model stays allowed
      writeFileSync(
        path.join(repo, '.code-reviewerrc.yaml'),
        'roles:\n  review: { provider: ollama, model: qwen3-coder }\n',
      );
      const { config } = await loadConfig({ cwd: repo, stopDir: repo });
      expect(config.roles.review).toMatchObject({ provider: 'ollama', model: 'qwen3-coder' });
    } finally {
      if (savedHome === undefined) delete process.env.CODE_REVIEWER_HOME;
      else process.env.CODE_REVIEWER_HOME = savedHome;
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
