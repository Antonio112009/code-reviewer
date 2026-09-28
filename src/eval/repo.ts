import { existsSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitRepo } from '../git/repo';
import { distrustDirectory, findTrustedExecutable } from '../util/executables';
import { shortHash } from '../util/ids';
import { globalConfigDir, resolveInside } from '../util/paths';
import { runManaged } from '../util/processes';
import { expectationProblems } from './cases';
import type { CaseSource, EvalCase } from './types';

/** Branches of a materialised inline case (neutral names: they appear in the review prompt). */
export const BASE_BRANCH = 'main';
export const HEAD_BRANCH = 'feature/change';
/** Fixed identity and dates: an inline case always produces the same commits. */
const IDENTITY = { name: 'Eval Author', email: 'eval@example.com', date: '2026-01-01T12:00:00Z' };
const CLONE_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 5 * 60_000;
const LOCAL_TIMEOUT_MS = 60_000;

/** A repository with a case's change between two refs, ready for `runReview`. */
export interface CaseRepo {
  root: string;
  base: string;
  head: string;
  /** Temporary directory holding the repository (inline cases), removed by `dispose`. */
  tempDir?: string;
  dispose(): Promise<void>;
}

export interface MaterializeOptions {
  signal?: AbortSignal;
  /** Keep temporary repositories (debugging). */
  keep?: boolean;
  /** Registers synchronous cleanup for a forced exit (see Lifecycle.onForcedExit). */
  onForcedExit?: (cleanup: () => void) => () => void;
  /** Where real repositories are cloned (default `~/.code-reviewer/eval-cache`). */
  cacheDir?: string;
}

export class CaseRepoError extends Error {}

function gitPath(): string {
  const git = findTrustedExecutable('git');
  if (!git) throw new CaseRepoError('git was not found on PATH (outside the reviewed repository)');
  return git;
}

/**
 * Runs git through the process registry (Ctrl+C kills it). Never prompts; `isolated` also ignores the
 * user's and the system git config (hooks, signing, autocrlf, templates) while building a case repository.
 */
async function git(
  args: string[],
  opts: { cwd: string; signal?: AbortSignal; timeoutMs?: number; isolated?: string },
): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    ...(opts.isolated
      ? {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: opts.isolated,
          GIT_AUTHOR_NAME: IDENTITY.name,
          GIT_AUTHOR_EMAIL: IDENTITY.email,
          GIT_AUTHOR_DATE: IDENTITY.date,
          GIT_COMMITTER_NAME: IDENTITY.name,
          GIT_COMMITTER_EMAIL: IDENTITY.email,
          GIT_COMMITTER_DATE: IDENTITY.date,
        }
      : {}),
  };
  const res = await runManaged(gitPath(), args, {
    label: `git ${args[0]}`,
    cwd: opts.cwd,
    env,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? LOCAL_TIMEOUT_MS,
  });
  if (res.aborted) throw new CaseRepoError('Interrupted');
  if (res.timedOut) throw new CaseRepoError(`git ${args[0]} timed out`);
  if (res.exitCode !== 0) {
    const reason = res.stderr.trim().split('\n').pop() || `exit ${res.exitCode ?? res.signal}`;
    throw new CaseRepoError(`git ${args[0]} failed: ${reason}`);
  }
  return res.stdout;
}

async function writeTree(root: string, files: Record<string, string | null>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolveInside(root, rel);
    if (content === null) {
      await rm(abs, { force: true });
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

/**
 * Builds a throw-away repository for an inline case: the base files committed on `main`, the change
 * committed on `feature/change`. Hooks never run (no user config, empty hooks path); nothing is executed.
 */
export async function materializeInline(
  source: Extract<CaseSource, { kind: 'inline' }>,
  opts: MaterializeOptions = {},
): Promise<CaseRepo> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'cr-eval-'));
  distrustDirectory(tempDir); // case code: never resolve programs from it
  const unregister = opts.keep
    ? () => {}
    : (opts.onForcedExit?.(() => rmSync(tempDir, { recursive: true, force: true })) ?? (() => {}));
  const dispose = async () => {
    unregister();
    if (!opts.keep) await rm(tempDir, { recursive: true, force: true, maxRetries: 3 });
  };
  try {
    const root = path.join(tempDir, 'repo');
    const hooks = path.join(tempDir, 'no-hooks');
    const config = path.join(tempDir, 'gitconfig');
    await mkdir(root);
    await mkdir(hooks);
    await writeFile(config, '');
    const run = (args: string[]) =>
      git(['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgSign=false', ...args], {
        cwd: root,
        signal: opts.signal,
        isolated: config,
      });
    await run(['init', '--quiet', `--initial-branch=${BASE_BRANCH}`]);
    await writeTree(root, source.base);
    await run(['add', '--all']);
    await run(['commit', '--quiet', '--allow-empty', '--message', 'Initial version']);
    await run(['checkout', '--quiet', '-b', HEAD_BRANCH]);
    await writeTree(root, source.head);
    await run(['add', '--all']);
    await run(['commit', '--quiet', '--message', 'Update']);
    return { root, base: BASE_BRANCH, head: HEAD_BRANCH, tempDir, dispose };
  } catch (err) {
    await dispose().catch(() => undefined);
    throw err;
  }
}

/** Serialises clones and fetches per cache directory within this process. */
const cacheLocks = new Map<string, Promise<unknown>>();

async function withCacheLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = cacheLocks.get(dir) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  cacheLocks.set(dir, next);
  try {
    return await next;
  } finally {
    if (cacheLocks.get(dir) === next) cacheLocks.delete(dir);
  }
}

export function evalCacheDir(): string {
  return path.join(globalConfigDir(), 'eval-cache');
}

/**
 * Prepares a real-repository case: a clone without a checked-out working tree in the eval cache (a
 * blob-filtered clone for URLs), with both commits present. The review reads everything from commits, so
 * the repository's own `.code-reviewer/` (config, skills) is never on disk to be picked up, and nothing
 * from it is executed (no checkout, no hooks, no filters).
 */
export async function materializeRepoCase(
  source: Extract<CaseSource, { kind: 'repo' }>,
  opts: MaterializeOptions = {},
): Promise<CaseRepo> {
  const isUrl = source.repo.startsWith('https://');
  if (!isUrl && !existsSync(source.repo)) throw new CaseRepoError(`${source.repo}: no such repository`);
  const cacheRoot = opts.cacheDir ?? evalCacheDir();
  const dir = path.join(cacheRoot, shortHash(source.repo, 16));
  await withCacheLock(dir, async () => {
    if (!existsSync(path.join(dir, '.git'))) {
      await mkdir(cacheRoot, { recursive: true });
      // Cloned next to its final place and renamed: an interrupted clone never looks like a cache entry.
      const tmp = await mkdtemp(`${dir}.tmp-`);
      distrustDirectory(tmp);
      const unregister =
        opts.onForcedExit?.(() => rmSync(tmp, { recursive: true, force: true })) ?? (() => {});
      try {
        await git(
          [
            'clone',
            '--quiet',
            '--no-checkout',
            '--no-tags',
            ...(isUrl ? ['--filter=blob:none'] : []),
            '--',
            source.repo,
            tmp,
          ],
          { cwd: cacheRoot, signal: opts.signal, timeoutMs: CLONE_TIMEOUT_MS },
        );
        await rename(tmp, dir).catch((err: unknown) => {
          // Another eval process cloned the same repository meanwhile: use its clone.
          if (!existsSync(path.join(dir, '.git'))) throw err;
        });
      } finally {
        unregister();
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    const repo = new GitRepo(dir);
    const missing = async () => {
      const out: string[] = [];
      for (const sha of [source.baseRef, source.headRef]) if (!(await repo.hasCommit(sha))) out.push(sha);
      return out;
    };
    let wanted = await missing();
    if (wanted.length) {
      // Kept under a ref of their own so that `git gc` never drops them.
      const bySha = await repo.fetchRefs(
        'origin',
        wanted.map((sha) => `${sha}:refs/code-reviewer-eval/${sha}`),
        { timeoutMs: FETCH_TIMEOUT_MS, signal: opts.signal },
      );
      if (bySha.aborted) throw new CaseRepoError('Interrupted');
      wanted = await missing();
    }
    if (wanted.length) {
      const all = await repo.fetchRefs('origin', ['+refs/heads/*:refs/remotes/origin/*'], {
        timeoutMs: FETCH_TIMEOUT_MS,
        signal: opts.signal,
      });
      if (all.aborted) throw new CaseRepoError('Interrupted');
      wanted = await missing();
    }
    if (wanted.length) {
      throw new CaseRepoError(`${source.repo}: commit(s) not found: ${wanted.join(', ')}`);
    }
  });
  return { root: dir, base: source.baseRef, head: source.headRef, dispose: async () => {} };
}

/** Materialises a case; real-repository cases are also checked against their head commit. */
export async function materializeCase(c: EvalCase, opts: MaterializeOptions = {}): Promise<CaseRepo> {
  if (c.source.kind === 'inline') return materializeInline(c.source, opts);
  const repo = await materializeRepoCase(c.source, opts);
  const git = new GitRepo(repo.root);
  const contents = new Map<string, string | undefined>();
  for (const d of c.expect) {
    if (!contents.has(d.file)) contents.set(d.file, await git.show(c.source.headRef, d.file));
  }
  const problems = expectationProblems(c.expect, (f) => contents.get(f));
  if (problems.length) throw new CaseRepoError(problems.join('; '));
  return repo;
}
