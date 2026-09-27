import type { AcpProviderConfig } from '../../config/schema';
import type { Logger } from '../../util/logger';
import { type AgentResult, type AgentTask, type Provider, ProviderError } from '../types';
import {
  AbortedError,
  AcpConnection,
  type AcpTimeouts,
  type AgentEndpoint,
  DEFAULT_TIMEOUTS,
  describeError,
} from './connection';
import { type AcpPreset, PRESETS } from './presets';

interface Pool {
  idle: AcpConnection[];
  size: number;
  /** Resolved with a free connection, 'retry' (a slot was freed: spawn a new one) or an error. */
  waiters: Array<(c: AcpConnection | 'retry' | Error) => void>;
}

export interface AcpProviderOptions {
  /** Test hook: connect to an in-process agent (or a custom process) instead of the preset. */
  endpoint?: () => AgentEndpoint;
  timeouts?: Partial<AcpTimeouts>;
}

/**
 * Provider backed by an ACP agent (Claude Code, Codex, Copilot, Gemini, custom).
 * Keeps up to `maxProcesses` agent processes per launch configuration; every task gets a fresh session.
 */
export class AcpProvider implements Provider {
  readonly kind = 'acp' as const;
  private readonly preset: AcpPreset;
  private readonly pools = new Map<string, Pool>();
  private readonly all = new Set<AcpConnection>();
  private readonly timeouts: AcpTimeouts;

  constructor(
    readonly id: string,
    private readonly cfg: AcpProviderConfig,
    private readonly logger: Logger,
    private readonly maxProcesses: number,
    private readonly options: AcpProviderOptions = {},
  ) {
    this.preset = PRESETS[cfg.preset];
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  }

  private endpointFor(task: AgentTask): AgentEndpoint {
    if (this.options.endpoint) return this.options.endpoint();
    const spec = this.preset.launch(this.cfg, { model: task.model, reasoning: task.reasoning });
    if (!spec) {
      throw new ProviderError(
        `${this.preset.label} is not available: ${this.preset.cli ? `\`${this.preset.cli}\` not found on PATH` : 'no command configured'}.`,
        this.id,
      );
    }
    return { kind: 'process', spec };
  }

  private poolKey(task: AgentTask): string {
    return this.preset.perProcessModel ? `${task.model ?? ''}|${task.reasoning}` : 'default';
  }

  private aborted(): ProviderError {
    return new ProviderError(`${this.preset.label}: aborted`, this.id);
  }

  private async acquire(task: AgentTask): Promise<{ conn: AcpConnection; key: string }> {
    if (task.signal?.aborted) throw this.aborted();
    const key = this.poolKey(task);
    let pool = this.pools.get(key);
    if (!pool) {
      pool = { idle: [], size: 0, waiters: [] };
      this.pools.set(key, pool);
    }
    for (let idle = pool.idle.pop(); idle; idle = pool.idle.pop()) {
      if (!idle.broken) return { conn: idle, key };
      this.discard(pool, idle); // died while idle
    }
    if (pool.size < this.maxProcesses) {
      pool.size++;
      try {
        const conn = await AcpConnection.open(
          this.endpointFor(task),
          this.preset,
          this.logger,
          this.timeouts,
        );
        this.all.add(conn);
        this.logger.debug(`[acp] ${this.id}: connected to ${conn.agentName}`);
        return { conn, key };
      } catch (err) {
        pool.size--;
        pool.waiters.shift()?.('retry');
        throw err instanceof ProviderError
          ? err
          : new ProviderError(describeError(err), this.id, { cause: err });
      }
    }
    const conn = await new Promise<AcpConnection | 'retry' | Error>((resolve) => pool.waiters.push(resolve));
    if (conn === 'retry') return this.acquire(task);
    if (conn instanceof Error) throw conn;
    return { conn, key };
  }

  private discard(pool: Pool, conn: AcpConnection): void {
    pool.size--;
    this.all.delete(conn);
    void conn.close();
  }

  private release(key: string, conn: AcpConnection): void {
    const pool = this.pools.get(key)!;
    if (conn.broken) {
      this.discard(pool, conn);
      // the slot is free again: let the next waiter spawn a replacement process
      pool.waiters.shift()?.('retry');
      return;
    }
    const waiter = pool.waiters.shift();
    if (waiter) waiter(conn);
    else pool.idle.push(conn);
  }

  async run(task: AgentTask): Promise<AgentResult> {
    const { conn, key } = await this.acquire(task);
    try {
      return await conn.run(task);
    } catch (err) {
      if (err instanceof AbortedError) throw this.aborted();
      throw err instanceof ProviderError
        ? err
        : new ProviderError(`${this.preset.label}: ${describeError(err)}`, this.id, { cause: err });
    } finally {
      this.release(key, conn);
    }
  }

  async dispose(): Promise<void> {
    for (const pool of this.pools.values()) {
      for (const w of pool.waiters) w(new ProviderError('provider disposed', this.id));
      pool.waiters.length = 0;
    }
    await Promise.all([...this.all].map((c) => c.close()));
    this.all.clear();
    this.pools.clear();
  }
}
