import { constants, type Dirent } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { GitRepo } from '../../git/repo';
import { resolveInside } from '../../util/paths';
import { runManaged, spawnManaged, terminate } from '../../util/processes';
import type { FileKind } from './rules';

/** Hard limits of the static scan (the whole point is to stay cheap and safe on untrusted repos). */
export interface ScanLimits {
  /** Max files whose content is read. */
  maxFiles: number;
  /** Max size of a single file we open. */
  maxFileBytes: number;
  /** Max total bytes read. */
  maxTotalBytes: number;
  /** Time budget for reading contents (listing has its own timeout). */
  budgetMs: number;
  /** Max directory depth (number of `/` in the path) of files we open. */
  maxDepth: number;
  /** Max entries listed when walking a non-git directory. */
  maxListed: number;
}

export const DEFAULT_LIMITS: ScanLimits = {
  maxFiles: 300,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  budgetMs: 2_000,
  maxDepth: 6,
  maxListed: 200_000,
};

const LIST_TIMEOUT_MS = 15_000;
const LIST_MAX_BUFFER = 128 * 1024 * 1024;
const WALK_BUDGET_MS = 5_000;
/** Kinds of which only the head is inspected: dialect hints of `.sql` files, the tools-version line of `Package.swift`. */
const HEAD_BYTES: Partial<Record<FileKind, number>> = { sql: 8 * 1024, 'swift-package': 1024 };

/** Directories never descended into / never counted (vendored, generated or test data). */
export const SKIP_DIRS = new Set([
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'third_party',
  'third-party',
  'thirdparty',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'testdata',
  'fixtures',
  '__fixtures__',
  '__snapshots__',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '__pycache__',
  '.gradle',
  '.idea',
  '.terraform',
  'Pods',
  'DerivedData',
  '.dart_tool',
  '_build',
  'deps',
  '.code-reviewer',
]);

/** True when any directory segment of the repo-relative posix `file` is skipped. */
export function inSkippedDir(file: string): boolean {
  let start = 0;
  for (;;) {
    const slash = file.indexOf('/', start);
    if (slash < 0) return false;
    if (SKIP_DIRS.has(file.slice(start, slash))) return true;
    start = slash + 1;
  }
}

// ---------------------------------------------------------------------------
// File kinds (allow-list of files we are willing to open)
// ---------------------------------------------------------------------------

interface KindLimit {
  /** Lower is read first. */
  priority: number;
  max: number;
}

/** Priority of dependency manifests (kinds at or above it may exceed their per-kind share). */
const MANIFEST_PRIORITY = 1;

export const KIND_LIMITS: Record<FileKind, KindLimit> = {
  gitattributes: { priority: 0, max: 1 },
  npm: { priority: 1, max: 60 },
  'pnpm-workspace': { priority: 1, max: 2 },
  pyproject: { priority: 1, max: 20 },
  requirements: { priority: 1, max: 20 },
  pipfile: { priority: 1, max: 5 },
  gomod: { priority: 1, max: 20 },
  gowork: { priority: 1, max: 2 },
  cargo: { priority: 1, max: 25 },
  pom: { priority: 1, max: 20 },
  gradle: { priority: 1, max: 25 },
  'gradle-settings': { priority: 1, max: 3 },
  'gradle-catalog': { priority: 1, max: 3 },
  csproj: { priority: 1, max: 25 },
  'nuget-props': { priority: 1, max: 5 },
  composer: { priority: 1, max: 15 },
  gemfile: { priority: 1, max: 8 },
  'gemfile-lock': { priority: 1, max: 8 },
  pubspec: { priority: 1, max: 8 },
  mix: { priority: 1, max: 8 },
  'swift-package': { priority: 1, max: 10 },
  'version-file': { priority: 1, max: 30 },
  'tool-versions': { priority: 1, max: 5 },
  env: { priority: 2, max: 10 },
  compose: { priority: 2, max: 10 },
  'github-workflow': { priority: 2, max: 20 },
  ci: { priority: 2, max: 5 },
  prisma: { priority: 3, max: 10 },
  drizzle: { priority: 3, max: 5 },
  typeorm: { priority: 3, max: 5 },
  knex: { priority: 3, max: 5 },
  sequelize: { priority: 3, max: 5 },
  'django-settings': { priority: 3, max: 10 },
  alembic: { priority: 3, max: 3 },
  'spring-config': { priority: 3, max: 15 },
  'rails-db': { priority: 3, max: 3 },
  'laravel-db': { priority: 3, max: 3 },
  'dotnet-code': { priority: 3, max: 10 },
  appsettings: { priority: 3, max: 6 },
  chart: { priority: 4, max: 10 },
  dockerfile: { priority: 4, max: 10 },
  sam: { priority: 4, max: 3 },
  k8s: { priority: 4, max: 20 },
  terraform: { priority: 4, max: 10 },
  sql: { priority: 5, max: 5 },
};

const REQUIREMENTS_RE = /^(?:[\w-]+[-_.])?requirements(?:[-_.][\w.-]+)?\.(?:txt|in)$/;
const ENV_RE =
  /^(?:\.env(?:\.[\w-]+)*\.(?:example|sample|template|dist|defaults|tmpl|tpl)|(?:example|sample)\.env|env\.(?:example|sample|template))$/;
const COMPOSE_RE = /^(?:docker-)?compose(?:\.[\w-]+)*\.ya?ml$/;
const SPRING_RE = /^(?:application|bootstrap)(?:-[\w]+)?\.(?:properties|ya?ml)$/;
const K8S_DIR_RE =
  /(?:^|\/)(?:k8s|kubernetes|manifests|deploy|deployment|deployments|kustomize|helm|charts)(?:\/|$)/;
const DOCKERFILE_RE = /^(?:Dockerfile\.[\w.-]+|[\w.-]+\.[Dd]ockerfile)$/;

function lastSegment(dir: string): string {
  return dir.slice(dir.lastIndexOf('/') + 1);
}

/** Which kind of readable file `file` (repo-relative, posix) is, or undefined when we never open it. */
export function classify(file: string): FileKind | undefined {
  const slash = file.lastIndexOf('/');
  const base = file.slice(slash + 1);
  const dir = slash < 0 ? '' : file.slice(0, slash);
  switch (base) {
    case '.gitattributes':
      return dir === '' ? 'gitattributes' : undefined;
    case 'package.json':
      return 'npm';
    case 'pnpm-workspace.yaml':
      return 'pnpm-workspace';
    case 'pyproject.toml':
      return 'pyproject';
    case 'Pipfile':
      return 'pipfile';
    case 'go.mod':
      return 'gomod';
    case 'go.work':
      return 'gowork';
    case 'Cargo.toml':
      return 'cargo';
    case 'pom.xml':
      return 'pom';
    case 'build.gradle':
    case 'build.gradle.kts':
      return 'gradle';
    case 'settings.gradle':
    case 'settings.gradle.kts':
      return 'gradle-settings';
    case 'libs.versions.toml':
      return 'gradle-catalog';
    case 'Directory.Packages.props':
      return 'nuget-props';
    case 'composer.json':
      return 'composer';
    case 'Directory.Build.props':
      return 'nuget-props';
    case 'Gemfile':
      return 'gemfile';
    case 'Gemfile.lock':
      return 'gemfile-lock';
    case 'pubspec.yaml':
      return 'pubspec';
    case 'mix.exs':
      return 'mix';
    case 'Package.swift':
      return 'swift-package';
    case '.nvmrc':
    case '.node-version':
    case '.python-version':
    case '.python-versions':
    case 'runtime.txt':
    case '.ruby-version':
    case '.bun-version':
    case '.swift-version':
    case 'rust-toolchain':
    case 'rust-toolchain.toml':
      return 'version-file';
    case '.tool-versions':
      return 'tool-versions';
    case '.gitlab-ci.yml':
    case 'azure-pipelines.yml':
    case 'azure-pipelines.yaml':
    case 'bitbucket-pipelines.yml':
      return 'ci';
    case 'alembic.ini':
      return 'alembic';
    case 'Chart.yaml':
      return 'chart';
    case 'Dockerfile':
    case 'Containerfile':
      return 'dockerfile';
    case 'settings.py':
      return 'django-settings';
    case 'database.yml':
      return lastSegment(dir) === 'config' ? 'rails-db' : undefined;
    case 'database.php':
      return lastSegment(dir) === 'config' ? 'laravel-db' : undefined;
    case 'config.json':
    case 'database.json':
      return lastSegment(dir) === 'config' ? 'sequelize' : undefined;
    case 'Program.cs':
    case 'Startup.cs':
      return 'dotnet-code';
    case 'template.yaml':
    case 'template.yml':
      return 'sam';
  }
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  switch (ext) {
    case '.csproj':
    case '.fsproj':
    case '.vbproj':
      return 'csproj';
    case '.prisma':
      return 'prisma';
    case '.tf':
      return 'terraform';
    case '.sql':
      return 'sql';
    case '.txt':
    case '.in':
      return REQUIREMENTS_RE.test(base) || lastSegment(dir) === 'requirements' ? 'requirements' : undefined;
    case '.py':
      return lastSegment(dir) === 'settings' ? 'django-settings' : undefined;
    case '.cs':
      return base.endsWith('Context.cs') ? 'dotnet-code' : undefined;
    case '.properties':
      return SPRING_RE.test(base) ? 'spring-config' : undefined;
    case '.yml':
    case '.yaml':
      if (dir === '.github/workflows') return 'github-workflow';
      if (dir === '.circleci' && base === 'config.yml') return 'ci';
      if (COMPOSE_RE.test(base)) return 'compose';
      if (SPRING_RE.test(base)) return 'spring-config';
      if (base.startsWith('ormconfig.')) return 'typeorm';
      if (ENV_RE.test(base)) return 'env';
      return K8S_DIR_RE.test(dir) ? 'k8s' : undefined;
    case '.json':
      if (/^appsettings(?:\.[\w-]+)?\.json$/.test(base)) return 'appsettings';
      if (base === 'drizzle.config.json') return 'drizzle';
      return base === 'ormconfig.json' ? 'typeorm' : undefined;
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.ts':
    case '.mts':
      if (base.startsWith('drizzle.config.')) return 'drizzle';
      if (base.startsWith('ormconfig.') || base.startsWith('data-source.')) return 'typeorm';
      if (base.startsWith('knexfile.')) return 'knex';
      return undefined;
  }
  if (ENV_RE.test(base)) return 'env';
  if (DOCKERFILE_RE.test(base)) return 'dockerfile';
  return undefined;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface ListedFile {
  path: string;
  /** Blob id when listed from a git tree. */
  oid?: string;
  size?: number;
}

export interface Listing {
  files: ListedFile[];
  source: 'git-tree' | 'git-index' | 'walk' | 'given';
  notes: string[];
}

export interface ListOptions {
  root: string;
  repo?: GitRepo;
  sha?: string;
  files?: string[];
  signal?: AbortSignal;
  limits: ScanLimits;
}

/** Normalises a repo-relative path; undefined for absolute paths or paths escaping the root. */
export function normalizeRel(p: string): string | undefined {
  if (!p || p.includes('\0')) return undefined;
  const posix = p.replaceAll('\\', '/');
  if (posix.startsWith('/') || /^[A-Za-z]:\//.test(posix)) return undefined;
  const norm = path.posix.normalize(posix).replace(/^\.\/+/, '');
  if (norm === '.' || norm === '..' || norm.startsWith('../')) return undefined;
  return norm.replace(/\/+$/, '');
}

/**
 * No index refresh writes, no credential prompts, and no on-demand blob fetches in partial clones
 * (`GIT_NO_LAZY_FETCH`, git >= 2.44; older versions are bounded by the read budget).
 */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' };

async function resolveSha(repo: GitRepo, sha: string): Promise<string> {
  if (/^[0-9a-f]{7,64}$/i.test(sha)) return sha;
  if (sha.startsWith('-')) throw new Error(`detectStack: invalid revision ${JSON.stringify(sha)}`);
  return repo.resolveCommit(sha);
}

/** Lists files at a commit (blobs only: symlinks and submodules are dropped), in the working tree index, or on disk. */
export async function listFiles(opts: ListOptions): Promise<Listing> {
  const notes: string[] = [];
  if (opts.repo && opts.sha) {
    const sha = await resolveSha(opts.repo, opts.sha);
    const res = await runManaged(
      'git',
      ['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '-l', '--full-tree', sha],
      {
        label: 'git ls-tree (stack)',
        cwd: opts.repo.root,
        env: { ...process.env, ...GIT_ENV },
        timeoutMs: LIST_TIMEOUT_MS,
        signal: opts.signal,
        maxBuffer: LIST_MAX_BUFFER,
      },
    );
    opts.signal?.throwIfAborted();
    if (res.exitCode !== 0) {
      throw new Error(`git ls-tree ${sha} failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
    }
    const wanted = opts.files
      ? new Set(opts.files.map(normalizeRel).filter((f) => f !== undefined))
      : undefined;
    const files: ListedFile[] = [];
    const entries = res.stdout.split('\0');
    // The last element is the empty string after the final NUL (or a truncated entry: dropped).
    entries.pop();
    if (res.stdout.length >= LIST_MAX_BUFFER)
      notes.push('git ls-tree output truncated; the listing is partial');
    for (const entry of entries) {
      const tab = entry.indexOf('\t');
      if (tab < 0) continue;
      const [mode, type, oid, size] = entry.slice(0, tab).split(/\s+/);
      // 120000 = symlink (never followed), 160000 = submodule.
      if (type !== 'blob' || mode === '120000' || !oid) continue;
      const file = entry.slice(tab + 1);
      if (wanted && !wanted.has(file)) continue;
      files.push({ path: file, oid, size: Number(size) });
    }
    return { files, source: 'git-tree', notes };
  }
  if (opts.files) {
    const files = [...new Set(opts.files.map(normalizeRel).filter((f) => f !== undefined))].map((p) => ({
      path: p,
    }));
    return { files, source: 'given', notes };
  }
  if (opts.repo) {
    const res = await runManaged(
      'git',
      ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        label: 'git ls-files (stack)',
        cwd: opts.root,
        env: { ...process.env, ...GIT_ENV },
        timeoutMs: LIST_TIMEOUT_MS,
        signal: opts.signal,
        maxBuffer: LIST_MAX_BUFFER,
      },
    );
    opts.signal?.throwIfAborted();
    if (res.exitCode === 0) {
      const entries = res.stdout.split('\0');
      entries.pop();
      const files = [...new Set(entries.map(normalizeRel).filter((f) => f !== undefined))].map((p) => ({
        path: p,
      }));
      return { files, source: 'git-index', notes };
    }
    notes.push('git ls-files failed; walked the directory instead');
  }
  return walk(opts.root, opts.limits, opts.signal, notes);
}

/** Breadth-first directory walk that never follows symlinks and skips vendored/generated directories. */
async function walk(
  root: string,
  limits: ScanLimits,
  signal: AbortSignal | undefined,
  notes: string[],
): Promise<Listing> {
  const deadline = Date.now() + WALK_BUDGET_MS;
  const files: ListedFile[] = [];
  const queue: string[] = [''];
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    signal?.throwIfAborted();
    if (files.length >= limits.maxListed || Date.now() > deadline) {
      truncated = true;
      break;
    }
    const rel = queue[i]!;
    let entries: Dirent[];
    try {
      entries = await readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) queue.push(child);
      } else if (e.isFile()) {
        files.push({ path: child });
      }
    }
  }
  if (truncated) notes.push(`directory walk stopped after ${files.length} files (limit reached)`);
  return { files, source: 'walk', notes };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface Candidate {
  file: ListedFile;
  kind: FileKind;
}

/**
 * Picks the files to open: allow-listed kinds, highest priority and shallowest first. Each kind is
 * guaranteed its share (`KIND_LIMITS[kind].max`); manifests beyond their share then use whatever is
 * left of the global budget, so large monorepos still get per-package dependency evidence.
 * `skipped` counts candidates dropped because the global file/byte caps were reached.
 */
export function pickCandidates(
  files: ListedFile[],
  limits: ScanLimits,
): { picked: Candidate[]; skipped: number } {
  const all: Array<Candidate & { depth: number }> = [];
  for (const f of files) {
    const kind = classify(f.path);
    if (!kind) continue;
    const d = depth(f.path);
    if (d > limits.maxDepth) continue;
    if (f.size !== undefined && f.size > limits.maxFileBytes) continue;
    all.push({ file: f, kind, depth: d });
  }
  all.sort(
    (a, b) =>
      KIND_LIMITS[a.kind].priority - KIND_LIMITS[b.kind].priority ||
      a.depth - b.depth ||
      (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0),
  );
  const perKind = new Map<FileKind, number>();
  const picked: Candidate[] = [];
  const overflow: Candidate[] = [];
  let bytes = 0;
  let skipped = 0;
  // Sizes are known in git mode (whole blobs are transferred); on disk each read is capped anyway.
  const take = (c: Candidate): void => {
    const size = c.file.size ?? 0;
    if (picked.length >= limits.maxFiles || bytes + size > limits.maxTotalBytes) {
      skipped++;
      return;
    }
    bytes += size;
    picked.push({ file: c.file, kind: c.kind });
  };
  for (const c of all) {
    const n = perKind.get(c.kind) ?? 0;
    if (n >= KIND_LIMITS[c.kind].max) {
      if (KIND_LIMITS[c.kind].priority <= MANIFEST_PRIORITY) overflow.push(c);
      continue;
    }
    perKind.set(c.kind, n + 1);
    take(c);
  }
  for (const c of overflow) take(c);
  return { picked, skipped };
}

function depth(file: string): number {
  let n = 0;
  for (let i = file.indexOf('/'); i >= 0; i = file.indexOf('/', i + 1)) n++;
  return n;
}

export interface ReadResult {
  contents: Map<string, string>;
  notes: string[];
}

/** Decodes file bytes as UTF-8 text; undefined for binary content. */
function decode(buf: Buffer, kind: FileKind): string | undefined {
  const limit = HEAD_BYTES[kind];
  const head = limit === undefined ? buf : buf.subarray(0, limit);
  if (head.subarray(0, 8192).includes(0)) return undefined;
  let text = head.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** Reads candidates from the git object database (one `git cat-file --batch` process) or from disk. */
export async function readCandidates(
  candidates: Candidate[],
  opts: { root: string; repo?: GitRepo; fromGit: boolean; signal?: AbortSignal; limits: ScanLimits },
): Promise<ReadResult> {
  if (candidates.length === 0) return { contents: new Map(), notes: [] };
  return opts.fromGit && opts.repo
    ? readFromGit(candidates, opts.repo, opts.limits, opts.signal)
    : readFromDisk(candidates, opts.root, opts.limits, opts.signal);
}

async function readFromGit(
  candidates: Candidate[],
  repo: GitRepo,
  limits: ScanLimits,
  signal: AbortSignal | undefined,
): Promise<ReadResult> {
  const notes: string[] = [];
  const contents = new Map<string, string>();
  const byOid = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const oid = c.file.oid!;
    const list = byOid.get(oid);
    if (list) list.push(c);
    else byOid.set(oid, [c]);
  }
  const oids = [...byOid.keys()];
  const mp = spawnManaged('git', ['cat-file', '--batch'], {
    label: 'git cat-file (stack)',
    cwd: repo.root,
    env: { ...process.env, ...GIT_ENV },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const chunks: Buffer[] = [];
  let received = 0;
  const cap = limits.maxTotalBytes + oids.length * 128;
  let timedOut = false;
  const closed = new Promise<void>((resolve) => mp.child.once('close', () => resolve()));
  mp.child.stdout?.on('data', (d: Buffer) => {
    if (received >= cap) return;
    chunks.push(d);
    received += d.length;
    if (received >= cap) void terminate(mp, 200);
  });
  mp.child.once('error', () => undefined);
  mp.child.stdin?.on('error', () => undefined);
  mp.child.stdin?.end(`${oids.join('\n')}\n`);
  const timer = setTimeout(() => {
    timedOut = true;
    void terminate(mp, 200);
  }, limits.budgetMs);
  const onAbort = () => void terminate(mp, 200);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  await mp.exited;
  await Promise.race([closed, new Promise<void>((r) => setTimeout(r, 1_000).unref())]);
  clearTimeout(timer);
  signal?.removeEventListener('abort', onAbort);
  signal?.throwIfAborted();

  const out = Buffer.concat(chunks);
  let pos = 0;
  let parsed = 0;
  for (const oid of oids) {
    const nl = out.indexOf(10, pos);
    if (nl < 0) break;
    const header = out.toString('latin1', pos, nl).split(' ');
    pos = nl + 1;
    if (header[1] === 'missing' || header.length < 3) continue;
    const size = Number(header[2]);
    if (!Number.isFinite(size) || pos + size > out.length) break;
    const buf = out.subarray(pos, pos + size);
    pos += size + 1;
    parsed++;
    // Responses come back in request order; guard anyway.
    const group = byOid.get(header[0] === oid ? oid : (header[0] ?? '')) ?? [];
    for (const c of group) {
      if (size > limits.maxFileBytes) continue;
      const text = decode(buf, c.kind);
      if (text !== undefined) contents.set(c.file.path, text);
    }
  }
  if (parsed < oids.length) {
    notes.push(
      timedOut
        ? `stack read budget (${limits.budgetMs} ms) exhausted after ${parsed} of ${oids.length} files`
        : `read ${parsed} of ${oids.length} files from git`,
    );
  }
  return { contents, notes };
}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

async function readOne(root: string, c: Candidate, limits: ScanLimits): Promise<string | undefined> {
  let abs: string;
  try {
    abs = resolveInside(root, c.file.path);
  } catch {
    return undefined;
  }
  const st = await lstat(abs).catch(() => undefined);
  if (!st?.isFile() || st.size > limits.maxFileBytes) return undefined;
  const want = Math.min(st.size, HEAD_BYTES[c.kind] ?? st.size);
  const fh = await open(abs, constants.O_RDONLY | NOFOLLOW).catch(() => undefined);
  if (!fh) return undefined;
  try {
    const buf = Buffer.alloc(want);
    let off = 0;
    while (off < want) {
      const { bytesRead } = await fh.read(buf, off, want - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return decode(buf.subarray(0, off), c.kind);
  } finally {
    await fh.close();
  }
}

async function readFromDisk(
  candidates: Candidate[],
  root: string,
  limits: ScanLimits,
  signal: AbortSignal | undefined,
): Promise<ReadResult> {
  const notes: string[] = [];
  const contents = new Map<string, string>();
  const deadline = Date.now() + limits.budgetMs;
  const BATCH = 16;
  let done = 0;
  let bytes = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    signal?.throwIfAborted();
    if (Date.now() > deadline) {
      notes.push(
        `stack read budget (${limits.budgetMs} ms) exhausted after ${done} of ${candidates.length} files`,
      );
      break;
    }
    if (bytes > limits.maxTotalBytes) {
      notes.push(`stack read size cap reached after ${done} of ${candidates.length} files`);
      break;
    }
    const batch = candidates.slice(i, i + BATCH);
    const texts = await Promise.all(batch.map((c) => readOne(root, c, limits).catch(() => undefined)));
    batch.forEach((c, j) => {
      const t = texts[j];
      if (t === undefined) return;
      contents.set(c.file.path, t);
      bytes += t.length;
    });
    done += batch.length;
  }
  return { contents, notes };
}
