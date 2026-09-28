import path from 'node:path';
import type { GitRepo } from '../git/repo';
import type { ReviewUnit } from '../types';
import { runManaged } from '../util/processes';
import { changedCalls, changedSymbols, refersTo } from './expand';
import { dirOf, resolveImports, sourceKind } from './imports';

const posix = path.posix;

export type EdgeReason = 'import' | 'call' | 'test' | 'cochange' | 'directory' | 'package';

export interface FileEdge {
  a: string;
  b: string;
  /** 0..1, higher = stronger affinity. */
  weight: number;
  reason: EdgeReason;
}

export interface FileGraph {
  edges: FileEdge[];
  /** Resolved repo-relative import targets per reviewed file (including unchanged files). */
  imports: Map<string, string[]>;
}

export interface FileGraphOptions {
  units: ReviewUnit[];
  /** Every file in the reviewed revision (repo-relative), used to resolve import specifiers. */
  allFiles: string[];
  /** Reads a file of the reviewed revision (tsconfig.json, go.mod, composer.json, …). */
  readFile?: (path: string) => Promise<string | undefined>;
  /** Enables co-change edges from `git log`. */
  repo?: GitRepo;
  headSha?: string;
  /**
   * Commit history is mined from here when set (typically the merge base), so the change's own commits
   * do not count as co-change evidence. Defaults to `headSha`, then `HEAD`.
   */
  baseSha?: string;
  signal?: AbortSignal;
}

/** Edge weights by reason (co-change is scaled by coupling). */
export const EDGE_WEIGHTS: Readonly<Record<EdgeReason, number>> = {
  import: 1,
  call: 1,
  test: 1,
  cochange: 0.5,
  directory: 0.3,
  package: 0.1,
};

/** Groups with more files than this are linked as a chain instead of a clique (keeps the graph linear). */
const CLIQUE_MAX = 40;

/** Builds the affinity graph between reviewed files (imports, test pairs, co-change, directories). */
export async function buildFileGraph(opts: FileGraphOptions): Promise<FileGraph> {
  const byPath = new Map<string, ReviewUnit>();
  for (const u of opts.units) if (u.status !== 'deleted' && !byPath.has(u.path)) byPath.set(u.path, u);
  const units = [...byPath.values()].sort((a, b) => cmp(a.path, b.path));
  const reviewed = units.map((u) => u.path);
  const reviewedSet = new Set(reviewed);
  const allFiles = new Set(opts.allFiles);
  for (const f of reviewed) allFiles.add(f);

  // git log runs while imports are resolved
  const coChange =
    opts.repo && units.length > 1
      ? coChangeEdges(opts.repo, units, { from: opts.baseSha ?? opts.headSha, signal: opts.signal })
      : Promise.resolve([]);
  const resolved = await resolveImports({
    files: units.flatMap((u) => (u.content !== undefined ? [{ path: u.path, content: u.content }] : [])),
    allFiles,
    readFile: opts.readFile,
    signal: opts.signal,
  });
  const imports = new Map<string, string[]>();
  for (const f of reviewed) imports.set(f, resolved.get(f) ?? []);

  const edges = new EdgeCollector();
  for (const [from, targets] of imports) {
    for (const t of targets) if (reviewedSet.has(t)) edges.add(from, t, EDGE_WEIGHTS.import, 'import');
  }
  for (const e of callEdges(units)) edges.add(e.a, e.b, e.weight, e.reason);
  for (const [test, source] of pairTests(reviewed)) edges.add(test, source, EDGE_WEIGHTS.test, 'test');

  for (const e of await coChange) edges.add(e.a, e.b, e.weight, e.reason);
  opts.signal?.throwIfAborted();

  for (const files of groupBy(reviewed, dirOf).values())
    edges.link(files, EDGE_WEIGHTS.directory, 'directory');
  const manifests = manifestDirs(allFiles);
  const packages = groupBy(reviewed, (f) => packageRootOf(f, manifests));
  // In a single-package repository every pair would get the same edge: no information, skip it.
  if (packages.size > 1) {
    for (const files of packages.values()) edges.link(files, EDGE_WEIGHTS.package, 'package');
  }
  return { edges: edges.list(), imports };
}

/** A name changed in more files than this, or called from more changed files, is too common to link by. */
const MAX_DECLARING = 3;
const MAX_CALLERS = 8;

/**
 * Caller ↔ callee edges between changed files: file B's changed lines (added or removed) call a function
 * whose declaration file A changes (signature, body or removal), and B can refer to A (same directory, or it
 * names A's module). The changed function and its changed call sites then land in one chunk, so a review
 * sees both sides of a changed contract. Import edges often link them already; this also covers callers
 * the import scanner cannot resolve (same Go package, C headers, dynamic imports).
 */
export function callEdges(units: readonly ReviewUnit[]): FileEdge[] {
  const declaring = new Map<string, string[]>();
  for (const u of units) {
    for (const s of changedSymbols(u)) {
      if (s.local) continue;
      const files = declaring.get(s.name);
      if (files) files.push(u.path);
      else declaring.set(s.name, [u.path]);
    }
  }
  if (!declaring.size) return [];
  const callers = new Map<string, ReviewUnit[]>();
  for (const u of units) {
    if (!sourceKind(u.path)) continue;
    for (const n of changedCalls(u)) {
      if (!declaring.has(n)) continue;
      const list = callers.get(n);
      if (list) list.push(u);
      else callers.set(n, [u]);
    }
  }
  const edges = new EdgeCollector();
  for (const [name, from] of callers) {
    const files = declaring.get(name)!;
    if (files.length > MAX_DECLARING || from.length > MAX_CALLERS) continue;
    for (const caller of from) {
      for (const file of files) {
        if (file !== caller.path && refersTo(caller.path, caller.content ?? '', file))
          edges.add(caller.path, file, EDGE_WEIGHTS.call, 'call');
      }
    }
  }
  return edges.list();
}

/** Same-directory edges only: the structural fallback when no graph was built. */
export function directoryEdges(files: readonly string[]): FileEdge[] {
  const edges = new EdgeCollector();
  for (const group of groupBy([...files], dirOf).values())
    edges.link(group, EDGE_WEIGHTS.directory, 'directory');
  return edges.list();
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupBy(files: string[], key: (f: string) => string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    const k = key(f);
    const list = out.get(k);
    if (list) list.push(f);
    else out.set(k, [f]);
  }
  return out;
}

/** Undirected edges, one per (pair, reason), keeping the strongest weight. */
class EdgeCollector {
  private readonly edges = new Map<string, FileEdge>();

  add(x: string, y: string, weight: number, reason: EdgeReason): void {
    if (x === y || !(weight > 0)) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}\0${b}\0${reason}`;
    const prev = this.edges.get(key);
    if (!prev || prev.weight < weight) this.edges.set(key, { a, b, weight, reason });
  }

  /** Links every pair of a group (a sorted chain for very large groups). */
  link(files: string[], weight: number, reason: EdgeReason): void {
    const sorted = [...files].sort(cmp);
    if (sorted.length <= CLIQUE_MAX) {
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) this.add(sorted[i]!, sorted[j]!, weight, reason);
      }
    } else {
      for (let i = 1; i < sorted.length; i++) this.add(sorted[i - 1]!, sorted[i]!, weight, reason);
    }
  }

  list(): FileEdge[] {
    return [...this.edges.values()].sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b) || cmp(x.reason, y.reason));
  }
}

// ---------------------------------------------------------------------------------------------------
// Test ↔ source pairing
// ---------------------------------------------------------------------------------------------------

const FAMILY_BY_EXT: Record<string, string> = {
  '.ts': 'js',
  '.tsx': 'js',
  '.mts': 'js',
  '.cts': 'js',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.vue': 'js',
  '.svelte': 'js',
  '.py': 'python',
  '.go': 'go',
  '.java': 'jvm',
  '.kt': 'jvm',
  '.kts': 'jvm',
  '.scala': 'jvm',
  '.groovy': 'jvm',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.dart': 'dart',
  '.swift': 'swift',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'c',
  '.cpp': 'c',
  '.cxx': 'c',
  '.hpp': 'c',
  '.m': 'c',
  '.mm': 'c',
};

const TEST_NAME_RULES: Record<string, RegExp[]> = {
  js: [/^(.+?)\.(?:test|spec|e2e|integration|unit)$/],
  python: [/^test_(.+)$/, /^(.+)_test$/],
  go: [/^(.+)_test$/],
  jvm: [/^(.+?)(?:Tests?|IT|Spec|Suite)$/, /^Test([A-Z]\w*)$/],
  csharp: [/^(.+?)(?:Tests?|Specs?)$/],
  php: [/^(.+?)Test$/],
  ruby: [/^(.+)_(?:spec|test)$/, /^test_(.+)$/],
  rust: [/^(.+)_tests?$/],
  dart: [/^(.+)_test$/],
  swift: [/^(.+?)Tests?$/],
  elixir: [/^(.+)_test$/],
  c: [/^(.+)_(?:test|tests|unittest)$/, /^test_(.+)$/],
};

/** Directories whose files are tests even without a test-style name. */
const TEST_DIRS = new Set(['__tests__', '__test__', 'tests', 'test', 'spec', 'specs']);
/** Path segments ignored when comparing a test's directory with its source's (mirrored layouts). */
const NEUTRAL_SEGMENTS = new Set([
  ...TEST_DIRS,
  'src',
  'lib',
  'main',
  'app',
  'java',
  'kotlin',
  'scala',
  'groovy',
  'testing',
  'unit',
  'integration',
  'e2e',
]);

function familyOf(file: string): string | undefined {
  return FAMILY_BY_EXT[posix.extname(file).toLowerCase()];
}

function stemOf(file: string): string {
  const base = posix.basename(file);
  const ext = posix.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/** For a test file: the stem of the source it tests and its language family; undefined otherwise. */
export function testSubject(file: string): { stem: string; family: string } | undefined {
  const family = familyOf(file);
  if (!family) return undefined;
  const name = stemOf(file);
  for (const re of TEST_NAME_RULES[family] ?? []) {
    const m = re.exec(name);
    if (m?.[1]) return { stem: m[1], family };
  }
  const segments = dirOf(file).split('/');
  // __tests__/x.ts, tests/x.rs, test/foo.exs, spec/x.rb
  if (segments.some((s) => TEST_DIRS.has(s)) && family !== 'go' && family !== 'python') {
    return { stem: name, family };
  }
  return undefined;
}

function normalizedDir(dir: string): string {
  return dir
    .split('/')
    .filter((s) => s !== '.' && !NEUTRAL_SEGMENTS.has(s))
    .join('/');
}

/** How plausible it is that `test` tests `source` judging by directories (3 = same place … 0 = unrelated). */
function directoryAffinity(test: string, source: string): number {
  const td = dirOf(test);
  const sd = dirOf(source);
  if (td === sd) return 3;
  if (TEST_DIRS.has(posix.basename(td)) && dirOf(td) === sd) return 3;
  if (normalizedDir(td) === normalizedDir(sd)) return 2;
  return 0;
}

/**
 * Pairs test files with the sources they test, by naming conventions (`x.test.ts`, `__tests__/x.ts`,
 * `test_x.py`, `x_test.go`, `XTest.java`, `x_spec.rb`, …). A test pairs with the same-stem sources in the
 * most plausible directory; a unique same-stem source anywhere also counts. Returns [test, source] pairs.
 */
export function pairTests(files: string[]): Array<[string, string]> {
  const sources = new Map<string, string[]>();
  const tests: Array<{ file: string; key: string; family: string }> = [];
  for (const f of [...files].sort(cmp)) {
    const subject = testSubject(f);
    if (subject) tests.push({ file: f, key: `${subject.family}:${subject.stem}`, family: subject.family });
    else {
      const family = familyOf(f);
      if (!family) continue;
      const key = `${family}:${stemOf(f)}`;
      const list = sources.get(key);
      if (list) list.push(f);
      else sources.set(key, [f]);
    }
  }
  const pairs: Array<[string, string]> = [];
  for (const t of tests) {
    const candidates = sources.get(t.key) ?? [];
    if (!candidates.length) continue;
    const scored = candidates.map((c) => ({ c, score: directoryAffinity(t.file, c) }));
    const best = Math.max(...scored.map((s) => s.score));
    const minScore = t.family === 'go' ? 3 : 2;
    if (best >= minScore) {
      for (const s of scored) if (s.score === best) pairs.push([t.file, s.c]);
    } else if (candidates.length === 1 && t.family !== 'go') pairs.push([t.file, candidates[0]!]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------------------------------
// Package roots
// ---------------------------------------------------------------------------------------------------

const MANIFEST_NAMES = new Set([
  'package.json',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'pubspec.yaml',
  'mix.exs',
  'Package.swift',
]);

/** Directories that hold a package manifest ('.' = repository root). */
export function manifestDirs(allFiles: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const f of allFiles) {
    const base = posix.basename(f);
    if (MANIFEST_NAMES.has(base) || base.endsWith('.csproj') || base.endsWith('.gemspec')) dirs.add(dirOf(f));
  }
  return dirs;
}

/** Nearest ancestor directory of `file` holding a manifest ('.' when none). */
export function packageRootOf(file: string, manifests: Set<string>): string {
  let dir = dirOf(file);
  while (dir !== '.' && !manifests.has(dir)) dir = dirOf(dir);
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// Co-change
// ---------------------------------------------------------------------------------------------------

/** Commits examined. */
const COCHANGE_COMMITS = 500;
/** Commits touching more of the reviewed files than this are sweeping edits (formatting, renames): ignored. */
const MAX_CHANGESET_FILES = 30;
const MIN_SHARED_COMMITS = 2;
/** Minimum coupling (shared / min(revs)), as in code-maat's defaults. */
const MIN_COUPLING = 0.3;
const GIT_LOG_TIMEOUT_MS = 15_000;

export interface CoChangeOptions {
  /** Commit to walk history from (default HEAD). */
  from?: string;
  signal?: AbortSignal;
}

/**
 * Co-change edges among `units` from the last {@link COCHANGE_COMMITS} commits touching them:
 * pairs changed together in ≥ 2 commits, weight 0.5 × shared / min(revs). Git failures yield `[]`.
 */
export async function coChangeEdges(
  repo: GitRepo,
  units: ReadonlyArray<Pick<ReviewUnit, 'path' | 'oldPath'>>,
  opts: CoChangeOptions = {},
): Promise<FileEdge[]> {
  const alias = new Map<string, string>();
  for (const u of units) {
    alias.set(u.path, u.path);
    if (u.oldPath && !alias.has(u.oldPath)) alias.set(u.oldPath, u.path);
  }
  if (units.length < 2) return [];
  const from = opts.from && /^[0-9a-f]{7,64}$/i.test(opts.from) ? opts.from : 'HEAD';
  const pathspecs = [...alias.keys()].sort(cmp);
  let stdout: string;
  try {
    const res = await runManaged(
      'git',
      [
        '-c',
        'core.quotePath=false',
        '-c',
        'log.showSignature=false',
        '--literal-pathspecs',
        'log',
        '--no-merges',
        '--no-renames',
        '--name-only',
        '-n',
        String(COCHANGE_COMMITS),
        '--format=%x00%H',
        from,
        '--',
        ...pathspecs,
      ],
      {
        label: 'git log (co-change)',
        cwd: repo.root,
        timeoutMs: GIT_LOG_TIMEOUT_MS,
        signal: opts.signal,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (res.exitCode !== 0 || res.timedOut || res.aborted) return [];
    stdout = res.stdout;
  } catch {
    return [];
  }
  return coChangeFromLog(parseNameLog(stdout), alias);
}

/** Parses `git log --name-only --format=%x00%H` output into the file lists of each commit. */
export function parseNameLog(out: string): string[][] {
  const commits: string[][] = [];
  for (const block of out.split('\0')) {
    const lines = block.split('\n');
    if (!/^[0-9a-f]{7,64}$/.test(lines[0]?.trim() ?? '')) continue;
    commits.push(
      lines
        .slice(1)
        .filter((l) => l.length > 0)
        .map(unquoteGitPath),
    );
  }
  return commits;
}

/** Computes co-change edges from commit file lists; `alias` maps every known path (incl. old names) to the reviewed path. */
export function coChangeFromLog(commits: string[][], alias: ReadonlyMap<string, string>): FileEdge[] {
  const revs = new Map<string, number>();
  const shared = new Map<string, number>();
  for (const raw of commits) {
    const files = [...new Set(raw.map((f) => alias.get(f)).filter((f): f is string => f !== undefined))].sort(
      cmp,
    );
    if (files.length === 0 || files.length > MAX_CHANGESET_FILES) continue;
    for (const f of files) revs.set(f, (revs.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]}\0${files[j]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }
  const edges: FileEdge[] = [];
  for (const [key, count] of shared) {
    if (count < MIN_SHARED_COMMITS) continue;
    const [a, b] = key.split('\0') as [string, string];
    const coupling = count / Math.min(revs.get(a) ?? count, revs.get(b) ?? count);
    if (coupling < MIN_COUPLING) continue;
    edges.push({ a, b, weight: EDGE_WEIGHTS.cochange * Math.min(1, coupling), reason: 'cochange' });
  }
  return edges.sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b));
}

/** Undoes git's C-style quoting of unusual paths (`"a\tb"`, octal UTF-8 bytes). */
export function unquoteGitPath(line: string): string {
  if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) return line;
  const body = line.slice(1, -1);
  const bytes: number[] = [];
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
