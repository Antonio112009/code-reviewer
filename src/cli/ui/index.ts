import type { UiSettings } from '../../config/schema';
import type { InteractionHost, ReviewEvent, ReviewPlan } from '../../review/events';
import type { RunRecord } from '../../types';
import { Narrator } from './lines';
import { createLinker, resolveLinkMode } from './links';
import { LiveRenderer } from './live';
import { PlainRenderer } from './plain';
import { renderPlanText } from './plan';
import { ReviewState } from './state';
import { renderError, renderSummary } from './summary';
import { colorEnabled, createTheme, isCI, unicodeEnabled } from './theme';

export { type LinkMode, resolveLinkMode } from './links';
export { renderFrame } from './live';
export { ReviewState } from './state';
export { colorEnabled, isCI } from './theme';

type Env = Record<string, string | undefined>;

export interface ReviewUiOptions {
  /** Output stream for the live view / logs (default: process.stderr). */
  stream?: NodeJS.WriteStream;
  mode: UiSettings['mode'];
  hyperlinks: UiSettings['hyperlinks'];
  verbose: boolean;
  /** Directory the user ran the command from (for relative paths and file links). */
  cwd: string;
  /** Repository root (absolute) used to build file links. */
  root?: string;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Environment used for CI / color / hyperlink detection (default: process.env). */
  env?: Env;
  /** Input stream checked for interactivity (default: process.stdin). */
  stdin?: { isTTY?: boolean };
  /** Live redraw interval in ms (default 100). */
  intervalMs?: number;
  /** Plain-mode heartbeat after this much silence in ms (default 60 000). */
  heartbeatMs?: number;
}

export interface FinishExtras {
  reports: string[];
  runDir?: string;
}

/** Live progress dashboard (TTY) or plain progress lines (CI / pipes), plus the final summary. */
export interface ReviewUi extends InteractionHost {
  /** `live` (redrawn dashboard) or `plain` (one line per state change). */
  readonly mode: 'live' | 'plain';
  onEvent(event: ReviewEvent): void;
  /** Prints lines above the live area (or as plain lines); buffered while paused. */
  log(...lines: string[]): void;
  /** Stops live rendering and prints the final summary. */
  finish(run: RunRecord, extras: FinishExtras): void;
  /** Stops live rendering and prints an error. */
  fail(error: Error): void;
  /** Stops live rendering without printing anything more (idempotent). */
  stop(): void;
}

/**
 * `live` needs a TTY (cursor control). `auto` also falls back to plain lines in CI and on TERM=dumb;
 * an explicit `live` is honoured in CI as long as the stream is a terminal.
 */
export function resolveUiMode(
  mode: UiSettings['mode'],
  stream: { isTTY?: boolean },
  env: Env,
): 'live' | 'plain' {
  if (mode === 'plain') return 'plain';
  const tty = stream.isTTY === true && env.TERM !== 'dumb';
  if (!tty) return 'plain';
  if (mode === 'live') return 'live';
  return isCI(env) ? 'plain' : 'live';
}

export function createReviewUi(opts: ReviewUiOptions): ReviewUi {
  const stream = opts.stream ?? process.stderr;
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const mode = resolveUiMode(opts.mode, stream, env);
  const theme = createTheme(colorEnabled(stream, env, mode === 'plain'), unicodeEnabled(env));
  // Plain logs stay free of escape codes unless FORCE_HYPERLINK asks for links.
  const forcedLinks = env.FORCE_HYPERLINK !== undefined && env.FORCE_HYPERLINK !== '';
  const linkMode =
    mode === 'live' || forcedLinks
      ? resolveLinkMode(opts.hyperlinks, stream, env, stream === process.stderr)
      : 'off';
  const linker = createLinker({ mode: linkMode, cwd: opts.cwd, root: opts.root });
  const state = new ReviewState(now());
  const width = () => stream.columns || (mode === 'plain' ? 120 : 80);
  const narrator = new Narrator({ theme, verbose: opts.verbose, starts: mode === 'plain', width });
  const renderer =
    mode === 'live'
      ? new LiveRenderer({ stream, state, narrator, theme, now, intervalMs: opts.intervalMs })
      : new PlainRenderer({ stream, state, narrator, theme, now, heartbeatMs: opts.heartbeatMs });
  const interactive = stream.isTTY === true && (opts.stdin ?? process.stdin).isTTY === true && !isCI(env);
  let summarized = false;

  const write = (text: string) => {
    try {
      stream.write(text);
    } catch {
      // best effort (EIO after SIGHUP)
    }
  };

  renderer.start();

  return {
    mode,
    interactive,
    onEvent(event) {
      const t = state.apply(event, now());
      if (!summarized) renderer.handle(event, t);
    },
    log(...lines) {
      renderer.print(lines);
    },
    pause() {
      renderer.pause();
    },
    resume() {
      renderer.resume();
    },
    finish(run, extras) {
      if (summarized) return;
      summarized = true;
      const ended = narrator.phases(state.finish(now()), state);
      if (ended.length) renderer.print(ended);
      renderer.stop();
      write(
        renderSummary(run, {
          theme,
          linker,
          width: width(),
          verbose: opts.verbose,
          timings: state.timings(),
          reports: extras.reports,
          runDir: extras.runDir,
        }),
      );
    },
    fail(error) {
      if (summarized) return;
      summarized = true;
      renderer.stop();
      write(renderError(error, theme, opts.verbose));
    },
    stop() {
      renderer.stop();
    },
  };
}

/** Human-readable `--dry-run` plan (chunks, files, skills, analyzers, refs). */
export function renderPlan(plan: ReviewPlan, opts: { color: boolean; cwd: string }): string {
  return renderPlanText(plan, { ...opts, unicode: unicodeEnabled(process.env) });
}
