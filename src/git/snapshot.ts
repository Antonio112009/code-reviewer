import { spawnSync } from 'node:child_process';
import { realpathSync, rmSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { distrustDirectory, findTrustedExecutable } from '../util/executables';
import { isPidAlive } from '../util/processes';
import type { GitRepo } from './repo';

/** Directory the agents and tools review. */
export interface ReviewRoot {
  /** Directory containing the reviewed code; agents and tools read files only from here. */
  root: string;
  /** True when `root` is a temporary directory (false = the user's own working tree). */
  isolated: boolean;
  /**
   * Repo-relative (posix) agent instruction / config paths removed from (or kept out of) the isolated
   * root (sorted), so reviewed code cannot instruct or configure the reviewing agent. Always empty when
   * not isolated.
   */
  sanitized: string[];
  dispose(): Promise<void>;
}

export interface Snapshot extends ReviewRoot {
  sha: string;
}

/** A file written into an isolated review root (repo-relative posix path). */
export interface RootFile {
  path: string;
  content: string;
}

export interface SnapshotOptions {
  /** Always use a temporary worktree, even when the user's checkout is clean and at `sha`. */
  forceIsolated?: boolean;
  /** Delete agent instruction / config files from an isolated worktree (default true). */
  sanitize?: boolean;
  /**
   * Files written over the checkout (files mode reviews the working tree). Implies an isolated worktree;
   * agent instruction / config paths are not written unless `sanitize` is false.
   */
  overlay?: readonly RootFile[];
  /**
   * Registers a synchronous cleanup that must run on a forced exit (see `Lifecycle.onForcedExit`) and
   * returns its unregister function; `dispose()` unregisters it.
   */
  onForcedExit?: (cleanup: () => void) => () => void;
}

/** Temp dir layout: `<tmpdir>/code-reviewer-XXXXXX/{tree,no-hooks,owner.json}`. */
const TEMP_PREFIX = 'code-reviewer-';
const TREE_DIR = 'tree';
const NO_HOOKS_DIR = 'no-hooks';
const OWNER_FILE = 'owner.json';
/** A snapshot older than this is stale even if its recorded pid is alive again (pid reuse). */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Directory names whose whole subtree is agent configuration (skills, rules, settings, hooks, MCP servers). */
const AGENT_DIRS = new Set(['.claude', '.agents', '.gemini', '.codex', '.cursor', '.windsurf', '.continue']);
/** `.github/<name>` directories read by Copilot: instructions, prompt files, skills, custom agents, hooks. */
const GITHUB_AGENT_DIRS = new Set(['instructions', 'prompts', 'skills', 'agents', 'hooks']);
/** Instruction / MCP files agents load automatically, matched at any depth. */
const AGENT_FILES = new Set([
  'claude.md',
  'claude.local.md',
  'agents.md',
  'agents.override.md',
  'gemini.md',
  '.mcp.json',
  '.cursorrules',
  '.windsurfrules',
]);

/**
 * Materialises `sha` as a read-only review root.
 *
 * If the user's working tree is clean, complete (not sparse) and already at `sha` it is used directly
 * (and never modified); otherwise a temporary detached `git worktree` is created so agents never see
 * (or touch) uncommitted changes in the user's checkout. The worktree is checked out with git hooks
 * disabled (a post-checkout hook would run inside the reviewed revision), without LFS downloads and
 * without the user's sparse-checkout cone, and, unless `sanitize: false`, stripped of agent
 * instruction / config files.
 */
export async function createSnapshot(
  repo: GitRepo,
  sha: string,
  opts: SnapshotOptions = {},
): Promise<Snapshot> {
  // `sha` ends up as a git argument: never let it be parsed as an option.
  if (sha.startsWith('-')) throw new Error(`Invalid revision for a snapshot: ${sha}`);
  if (
    !opts.forceIsolated &&
    !opts.overlay?.length &&
    (await repo.headSha()) === sha &&
    (await repo.isClean()) &&
    !(await isSparse(repo))
  ) {
    return { root: repo.root, sha, isolated: false, sanitized: [], dispose: async () => {} };
  }

  const parent = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  const root = path.join(parent, TREE_DIR);
  distrustDirectory(root); // reviewed code: never resolve programs from it
  // Registered before the worktree exists: a forced exit mid-creation must not leave it behind.
  const unregister = opts.onForcedExit?.(() => removeSnapshotSync(repo.root, root, parent)) ?? (() => {});
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposing ??= (async () => {
      try {
        const removed = await repo.tryRun(['worktree', 'remove', '--force', root]);
        await rm(parent, { recursive: true, force: true, maxRetries: 3 });
        // Only a failed removal (half-created worktree, locked files) leaves administrative data behind.
        if (!removed.ok) await repo.run(['worktree', 'prune'], { allowFailure: true });
      } finally {
        unregister();
      }
    })();
    return disposing;
  };

  try {
    await writeFile(
      path.join(parent, OWNER_FILE),
      JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
    );
    const noHooks = path.join(parent, NO_HOOKS_DIR);
    await mkdir(noHooks);
    await repo.run([
      '-c',
      `core.hooksPath=${noHooks}`,
      // The committed content as is: LFS objects are not downloaded (network under --offline; a failing
      // required filter would abort the review), and changed files outside a sparse cone stay present.
      '-c',
      'filter.lfs.required=false',
      '-c',
      'filter.lfs.smudge=',
      '-c',
      'filter.lfs.process=',
      '-c',
      'core.sparseCheckout=false',
      'worktree',
      'add',
      '--detach',
      '--quiet',
      root,
      sha,
    ]);
    const sanitize = opts.sanitize !== false;
    const removed = sanitize ? await sanitizeWorktree(repo, root) : [];
    const keptOut = await writeRootFiles(root, opts.overlay ?? [], sanitize);
    return { root, sha, isolated: true, sanitized: [...new Set([...removed, ...keptOut])].sort(), dispose };
  } catch (err) {
    await dispose().catch(() => undefined);
    throw err;
  }
}

/**
 * Materialises `files` as an isolated review root without git: for reviews of plain folders and of
 * repositories without a commit, so agents never run in the reviewed directory itself (where they would
 * load its agent settings, hooks and MCP servers). Agent instruction / config files are kept out.
 */
export async function createFilesSnapshot(
  files: readonly RootFile[],
  opts: Pick<SnapshotOptions, 'onForcedExit'> = {},
): Promise<ReviewRoot> {
  const parent = await mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  const root = path.join(parent, TREE_DIR);
  distrustDirectory(root); // reviewed code: never resolve programs from it
  const unregister =
    opts.onForcedExit?.(() => {
      try {
        rmSync(parent, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }) ?? (() => {});
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposing ??= rm(parent, { recursive: true, force: true, maxRetries: 3 }).finally(unregister);
    return disposing;
  };
  try {
    await mkdir(root);
    const sanitized = [...new Set(await writeRootFiles(root, files, true))].sort();
    return { root, isolated: true, sanitized, dispose };
  } catch (err) {
    await dispose().catch(() => undefined);
    throw err;
  }
}

/** True when the user's checkout is sparse (files outside the cone are missing from it). */
async function isSparse(repo: GitRepo): Promise<boolean> {
  const { ok, stdout } = await repo.tryRun(['config', '--bool', '--get', 'core.sparseCheckout']);
  return ok && stdout.trim() === 'true';
}

/**
 * Writes `files` below `root`; with `keepOutAgentConfig`, agent instruction / config paths are skipped
 * and their top-most targets returned. Git metadata (`.git` at any depth, any case) is never written.
 */
async function writeRootFiles(
  root: string,
  files: readonly RootFile[],
  keepOutAgentConfig: boolean,
): Promise<string[]> {
  const keptOut: string[] = [];
  for (const file of files) {
    if (file.path.split('/').some((s) => s.toLowerCase() === '.git')) continue;
    const target = keepOutAgentConfig ? targetFor(file.path) : undefined;
    if (target !== undefined) keptOut.push(target);
    else await writeInside(root, file.path, file.content);
  }
  return keptOut;
}

/**
 * Writes `rel` below `root` without following symlinks: whatever is in the way — a file or symlink
 * where a directory is needed, a directory or symlink where the file goes — is replaced, as it is in
 * the reviewed working tree.
 */
async function writeInside(root: string, rel: string, content: string): Promise<void> {
  const segs = rel.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`Invalid path for the review root: ${rel}`);
  }
  let dir = root;
  for (const seg of segs.slice(0, -1)) {
    dir = path.join(dir, seg);
    const stat = await lstatOrUndefined(dir);
    if (stat?.isDirectory()) continue;
    if (stat) await unlink(dir);
    await mkdir(dir);
  }
  const abs = path.join(root, ...segs);
  const stat = await lstatOrUndefined(abs);
  if (stat?.isDirectory()) await rm(abs, { recursive: true, force: true });
  else if (stat) await unlink(abs);
  // `wx`: the entry was just removed, so the write can never land behind a symlink.
  await writeFile(abs, content, { flag: 'wx' });
}

/**
 * Synchronous removal for forced exits (inside signal / `exit` handlers): `git worktree remove` plus a
 * recursive delete of the temp dir. Never throws.
 */
function removeSnapshotSync(repoRoot: string, root: string, parent: string): void {
  try {
    const git = findTrustedExecutable('git');
    if (!git) throw new Error('git not found');
    spawnSync(git, ['worktree', 'remove', '--force', root], {
      cwd: repoRoot,
      stdio: 'ignore',
      timeout: 5_000,
      windowsHide: true,
    });
  } catch {
    // git missing / timed out: the temp dir is still removed; `pruneStaleSnapshots` drops the metadata
  }
  try {
    rmSync(parent, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/**
 * Paths to delete so that agents started in a checkout of `files` load no repository-provided
 * instructions, skills, settings, hooks or MCP servers. `files` are repo-relative posix paths as listed
 * by `git ls-files` (so a symlink appears as a file); names match case-insensitively (case-insensitive
 * file systems resolve `claude.md` for `CLAUDE.md`). Returns the top-most matching path per file, sorted
 * and de-duplicated.
 */
export function agentConfigTargets(files: readonly string[]): string[] {
  const targets = new Set<string>();
  for (const file of files) {
    const target = targetFor(file);
    if (target !== undefined) targets.add(target);
  }
  return [...targets].sort();
}

/**
 * True when `file` (repo-relative, posix) is agent instruction / config that the sanitizer removes —
 * itself or below a removed directory (`.claude/settings.json`, `pkg/AGENTS.md`, `.github/prompts/x.md`).
 */
export function isAgentConfigPath(file: string): boolean {
  return targetFor(file) !== undefined;
}

function targetFor(file: string): string | undefined {
  const segs = file.split('/');
  const upTo = (i: number) => segs.slice(0, i + 1).join('/');
  for (let i = 0; i < segs.length; i++) {
    const name = segs[i]!.toLowerCase();
    const last = i === segs.length - 1;
    if (AGENT_DIRS.has(name)) return upTo(i);
    if (name === '.github' || name === '.vscode') {
      // A listed entry with this name is a file or a symlink, never a real directory: a symlinked
      // `.github` would expose instruction files stored under an innocuous name.
      if (last) return file;
      const next = segs[i + 1]!.toLowerCase();
      const nextIsLast = i + 1 === segs.length - 1;
      if (name === '.github' && GITHUB_AGENT_DIRS.has(next)) return upTo(i + 1);
      if (name === '.github' && nextIsLast && next === 'copilot-instructions.md') return file;
      if (name === '.vscode' && nextIsLast && next === 'mcp.json') return file;
    }
    if (last && AGENT_FILES.has(name)) return file;
  }
  return undefined;
}

/** Deletes agent instruction / config paths from a fresh worktree; returns the removed paths. */
async function sanitizeWorktree(repo: GitRepo, root: string): Promise<string[]> {
  const listing = await repo.run(['ls-files', '--cached', '-z'], { cwd: root });
  const removed: string[] = [];
  for (const rel of agentConfigTargets(listing.split('\0').filter(Boolean))) {
    if (await removeInside(root, rel)) removed.push(rel);
  }
  return removed;
}

/**
 * Removes `rel` (file, symlink or directory) below `root` without following symlinks: every ancestor must
 * be a real directory, and the target itself is unlinked when it is a link. Returns false when there was
 * nothing to remove.
 */
async function removeInside(root: string, rel: string): Promise<boolean> {
  const segs = rel.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false;
  let dir = root;
  for (const seg of segs.slice(0, -1)) {
    dir = path.join(dir, seg);
    if (!(await lstatOrUndefined(dir))?.isDirectory()) return false;
  }
  const abs = path.join(root, ...segs);
  const stat = await lstatOrUndefined(abs);
  if (!stat) return false;
  // `rm` does not descend into symlinked directories inside the tree either; it unlinks them.
  if (stat.isDirectory()) await rm(abs, { recursive: true, force: true });
  else await unlink(abs);
  return true;
}

async function lstatOrUndefined(p: string) {
  try {
    return await lstat(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR')
      return undefined;
    throw err;
  }
}

/**
 * Removes snapshot worktrees of `repo` left behind by crashed or killed runs: linked worktrees at
 * `<tmpdir>/code-reviewer-XXXXXX/tree` whose owning process is gone (or that are older than a day), then
 * runs `git worktree prune`. Snapshots of live runs — including concurrent ones — are kept. Returns the
 * removed worktree paths (sorted). Never throws for git failures.
 */
export async function pruneStaleSnapshots(repo: GitRepo): Promise<string[]> {
  const listing = await repo.tryRun(['worktree', 'list', '--porcelain']);
  if (!listing.ok) return [];
  const tempRoots = new Set([canonical(tmpdir())]);
  const removed: string[] = [];
  const own = canonical(repo.root);
  for (const entry of parseWorktreeList(listing.stdout).slice(1)) {
    if (entry.locked || canonical(entry.path) === own) continue;
    const worktree = path.resolve(entry.path);
    const parent = path.dirname(worktree);
    if (path.basename(worktree) !== TREE_DIR || !path.basename(parent).startsWith(TEMP_PREFIX)) continue;
    if (!tempRoots.has(canonical(path.dirname(parent)))) continue;
    if (!(await isStale(parent))) continue;
    await repo.tryRun(['worktree', 'remove', '--force', worktree]);
    const stat = await lstatOrUndefined(parent);
    if (stat?.isDirectory()) await rm(parent, { recursive: true, force: true, maxRetries: 3 });
    removed.push(worktree);
  }
  await repo.tryRun(['worktree', 'prune']);
  return removed.sort();
}

interface WorktreeEntry {
  path: string;
  locked: boolean;
}

/** Parses `git worktree list --porcelain` (first entry = main worktree). */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) entries.push({ path: line.slice('worktree '.length), locked: false });
    else if ((line === 'locked' || line.startsWith('locked ')) && entries.length > 0)
      entries[entries.length - 1]!.locked = true;
  }
  return entries;
}

/** Owner recorded in `owner.json` is gone, the record is missing/invalid, or the snapshot is too old. */
async function isStale(parent: string): Promise<boolean> {
  let owner: { pid?: unknown; createdAt?: unknown };
  try {
    owner = JSON.parse(await readFile(path.join(parent, OWNER_FILE), 'utf8'));
  } catch {
    // written before `git worktree add`, so a listed worktree without it predates this version or is gone
    return true;
  }
  const { pid, createdAt } = owner;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return true;
  if (pid === process.pid) return false;
  if (typeof createdAt === 'number' && Date.now() - createdAt > STALE_AFTER_MS) return true;
  return !isPidAlive(pid);
}

/** Real path when it exists (macOS: /var → /private/var), normalised case on case-insensitive platforms. */
function canonical(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // missing: compare the lexical path
  }
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved;
}
