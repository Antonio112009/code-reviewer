import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isPidAlive,
  type ManagedProcess,
  ProcessRegistry,
  runManaged,
  spawnManaged,
} from '../src/util/processes';

const TREE = fileURLToPath(new URL('./fixtures/processes/tree.mjs', import.meta.url));
const NODE = process.execPath;

interface TreePids {
  leader: number;
  grandchild: number;
}

/** Polls until none of `pids` is alive; returns the survivors after `timeoutMs`. */
async function waitDead(pids: number[], timeoutMs = 5_000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const alive = pids.filter(isPidAlive);
    if (alive.length === 0 || Date.now() > deadline) return alive;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Reads the tree fixture's pid line and waits until the grandchild ignores SIGTERM. */
function treeReady(mp: ManagedProcess): Promise<TreePids> {
  return new Promise((resolve, reject) => {
    let out = '';
    mp.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('grandchild ready')) resolve(JSON.parse(out.split('\n')[0]!) as TreePids);
    });
    mp.child.once('exit', () => reject(new Error(`tree exited early: ${out}`)));
  });
}

const leftovers: number[] = [];
afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
});

describe.skipIf(process.platform === 'win32')('process trees (POSIX)', () => {
  it('terminateAll() kills a grandchild that ignores SIGTERM and holds the pipes', async () => {
    const registry = new ProcessRegistry();
    const mp = spawnManaged(NODE, [TREE, 'wait'], {
      label: 'tree',
      registry,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pids = await treeReady(mp);
    leftovers.push(pids.leader, pids.grandchild);
    expect(registry.size).toBe(1);
    expect(registry.trackedGroups()).toEqual([mp.pid]);

    const started = Date.now();
    await registry.terminateAll(2_000);
    expect(await waitDead([pids.leader, pids.grandchild])).toEqual([]);
    // The leader dies on SIGTERM, so the SIGKILL for the group follows without waiting for the grace.
    expect(Date.now() - started).toBeLessThan(1_500);
    await mp.exited;
    expect(registry.size).toBe(0);
    expect(registry.trackedGroups()).toEqual([]);
  });

  it('terminateAll() also kills orphaned groups whose leader already exited', async () => {
    const registry = new ProcessRegistry();
    const mp = spawnManaged(NODE, [TREE, 'exit'], {
      label: 'tree',
      registry,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pids = await new Promise<TreePids>((resolve) => {
      let out = '';
      mp.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('grandchild ready')) resolve(JSON.parse(out.split('\n')[0]!) as TreePids);
      });
    });
    leftovers.push(pids.grandchild);
    await mp.exited;
    expect(registry.size).toBe(0);
    expect(isPidAlive(pids.grandchild)).toBe(true);
    expect(registry.trackedGroups()).toEqual([mp.pid]);

    await registry.terminateAll(300);
    expect(await waitDead([pids.grandchild])).toEqual([]);
    expect(registry.trackedGroups()).toEqual([]);
  });

  it('killAllSync() kills every tree synchronously', async () => {
    const registry = new ProcessRegistry();
    const mp = spawnManaged(NODE, [TREE, 'wait'], {
      label: 'tree',
      registry,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pids = await treeReady(mp);
    leftovers.push(pids.leader, pids.grandchild);
    registry.killAllSync();
    expect(await waitDead([pids.leader, pids.grandchild])).toEqual([]);
  });

  it('runManaged: timeout kills the whole tree and reports timedOut', async () => {
    const registry = new ProcessRegistry();
    const started = Date.now();
    const res = await runManaged(NODE, [TREE, 'wait'], { label: 'tree', registry, timeoutMs: 700 });
    const pids = JSON.parse(res.stdout.split('\n')[0]!) as TreePids;
    leftovers.push(pids.leader, pids.grandchild);
    expect(res.timedOut).toBe(true);
    expect(res.aborted).toBe(false);
    expect(res.signal).toBe('SIGTERM');
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(await waitDead([pids.leader, pids.grandchild])).toEqual([]);
    expect(registry.size).toBe(0);
  });

  it('runManaged: abort kills the whole tree and reports aborted', async () => {
    const registry = new ProcessRegistry();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 700);
    const res = await runManaged(NODE, [TREE, 'wait'], {
      label: 'tree',
      registry,
      signal: controller.signal,
    });
    const pids = JSON.parse(res.stdout.split('\n')[0]!) as TreePids;
    leftovers.push(pids.leader, pids.grandchild);
    expect(res.aborted).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(await waitDead([pids.leader, pids.grandchild])).toEqual([]);
  });

  it('runManaged: returns promptly when a grandchild keeps the pipes open, and kills it', async () => {
    const registry = new ProcessRegistry();
    const started = Date.now();
    const res = await runManaged(NODE, [TREE, 'exit'], { label: 'tree', registry, timeoutMs: 10_000 });
    const pids = JSON.parse(res.stdout.split('\n')[0]!) as TreePids;
    leftovers.push(pids.grandchild);
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(await waitDead([pids.grandchild])).toEqual([]);
  });
});

describe('runManaged', () => {
  it('collects complete output of a large write', async () => {
    const size = 3 * 1024 * 1024 + 7;
    const res = await runManaged(NODE, [TREE, 'big', String(size)], {
      label: 'big',
      registry: new ProcessRegistry(),
      timeoutMs: 20_000,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.length).toBe(size);
    expect(res.stdout.endsWith('y'.repeat(7))).toBe(true);
  });

  it('caps each stream at maxBuffer characters', async () => {
    const res = await runManaged(NODE, [TREE, 'big', '100000'], {
      label: 'big',
      registry: new ProcessRegistry(),
      maxBuffer: 1_000,
      timeoutMs: 20_000,
    });
    expect(res.stdout.length).toBe(1_000);
  });

  it('feeds input on stdin', async () => {
    const res = await runManaged(NODE, [TREE, 'echo'], {
      label: 'echo',
      registry: new ProcessRegistry(),
      input: 'héllo\nwörld',
      timeoutMs: 20_000,
    });
    expect(res).toMatchObject({ exitCode: 0, stdout: 'héllo\nwörld', timedOut: false, aborted: false });
  });

  it('does not start anything when the signal is already aborted', async () => {
    const registry = new ProcessRegistry();
    const controller = new AbortController();
    controller.abort();
    const res = await runManaged(NODE, ['-e', 'setInterval(() => {}, 1000)'], {
      label: 'never',
      registry,
      signal: controller.signal,
    });
    expect(res).toEqual({
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: true,
    });
    expect(registry.size).toBe(0);
  });

  it('does not flag a command that finished before its timeout', async () => {
    const res = await runManaged(NODE, ['-e', 'process.stderr.write("warn")'], {
      label: 'quick',
      registry: new ProcessRegistry(),
      timeoutMs: 5_000,
    });
    expect(res).toMatchObject({ exitCode: 0, stderr: 'warn', timedOut: false, aborted: false });
  });

  it('rejects when the command cannot be started', async () => {
    const registry = new ProcessRegistry();
    await expect(
      runManaged('code-reviewer-definitely-missing-binary', [], {
        label: 'missing',
        registry,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/code-reviewer-definitely-missing-binary/);
    expect(registry.size).toBe(0);
  });
});

describe('isPidAlive', () => {
  it('reports our own pid alive and refuses group / invalid ids', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });
});
