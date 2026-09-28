import {
  analyzersSummary,
  fallbackLabel,
  formatDuration,
  formatTokens,
  stackSummary,
} from '../../report/common';
import type { ReviewEvent, ReviewPlan } from '../../review/events';
import type { RefsInfo, Role, RoleRouting, RunTarget } from '../../types';
import { clean, compactFiles, join, padEnd, padStart, plural, truncate, visibleWidth } from './format';
import type { FinishedChunk, PhaseState, ReviewState, Transition } from './state';
import type { Theme } from './theme';

/** Width of the phase label column (`analyzers`, `chunking`, …). */
const PHASE_WIDTH = 9;
/** Plain logs are not width-limited: list files in full up to this many columns. */
const PLAIN_FILES_WIDTH = 100;

/** `origin/develop … feature/login` / `files src, lib`. */
export function targetText(target: RunTarget, theme: Theme): string {
  if (target.kind === 'diff') return `${clean(target.base)} ${theme.sym.ellipsis} ${clean(target.head)}`;
  return `files ${target.paths.length ? target.paths.map(clean).join(', ') : '.'}`;
}

/** Optional commit count a refs resolver may attach (not part of the shared contract yet). */
function commitCount(refs: RefsInfo | undefined): number | undefined {
  const n = (refs as (RefsInfo & { commits?: unknown }) | undefined)?.commits;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** `review claude:sonnet (medium) · critique claude:opus (high)` */
export function routingText(routing: Partial<Record<Role, RoleRouting>>, theme: Theme): string {
  const parts: string[] = [];
  for (const role of ['review', 'critique', 'summary'] as const) {
    const r = routing[role];
    if (!r) continue;
    parts.push(`${role} ${clean(r.provider)}${r.model ? `:${clean(r.model)}` : ''} (${r.reasoning})`);
  }
  if (!routing.critique) parts.push('critique off');
  return parts.join(` ${theme.sym.dot} `);
}

/** `◆ origin/develop … feature/login · 3 commits · 12 files · review claude:sonnet · critique claude:opus` */
export function stickyHeader(state: ReviewState, theme: Theme): string | undefined {
  if (!state.target) return undefined;
  const { c, sym } = theme;
  const commits = commitCount(state.refs);
  const model = (r: RoleRouting | undefined) =>
    r ? `${clean(r.provider)}${r.model ? `:${clean(r.model)}` : ''}` : '';
  const routing = state.plan?.routing;
  const rest = join(
    [
      commits !== undefined ? plural(commits, 'commit') : '',
      state.plan ? plural(state.plan.units, 'file') : '',
      routing?.review ? `review ${model(routing.review)}` : '',
      routing?.critique ? `critique ${model(routing.critique)}` : '',
    ],
    ` ${sym.dot} `,
  );
  return `${c.cyan(sym.diamond)} ${targetText(state.target, theme)}${rest ? c.dim(` ${sym.dot} ${rest}`) : ''}`;
}

/** `12 files → 5 chunks · ~48k tokens` */
export function planText(plan: ReviewPlan, theme: Theme): string {
  return join(
    [
      `${plural(plan.units, 'file')} ${theme.sym.arrow} ${plural(plan.chunks.length, 'chunk')}`,
      `~${formatTokens(plan.totalTokens)} tokens`,
      plan.skipped.length ? `${plan.skipped.length} skipped` : '',
      plan.deleted.length ? `${plan.deleted.length} deleted` : '',
    ],
    ` ${theme.sym.dot} `,
  );
}

export function stackText(state: ReviewState, theme: Theme): string {
  return clean(stackSummary(state.stack, 6, ` ${theme.sym.dot} `)) || 'no frameworks or databases detected';
}

export function analyzersText(state: ReviewState, theme: Theme): string {
  return clean(analyzersSummary(state.analyzers?.runs, theme.sym.analyzer, ` ${theme.sym.dot} `)) || 'none';
}

function label(theme: Theme, name: string): string {
  return theme.c.dim(padEnd(name, PHASE_WIDTH));
}

function phaseDetail(p: PhaseState, state: ReviewState, theme: Theme): string {
  const dot = ` ${theme.sym.dot} `;
  switch (p.id) {
    case 'refs':
      return clean(state.refs?.explanation[0] ?? p.message);
    case 'stack':
      return state.stack ? stackText(state, theme) : clean(p.message);
    case 'analyzers':
      return state.analyzers ? analyzersText(state, theme) : clean(p.message);
    case 'chunking':
      return state.plan ? planText(state.plan, theme) : clean(p.message);
    case 'review': {
      const ok = state.finished.length - state.failed;
      return join(
        [
          `${ok}/${state.total} chunks`,
          state.failed ? theme.c.red(`${state.failed} failed`) : '',
          plural(state.rawFindings, 'raw finding'),
        ],
        dot,
      );
    }
    case 'critique':
      return state.critique
        ? `${plural(state.critique.findings, 'finding')} in ${plural(state.critique.batches, 'batch', 'batches')}`
        : clean(p.message);
    default:
      return clean(p.message);
  }
}

/**
 * `✔ stack      120ms  Next.js · React`. With `quiet`, a detail that merely repeats the phase message
 * (already printed when the phase started) is left out.
 */
export function phaseLine(p: PhaseState, state: ReviewState, theme: Theme, quiet = false): string {
  const { c, sym } = theme;
  const failed = p.id === 'review' && state.total > 0 && state.failed === state.total;
  const mark = failed ? c.red(sym.fail) : c.green(sym.ok);
  const detail = phaseDetail(p, state, theme);
  const shown = quiet && detail === clean(p.message) ? '' : `  ${c.dim(detail)}`;
  return `${mark} ${label(theme, p.id)} ${padStart(formatDuration(p.durationMs), 6)}${shown}`;
}

/** Column layout shared by finished-chunk lines and running rows, so they line up. */
export interface ChunkColumns {
  idWidth: number;
  /** Max columns a compacted file list may use. */
  filesMax: number;
  /** Padded width of the file column (the widest compacted list of any chunk, ≤ filesMax). */
  filesWidth: number;
}

let columnsCache: { plan: ReviewPlan; width: number; cols: ChunkColumns } | undefined;

export function chunkColumns(state: ReviewState, width: number): ChunkColumns {
  const filesMax = Math.min(36, Math.max(14, Math.floor(width * 0.3)));
  const extra = [...state.running.values()].filter((r) => !state.plan?.chunks.some((c) => c.id === r.id));
  if (state.plan && extra.length === 0 && columnsCache?.plan === state.plan && columnsCache.width === width) {
    return columnsCache.cols;
  }
  const lists = [...(state.plan?.chunks ?? []), ...extra];
  const cols: ChunkColumns = {
    idWidth: Math.max(4, ...lists.map((l) => clean(l.id).length)),
    filesMax,
    filesWidth: Math.min(
      filesMax,
      Math.max(8, ...lists.map((l) => visibleWidth(compactFiles(l.files, filesMax)))),
    ),
  };
  if (state.plan && extra.length === 0) columnsCache = { plan: state.plan, width, cols };
  return cols;
}

/** The file column of a chunk row: compacted, cut and padded to the shared width. */
export function filesCell(files: string[], cols: ChunkColumns, theme: Theme): string {
  return padEnd(
    truncate(compactFiles(files, cols.filesMax), cols.filesWidth, theme.sym.ellipsis),
    cols.filesWidth,
  );
}

export interface ChunkLineOptions {
  /** Column-aligned layout (live view); compact single line (plain logs) when omitted. */
  cols?: ChunkColumns;
}

/** `✔ c003  src/api/*.ts +2  38s  2 findings  skills: node-backend, sql  tools: read_file×4 grep×2` */
export function chunkLine(f: FinishedChunk, state: ReviewState, theme: Theme, o: ChunkLineOptions): string {
  const { c, sym } = theme;
  const r = f.record;
  const failed = r.status === 'failed';
  const mark = failed ? c.red(sym.fail) : c.green(sym.ok);
  const aligned = o.cols !== undefined;
  const id = o.cols ? padEnd(clean(r.id), o.cols.idWidth) : clean(r.id);
  const filesCol = o.cols ? filesCell(r.files, o.cols, theme) : compactFiles(r.files, PLAIN_FILES_WIDTH);
  const dur = aligned ? padStart(formatDuration(f.durationMs), 6) : formatDuration(f.durationMs);
  const sep = aligned ? '  ' : ' ';
  if (failed) {
    const err = clean((r.error ?? 'failed').split('\n')[0]);
    return join([`${mark} ${id}`, filesCol, dur, c.red(`failed: ${err}`)], sep);
  }
  const findings =
    r.findings > 0 ? c.yellow(plural(r.findings, 'finding')) : c.dim(aligned ? 'no findings' : '0 findings');
  const review = state.plan?.routing.review;
  const actual = [r.provider, r.model].filter(Boolean).join(':');
  const planned = review ? [review.provider, review.model].filter(Boolean).join(':') : '';
  const via = actual && planned && actual !== planned && r.model ? c.yellow(`via ${clean(actual)}`) : '';
  const tools = Object.entries(f.tools)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => `${clean(t)}${sym.times}${n}`)
    .join(' ');
  return join(
    [
      `${mark} ${id}`,
      filesCol,
      dur,
      findings,
      via,
      r.cached ? c.cyan(r.cached === 'all' ? 'cached' : 'partly cached') : '',
      r.skills.length ? c.dim(`skills: ${r.skills.map(clean).join(', ')}`) : '',
      tools ? c.dim(`tools: ${tools}`) : '',
    ],
    sep,
  );
}

export interface NarratorOptions {
  theme: Theme;
  verbose: boolean;
  /** Plain logs also print a line when a phase or chunk starts (the live view shows spinners instead). */
  starts: boolean;
  /** Current terminal width (live) or a generous default (plain). */
  width: () => number;
}

/**
 * Turns events into the lines that stay in the scrollback / log: header (target, refs notes, stack,
 * analyzers, models), phase completions with durations, finished chunks, fallbacks and warnings.
 */
export class Narrator {
  private titled = false;
  private modelsShown = false;

  constructor(private readonly o: NarratorOptions) {}

  lines(e: ReviewEvent, t: Transition, state: ReviewState): string[] {
    const { theme, verbose, starts } = this.o;
    const { c, sym } = theme;
    const out = this.phases(t.ended, state);
    const phaseOpen = (id: string) => state.current?.id === id && state.current.endedAt === undefined;
    switch (e.type) {
      case 'phase':
        if (starts) out.push(`${c.cyan('›')} ${clean(e.message)}`);
        break;
      case 'refs':
        out.push(...this.title(state));
        break;
      case 'stack':
        if (!phaseOpen('stack')) out.push(`  ${label(theme, 'stack')} ${c.dim(stackText(state, theme))}`);
        break;
      case 'analyzers':
        if (!phaseOpen('analyzers'))
          out.push(`  ${label(theme, 'analyzers')} ${c.dim(analyzersText(state, theme))}`);
        break;
      case 'plan':
        out.push(...this.title(state));
        if (!phaseOpen('chunking')) {
          out.push(`  ${label(theme, 'plan')} ${c.dim(planText(e.plan, theme))}`);
          out.push(...this.models(state));
        }
        break;
      case 'chunk-start':
        if (starts) {
          const r = state.running.get(e.chunk.id);
          out.push(
            join(
              [
                `${c.cyan(sym.start)} ${clean(e.chunk.id)}`,
                compactFiles(e.chunk.files, PLAIN_FILES_WIDTH),
                r?.skills.length ? c.dim(`skills: ${r.skills.map(clean).join(', ')}`) : '',
              ],
              ' ',
            ),
          );
        }
        break;
      case 'chunk-done':
        if (t.finished) {
          const counter = starts
            ? `[${String(t.finished.index).padStart(String(state.total).length, '0')}/${state.total}] `
            : '';
          // Live: one aligned row per chunk, cut to the terminal (details are in the report).
          // Plain logs keep everything on one long line.
          const width = this.o.width();
          const cols = starts ? undefined : chunkColumns(state, width);
          const line = chunkLine(t.finished, state, theme, { cols });
          out.push(starts ? counter + line : truncate(line, Math.max(10, width - 1), sym.ellipsis));
        }
        break;
      case 'critique-progress':
        if (starts) out.push(c.dim(`  critique batch ${e.batch}/${e.total} done`));
        break;
      case 'fallback':
        out.push(`${c.yellow(sym.back)} ${c.yellow('fallback')} ${clean(fallbackLabel(e, sym.arrow))}`);
        break;
      case 'warning':
        if (starts || verbose) out.push(`${c.yellow(sym.warn)} ${clean(e.message)}`);
        break;
    }
    return out;
  }

  /** Lines for phases that just ended (the models line follows chunking, once the plan is known). */
  phases(ended: PhaseState[], state: ReviewState): string[] {
    const out: string[] = [];
    for (const p of ended) {
      out.push(phaseLine(p, state, this.o.theme, this.o.starts));
      if (p.id === 'chunking' && state.plan) out.push(...this.models(state));
    }
    return out;
  }

  /** Header: what is being reviewed, plus refs notes (and the explanation when verbose). */
  private title(state: ReviewState): string[] {
    if (this.titled || !state.target) return [];
    this.titled = true;
    const { theme, verbose } = this.o;
    const { c, sym } = theme;
    const commits = commitCount(state.refs);
    const extra = join(
      [
        commits !== undefined ? plural(commits, 'commit') : '',
        state.plan ? plural(state.plan.units, 'file') : '',
      ],
      ', ',
    );
    const out = [
      `${c.cyan(sym.diamond)} ${c.bold(targetText(state.target, theme))}${extra ? c.dim(`  (${extra})`) : ''}`,
    ];
    if (state.refs) {
      if (verbose) for (const line of state.refs.explanation) out.push(c.dim(`  ${sym.dot} ${clean(line)}`));
      for (const note of state.refs.notes) out.push(`  ${c.yellow(sym.warn)} ${c.yellow(clean(note))}`);
    }
    return out;
  }

  private models(state: ReviewState): string[] {
    if (this.modelsShown || !state.plan) return [];
    this.modelsShown = true;
    const { theme } = this.o;
    return [
      `  ${label(theme, 'models')} ${theme.c.dim(routingText(state.plan.routing, theme))}`,
      `  ${label(theme, 'depth')} ${theme.c.dim(state.plan.depth === 'essential' ? `essential — serious production issues only (≥ ${state.plan.minSeverity})` : `full — every real defect (≥ ${state.plan.minSeverity})`)}`,
    ];
  }
}
