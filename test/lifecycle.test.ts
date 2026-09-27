import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { installLifecycle, type Lifecycle } from '../src/cli/lifecycle';
import { isPidAlive, ProcessRegistry, spawnManaged } from '../src/util/processes';

const EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'] as const;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/processes/${name}`, import.meta.url));

async function waitDead(pids: number[], timeoutMs = 5_000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const alive = pids.filter(isPidAlive);
    if (alive.length === 0 || Date.now() > deadline) return alive;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('installLifecycle (in-process)', () => {
  // The test runner's own handlers must not see the signals we emit.
  let saved: Map<string, ((...args: unknown[]) => void)[]>;
  let exit: MockInstance<typeof process.exit>;
  let registry: ProcessRegistry;
  let killAll: MockInstance<() => void>;
  let lifecycle: Lifecycle | undefined;

  beforeEach(() => {
    saved = new Map();
    for (const event of EVENTS) {
      saved.set(event, process.listeners(event) as ((...args: unknown[]) => void)[]);
      process.removeAllListeners(event);
    }
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    registry = new ProcessRegistry();
    killAll = vi.spyOn(registry, 'killAllSync');
  });

  afterEach(() => {
    lifecycle?.dispose();
    lifecycle = undefined;
    exit.mockRestore();
    for (const event of EVENTS) {
      process.removeAllListeners(event);
      for (const listener of saved.get(event) ?? []) process.on(event, listener);
    }
  });

  const install = (forceAfterMs = 0) => {
    lifecycle = installLifecycle({ registry, forceAfterMs });
    return lifecycle;
  };

  it('first SIGINT aborts and notifies; the second one force-exits with 130', () => {
    const lc = install();
    const heard: string[] = [];
    const order: string[] = [];
    lc.onInterrupt((sig) => heard.push(sig));
    lc.onForcedExit(() => order.push('first'));
    lc.onForcedExit(() => order.push('second'));

    process.emit('SIGINT', 'SIGINT');
    expect(lc.signal.aborted).toBe(true);
    expect(lc.interrupted).toBe(true);
    expect(lc.interruptExitCode).toBe(130);
    expect(heard).toEqual(['SIGINT']);
    expect(killAll).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    process.emit('SIGINT', 'SIGINT');
    expect(heard).toEqual(['SIGINT']);
    expect(killAll).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['second', 'first']);
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('SIGTERM interrupts with 143; a following SIGINT forces 130', () => {
    const lc = install();
    process.emit('SIGTERM', 'SIGTERM');
    expect(lc.interruptExitCode).toBe(143);
    expect(exit).not.toHaveBeenCalled();
    process.emit('SIGINT', 'SIGINT');
    expect(exit).toHaveBeenCalledWith(130);
    expect(lc.interruptExitCode).toBe(143);
  });

  it('SIGHUP forces the exit immediately with 129', () => {
    const lc = install();
    const heard: string[] = [];
    const cleanup = vi.fn();
    lc.onInterrupt((sig) => heard.push(sig));
    lc.onForcedExit(cleanup);
    process.emit('SIGHUP', 'SIGHUP');
    expect(heard).toEqual([]);
    expect(lc.signal.aborted).toBe(true);
    expect(killAll).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(129);
    // Further signals while exiting are ignored; cleanups never run twice.
    process.emit('SIGINT', 'SIGINT');
    process.emit('exit', 129);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps going when listeners or cleanups throw', () => {
    const lc = install();
    const later = vi.fn();
    lc.onInterrupt(() => {
      throw new Error('EIO');
    });
    lc.onInterrupt(later);
    const cleanup = vi.fn();
    lc.onForcedExit(cleanup);
    lc.onForcedExit(() => {
      throw new Error('boom');
    });
    process.emit('SIGINT', 'SIGINT');
    expect(later).toHaveBeenCalledWith('SIGINT');
    process.emit('SIGINT', 'SIGINT');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('runs kill + registered cleanups on exit, skipping unregistered ones', () => {
    const lc = install();
    const kept = vi.fn();
    const dropped = vi.fn();
    lc.onForcedExit(kept);
    const unregister = lc.onForcedExit(dropped);
    unregister();
    unregister();
    process.emit('exit', 0);
    expect(killAll).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('interrupt() behaves like the signal (for Ctrl+C read from raw-mode stdin)', () => {
    const lc = install();
    lc.interrupt();
    expect(lc.interruptExitCode).toBe(130);
    expect(exit).not.toHaveBeenCalled();
    lc.interrupt();
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('the watchdog forces the exit when a graceful shutdown hangs', async () => {
    const lc = install(50);
    process.emit('SIGTERM', 'SIGTERM');
    expect(exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143), { timeout: 2_000 });
    expect(lc.interruptExitCode).toBe(143);
  });

  it('dispose() removes every handler, is idempotent and cancels the watchdog', async () => {
    const before = EVENTS.map((e) => process.listenerCount(e));
    const lc = install(50);
    expect(EVENTS.map((e) => process.listenerCount(e))).toEqual(before.map((n) => n + 1));
    const cleanup = vi.fn();
    lc.onForcedExit(cleanup);
    process.emit('SIGINT', 'SIGINT');
    lc.dispose();
    lc.dispose();
    expect(EVENTS.map((e) => process.listenerCount(e))).toEqual(before);
    lc.interrupt();
    await new Promise((r) => setTimeout(r, 120));
    expect(exit).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')(
    'a forced exit kills registered process trees for real',
    async () => {
      lifecycle = installLifecycle({ registry, forceAfterMs: 0 });
      const mp = spawnManaged(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        label: 'sleeper',
        registry,
        stdio: 'ignore',
      });
      await new Promise<void>((resolve) => mp.child.once('spawn', () => resolve()));
      process.emit('SIGHUP', 'SIGHUP');
      expect(await waitDead([mp.pid])).toEqual([]);
      expect(exit).toHaveBeenCalledWith(129);
    },
  );
});

/** Starts the lifecycle fixture as a real process and waits for its process tree to be ready. */
async function startChild(mode: 'graceful' | 'hang') {
  const child = spawn(
    process.execPath,
    ['--import', fixture('ts-resolve.mjs'), fixture('lifecycle-child.mjs'), mode],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let out = '';
  let err = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => {
    out += d;
  });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => {
    err += d;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const waitFor = async (needle: string) => {
    await vi.waitFor(
      () => {
        if (child.exitCode !== null) throw new Error(`child exited early: ${err}`);
        expect(out).toContain(needle);
      },
      { timeout: 10_000, interval: 20 },
    );
  };
  await waitFor('"grandchild"');
  const pids = JSON.parse(out.split('\n')[0]!) as { leader: number; grandchild: number };
  return { child, pids, exited, waitFor, output: () => out };
}

describe.skipIf(process.platform === 'win32')('installLifecycle (real signals, child process)', () => {
  const children: ChildProcess[] = [];
  const pidsToReap: number[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill('SIGKILL');
    for (const pid of pidsToReap.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
  });

  it('first Ctrl+C: graceful shutdown, exit code 130, no process left, event loop not held', async () => {
    const run = await startChild('graceful');
    children.push(run.child);
    pidsToReap.push(run.pids.leader, run.pids.grandchild);
    run.child.kill('SIGINT');
    const result = await run.exited;
    expect(run.output()).toContain('interrupt SIGINT');
    expect(result).toEqual({ code: 130, signal: null });
    expect(await waitDead([run.pids.leader, run.pids.grandchild])).toEqual([]);
  });

  it('second Ctrl+C forces the exit and kills a SIGTERM-ignoring tree', async () => {
    const run = await startChild('hang');
    children.push(run.child);
    pidsToReap.push(run.pids.leader, run.pids.grandchild);
    run.child.kill('SIGINT');
    await run.waitFor('interrupt SIGINT');
    run.child.kill('SIGINT');
    expect(await run.exited).toEqual({ code: 130, signal: null });
    expect(await waitDead([run.pids.leader, run.pids.grandchild])).toEqual([]);
  });

  it('SIGHUP forces the exit with 129 and kills the tree', async () => {
    const run = await startChild('hang');
    children.push(run.child);
    pidsToReap.push(run.pids.leader, run.pids.grandchild);
    run.child.kill('SIGHUP');
    expect(await run.exited).toEqual({ code: 129, signal: null });
    expect(run.output()).not.toContain('interrupt');
    expect(await waitDead([run.pids.leader, run.pids.grandchild])).toEqual([]);
  });
});
