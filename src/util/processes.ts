import { type ChildProcess, type SpawnOptions, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { findTrustedExecutable, spawnPlan } from './executables';

const IS_WINDOWS = process.platform === 'win32';
/** Grace between SIGTERM and SIGKILL when `runManaged` stops a command (timeout / abort). */
const RUN_KILL_GRACE_MS = 2_000;
/** How long `runManaged` waits for stdio to drain after the direct child exited. */
const RUN_DRAIN_MS = 1_000;

export interface ManagedProcess {
  readonly label: string;
  readonly child: ChildProcess;
  readonly pid: number;
  /** True when the child leads its own process group (POSIX), so the whole tree can be signalled. */
  readonly group: boolean;
  /** Resolves when the direct child has exited. */
  readonly exited: Promise<void>;
}

/**
 * True when a process with this pid exists (EPERM — someone else's process — counts as alive).
 * Only positive pids are accepted: `0` and negative ids would address whole process groups.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return probe(pid);
}

/** True while at least one member of process group `pgid` is alive (POSIX). */
function groupAlive(pgid: number): boolean {
  if (IS_WINDOWS || !Number.isInteger(pgid) || pgid <= 1) return false;
  return probe(-pgid);
}

function probe(id: number): boolean {
  try {
    process.kill(id, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  if (IS_WINDOWS || !Number.isInteger(pgid) || pgid <= 1) return;
  try {
    process.kill(-pgid, signal);
  } catch {
    // ESRCH: group already gone
  }
}

/**
 * Every subprocess we start (ACP agents, analyzers, git fetch, …) is registered here so that an
 * interrupted run can terminate all of them — including grandchildren such as MCP servers spawned by
 * an agent. On POSIX children are started as process-group leaders (`detached: true`), which also keeps
 * a terminal Ctrl+C from hitting them directly: shutdown order stays under our control.
 */
export class ProcessRegistry {
  private readonly live = new Map<number, ManagedProcess>();
  /** Groups we started; kept after the leader exits while members are alive (they can outlive it). */
  private readonly groups = new Set<number>();

  add(mp: ManagedProcess): void {
    this.pruneGroups();
    this.live.set(mp.pid, mp);
    if (mp.group) this.groups.add(mp.pid);
    void mp.exited.then(() => {
      if (this.live.get(mp.pid) !== mp) return;
      this.live.delete(mp.pid);
      // An empty group's id can be reused by an unrelated process group: never signal it again.
      if (mp.group && !groupAlive(mp.pid)) this.groups.delete(mp.pid);
    });
  }

  list(): ManagedProcess[] {
    return [...this.live.values()];
  }

  get size(): number {
    return this.live.size;
  }

  /** Process groups still tracked: live leaders plus orphaned groups whose members outlived the leader. */
  trackedGroups(): number[] {
    this.pruneGroups();
    return [...this.groups].sort((a, b) => a - b);
  }

  /**
   * Graceful: SIGTERM every tree (including orphaned groups), wait up to `graceMs` for them to exit,
   * then SIGKILL whatever is left.
   */
  async terminateAll(graceMs = 3_000): Promise<void> {
    this.pruneGroups();
    const procs = this.list();
    const orphans = [...this.groups].filter((pgid) => !this.live.has(pgid));
    for (const pgid of orphans) signalGroup(pgid, 'SIGTERM');
    await Promise.all([
      ...procs.map((p) => terminate(p, graceMs)),
      ...orphans.map((pgid) => waitGroupGone(pgid, graceMs)),
    ]);
    this.killAllSync();
  }

  /** Synchronous last resort (safe inside `process.on('exit')`): SIGKILL every known tree and group. */
  killAllSync(): void {
    for (const p of this.list()) killTree(p, 'SIGKILL');
    for (const pgid of this.groups) signalGroup(pgid, 'SIGKILL');
    this.groups.clear();
  }

  /** Forgets groups that are empty and whose leader is not tracked as live any more. */
  private pruneGroups(): void {
    for (const pgid of this.groups) {
      if (!this.live.has(pgid) && !groupAlive(pgid)) this.groups.delete(pgid);
    }
  }
}

/** Polls until process group `pgid` is empty or `timeoutMs` elapsed. */
async function waitGroupGone(pgid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (groupAlive(pgid) && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50).unref());
  }
}

/** Process-wide registry used by the CLI shutdown handler. */
export const processes = new ProcessRegistry();

export interface SpawnManagedOptions extends Omit<SpawnOptions, 'detached'> {
  label: string;
  registry?: ProcessRegistry;
}

/**
 * Spawns a child as a process-group leader (POSIX) and registers it for shutdown. A bare command name
 * is resolved from trusted PATH entries only (never the reviewed checkout or the current directory);
 * Windows `.cmd` / `.bat` shims run through `cmd.exe` with escaped arguments.
 */
export function spawnManaged(command: string, args: string[], opts: SpawnManagedOptions): ManagedProcess {
  const { label, registry = processes, ...spawnOpts } = opts;
  const resolved = path.isAbsolute(command)
    ? command
    : findTrustedExecutable(command, spawnOpts.env ?? process.env);
  if (!resolved) {
    const err = Object.assign(new Error(`spawn ${command} ENOENT (not found on a trusted PATH entry)`), {
      code: 'ENOENT',
    });
    throw err;
  }
  const plan = spawnPlan(resolved, args);
  const child = spawn(plan.command, plan.args, {
    ...spawnOpts,
    ...(plan.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    detached: !IS_WINDOWS,
    windowsHide: true,
  });
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  const mp: ManagedProcess = { label, child, pid: child.pid ?? -1, group: !IS_WINDOWS, exited };
  if (child.pid !== undefined) registry.add(mp);
  return mp;
}

export function isRunning(mp: ManagedProcess): boolean {
  return mp.child.exitCode === null && mp.child.signalCode === null;
}

/**
 * `taskkill.exe` by absolute path: a bare name is looked up in the current directory before PATH on
 * Windows, so a `taskkill.exe` checked into the reviewed repository would otherwise run.
 */
function taskkillPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  return path.win32.join(systemRoot, 'System32', 'taskkill.exe');
}

/** Signals the whole process tree of `mp` (group on POSIX, `taskkill /T` on Windows). Never throws. */
export function killTree(mp: ManagedProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (mp.pid <= 0) return;
  if (IS_WINDOWS) {
    // Only while the root is alive: taskkill /T needs it to find descendants, and after its exit the
    // pid may already belong to an unrelated process (Windows reuses pids quickly). /F: console
    // programs ignore the polite close request.
    if (!isRunning(mp)) return;
    spawnSync(taskkillPath(), ['/pid', String(mp.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10_000,
    });
    return;
  }
  if (mp.group) {
    signalGroup(mp.pid, signal);
    return;
  }
  try {
    process.kill(mp.pid, signal);
  } catch {
    // ESRCH / EPERM: already gone
  }
}

/** SIGTERM the tree, then SIGKILL it after `graceMs` (the group may outlive its leader, so always finish with SIGKILL). */
export async function terminate(mp: ManagedProcess, graceMs = 3_000): Promise<void> {
  if (isRunning(mp)) {
    killTree(mp, 'SIGTERM');
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([mp.exited, new Promise<void>((r) => (timer = setTimeout(r, graceMs)))]);
    clearTimeout(timer);
  }
  killTree(mp, 'SIGKILL');
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export interface RunOptions {
  label: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Max characters kept per stream (the rest is dropped). */
  maxBuffer?: number;
  registry?: ProcessRegistry;
}

/**
 * Runs a command to completion under the registry, with timeout and abort support that kill the whole
 * process tree. Never rejects for non-zero exits; inspect the result instead. Rejects when the command
 * cannot be started. An already-aborted `signal` returns `aborted: true` without starting anything.
 */
export async function runManaged(command: string, args: string[], opts: RunOptions): Promise<RunResult> {
  if (opts.signal?.aborted) {
    return { exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: true };
  }
  const maxBuffer = opts.maxBuffer ?? 32 * 1024 * 1024;
  const mp = spawnManaged(command, args, {
    label: opts.label,
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    registry: opts.registry,
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let aborted = false;
  let spawnError: Error | undefined;
  let closed = false;
  mp.child.once('error', (err) => {
    spawnError = err;
  });
  // 'close' fires once stdio is drained (complete output); it can be held back by a grandchild that
  // inherited the pipes, so waiting for it is bounded below.
  const closedP = new Promise<void>((resolve) =>
    mp.child.once('close', () => {
      closed = true;
      resolve();
    }),
  );
  mp.child.stdout?.setEncoding('utf8').on('data', (d: string) => {
    if (stdout.length < maxBuffer) stdout += d;
  });
  mp.child.stderr?.setEncoding('utf8').on('data', (d: string) => {
    if (stderr.length < maxBuffer) stderr += d;
  });
  mp.child.stdin?.on('error', () => undefined);
  if (opts.input !== undefined) mp.child.stdin?.end(opts.input);
  else mp.child.stdin?.end();

  const timer = opts.timeoutMs
    ? setTimeout(() => {
        if (!isRunning(mp)) return;
        timedOut = true;
        void terminate(mp, RUN_KILL_GRACE_MS);
      }, opts.timeoutMs)
    : undefined;
  const onAbort = () => {
    if (!isRunning(mp)) return;
    aborted = true;
    void terminate(mp, RUN_KILL_GRACE_MS);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  await mp.exited;
  // The command is over: a late timer or abort must neither flag the result nor signal the (possibly
  // reused) pid.
  clearTimeout(timer);
  opts.signal?.removeEventListener('abort', onAbort);
  if (spawnError) throw new Error(`${command}: ${spawnError.message}`);

  let drainTimer: NodeJS.Timeout | undefined;
  await Promise.race([closedP, new Promise<void>((r) => (drainTimer = setTimeout(r, RUN_DRAIN_MS)))]);
  clearTimeout(drainTimer);
  if (!closed) {
    // Leftovers of the tree still hold our pipes: kill them and drop our ends so the open pipes cannot
    // keep the event loop (and the CLI) alive.
    killTree(mp, 'SIGKILL');
    mp.child.stdout?.destroy();
    mp.child.stderr?.destroy();
    mp.child.stdin?.destroy();
  }
  return {
    exitCode: mp.child.exitCode,
    signal: mp.child.signalCode,
    stdout: stdout.slice(0, maxBuffer),
    stderr: stderr.slice(0, maxBuffer),
    timedOut,
    aborted,
  };
}
