import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { AcpProviderConfig } from '../../config/schema';
import { resolveDependencyPath } from '../../tools/dependencies';
import { MCP_SERVER_NAME } from '../../tools/mcp-server';
import type { Submission } from '../../tools/submission';
import type { Money, Usage } from '../../types';
import { trustedPath } from '../../util/executables';
import type { Logger } from '../../util/logger';
import { cliEntryPath, resolveInside } from '../../util/paths';
import { type ManagedProcess, spawnManaged, terminate } from '../../util/processes';
import { ActivityDeadline } from '../deadline';
import {
  endedWithoutSubmitting,
  mayAskForMore,
  salvagePrompt,
  salvageReason,
  salvageTimeoutMs,
  submitReminderPrompt,
} from '../salvage';
import type { AgentResult, AgentTask } from '../types';
import { decidePermission } from './permissions';
import { type AcpPreset, type LaunchSpec, THOUGHT_LEVEL_CANDIDATES } from './presets';

interface SessionState {
  root: string;
  /** Installed dependency sources the agent may read too (real paths). */
  dependencyRoots: string[];
  denied: string[];
  toolCalls: number;
  /** Files the agent read or searched (root-relative), from tool call locations and fs reads. */
  reads: Set<string>;
  /** Tool kind per tool call id: updates may omit it. */
  toolKinds: Map<string, string>;
}

/** Agent stderr lines written to the debug log per connection. */
const MAX_STDERR_LOG_LINES = 200;

/** Tool kinds whose locations are files the agent looked at. */
const READ_KINDS = new Set(['read', 'search']);
const MAX_READS = 500;

/** Root-relative posix path of a file inside `root`, or undefined outside it. */
function relativeInside(root: string, p: string): string | undefined {
  const rel = path.relative(root, path.resolve(root, p));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join('/');
}

function noteReads(state: SessionState, paths: Array<string | undefined>): void {
  for (const p of paths) {
    const rel = p ? relativeInside(state.root, p) : undefined;
    if (rel && state.reads.size < MAX_READS) state.reads.add(rel);
  }
}

/** What the turns of one task have produced so far (a task may take a second, salvage turn). */
interface TurnState {
  text: string;
  toolUsage: Record<string, number>;
  warnings: string[];
  /** Prompts sent in this session. */
  prompts: number;
  stopReason?: string;
  /** Last usage the agent reported (cumulative for the session). */
  usage?: Usage;
  /** Last cumulative session cost from `usage_update`. */
  cost?: Money;
  /** How the latest turn was interrupted by us, if it was. */
  interruptedBy?: 'timeout' | 'stalled';
  /** Some turn was cancelled: the agent may be unresponsive, so session/close is skipped. */
  everInterrupted: boolean;
  aborted: boolean;
  /** Unfinished `nextUpdate()` read: rejects on dispose, nobody waits for it then. */
  pending?: Promise<acp.ActiveSessionMessage>;
}

export type AgentEndpoint = { kind: 'process'; spec: LaunchSpec } | { kind: 'app'; app: acp.AgentApp };

export interface AcpTimeouts {
  /** initialize, session/new, set_config_option, set_mode */
  setupMs: number;
  /** initialize alone, which includes starting the agent process; defaults to `setupMs` */
  initMs?: number;
  /** how long the agent may take to stop after session/cancel (task timeout) */
  cancelGraceMs: number;
  /** how long the agent may take to stop after the run was aborted (Ctrl+C) */
  abortGraceMs: number;
  /** session/close */
  closeMs: number;
}

export const DEFAULT_TIMEOUTS: AcpTimeouts = {
  setupMs: 60_000,
  cancelGraceMs: 15_000,
  abortGraceMs: 5_000,
  closeMs: 5_000,
};

/** npm's answer when `npm_config_offline` is set and the package (or one of its dependencies) is not cached. */
const NOT_IN_NPM_CACHE = /\bENOTCACHED\b|only-if-cached/;

export class AbortedError extends Error {
  constructor() {
    super('aborted');
  }
}

/** One live ACP agent (usually a subprocess). Runs one task at a time, each in a fresh session. */
export class AcpConnection {
  private readonly sessions = new Map<string, SessionState>();
  private proc?: ManagedProcess;
  private closing?: Promise<void>;
  private stderrTail: string[] = [];
  private stderrLogged = 0;
  private conn!: acp.ClientConnection;
  private init!: acp.InitializeResponse;
  private tmpDir!: string;
  /** Set when the agent stopped responding; a broken connection must not be reused. */
  broken = false;

  private constructor(
    private readonly preset: AcpPreset,
    private readonly logger: Logger,
    private readonly timeouts: AcpTimeouts,
    /** The provider config (session options such as `userSettings`); the preset's defaults when unset. */
    private readonly cfg: AcpProviderConfig,
  ) {}

  static async open(
    endpoint: AgentEndpoint,
    preset: AcpPreset,
    logger: Logger,
    timeouts: AcpTimeouts = DEFAULT_TIMEOUTS,
    cfg: AcpProviderConfig = { type: 'acp', preset: preset.id },
  ): Promise<AcpConnection> {
    if (endpoint.kind === 'process' && endpoint.spec.offlineFirst) {
      // An adapter that npx has installed before starts from the cache, without asking the registry.
      const offline = { ...endpoint.spec, env: { ...endpoint.spec.env, npm_config_offline: 'true' } };
      const cached = new AcpConnection(preset, logger, timeouts, cfg);
      try {
        await cached.start({ kind: 'process', spec: offline });
        return cached;
      } catch (err) {
        if (!NOT_IN_NPM_CACHE.test(err instanceof Error ? err.message : String(err))) throw err;
        logger.debug('[acp] the adapter is not in the npm cache yet: fetching it');
      }
    }
    const c = new AcpConnection(preset, logger, timeouts, cfg);
    await c.start(endpoint);
    return c;
  }

  get agentName(): string {
    return this.init.agentInfo?.name ?? this.preset.label;
  }

  private buildClient(): acp.ClientApp {
    return acp
      .client({ name: 'code-reviewer' })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
        const state = this.sessions.get(params.sessionId);
        // Without a known session root nothing is read-safe: decide as if the root were unknown → reject reads.
        const decision = decidePermission(
          params,
          state?.root ?? '\0no-session',
          state?.dependencyRoots ?? [],
        );
        if (!decision.allowed) {
          state?.denied.push(decision.label);
          this.logger.debug(`[acp] denied: ${decision.label}`);
        }
        return decision.response;
      })
      .onRequest(acp.methods.client.fs.readTextFile, async ({ params }) => {
        const state = this.sessions.get(params.sessionId);
        if (!state) throw acp.RequestError.invalidParams(undefined, 'unknown session');
        const root = state.root;
        const dependency = path.isAbsolute(params.path)
          ? resolveDependencyPath(state.dependencyRoots, params.path)
          : undefined;
        const rel = path.isAbsolute(params.path) ? path.relative(root, params.path) : params.path;
        const abs = dependency ?? resolveInside(root, rel);
        let content = readFileSync(abs, 'utf8');
        if (!dependency) noteReads(state, [abs]);
        if (params.line != null || params.limit != null) {
          const lines = content.split('\n');
          const start = Math.max(0, (params.line ?? 1) - 1);
          content = lines.slice(start, params.limit != null ? start + params.limit : undefined).join('\n');
        }
        return { content };
      });
  }

  private async start(endpoint: AgentEndpoint): Promise<void> {
    this.tmpDir = await mkdtemp(path.join(tmpdir(), 'code-reviewer-acp-'));
    const client = this.buildClient();
    if (endpoint.kind === 'app') {
      this.conn = client.connect(endpoint.app);
    } else {
      const { spec } = endpoint;
      this.logger.debug(`[acp] spawn ${spec.command} ${spec.args.join(' ')} (via ${spec.via})`);
      // Neutral working directory: never the reviewed checkout, whose .npmrc/.env/etc. would otherwise
      // influence how the agent (or `npx`) starts. The review root is passed as the session cwd.
      // Own process group (registered for shutdown): Ctrl+C in the terminal does not kill agents mid-write,
      // and closing the connection terminates the whole tree (adapter → CLI → MCP servers).
      let proc: ManagedProcess;
      try {
        proc = spawnManaged(spec.command, spec.args, {
          label: `acp:${this.preset.id}`,
          cwd: this.tmpDir,
          // PATH without the reviewed checkout, node_modules/.bin or relative entries: the adapter's own
          // lookups (`#!/usr/bin/env node`, the CLI it drives) must not reach repository binaries.
          env: { ...process.env, ...spec.env, PATH: trustedPath({ ...process.env, ...spec.env }) },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.proc = proc;
        const child = proc.child;
        child.stderr?.setEncoding('utf8').on('data', (d: string) => {
          const lines = d.split('\n').filter(Boolean);
          this.stderrTail.push(...lines);
          this.stderrTail = this.stderrTail.slice(-40);
          // Into the debug log (and the run's run.log), capped: a chatty agent must not flood it.
          for (const line of lines) {
            if (this.stderrLogged++ < MAX_STDERR_LOG_LINES)
              this.logger.debug(`[acp:${this.preset.id} stderr] ${line}`);
          }
        });
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', () => resolve());
          child.once('error', (err) => reject(new Error(`Failed to start ${spec.command}: ${err.message}`)));
        });
      } catch (err) {
        await this.close().catch(() => undefined); // removes the temp dir
        throw err;
      }
      const child = proc.child;
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
      );
      this.conn = client.connect(stream);
      child.once('exit', (code, signal) => {
        this.logger.debug(`[acp] agent exited code=${code} signal=${signal}`);
        this.broken = true;
        this.conn.close(new Error(`agent process exited (${code ?? signal})${this.stderrHint()}`));
      });
    }

    try {
      this.init = await this.request(
        this.conn.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'code-reviewer', version: '0' },
        }),
        this.timeouts.initMs ?? this.timeouts.setupMs,
        'initialize',
      );
    } catch (err) {
      await this.close();
      // A silent npx is usually waiting for the npm registry (the first start of an adapter downloads it).
      const waiting =
        endpoint.kind === 'process' && endpoint.spec.via === 'npx' && this.stderrTail.length === 0
          ? ' (npx printed nothing: it may be waiting for the npm registry)'
          : '';
      throw new Error(`ACP initialize failed: ${describeError(err)}${waiting}${this.stderrHint()}`);
    }
  }

  private stderrHint(): string {
    return this.stderrTail.length ? `\n  agent stderr:\n    ${this.stderrTail.slice(-8).join('\n    ')}` : '';
  }

  /** Bounds a request by `ms`; a timeout or closed connection marks this connection broken. */
  private async request<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    const r = await withTimeout(p, ms, this.conn.closed);
    if (r === 'timeout') {
      this.broken = true;
      p.catch(() => undefined);
      throw new Error(`${what} timed out after ${Math.round(ms / 1000)}s${this.stderrHint()}`);
    }
    if (r === 'closed') {
      this.broken = true;
      p.catch(() => undefined);
      throw new Error(`agent connection closed during ${what}${this.stderrHint()}`);
    }
    return r as T;
  }

  /** MCP server that exposes our tools (and the submit tool) inside the agent session. */
  private mcpServerFor(task: AgentTask, submitFile: string): acp.McpServer | undefined {
    const entry = cliEntryPath();
    if (!existsSync(entry)) return undefined;
    const args = [entry, 'mcp-serve', '--root', task.root, '--kind', task.kind, '--submit-file', submitFile];
    if (!task.git) args.push('--no-git');
    if (!task.readTools) args.push('--no-read-tools');
    for (const dir of task.dependencyRoots ?? []) args.push('--dependency-root', dir);
    return { name: MCP_SERVER_NAME, command: process.execPath, args, env: [] };
  }

  async run(task: AgentTask): Promise<AgentResult> {
    if (task.signal?.aborted) throw new AbortedError();
    const warnings: string[] = [];
    const submitFile = path.join(this.tmpDir, `${task.label}-${Date.now()}.json`);
    const mcp = this.mcpServerFor(task, submitFile);
    if (!mcp)
      warnings.push('MCP tools unavailable (dist/cli.js not built) — falling back to JSON in the reply');

    let session: acp.ActiveSession;
    try {
      session = await this.request(
        this.conn.agent
          .buildSession({
            cwd: task.root,
            mcpServers: mcp ? [mcp] : [],
            ...(this.preset.sessionMeta ? { _meta: this.preset.sessionMeta(this.cfg) } : {}),
          })
          .start(),
        this.timeouts.setupMs,
        'session/new',
      );
    } catch (err) {
      throw new Error(`session/new failed: ${describeError(err)}${this.stderrHint()}`);
    }
    const state: SessionState = {
      root: task.root,
      dependencyRoots: task.dependencyRoots ?? [],
      denied: [],
      toolCalls: 0,
      reads: new Set(),
      toolKinds: new Map(),
    };
    this.sessions.set(session.sessionId, state);

    const turn: TurnState = {
      text: '',
      toolUsage: {},
      warnings,
      prompts: 0,
      everInterrupted: false,
      aborted: false,
    };
    let salvaged: string | undefined;
    let interruptedBy: TurnState['interruptedBy'];
    /** Why the first turn was cut short (time, steps, output), if it was. */
    let cutOff: string | undefined;
    try {
      warnings.push(...(await this.configureSession(session, task)));
      await this.runTurn(session, state, turn, task, `${task.instructions}\n\n---\n\n${task.prompt}`, {
        timeoutMs: task.timeoutMs,
        stallTimeoutMs: task.stallTimeoutMs,
        extendMs: task.extendMs,
      });
      interruptedBy = turn.interruptedBy;
      // Out of time, steps or output: one short extra turn keeps the work done so far (for a review also after
      // earlier submissions, which may not hold everything it found).
      const why = salvageReason(turn.stopReason, turn.interruptedBy);
      cutOff = why;
      const submittedBefore = readSubmission(submitFile).calls > 0;
      if (why && task.salvage !== false && !turn.aborted && mayAskForMore(task.kind, submittedBefore)) {
        const timeoutMs = salvageTimeoutMs(task.timeoutMs);
        this.logger.debug(`[acp] ${task.label}: ${why} — asking for an early answer`);
        await this.runTurn(session, state, turn, task, salvagePrompt(task.kind, why, submittedBefore), {
          timeoutMs,
          stallTimeoutMs: task.stallTimeoutMs ? Math.min(task.stallTimeoutMs, timeoutMs) : undefined,
        });
        // Ended on its own: its answer (submit tool or reply text) is the task's result.
        if (!turn.interruptedBy && !turn.aborted && !salvageReason(turn.stopReason, undefined)) {
          salvaged = why;
          interruptedBy = undefined;
          warnings.push(`${why}: asked the agent for what it had found so far`);
        } else interruptedBy = turn.interruptedBy ?? interruptedBy;
      } else if (
        task.salvage !== false &&
        !turn.aborted &&
        readSubmission(submitFile).calls === 0 &&
        endedWithoutSubmitting(turn.stopReason, turn.text)
      ) {
        // Finished, but handed nothing in: the review is complete, only the submission is missing.
        const timeoutMs = salvageTimeoutMs(task.timeoutMs);
        this.logger.debug(`[acp] ${task.label}: ended without submitting — reminding the agent`);
        await this.runTurn(session, state, turn, task, submitReminderPrompt(task.kind), {
          timeoutMs,
          stallTimeoutMs: task.stallTimeoutMs ? Math.min(task.stallTimeoutMs, timeoutMs) : undefined,
        });
        warnings.push('the agent ended without submitting its findings: reminded it to submit them');
        interruptedBy = turn.interruptedBy;
      }
    } finally {
      // an unfinished read rejects on dispose; nobody is waiting for it any more
      turn.pending?.catch(() => undefined);
      session.dispose();
      this.sessions.delete(session.sessionId);
      // After a cancel the agent may be unresponsive: do not block on session/close then.
      if (!turn.everInterrupted && !this.broken && this.init.agentCapabilities?.sessionCapabilities?.close) {
        await this.request(
          this.conn.agent.request(acp.methods.agent.session.close, { sessionId: session.sessionId }),
          this.timeouts.closeMs,
          'session/close',
        ).catch(() => undefined);
      }
    }
    if (turn.aborted) throw new AbortedError();

    if (state.denied.length) {
      warnings.push(
        `denied ${state.denied.length} request(s) (writes, commands or reads outside the review root): ${state.denied.join('; ')}`,
      );
    }
    // Agents that report no token counts get `estimated` (filled in from the prompt and reply by runRouted).
    const usage: Usage = {
      ...(turn.usage ?? { inputTokens: 0, outputTokens: 0, estimated: true }),
      requests: turn.prompts,
      ...(turn.cost ? { reportedCost: turn.cost } : {}),
    };
    const submission = readSubmission(submitFile);
    noteReads(state, submission.reads ?? []);
    // Findings come in as they are verified: a review cut short after submitting some is partial even when the
    // extra turn did not complete it (never cached, and the chunk's recovery says so).
    if (!salvaged && cutOff && submission.calls > 0 && task.kind === 'findings') {
      salvaged = cutOff;
      warnings.push(`${cutOff}: kept the findings submitted before it`);
    }
    return {
      submission,
      ...(state.reads.size ? { reads: [...state.reads] } : {}),
      text: turn.text,
      usage,
      model: task.model,
      stopReason: turn.stopReason,
      ...(interruptedBy ? { interruptedBy } : {}),
      ...(salvaged ? { salvaged } : {}),
      toolCalls: state.toolCalls,
      toolUsage: turn.toolUsage,
      warnings,
    };
  }

  /**
   * Sends one prompt and consumes its updates until the stop message. Our own timeout and stall watchdog
   * cancel the turn (the agent then ends it with `cancelled`); an abort cancels it and throws afterwards.
   */
  private async runTurn(
    session: acp.ActiveSession,
    state: SessionState,
    turn: TurnState,
    task: AgentTask,
    prompt: string,
    limits: { timeoutMs: number; stallTimeoutMs?: number; extendMs?: number },
  ): Promise<void> {
    turn.prompts++;
    turn.interruptedBy = undefined;
    turn.stopReason = undefined;
    let interrupted = false;
    void session.prompt(prompt).catch(() => {
      // failures surface through nextUpdate()/the connection; avoid unhandled rejections
    });

    // Extended while the agent keeps calling tools (see providers/deadline.ts).
    const activity = new ActivityDeadline(limits.timeoutMs, limits.extendMs ?? 0);
    let deadline = activity.at;
    let lastActivity = Date.now();
    const stallMs = limits.stallTimeoutMs;
    const cancel = async () => {
      interrupted = true;
      turn.everInterrupted = true;
      await this.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
    };
    // Keep the pending read across timeouts: a dropped nextUpdate() would swallow the stop message.
    let next = session.nextUpdate();
    turn.pending = next;
    for (;;) {
      // Before any interruption, also watch for a stalled agent (no updates at all for `stallMs`).
      const stallAt = !interrupted && stallMs ? lastActivity + stallMs : Number.POSITIVE_INFINITY;
      const waitUntil = Math.min(deadline, stallAt);
      const msg = await withTimeout(
        next,
        Math.max(waitUntil - Date.now(), 0),
        this.conn.closed,
        turn.aborted ? undefined : task.signal,
      );
      if (msg === 'timeout' && !interrupted && stallAt < deadline) {
        turn.warnings.push(`no activity for ${Math.round(stallMs! / 1000)}s — cancelled as stalled`);
        turn.interruptedBy = 'stalled';
        deadline = Date.now() + this.timeouts.cancelGraceMs;
        await cancel();
        continue;
      }
      if (msg === 'aborted') {
        turn.aborted = true;
        deadline = Date.now() + this.timeouts.abortGraceMs;
        if (!interrupted) await cancel();
        continue;
      }
      if (msg === 'timeout') {
        if (interrupted) {
          this.broken = true;
          if (turn.aborted) throw new AbortedError();
          throw new Error(`agent did not stop after cancellation${this.stderrHint()}`);
        }
        if (activity.tryExtend()) {
          deadline = activity.at;
          this.logger.debug(
            `[acp] ${task.label}: still calling tools at the time limit — extended to ${Math.round((limits.timeoutMs + activity.extendedMs) / 1000)}s`,
          );
          continue;
        }
        turn.warnings.push(
          `timed out after ${Math.round((limits.timeoutMs + activity.extendedMs) / 1000)}s — cancelled`,
        );
        turn.interruptedBy = 'timeout';
        deadline = Date.now() + this.timeouts.cancelGraceMs;
        await cancel();
        continue;
      }
      if (msg === 'closed') {
        this.broken = true;
        throw new Error(`agent connection closed${this.stderrHint()}`);
      }
      turn.pending = undefined;
      if (msg.kind === 'stop') {
        turn.stopReason = msg.stopReason;
        // Usage is cumulative for the session: the last report covers every turn.
        const u = msg.response.usage;
        if (u) {
          turn.usage = {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            reasoningTokens: u.thoughtTokens ?? undefined,
            cachedInputTokens: u.cachedReadTokens ?? undefined,
            cacheWriteTokens: u.cachedWriteTokens ?? undefined,
          };
        }
        return;
      }
      next = session.nextUpdate();
      turn.pending = next;
      lastActivity = Date.now();
      const update = msg.update;
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        turn.text += update.content.text;
      } else if (update.sessionUpdate === 'tool_call') {
        state.toolCalls++;
        activity.touch();
        const name = normalizeToolName(update.title, update.kind);
        turn.toolUsage[name] = (turn.toolUsage[name] ?? 0) + 1;
        task.onActivity?.({ kind: 'tool', name });
        this.logger.debug(`[acp] ${task.label} tool: ${update.title}`);
        if (update.kind) state.toolKinds.set(update.toolCallId, update.kind);
        if (update.kind && READ_KINDS.has(update.kind))
          noteReads(
            state,
            (update.locations ?? []).map((l) => l.path),
          );
      } else if (update.sessionUpdate === 'tool_call_update') {
        const kind = update.kind ?? state.toolKinds.get(update.toolCallId);
        if (kind && READ_KINDS.has(kind))
          noteReads(
            state,
            (update.locations ?? []).map((l) => l.path),
          );
      } else if (update.sessionUpdate === 'usage_update' && update.cost) {
        // Cumulative session cost; agents that bill differently (Copilot) usually send none.
        const { amount, currency } = update.cost;
        if (Number.isFinite(amount) && amount >= 0 && /^[A-Z]{3}$/.test(currency)) {
          turn.cost = { amount, currency };
        }
      }
    }
  }

  /**
   * Opens a throw-away session (no prompt, no tokens) to read what the agent offers: models, reasoning
   * levels, modes. Used for model discovery and availability pre-checks.
   */
  async probeConfigOptions(cwd: string): Promise<{
    configOptions: acp.SessionConfigOption[];
    modes: acp.SessionModeState | null | undefined;
  }> {
    const session = await this.request(
      this.conn.agent
        .buildSession({
          cwd,
          mcpServers: [],
          ...(this.preset.sessionMeta ? { _meta: this.preset.sessionMeta(this.cfg) } : {}),
        })
        .start(),
      this.timeouts.setupMs,
      'session/new',
    );
    try {
      return { configOptions: session.newSessionResponse.configOptions ?? [], modes: session.modes };
    } finally {
      session.dispose();
      if (this.init.agentCapabilities?.sessionCapabilities?.close) {
        await this.request(
          this.conn.agent.request(acp.methods.agent.session.close, { sessionId: session.sessionId }),
          this.timeouts.closeMs,
          'session/close',
        ).catch(() => undefined);
      }
    }
  }

  /**
   * Applies model, reasoning effort and read-only mode through session config options.
   * Options depend on each other (e.g. a model without effort control drops the effort option), so the
   * list returned by every set_config_option call replaces the current one. Rejected changes only produce
   * warnings (the agent's defaults are still a usable review setup); a timeout breaks the connection.
   */
  private async configureSession(session: acp.ActiveSession, task: AgentTask): Promise<string[]> {
    const warnings: string[] = [];
    let options = session.newSessionResponse.configOptions ?? [];
    for (const o of options) {
      const values = o.type === 'select' ? selectValuesOf(o).map((v) => v.value) : [String(o.currentValue)];
      this.logger.debug(
        `[acp] config option ${o.id} (${o.category ?? 'other'}) = ${o.currentValue}; values: ${values.join(', ')}`,
      );
    }
    const set = async (opt: acp.SessionConfigOption, value: string, strict = false): Promise<void> => {
      this.logger.debug(`[acp] set ${opt.id}=${value}`);
      try {
        const res = await this.request(
          this.conn.agent.request(acp.methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: opt.id,
            value,
          }),
          this.timeouts.setupMs,
          `set_config_option ${opt.id}`,
        );
        if (res?.configOptions) options = res.configOptions;
      } catch (err) {
        if (this.broken || strict) throw err;
        warnings.push(`could not set ${opt.id}=${value}: ${describeError(err)}`);
      }
    };
    const byCategory = (category: string) => options.find((o) => o.category === category);

    if (!this.preset.perProcessModel && task.model) {
      const opt = byCategory('model');
      const values = opt ? selectValuesOf(opt) : [];
      const wanted = task.model.toLowerCase();
      const match =
        values.find((v) => v.value.toLowerCase() === wanted || v.name.toLowerCase() === wanted) ??
        values.find((v) => v.value.toLowerCase().includes(wanted) || v.name.toLowerCase().includes(wanted));
      if (opt && match) await set(opt, match.value);
      else
        warnings.push(
          `model "${task.model}" not offered by ${this.agentName}${values.length ? ` (available: ${values.map((v) => v.value).join(', ')})` : ''}; using the agent default`,
        );
    }

    if (!this.preset.perProcessModel) {
      const opt = byCategory('thought_level');
      if (opt) {
        const values = selectValuesOf(opt).map((v) => v.value);
        const match = THOUGHT_LEVEL_CANDIDATES[task.reasoning].find((c) => values.includes(c));
        if (match) await set(opt, match);
      } else if (task.reasoning !== 'none') {
        this.logger.debug(`[acp] no reasoning-effort option offered; using the agent default`);
      }
    }

    if (this.preset.readOnlyMode) {
      const opt = byCategory('mode');
      const values = opt ? selectValuesOf(opt).map((v) => v.value) : [];
      if (opt && values.includes(this.preset.readOnlyMode)) await set(opt, this.preset.readOnlyMode, true);
      else if (session.modes?.availableModes.some((m) => m.id === this.preset.readOnlyMode)) {
        try {
          await this.request(
            this.conn.agent.request(acp.methods.agent.session.setMode, {
              sessionId: session.sessionId,
              modeId: this.preset.readOnlyMode,
            }),
            this.timeouts.setupMs,
            'session/set_mode',
          );
        } catch (err) {
          // An agent that keeps a more permissive mode must not review untrusted code.
          throw new Error(
            `could not switch the agent to its "${this.preset.readOnlyMode}" mode: ${describeError(err)}`,
          );
        }
      }
    }
    return warnings;
  }

  /** Idempotent: closes the connection, terminates the agent process and removes temp files. */
  close(): Promise<void> {
    this.closing ??= this.doClose();
    return this.closing;
  }

  private async doClose(): Promise<void> {
    this.broken = true;
    this.conn?.close();
    // SIGTERM the whole process group, SIGKILL after a grace period; handles signal-killed leaders too.
    if (this.proc) await terminate(this.proc, 3_000);
    if (this.tmpDir) await rm(this.tmpDir, { recursive: true, force: true });
  }
}

/** Error text including JSON-RPC error data, which agents use for the actual reason. */
export function describeError(err: unknown): string {
  if (err instanceof acp.RequestError) {
    const data =
      err.data === undefined
        ? ''
        : ` — ${typeof err.data === 'string' ? err.data : JSON.stringify(err.data)}`;
    return `${err.message} (code ${err.code})${data}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tool name for statistics: our MCP tools lose their `mcp__code-reviewer__` prefix, agent built-ins keep
 * their first word ("Read src/a.ts" → "Read"); falls back to the ACP tool kind.
 */
export function normalizeToolName(title: string | null | undefined, kind?: string | null): string {
  const raw = (title ?? '').trim();
  const mcp = /^mcp__[\w-]+__([\w-]+)/.exec(raw);
  if (mcp) return mcp[1]!;
  const first = raw.split(/[\s:(`'"]/)[0];
  if (first && /^[\w.-]{2,40}$/.test(first)) return first;
  return kind ?? 'other';
}

export function selectValuesOf(opt: acp.SessionConfigOption): Array<{ value: string; name: string }> {
  return opt.type === 'select'
    ? opt.options
        .flatMap((o) => ('group' in o ? o.options : [o]))
        .map((o) => ({ value: o.value, name: o.name }))
    : [];
}

function readSubmission(file: string): Submission {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Submission;
  } catch {
    return { calls: 0 };
  }
}

/** Races `p` against a timeout, the connection closing and (optionally) an abort signal. */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  closed: Promise<void>,
  signal?: AbortSignal,
): Promise<T | 'timeout' | 'closed' | 'aborted'> {
  if (signal?.aborted) return 'aborted';
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<'timeout'>((r) => {
        timer = setTimeout(() => r('timeout'), ms);
      }),
      closed.then(() => 'closed' as const),
      new Promise<'aborted'>((r) => {
        if (!signal) return;
        onAbort = () => r('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
