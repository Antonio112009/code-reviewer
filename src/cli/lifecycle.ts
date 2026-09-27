import { type ProcessRegistry, processes } from '../util/processes';

/**
 * Process lifecycle for long runs: first Ctrl+C / SIGTERM → graceful abort (cancel agent sessions, save a
 * partial run); second Ctrl+C / SIGHUP → immediate kill of every child process tree; `exit` → synchronous
 * last-resort cleanup (process groups, temporary worktrees).
 */
export interface Lifecycle {
  /** Aborted on the first interrupt. */
  readonly signal: AbortSignal;
  /** Register synchronous cleanup that must run even on a forced exit (e.g. remove a worktree). */
  onForcedExit(cleanup: () => void): () => void;
  /** Called when the first interrupt arrives (e.g. to print "stopping…"). */
  onInterrupt(listener: (signal: NodeJS.Signals) => void): () => void;
  /** Exit code to use after a graceful interrupt (130 for SIGINT, 143 for SIGTERM), else undefined. */
  readonly interruptExitCode: number | undefined;
  /** True once the first interrupt arrived. */
  readonly interrupted: boolean;
  /**
   * Same as receiving `signal` (default SIGINT): for Ctrl+C read from a raw-mode stdin, which raises no
   * SIGINT. A second call forces the exit.
   */
  interrupt(signal?: NodeJS.Signals): void;
  /**
   * End of a command: terminates every process tree still registered (e.g. an agent that was still
   * starting when the run was interrupted, which no provider owns yet and so nobody closes), then
   * disposes. The handlers stay installed meanwhile: another Ctrl+C still force-kills everything.
   */
  close(graceMs?: number): Promise<void>;
  /** Remove signal handlers (end of command). Idempotent. */
  dispose(): void;
}

export interface LifecycleOptions {
  /** Registry whose process trees are killed on a forced exit (default: the process-wide `processes`). */
  registry?: ProcessRegistry;
  /**
   * Force the exit when a graceful shutdown is still running this long after the first interrupt
   * (0 = never). The timer never keeps the process alive.
   */
  forceAfterMs?: number;
}

/** Graceful shutdown (cancel sessions, save a partial run, reports) normally takes a few seconds. */
const DEFAULT_FORCE_AFTER_MS = 20_000;
/** SIGTERM → SIGKILL grace for process trees still running when a command ends. */
const LEFTOVER_GRACE_MS = 3_000;

const HANDLED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
type HandledSignal = (typeof HANDLED_SIGNALS)[number];

/** Conventional 128 + signal number, independent of the platform's numbering. */
const EXIT_CODES: Record<HandledSignal, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

function exitCodeFor(signal: NodeJS.Signals): number {
  return EXIT_CODES[signal as HandledSignal] ?? 130;
}

let streamsSilenced = false;

/** After SIGHUP the terminal is gone: writes fail with EIO/EPIPE, which must not crash the cleanup. */
function silenceBrokenStreams(): void {
  if (streamsSilenced) return;
  streamsSilenced = true;
  for (const stream of [process.stdout, process.stderr]) {
    try {
      stream.on('error', () => undefined);
    } catch {
      // stream already destroyed
    }
  }
}

/**
 * Installs SIGINT / SIGTERM / SIGHUP / exit handlers for one command:
 * - first SIGINT or SIGTERM → aborts `signal`, notifies `onInterrupt` listeners and remembers the exit code
 *   (130 / 143); the command is expected to wind down and exit with `interruptExitCode`;
 * - a further SIGINT / SIGTERM, a SIGHUP, or the `forceAfterMs` watchdog → synchronously SIGKILLs every
 *   registered process tree, runs the `onForcedExit` cleanups and exits (130 / 143 / 129);
 * - `exit` → the same synchronous kill + cleanups (anything still registered at that point is a leak).
 * Nothing here keeps the event loop alive.
 */
export function installLifecycle(opts: LifecycleOptions = {}): Lifecycle {
  const registry = opts.registry ?? processes;
  const forceAfterMs = opts.forceAfterMs ?? DEFAULT_FORCE_AFTER_MS;
  const controller = new AbortController();
  // Wrapper objects so the same function can be registered twice and unregistered independently.
  const cleanups = new Set<{ run: () => void }>();
  const interruptListeners = new Set<{ run: (signal: NodeJS.Signals) => void }>();
  let exitCode: number | undefined;
  let forcing = false;
  let disposed = false;
  let watchdog: NodeJS.Timeout | undefined;

  const lastResort = (): void => {
    try {
      registry.killAllSync();
    } catch {
      // best effort
    }
    // LIFO: later resources (e.g. a worktree) may live inside earlier ones (a temp dir).
    const pending = [...cleanups].reverse();
    cleanups.clear();
    for (const entry of pending) {
      try {
        entry.run();
      } catch {
        // best effort: one failing cleanup must not skip the others
      }
    }
  };

  const force = (signal: NodeJS.Signals): void => {
    if (forcing) return;
    forcing = true;
    clearTimeout(watchdog);
    silenceBrokenStreams();
    const code = exitCodeFor(signal);
    exitCode ??= code;
    if (!controller.signal.aborted) controller.abort();
    lastResort();
    process.exit(code);
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    if (disposed || forcing) return;
    if (signal === 'SIGHUP' || exitCode !== undefined) {
      force(signal);
      return;
    }
    exitCode = exitCodeFor(signal);
    if (forceAfterMs > 0) {
      watchdog = setTimeout(() => force(signal), forceAfterMs);
      watchdog.unref();
    }
    controller.abort();
    for (const listener of [...interruptListeners]) {
      try {
        listener.run(signal);
      } catch {
        // a failing listener (e.g. a write to a closed terminal) must not stop the shutdown
      }
    }
  };

  const handlers: Record<HandledSignal, () => void> = {
    SIGINT: () => onSignal('SIGINT'),
    SIGTERM: () => onSignal('SIGTERM'),
    SIGHUP: () => onSignal('SIGHUP'),
  };
  const onExit = (): void => {
    if (!disposed) lastResort();
  };
  for (const sig of HANDLED_SIGNALS) process.on(sig, handlers[sig]);
  process.on('exit', onExit);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearTimeout(watchdog);
    for (const sig of HANDLED_SIGNALS) process.off(sig, handlers[sig]);
    process.off('exit', onExit);
    cleanups.clear();
    interruptListeners.clear();
  };

  return {
    signal: controller.signal,
    get interruptExitCode() {
      return exitCode;
    },
    get interrupted() {
      return exitCode !== undefined;
    },
    onForcedExit(cleanup) {
      const entry = { run: cleanup };
      if (!disposed) cleanups.add(entry);
      return () => {
        cleanups.delete(entry);
      };
    },
    onInterrupt(listener) {
      const entry = { run: listener };
      if (!disposed) interruptListeners.add(entry);
      return () => {
        interruptListeners.delete(entry);
      };
    },
    interrupt(signal = 'SIGINT') {
      onSignal(signal);
    },
    async close(graceMs = LEFTOVER_GRACE_MS) {
      try {
        if (!disposed && (registry.size > 0 || registry.trackedGroups().length > 0)) {
          await registry.terminateAll(graceMs);
        }
      } catch {
        // best effort: a failed kill must not leave the signal handlers installed
      } finally {
        dispose();
      }
    },
    dispose,
  };
}
