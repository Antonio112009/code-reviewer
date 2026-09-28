import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRESETS } from '../src/providers/acp/presets';
import { AcpProvider } from '../src/providers/acp/provider';
import type { AgentTask } from '../src/providers/types';
import { resolveFindings } from '../src/review/findings';
import { silentLogger } from '../src/util/logger';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-acp-'));
  writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = a / 0;\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface FakeAgentLog {
  permissions: string[];
  configCalls: Array<{ configId: string; value: unknown }>;
  readContent?: string;
  cancelled: boolean;
  meta?: unknown;
  /** Text of every prompt received. */
  prompts?: string[];
}

const CONFIG_OPTIONS: acp.SessionConfigOption[] = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'claude-opus-x', name: 'Opus' },
    ],
  },
  {
    id: 'effort',
    name: 'Effort',
    category: 'thought_level',
    type: 'select',
    currentValue: 'medium',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'medium', name: 'Medium' },
      { value: 'high', name: 'High' },
    ],
  },
];

/**
 * In-process ACP agent that behaves like a coding agent: asks to edit a file (must be rejected),
 * reads a file through the client, then answers with JSON findings in its message.
 */
function fakeAgent(
  log: FakeAgentLog,
  opts: {
    hang?: boolean;
    optionsAfterSet?: acp.SessionConfigOption[];
    /** How the first prompt of a session ends before any answer: hangs until cancelled, or hits a limit. */
    firstTurn?: 'hang' | 'max_turn_requests' | 'silent';
    /** Cumulative session cost sent as a `usage_update`. */
    cost?: number;
    /** No token usage in the stop message (like Copilot). */
    noUsage?: boolean;
  } = {},
): acp.AgentApp {
  const aborts = new Map<string, AbortController>();
  const turns = new Map<string, number>();
  return acp
    .agent({ name: 'fake-agent' })
    .onRequest(acp.methods.agent.initialize, async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: 'fake-agent', version: '1.0.0' },
    }))
    .onRequest(acp.methods.agent.session.new, async ({ params }) => {
      log.meta = params._meta;
      return {
        sessionId: `s-${Math.random().toString(36).slice(2)}`,
        configOptions: CONFIG_OPTIONS,
      };
    })
    .onRequest(acp.methods.agent.session.setConfigOption, async ({ params }) => {
      log.configCalls.push({ configId: params.configId, value: (params as { value: unknown }).value });
      return { configOptions: opts.optionsAfterSet ?? CONFIG_OPTIONS };
    })
    .onNotification(acp.methods.agent.session.cancel, async ({ params }) => {
      log.cancelled = true;
      aborts.get(params.sessionId)?.abort();
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      const sessionId = params.sessionId;
      const turn = (turns.get(sessionId) ?? 0) + 1;
      turns.set(sessionId, turn);
      log.prompts?.push(params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join(''));
      if (turn === 1 && opts.firstTurn === 'max_turn_requests') {
        return { stopReason: 'max_turn_requests' as const };
      }
      if (turn === 1 && opts.firstTurn === 'silent') return { stopReason: 'end_turn' as const };
      if (opts.hang || (turn === 1 && opts.firstTurn === 'hang')) {
        const ac = new AbortController();
        aborts.set(sessionId, ac);
        await new Promise((resolve) => ac.signal.addEventListener('abort', resolve));
        return { stopReason: 'cancelled' as const };
      }
      const permission = await client.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: 't1', title: 'Edit app.js', kind: 'edit' },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      });
      log.permissions.push(
        permission.outcome.outcome === 'selected' ? permission.outcome.optionId : 'cancelled',
      );
      const read = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: path.join(dir, 'app.js'),
      });
      log.readContent = read.content;
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't2',
          title: 'Read app.js',
          kind: 'read',
          status: 'completed',
        },
      });
      const payload = {
        findings: [
          {
            file: 'app.js',
            startLine: 2,
            endLine: 2,
            severity: 'minor',
            category: 'bug',
            title: 'Division by zero',
            description: 'b is always Infinity because a is divided by zero',
            confidence: 0.95,
          },
        ],
      };
      for (const piece of ['Here are my findings:\n```json\n', JSON.stringify(payload), '\n```']) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: piece } },
        });
      }
      if (opts.cost !== undefined) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: 'usage_update',
            used: 1000,
            size: 200_000,
            cost: { amount: opts.cost, currency: 'USD' },
          },
        });
      }
      return {
        stopReason: 'end_turn' as const,
        ...(opts.noUsage ? {} : { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }),
      };
    });
}

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    kind: 'findings',
    label: 'c001',
    instructions: 'review',
    prompt: 'code',
    model: 'opus',
    reasoning: 'high',
    readTools: true,
    root: dir,
    git: false,
    maxSteps: 5,
    timeoutMs: 5_000,
    ...over,
  };
}

describe('AcpProvider with an in-process agent', () => {
  it('runs a session: rejects edits, serves reads, sets model/effort, parses findings', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false, prompts: [] };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 2, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log) }),
    });
    try {
      const result = await provider.run(task());
      expect(log.permissions).toEqual(['no']);
      expect(log.readContent).toContain('a / 0');
      expect(log.configCalls).toEqual([
        { configId: 'model', value: 'claude-opus-x' },
        { configId: 'effort', value: 'high' },
      ]);
      expect(log.meta).toMatchObject({
        claudeCode: { options: { disallowedTools: expect.arrayContaining(['Edit', 'Bash']) } },
      });
      expect(result.stopReason).toBe('end_turn');
      expect(result.toolCalls).toBe(1);
      expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
      expect(result.warnings.join('\n')).toMatch(/denied 1 write\/exec request/);
      const resolved = resolveFindings(result);
      expect(resolved.via).toBe('text');
      expect(resolved.items[0]).toMatchObject({ file: 'app.js', startLine: 2, title: 'Division by zero' });
      // findings as JSON in the reply count as handed in: no reminder turn
      expect(log.prompts).toHaveLength(1);
    } finally {
      await provider.dispose();
    }
  });

  it('re-reads options after each change (a model without effort control drops the effort option)', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { optionsAfterSet: [CONFIG_OPTIONS[0]!] }) }),
    });
    try {
      const result = await provider.run(task());
      expect(log.configCalls).toEqual([{ configId: 'model', value: 'claude-opus-x' }]);
      expect(result.stopReason).toBe('end_turn');
    } finally {
      await provider.dispose();
    }
  });

  it('reuses connections across tasks up to the pool size', async () => {
    let connections = 0;
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 2, {
      endpoint: () => {
        connections++;
        return { kind: 'app', app: fakeAgent(log) };
      },
    });
    try {
      await Promise.all([1, 2, 3, 4, 5].map((i) => provider.run(task({ label: `c00${i}` }))));
      expect(connections).toBe(2);
    } finally {
      await provider.dispose();
    }
  });

  it('cancels the session when the task times out', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { hang: true }) }),
    });
    try {
      const result = await provider.run(task({ timeoutMs: 200 }));
      expect(log.cancelled).toBe(true);
      expect(result.stopReason).toBe('cancelled');
      expect(result.interruptedBy).toBe('timeout');
      expect(result.warnings.join('\n')).toMatch(/timed out/);
    } finally {
      await provider.dispose();
    }
  });

  it('asks for an early answer when a turn times out, keeping the work', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false, prompts: [] };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { firstTurn: 'hang' }) }),
    });
    try {
      const result = await provider.run(task({ timeoutMs: 300 }));
      expect(log.cancelled).toBe(true);
      expect(log.prompts).toHaveLength(2);
      expect(log.prompts![1]).toMatch(/Stop here: the time limit was reached\..*submit_findings/);
      expect(result.stopReason).toBe('end_turn');
      expect(result.interruptedBy).toBeUndefined();
      expect(result.salvaged).toBe('the time limit was reached');
      expect(result.usage?.requests).toBe(2);
      expect(resolveFindings(result).items[0]).toMatchObject({ title: 'Division by zero' });
    } finally {
      await provider.dispose();
    }
  });

  it('asks for an early answer when the agent hits its step limit', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false, prompts: [] };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { firstTurn: 'max_turn_requests' }) }),
    });
    try {
      const result = await provider.run(task());
      expect(log.cancelled).toBe(false);
      expect(log.prompts![1]).toMatch(/the step limit was reached/);
      expect(result.salvaged).toBe('the step limit was reached');
      expect(resolveFindings(result).items).toHaveLength(1);
    } finally {
      await provider.dispose();
    }
  });

  it('reminds an agent that ended its turn without submitting anything', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false, prompts: [] };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { firstTurn: 'silent' }) }),
    });
    try {
      const result = await provider.run(task());
      expect(log.prompts).toHaveLength(2);
      expect(log.prompts![1]).toMatch(/ended your turn without calling `submit_findings`/);
      expect(result.salvaged).toBeUndefined(); // a complete review, only the submission was missing
      expect(result.warnings.join('\n')).toMatch(/reminded it to submit/);
      expect(resolveFindings(result).items).toHaveLength(1);
    } finally {
      await provider.dispose();
    }
  });

  it('does not ask for an early answer when salvage is off', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false, prompts: [] };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { firstTurn: 'max_turn_requests' }) }),
    });
    try {
      const result = await provider.run(task({ salvage: false }));
      expect(log.prompts).toHaveLength(1);
      expect(result.stopReason).toBe('max_turn_requests');
      expect(result.salvaged).toBeUndefined();
    } finally {
      await provider.dispose();
    }
  });

  it('records the cost an agent reports and marks missing token counts as estimated', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { cost: 0.0421, noUsage: true }) }),
    });
    try {
      const result = await provider.run(task());
      expect(result.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        estimated: true,
        requests: 1,
        reportedCost: { amount: 0.0421, currency: 'USD' },
      });
    } finally {
      await provider.dispose();
    }
  });

  it('stops promptly and cancels the session when the run is aborted', async () => {
    const log: FakeAgentLog = { permissions: [], configCalls: [], cancelled: false };
    const provider = new AcpProvider('claude', { type: 'acp', preset: 'claude' }, silentLogger, 1, {
      endpoint: () => ({ kind: 'app', app: fakeAgent(log, { hang: true }) }),
    });
    const controller = new AbortController();
    try {
      const started = Date.now();
      setTimeout(() => controller.abort(), 100);
      await expect(provider.run(task({ timeoutMs: 60_000, signal: controller.signal }))).rejects.toThrow(
        /aborted/,
      );
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(log.cancelled).toBe(true);
      // no new work is accepted after the abort
      await expect(provider.run(task({ signal: controller.signal }))).rejects.toThrow(/aborted/);
    } finally {
      await provider.dispose();
    }
  });
});

describe('Claude preset', () => {
  it('loads our MCP tools up front (no ToolSearch), unless the provider env says otherwise', () => {
    const spec = PRESETS.claude.launch(
      { type: 'acp', preset: 'claude', command: '/usr/bin/true' },
      {
        reasoning: 'high',
      },
    );
    expect(spec?.env.ENABLE_TOOL_SEARCH).toBe('false');
    const overridden = PRESETS.claude.launch(
      { type: 'acp', preset: 'claude', command: '/usr/bin/true', env: { ENABLE_TOOL_SEARCH: 'auto' } },
      { reasoning: 'high' },
    );
    expect(overridden?.env.ENABLE_TOOL_SEARCH).toBe('auto');
  });
});

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agent.mjs');

function processProvider(mode: string, timeouts = {}) {
  return new AcpProvider('fixture', { type: 'acp', preset: 'custom' }, silentLogger, 1, {
    endpoint: () => ({
      kind: 'process',
      spec: { command: process.execPath, args: [FIXTURE, mode], env: {}, via: 'test' },
    }),
    timeouts,
  });
}

describe('AcpProvider with a real agent process', () => {
  it('talks ACP over stdio', async () => {
    const provider = processProvider('ok');
    try {
      const result = await provider.run(task());
      expect(resolveFindings(result)).toMatchObject({ via: 'text', items: [{ title: 'Division by zero' }] });
    } finally {
      await provider.dispose();
    }
  });

  it('survives an agent killed by a signal: the task fails and dispose() does not hang', async () => {
    const provider = processProvider('die-on-prompt');
    await expect(provider.run(task())).rejects.toThrow(/closed|exited/);
    const disposed = provider.dispose().then(() => 'disposed');
    const timeout = new Promise((r) => setTimeout(() => r('hung'), 5_000));
    expect(await Promise.race([disposed, timeout])).toBe('disposed');
  });

  it('fails a task whose session/new never answers, within the setup timeout', async () => {
    const provider = processProvider('hang-new', { setupMs: 300 });
    try {
      const started = Date.now();
      await expect(provider.run(task())).rejects.toThrow(/session\/new timed out/);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await provider.dispose();
    }
  });
});
