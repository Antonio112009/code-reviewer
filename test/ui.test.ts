import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReviewUi, ReviewState, renderFrame, renderPlan, resolveUiMode } from '../src/cli/ui';
import { clean, compactFiles, gist, stripAnsi, truncate, visibleWidth } from '../src/cli/ui/format';
import { createLinker, resolveLinkMode, vscodeUrl } from '../src/cli/ui/links';
import { colorEnabled, createTheme } from '../src/cli/ui/theme';
import type { PlannedChunk, ReviewEvent, ReviewPlan } from '../src/review/events';
import type {
  AnalyzerRun,
  Chunk,
  ChunkRecord,
  Finding,
  RefsInfo,
  RunRecord,
  RunTarget,
  StackProfile,
} from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class FakeStream extends EventEmitter {
  out = '';
  constructor(
    public isTTY: boolean,
    public columns = 100,
    public rows = 30,
  ) {
    super();
  }
  write(s: string): boolean {
    this.out += s;
    return true;
  }
  get text(): string {
    return stripAnsi(this.out);
  }
}

const asStream = (s: FakeStream) => s as unknown as NodeJS.WriteStream;
const SGR = /\u001B\[[\d;]*m/;

const target: RunTarget = {
  kind: 'diff',
  base: 'origin/develop',
  head: 'feature/login',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  mergeBase: 'c'.repeat(40),
};

const refs: RefsInfo = {
  explanation: ['base origin/develop from GITHUB_BASE_REF'],
  baseSource: 'ci',
  remote: 'origin',
  fetched: true,
  notes: ['2 local commits are not pushed'],
};

const tech = (
  id: string,
  name: string,
  category: StackProfile['techs'][number]['category'],
  score: number,
) => ({
  id,
  name,
  category,
  score,
  reasons: [],
  packages: ['.'],
});

const stack: StackProfile = {
  techs: [
    tech('framework.nextjs', 'Next.js', 'framework', 0.95),
    tech('framework.react', 'React', 'framework', 0.9),
    tech('db.postgresql', 'PostgreSQL', 'database', 0.85),
    tech('orm.prisma', 'Prisma', 'orm', 0.9),
    tech('infra.docker', 'Docker', 'infra', 0.7),
    tech('lang.typescript', 'TypeScript', 'language', 1),
    tech('tool.maybe', 'Unlikely', 'tool', 0.1),
  ],
  packages: [
    {
      dir: '.',
      manifests: ['package.json'],
      techs: ['framework.nextjs', 'framework.react', 'db.postgresql', 'orm.prisma', 'infra.docker'],
    },
  ],
  languages: [{ id: 'typescript', files: 10 }],
  filesScanned: 42,
  durationMs: 12,
};

const analyzers: AnalyzerRun[] = [
  { id: 'secretlint', label: 'secretlint', tier: 'builtin', status: 'ok', hits: 2, durationMs: 300 },
  { id: 'patterns', label: 'patterns', tier: 'builtin', status: 'ok', hits: 5, durationMs: 20 },
  {
    id: 'shellcheck',
    label: 'shellcheck',
    tier: 'external',
    status: 'skipped',
    hits: 0,
    durationMs: 0,
    reason: 'not installed',
  },
];

const planned: PlannedChunk[] = [
  {
    id: 'c001',
    files: ['src/api/users.ts', 'src/api/login.ts', 'src/api/session.ts', 'src/db/schema.sql', 'README.md'],
    contextFiles: ['src/db/pool.ts'],
    tokens: 12_000,
    skills: [
      { id: 'node-backend', reasons: ['stack: node'] },
      { id: 'sql', reasons: ['content: SELECT'] },
    ],
    groupReasons: ['imports', 'test pair'],
    hints: 2,
    timeoutMs: 240_000,
  },
  {
    id: 'c002',
    files: ['src/web/page.tsx'],
    contextFiles: [],
    tokens: 8_000,
    skills: [{ id: 'react', reasons: ['files: **/*.tsx'] }],
    groupReasons: ['directory'],
    hints: 0,
    timeoutMs: 180_000,
  },
  {
    id: 'c003',
    files: ['src/db/users.ts'],
    contextFiles: [],
    tokens: 4_000,
    skills: [],
    groupReasons: [],
    hints: 0,
    timeoutMs: 120_000,
  },
];

const plan: ReviewPlan = {
  target,
  root: '/repo',
  depth: 'essential',
  minSeverity: 'major',
  refs,
  units: 12,
  skipped: [{ path: 'package-lock.json', reason: 'excluded' }],
  deleted: ['src/old.ts'],
  budget: 40_000,
  chunks: planned,
  totalTokens: 24_000,
  projectRules: ['CLAUDE.md'],
  routing: {
    review: { provider: 'claude', model: 'sonnet', reasoning: 'medium' },
    critique: { provider: 'claude', model: 'opus', reasoning: 'high' },
  },
  stack,
  analyzers,
  skills: ['node-backend', 'react', 'sql'],
};

function chunkOf(p: PlannedChunk, index: number): Chunk {
  return {
    id: p.id,
    index,
    parts: [],
    tokens: p.tokens,
    files: p.files,
    contextFiles: p.contextFiles,
    languages: ['typescript'],
    mentions: [],
    groupReasons: p.groupReasons,
  };
}

function record(p: PlannedChunk, over: Partial<ChunkRecord> = {}): ChunkRecord {
  return {
    id: p.id,
    files: p.files,
    contextFiles: p.contextFiles,
    tokens: p.tokens,
    skills: p.skills.map((s) => s.id),
    status: 'running',
    findings: 0,
    hints: p.hints,
    ...over,
  };
}

function finding(over: Partial<Finding>): Finding {
  return {
    id: 'f1',
    file: 'src/db/users.ts',
    startLine: 42,
    endLine: 45,
    severity: 'major',
    category: 'bug',
    title: 'Some defect',
    description: 'A concrete failure. More details follow here.',
    confidence: 0.9,
    skills: [],
    source: { chunkIds: ['c001'], provider: 'claude' },
    ...over,
  };
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1,
    id: '2026-09-27-abc123',
    command: 'review',
    status: 'completed',
    createdAt: '2026-09-27T10:00:00.000Z',
    durationMs: 245_000,
    repo: { root: '/repo' },
    target,
    options: {
      selfCritique: true,
      minConfidence: 0.7,
      skills: 'auto',
      tools: true,
      authors: true,
      maxChunkTokens: 40_000,
      concurrency: 3,
    },
    routing: plan.routing,
    analyzers,
    chunks: [
      record(planned[0]!, { status: 'done', findings: 2, toolCalls: { read_file: 10, grep: 6 } }),
      record(planned[1]!, {
        status: 'done',
        findings: 1,
        skills: ['react', 'sql'],
        toolCalls: { read_file: 4 },
      }),
      record(planned[2]!, { status: 'failed', error: 'timeout after 120s\nstack…', skills: ['react'] }),
    ],
    findings: [
      finding({
        id: 'f1',
        severity: 'critical',
        title: 'SQL built from request body',
        description: 'The `name` field is concatenated into the query. An attacker can inject SQL.',
        confidence: 0.95,
        critique: { verdict: 'confirmed', confidence: 0.95, reason: 'yes', originalConfidence: 0.9 },
        author: { name: 'Dev Two', commit: 'd'.repeat(40) },
      }),
      finding({
        id: 'f2',
        severity: 'minor',
        startLine: 80,
        endLine: 80,
        title: 'Pool not released on error',
      }),
      finding({
        id: 'f3',
        file: 'src/api/login.ts',
        startLine: 12,
        endLine: 12,
        severity: 'major',
        title: 'Session fixation',
        origin: 'static',
        tool: { analyzer: 'patterns', ruleId: 'session-fixation' },
      }),
    ],
    rejected: [
      finding({ id: 'r1', droppedReason: 'critique' }),
      finding({ id: 'r2', droppedReason: 'critique' }),
      finding({ id: 'r3', droppedReason: 'below-threshold', confidence: 0.4 }),
      finding({ id: 'r4', droppedReason: 'unknown-file' }),
    ],
    fallbacks: [{ role: 'review', from: 'claude:opus', to: 'claude:sonnet', reason: 'model unavailable' }],
    usage: { inputTokens: 120_345, cachedInputTokens: 80_000, outputTokens: 12_345 },
    warnings: ['c003 failed: timeout after 120s'],
    ...over,
  };
}

/** A realistic event sequence up to "review in progress" (c001 done, c002 running). */
function runThrough(emit: (e: ReviewEvent) => void, tick: (ms: number) => void): void {
  emit({ type: 'phase', phase: 'refs', message: 'Resolving refs' });
  emit({ type: 'refs', target, refs });
  tick(400);
  emit({ type: 'phase', phase: 'collect', message: 'Collecting changes' });
  tick(100);
  emit({ type: 'phase', phase: 'stack', message: 'Detecting stack' });
  emit({ type: 'stack', stack });
  tick(120);
  emit({ type: 'phase', phase: 'analyzers', message: 'Running static analyzers' });
  emit({ type: 'analyzers', runs: analyzers, hits: 7 });
  tick(1_200);
  emit({ type: 'phase', phase: 'chunking', message: 'Chunking' });
  emit({ type: 'plan', plan });
  tick(80);
  emit({ type: 'phase', phase: 'review', message: 'Reviewing 3 chunk(s) with claude' });
  emit({ type: 'chunk-start', chunk: chunkOf(planned[0]!, 0), record: record(planned[0]!) });
  emit({ type: 'chunk-start', chunk: chunkOf(planned[1]!, 1), record: record(planned[1]!) });
  tick(15_000);
  emit({ type: 'chunk-activity', chunkId: 'c002', tool: 'grep' });
  tick(23_000);
  emit({
    type: 'chunk-done',
    chunk: chunkOf(planned[0]!, 0),
    record: record(planned[0]!, {
      status: 'done',
      findings: 2,
      durationMs: 38_000,
      toolCalls: { read_file: 4, grep: 2 },
    }),
  });
}

let clock = 0;
const now = () => clock;
const tick = (ms: number) => {
  clock += ms;
};

beforeEach(() => {
  clock = 1_000_000;
});
afterEach(() => {
  vi.useRealTimers();
});

const TTY_ENV = { TERM: 'xterm-256color' };

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

describe('format helpers', () => {
  it('strips escape sequences and control characters from untrusted text', () => {
    const evil = 'a\u001B]52;c;ZXZpbA==\u0007b\u001B[31mc\rd\u202Ee\n f';
    expect(clean(evil)).toBe('abcde f');
  });

  it('truncates by visible width and keeps escape sequences balanced', () => {
    const s = `\u001B[1m${'x'.repeat(20)}\u001B[22m`;
    const t = truncate(s, 10);
    expect(stripAnsi(t)).toBe(`${'x'.repeat(9)}…`);
    expect(t.endsWith('\u001B[22m')).toBe(true);
    expect(visibleWidth('日本語')).toBe(6);
    expect(truncate('short', 10)).toBe('short');
  });

  it('compacts long file lists into a glob plus a count', () => {
    expect(compactFiles(['a.ts', 'b.ts'])).toBe('a.ts, b.ts');
    expect(compactFiles(planned[0]!.files, 30)).toBe('src/api/*.ts +2');
    expect(compactFiles(['x/one.ts', 'y/two.go', 'z/three.py'], 10)).toBe('x/one.ts +2');
  });

  it('takes the first sentence as the gist', () => {
    expect(gist('The `name` field is concatenated. Attackers can inject SQL.')).toBe(
      'The `name` field is concatenated.',
    );
    expect(gist('No sentence end here')).toBe('No sentence end here');
  });
});

describe('theme', () => {
  it('honours NO_COLOR, FORCE_COLOR and TERM=dumb', () => {
    const tty = { isTTY: true };
    expect(colorEnabled(tty, {})).toBe(true);
    expect(colorEnabled(tty, { NO_COLOR: '1' })).toBe(false);
    expect(colorEnabled(tty, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(false);
    expect(colorEnabled(tty, { TERM: 'dumb' })).toBe(false);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
    expect(colorEnabled(tty, { FORCE_COLOR: '0' })).toBe(false);
    expect(colorEnabled(tty, {}, true)).toBe(false);
  });

  it('picks live only on an interactive terminal outside CI', () => {
    expect(resolveUiMode('auto', { isTTY: true }, {})).toBe('live');
    expect(resolveUiMode('auto', { isTTY: true }, { CI: 'true' })).toBe('plain');
    expect(resolveUiMode('auto', { isTTY: true }, { CI: 'false' })).toBe('live');
    expect(resolveUiMode('auto', { isTTY: false }, {})).toBe('plain');
    expect(resolveUiMode('live', { isTTY: false }, {})).toBe('plain');
    expect(resolveUiMode('live', { isTTY: true }, { CI: '1' })).toBe('live');
    expect(resolveUiMode('plain', { isTTY: true }, {})).toBe('plain');
    expect(resolveUiMode('auto', { isTTY: true }, { TERM: 'dumb' })).toBe('plain');
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('links', () => {
  it('renders plain locations when off', () => {
    const l = createLinker({ mode: 'off', cwd: '/repo', root: '/repo' });
    expect(l.location('src/db/users.ts', 42, 45)).toBe('src/db/users.ts:42-45');
    expect(l.location('src/db/users.ts', 7, 7)).toBe('src/db/users.ts:7');
  });

  it('wraps locations in OSC 8 file:// links', () => {
    const l = createLinker({ mode: 'file', cwd: '/repo', root: '/repo' });
    expect(l.location('src/db/users.ts', 42, 45)).toBe(
      '\u001B]8;;file:///repo/src/db/users.ts\u0007src/db/users.ts:42-45\u001B]8;;\u0007',
    );
  });

  it('builds vscode://file links with line and column', () => {
    const l = createLinker({ mode: 'vscode', cwd: '/repo', root: '/repo' });
    const link = l.location('src/my file#1.ts', 42, 45);
    expect(link).toContain('vscode://file/repo/src/my%20file%231.ts:42:1');
    expect(stripAnsi(link)).toBe('src/my file#1.ts:42-45');
    expect(vscodeUrl('/a/b.ts')).toBe('vscode://file/a/b.ts');
  });

  it('shows paths relative to cwd and never links outside the root', () => {
    const l = createLinker({ mode: 'file', cwd: '/repo/src/db', root: '/repo' });
    expect(stripAnsi(l.location('src/db/users.ts', 3))).toBe('users.ts:3');
    expect(l.location('../etc/passwd', 1)).toBe('../etc/passwd:1');
  });

  it('percent-encodes control characters in link targets', () => {
    const l = createLinker({ mode: 'file', cwd: '/repo', root: '/repo' });
    const link = l.location('a\u0007\u001B.ts', 1);
    expect(link).toContain('file:///repo/a%07%1B.ts');
    expect(stripAnsi(link)).toBe('a.ts:1');
  });

  it('resolves the hyperlink setting against the terminal', () => {
    const tty = { isTTY: true };
    expect(resolveLinkMode('off', tty, { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.0' })).toBe(
      'off',
    );
    expect(resolveLinkMode('auto', tty, { TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.0' })).toBe(
      'file',
    );
    expect(resolveLinkMode('auto', tty, { TERM_PROGRAM: 'Apple_Terminal' })).toBe('off');
    expect(resolveLinkMode('auto', tty, { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.99.0' })).toBe(
      'off',
    );
    expect(resolveLinkMode('vscode', tty, {})).toBe('vscode');
    expect(resolveLinkMode('file', { isTTY: false }, {})).toBe('off');
    expect(resolveLinkMode('file', tty, { CI: 'true' })).toBe('off');
    expect(resolveLinkMode('file', tty, { FORCE_HYPERLINK: '0' })).toBe('off');
    expect(resolveLinkMode('auto', { isTTY: false }, { FORCE_HYPERLINK: '1' })).toBe('file');
  });
});

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

describe('live frame', () => {
  const theme = createTheme(false);

  it('shows the progress bar, counters, ETA and running chunks', () => {
    const state = new ReviewState(now());
    runThrough((e) => state.apply(e, now()), tick);
    tick(2_000);
    const frame = renderFrame(state, { theme, width: 100, height: 30, now: now() });
    const [header, ...lines] = frame.split('\n');
    expect(header).toBe(
      '◆ origin/develop … feature/login · 12 files · review claude:sonnet · critique claude:opus',
    );
    expect(lines[0]).toMatch(/^█+░+ 1\/3 chunks · 1 running · 2 findings · ⏱ 00:41 · ETA ~00:\d\d$/);
    expect(lines[1]).toContain('c002');
    expect(lines[1]).toContain('src/web/page.tsx');
    expect(lines[1]).toContain('00:40'); // per-chunk stopwatch
    expect(lines[1]).toContain('↳ grep');
    expect(lines[1]).toContain('react');
    for (const l of lines) expect(visibleWidth(l)).toBeLessThan(100);
  });

  it('marks chunks without recent activity as idle', () => {
    const state = new ReviewState(now());
    runThrough((e) => state.apply(e, now()), tick);
    tick(31_000);
    const frame = renderFrame(state, { theme, width: 100, height: 30, now: now() });
    expect(frame).toMatch(/c002 .* idle 00:\d\d/);
  });

  it('clips to the terminal height', () => {
    const state = new ReviewState(now());
    state.apply({ type: 'plan', plan: { ...plan, chunks: [] } }, now());
    state.apply({ type: 'phase', phase: 'review', message: 'Reviewing' }, now());
    for (let i = 0; i < 12; i++) {
      const p: PlannedChunk = { ...planned[2]!, id: `c1${String(i).padStart(2, '0')}` };
      state.apply({ type: 'chunk-start', chunk: chunkOf(p, i), record: record(p) }, now());
    }
    const frame = renderFrame(state, { theme, width: 80, height: 8, now: now() });
    const lines = frame.split('\n');
    expect(lines.length).toBeLessThanOrEqual(7);
    expect(lines[0]).toContain('◆ origin/develop');
    expect(lines.at(-1)).toContain('+8 more running');
  });

  it('shows a spinner row for other phases and critique progress', () => {
    const state = new ReviewState(now());
    state.apply({ type: 'phase', phase: 'stack', message: 'Detecting stack' }, now());
    tick(2_000);
    expect(renderFrame(state, { theme, width: 80, height: 20, now: now() })).toMatch(
      /^⠋|^\S Detecting stack {2}00:02/,
    );
    state.apply({ type: 'phase', phase: 'critique', message: 'Self-critique' }, now());
    state.apply({ type: 'critique-start', findings: 7, batches: 4 }, now());
    state.apply({ type: 'critique-progress', batch: 2, total: 4 }, now());
    tick(21_000);
    const frame = renderFrame(state, { theme, width: 100, height: 20, now: now() });
    expect(frame).toContain('critique');
    expect(frame).toContain('2/4 batches');
    expect(frame).toContain('7 findings');
    expect(frame).toContain('00:21');
  });
});

describe('review state', () => {
  it('prefers explicit phase-done durations and sums repeated phases', () => {
    const state = new ReviewState(now());
    state.apply({ type: 'phase', phase: 'refs', message: 'Resolving refs' }, now());
    tick(500);
    const t = state.apply({ type: 'phase-done', phase: 'refs', durationMs: 420 }, now());
    expect(t.ended.map((p) => p.id)).toEqual(['refs']);
    state.apply({ type: 'phase-done', phase: 'stack', durationMs: 30 }, now());
    state.apply({ type: 'phase', phase: 'review', message: 'Reviewing' }, now());
    tick(1_000);
    state.apply({ type: 'phase', phase: 'validate', message: 'Validating' }, now());
    state.apply({ type: 'phase', phase: 'review', message: 'Retrying' }, now());
    tick(2_000);
    expect(state.finish(now()).map((p) => p.id)).toEqual(['review']);
    expect(state.timings()).toEqual([
      { id: 'refs', ms: 420 },
      { id: 'stack', ms: 30 },
      { id: 'review', ms: 3_000 },
      { id: 'validate', ms: 0 },
    ]);
  });

  it('estimates the remaining time from finished chunks and concurrency', () => {
    const state = new ReviewState(now());
    state.apply(
      { type: 'plan', plan: { ...plan, chunks: [...planned, { ...planned[2]!, id: 'c004' }] } },
      now(),
    );
    expect(state.eta(now())).toBeUndefined();
    for (const p of planned.slice(0, 2)) {
      state.apply({ type: 'chunk-start', chunk: chunkOf(p, 0), record: record(p) }, now());
    }
    tick(40_000);
    state.apply(
      {
        type: 'chunk-done',
        chunk: chunkOf(planned[0]!, 0),
        record: record(planned[0]!, { durationMs: 40_000 }),
      },
      now(),
    );
    // 2 queued × 40 s + c002 (40 s elapsed → at least 10% of the average left), over 2 lanes
    expect(state.eta(now())).toBe((2 * 40_000 + 4_000) / 2);
  });
});

describe('createReviewUi (live)', () => {
  function live(env: Record<string, string> = TTY_ENV, hyperlinks: 'off' | 'file' = 'off') {
    const stream = new FakeStream(true, 100, 30);
    const ui = createReviewUi({
      stream: asStream(stream),
      mode: 'auto',
      hyperlinks,
      verbose: false,
      cwd: '/repo',
      root: '/repo',
      now,
      env,
      stdin: { isTTY: true },
    });
    return { stream, ui };
  }

  it('persists the header, phase lines and finished chunks above the live area', () => {
    vi.useFakeTimers();
    const { stream, ui } = live();
    expect(ui.mode).toBe('live');
    expect(ui.interactive).toBe(true);
    runThrough((e) => ui.onEvent(e), tick);
    vi.advanceTimersByTime(100);
    const text = stream.text;
    expect(text).toContain('◆ origin/develop … feature/login\n');
    expect(text).toContain('! 2 local commits are not pushed');
    expect(text).toMatch(/✔ refs +400ms {2}base origin\/develop from GITHUB_BASE_REF/);
    expect(text).toMatch(/✔ stack +120ms {2}Next\.js · React · PostgreSQL · Prisma · Docker/);
    expect(text).toContain('secretlint ✓ 2 hints · patterns ✓ 5 hints · shellcheck –');
    expect(text).toMatch(/✔ chunking +80ms {2}12 files → 3 chunks · ~24k tokens · 1 skipped · 1 deleted/);
    expect(text).toContain('models    review claude:sonnet (medium) · critique claude:opus (high)');
    expect(text).toMatch(
      /✔ c001 {2}src\/api\/\*\.ts \+2 +38s {2}2 findings {2}skills: node-backend, sql {2}tools: read_file×4 grep×2/,
    );
    expect(text).toContain('1/3 chunks');
    expect(stream.out).toContain('\u001B[?25l'); // cursor hidden while live
    ui.stop();
    expect(stream.out.endsWith('\u001B[?25h')).toBe(true);
  });

  it('redraws on the timer (activity only marks the state)', () => {
    vi.useFakeTimers();
    const { stream, ui } = live();
    runThrough((e) => ui.onEvent(e), tick);
    const before = stream.out.length;
    ui.onEvent({ type: 'chunk-activity', chunkId: 'c002', tool: 'read_file' });
    expect(stream.out.length).toBe(before);
    vi.advanceTimersByTime(100);
    expect(stripAnsi(stream.out.slice(before))).toContain('↳ read_file');
    ui.stop();
  });

  it('pause() releases the terminal and buffers output until resume()', () => {
    vi.useFakeTimers();
    const { stream, ui } = live();
    runThrough((e) => ui.onEvent(e), tick);
    ui.pause();
    expect(stream.out.endsWith('\u001B[?25h')).toBe(true);
    const paused = stream.out.length;
    ui.onEvent({
      type: 'chunk-done',
      chunk: chunkOf(planned[1]!, 1),
      record: record(planned[1]!, { status: 'done', findings: 0, durationMs: 40_000 }),
    });
    ui.log('hello from a prompt');
    vi.advanceTimersByTime(500);
    expect(stream.out.length).toBe(paused);
    ui.resume();
    const after = stripAnsi(stream.out.slice(paused));
    expect(after).toContain('✔ c002');
    expect(after).toContain('hello from a prompt');
    ui.stop();
  });

  it('stop() is idempotent and removes its exit hook', () => {
    const exitListeners = process.listenerCount('exit');
    const { stream, ui } = live();
    expect(process.listenerCount('exit')).toBe(exitListeners + 1);
    ui.stop();
    ui.stop();
    expect(process.listenerCount('exit')).toBe(exitListeners);
    const len = stream.out.length;
    ui.onEvent({ type: 'phase', phase: 'critique', message: 'x' });
    expect(stream.out.length).toBe(len);
  });

  it('emits no colors with NO_COLOR but still drives the cursor', () => {
    vi.useFakeTimers();
    const { stream, ui } = live({ ...TTY_ENV, NO_COLOR: '1' });
    runThrough((e) => ui.onEvent(e), tick);
    ui.finish(makeRun(), { reports: [] });
    expect(SGR.test(stream.out)).toBe(false);
    expect(stream.out).toContain('\u001B[?25l');
  });

  it('uses colors on a TTY by default', () => {
    const { stream, ui } = live();
    ui.finish(makeRun(), { reports: [] });
    expect(SGR.test(stream.out)).toBe(true);
  });

  it('never writes escape sequences taken from untrusted text', () => {
    vi.useFakeTimers();
    const { stream, ui } = live();
    const evil: PlannedChunk = { ...planned[2]!, files: ['src/\u001B]52;c;ZXZpbA==\u0007x.ts'] };
    ui.onEvent({ type: 'phase', phase: 'review', message: 'Reviewing \u001B]0;pwned\u0007' });
    ui.onEvent({ type: 'chunk-start', chunk: chunkOf(evil, 0), record: record(evil) });
    vi.advanceTimersByTime(100);
    ui.finish(
      makeRun({
        findings: [
          finding({ title: 'Bad\u001B[2J title', description: 'desc \u001B]52;c;AAAA\u0007 here.' }),
        ],
        warnings: ['warn \u001B]0;title\u0007'],
      }),
      { reports: [] },
    );
    expect(stream.out).not.toContain('\u001B]52');
    expect(stream.out).not.toContain('\u001B]0;');
    expect(stream.out).not.toContain('\u001B[2J');
  });
});

// ---------------------------------------------------------------------------
// Plain mode
// ---------------------------------------------------------------------------

describe('createReviewUi (plain)', () => {
  function plain(env: Record<string, string> = {}) {
    const stream = new FakeStream(false, 120);
    const ui = createReviewUi({
      stream: asStream(stream),
      mode: 'auto',
      hyperlinks: 'auto',
      verbose: false,
      cwd: '/repo',
      root: '/repo',
      now,
      env,
      stdin: { isTTY: false },
    });
    return { stream, ui };
  }

  it('prints one line per state change without cursor control or colors', () => {
    const { stream, ui } = plain();
    expect(ui.mode).toBe('plain');
    expect(ui.interactive).toBe(false);
    runThrough((e) => ui.onEvent(e), tick);
    const lines = stream.out.trimEnd().split('\n');
    expect(stream.out).not.toContain('\u001B');
    expect(lines[0]).toBe('[00:00] › Resolving refs');
    expect(lines).toContain('[00:00] ◆ origin/develop … feature/login');
    expect(lines).toContain('[00:00]   ! 2 local commits are not pushed');
    expect(lines.some((l) => /^\[00:00\] ✔ refs +400ms/.test(l))).toBe(true);
    expect(
      lines.some((l) => l.includes('▶ c001 src/api/users.ts, src/api/login.ts, src/api/session.ts')),
    ).toBe(true);
    expect(lines.at(-1)).toBe(
      '[00:39] [1/3] ✔ c001 src/api/users.ts, src/api/login.ts, src/api/session.ts, src/db/schema.sql, README.md 38s 2 findings skills: node-backend, sql tools: read_file×4 grep×2',
    );
    // chunk activity never prints a line
    expect(stream.out).not.toContain('grep\n');
    ui.stop();
  });

  it('prints a heartbeat after a minute of silence', () => {
    vi.useFakeTimers();
    const { stream, ui } = plain();
    runThrough((e) => ui.onEvent(e), tick);
    const before = stream.out.length;
    tick(30_000);
    vi.advanceTimersByTime(15_000);
    expect(stream.out.length).toBe(before);
    tick(31_000);
    vi.advanceTimersByTime(15_000);
    const beat = stream.out.slice(before);
    expect(beat).toMatch(/^\[01:40\] … still reviewing: 1\/3 chunks done · running c002 01:39 grep\n$/);
    ui.stop();
  });

  it('prints failures and fallbacks, and warnings in plain logs', () => {
    const { stream, ui } = plain();
    ui.onEvent({ type: 'plan', plan });
    ui.onEvent({
      type: 'fallback',
      role: 'review',
      from: 'claude:opus',
      to: 'claude:sonnet',
      reason: 'unavailable',
    });
    ui.onEvent({ type: 'warning', message: 'something odd' });
    ui.onEvent({ type: 'chunk-start', chunk: chunkOf(planned[2]!, 2), record: record(planned[2]!) });
    tick(61_000);
    ui.onEvent({
      type: 'chunk-done',
      chunk: chunkOf(planned[2]!, 2),
      record: record(planned[2]!, {
        status: 'failed',
        error: 'timeout after 60s\ndetails',
        durationMs: 61_000,
      }),
    });
    const text = stream.out;
    expect(text).toContain('↪ fallback review: claude:opus → claude:sonnet (unavailable)');
    expect(text).toContain('! something odd');
    expect(text).toContain('[1/3] ✖ c003 src/db/users.ts 1m 01s failed: timeout after 60s');
    ui.stop();
  });

  it('uses colors in plain mode only with FORCE_COLOR', () => {
    const { stream, ui } = plain({ FORCE_COLOR: '1' });
    ui.onEvent({ type: 'phase', phase: 'refs', message: 'Resolving refs' });
    ui.finish(makeRun(), { reports: [] });
    expect(SGR.test(stream.out)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('summary', () => {
  function finish(run: RunRecord, hyperlinks: 'off' | 'file' | 'vscode' = 'off', columns = 120) {
    const stream = new FakeStream(true, columns, 40);
    const ui = createReviewUi({
      stream: asStream(stream),
      mode: 'auto',
      hyperlinks,
      verbose: false,
      cwd: '/repo',
      root: '/repo',
      now,
      env: TTY_ENV,
      stdin: { isTTY: true },
    });
    runThrough((e) => ui.onEvent(e), tick);
    tick(5_000);
    ui.finish(run, {
      reports: ['/repo/.code-reviewer/runs/x/report.md', '/repo/.code-reviewer/runs/x/report.html'],
      runDir: '/repo/.code-reviewer/runs/x',
    });
    const out = stream.out.slice(stream.out.lastIndexOf('\u001B[?25h'));
    return { raw: out, text: stripAnsi(out) };
  }

  it('prints the headline, findings grouped by file and the run facts', () => {
    const { text } = finish(makeRun());
    const lines = text.split('\n');
    expect(text).toContain('✖ 1 critical · 1 major · 1 minor');
    const critical = lines.findIndex((l) => l.startsWith('  CRITICAL  src/db/users.ts:42-45'));
    const minor = lines.findIndex((l) => l.startsWith('  MINOR     src/db/users.ts:80'));
    const major = lines.findIndex((l) => l.startsWith('  MAJOR     src/api/login.ts:12'));
    expect(critical).toBeGreaterThan(0);
    // grouped by file: both users.ts findings first (worst file first), then login.ts
    expect(minor).toBeGreaterThan(critical);
    expect(major).toBeGreaterThan(minor);
    expect(lines[critical]).toContain('SQL built from request body  conf 0.95 · critic ✓ · @Dev Two');
    expect(lines[critical + 1]).toBe('            The `name` field is concatenated into the query.');
    expect(lines[major]).toContain('static patterns');
    expect(text).toContain('Skills     react ×2 · sql ×2 · node-backend ×1');
    expect(text).toContain('Tools      read_file ×14 · grep ×6');
    expect(text).toContain('Analyzers  secretlint ✓ 2 hints · patterns ✓ 5 hints · shellcheck –');
    expect(text).toContain('Rejected   4: 2 rejected by critique · 1 below confidence 0.7 · 1 unknown file');
    expect(text).toContain('Fallbacks  review: claude:opus → claude:sonnet (model unavailable)');
    expect(text).toContain('Warnings   ! c003 failed: timeout after 120s');
    expect(text).toMatch(
      /Timings {4}4m 05s total · refs 400ms · collect 100ms · stack 120ms · analyzers 1\.2s · chunking 80ms · review 43s/,
    );
    expect(text).toContain('Tokens     in 120,345 · cached 80,000 · out 12,345');
    expect(text).toContain('Run        2026-09-27-abc123 (completed) → .code-reviewer/runs/x');
    expect(text).toContain('Reports    report.md · report.html');
  });

  it('reports a clean run', () => {
    const { text } = finish(makeRun({ findings: [], rejected: [], fallbacks: [], warnings: [] }));
    expect(text).toContain('✔ No defects above confidence 0.7');
    expect(text).not.toContain('Rejected');
    expect(text).not.toContain('Fallbacks');
  });

  it('leads with the error when a run failed without findings', () => {
    const { text } = finish(makeRun({ status: 'failed', error: 'provider crashed\ntrace', findings: [] }));
    expect(text).toContain('✖ Review failed: provider crashed');
    expect(text).not.toContain('No defects');
  });

  it('flags partial runs', () => {
    const { text } = finish(makeRun({ status: 'partial' }));
    expect(text).toContain('! Partial result: 1 of 3 chunks failed');
  });

  it('fits lines to the terminal width', () => {
    const long = finding({ title: 'T'.repeat(200), description: `${'word '.repeat(80)}.` });
    const { text } = finish(makeRun({ findings: [long] }), 'off', 80);
    for (const l of text.split('\n')) expect(visibleWidth(l)).toBeLessThan(80);
  });

  it('makes locations and reports clickable', () => {
    const file = finish(makeRun(), 'file').raw;
    expect(file).toContain(
      '\u001B]8;;file:///repo/src/db/users.ts\u0007src/db/users.ts:42-45\u001B]8;;\u0007',
    );
    expect(file).toContain(
      '\u001B]8;;file:///repo/.code-reviewer/runs/x/report.md\u0007report.md\u001B]8;;\u0007',
    );
    const vscode = finish(makeRun(), 'vscode').raw;
    expect(vscode).toContain('\u001B]8;;vscode://file/repo/src/db/users.ts:42:1\u0007');
    const off = finish(makeRun(), 'off').raw;
    expect(off).not.toContain('\u001B]8;;');
  });

  it('fail() prints a red error block once', () => {
    const stream = new FakeStream(true);
    const ui = createReviewUi({
      stream: asStream(stream),
      mode: 'auto',
      hyperlinks: 'off',
      verbose: false,
      cwd: '/repo',
      now,
      env: TTY_ENV,
      stdin: { isTTY: true },
    });
    ui.fail(new Error('Could not resolve base\nhint: pass --base'));
    ui.fail(new Error('second'));
    expect(stream.out).toContain('\u001B[31m');
    const text = stream.text;
    expect(text).toContain('✖ Could not resolve base');
    expect(text).toContain('  hint: pass --base');
    expect(text).not.toContain('second');
  });
});

// ---------------------------------------------------------------------------
// Dry-run plan
// ---------------------------------------------------------------------------

describe('renderPlan', () => {
  it('explains refs, stack, analyzers and every chunk', () => {
    const text = renderPlan(plan, { color: false, cwd: '/repo' });
    expect(text).not.toContain('\u001B');
    expect(text).toContain(
      '◆ Review plan  origin/develop … feature/login  (merge-base cccccccc · head bbbbbbbb)',
    );
    expect(text).toContain('Refs       base from ci · remote origin · fetched');
    expect(text).toContain('· base origin/develop from GITHUB_BASE_REF');
    expect(text).toContain('! 2 local commits are not pushed');
    expect(text).toContain('Models     review claude:sonnet (medium) · critique claude:opus (high)');
    expect(text).toContain('Stack      Next.js · React · PostgreSQL · Prisma · Docker · TypeScript');
    expect(text).not.toContain('Unlikely');
    expect(text).toContain('Analyzers  secretlint ✓ 2 hints · patterns ✓ 5 hints · shellcheck –');
    expect(text).toContain('shellcheck: not installed');
    expect(text).toContain('Rules      CLAUDE.md');
    expect(text).toContain('Files      12 to review · 1 deleted · 1 skipped');
    expect(text).toContain('skipped: package-lock.json (excluded)');
    expect(text).toContain('Chunks (3, budget 40,000 tokens each)');
    expect(text).toContain('  c001  12,000 tok  timeout 4m 00s  2 hints  [imports, test pair]');
    expect(text).toContain(
      'files    src/api/users.ts, src/api/login.ts, src/api/session.ts, src/db/schema.sql, README.md',
    );
    expect(text).toContain('context  src/db/pool.ts');
    expect(text).toContain('skills   node-backend (stack: node), sql (content: SELECT)');
    expect(text).toContain('c002   8,000 tok  timeout 3m 00s  0 hints  [directory]');
    expect(text).toContain(
      'Totals     3 chunks · 24,000 tokens · 7 files + 1 context · 2 hints · skills: node-backend, react, sql',
    );
  });

  it('colors only when asked and sanitises repository text', () => {
    const evil = { ...plan, skipped: [{ path: 'x\u001B]52;c;AA\u0007.bin', reason: 'binary' }] };
    expect(renderPlan(evil, { color: false, cwd: '/repo' })).not.toContain('\u001B');
    expect(SGR.test(renderPlan(plan, { color: true, cwd: '/repo' }))).toBe(true);
  });
});
