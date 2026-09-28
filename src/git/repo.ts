import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { distrustDirectory, findTrustedExecutable } from '../util/executables';
import { processes, type RunResult, runManaged } from '../util/processes';

export class GitError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
  ) {
    super(message);
  }
}

/**
 * Conservative branch-name check (a subset of `git check-ref-format --branch`) for names that come from
 * CI variables, forge CLIs, git config or settings before they are used in refspecs and rev arguments.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 255 || name === 'HEAD' || name === '@') return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false;
  return name.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

/** Upstream (tracking) branch of a local branch. */
export interface UpstreamInfo {
  /** Full tracking ref, e.g. `refs/remotes/origin/feature/x`. */
  trackingRef: string;
  /** Remote name, e.g. `origin`. */
  remote: string;
  /** Branch name on the remote (without `refs/heads/`). */
  branch: string;
}

/** Result of `git ls-remote` restricted to a few branches. */
export interface LsRemoteResult {
  /** Branch name (without `refs/heads/`) → tip sha, for the requested branches that exist on the remote. */
  heads: Map<string, string>;
  /** Default branch the remote's HEAD points to, when requested and advertised. */
  defaultBranch?: string;
}

export interface NetworkOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Outcome of a network git command; never thrown for ordinary failures (inspect `ok` / `error`). */
export interface NetworkResult {
  ok: boolean;
  /** One-line reason when `ok` is false (timeout, abort, last stderr line). */
  error?: string;
  aborted: boolean;
}

/** Working-tree changes that a commit-range review does not see. */
export interface WorkingTreeStatus {
  /** Tracked files with staged or unstaged modifications. */
  changed: number;
  untracked: number;
}

const SSH_BATCH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=10';

function networkFailure(res: RunResult, timeoutMs: number): string {
  if (res.aborted) return 'aborted';
  if (res.timedOut) return `timed out after ${Math.round(timeoutMs / 1000)} s`;
  const lines = res.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const fatal = lines.filter((l) => /^(fatal|error):/i.test(l)).pop();
  return (fatal ?? lines.pop() ?? `exit ${res.exitCode ?? res.signal}`).replace(/^(fatal|error):\s*/i, '');
}

/** Flags that neutralise user git config that would change the output format we parse. */
const STABLE_FLAGS = [
  '-c',
  'core.quotePath=false',
  '-c',
  'color.ui=false',
  '-c',
  'diff.noprefix=false',
  // `diff.submodule=diff` would inline files from inside submodules as if they were in the tree.
  '-c',
  'diff.submodule=short',
];

/**
 * Git runs in its own process group (POSIX) so a terminal Ctrl+C reaches only the CLI, which then
 * shuts down in order instead of seeing git die mid-command (e.g. during `worktree add`). Every git
 * child is registered with the process registry, so an abort or a forced exit kills it.
 */
const SPAWN_OPTS = { detached: process.platform !== 'win32', windowsHide: true } as const;

/**
 * The git executable, from trusted PATH entries only: a `git` / `git.cmd` inside the reviewed checkout,
 * a snapshot or the current directory is never run (on Windows a bare name would be looked up in the
 * working directory first).
 */
function gitCommand(): string {
  const git = findTrustedExecutable('git');
  if (!git) throw new GitError('git was not found on PATH (outside the reviewed repository)', [], '');
  return git;
}

/**
 * The index a git hook was given (`GIT_INDEX_FILE`, absolute): a pre-commit hook gets the index being
 * committed, which is a temporary one for `git commit -a` or `git commit <paths>`. Undefined outside hooks.
 */
export function hookIndexFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = env.GIT_INDEX_FILE?.trim();
  return file ? path.resolve(file) : undefined;
}

/**
 * The environment of git children, without `GIT_INDEX_FILE`: git exports it to hooks, and a review started
 * from a pre-commit hook must not let `worktree add` or `status` use the index being committed. Commands
 * that should read it (`--staged`) pass it explicitly.
 */
export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { GIT_INDEX_FILE: _index, ...inherited } = process.env;
  return { ...inherited, ...extra };
}

/** Runs git through execa with the child registered for shutdown. */
interface GitRunOptions {
  cwd: string;
  reject: false;
  stripFinalNewline?: boolean;
  maxBuffer?: number;
  env?: Record<string, string>;
}

function git(args: string[], opts: GitRunOptions) {
  const sub = execa(gitCommand(), args, {
    ...opts,
    env: gitEnv(opts.env),
    extendEnv: false,
    ...SPAWN_OPTS,
  });
  if (sub.pid !== undefined) {
    processes.add({
      label: 'git',
      child: sub as unknown as ChildProcess,
      pid: sub.pid,
      group: SPAWN_OPTS.detached,
      exited: sub.then(
        () => undefined,
        () => undefined,
      ),
    });
  }
  return sub;
}

/** Nearest directory at or above `dir` holding a `.git` entry (the work tree git would use), if any. */
function nearestWorkTree(dir: string): string | undefined {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return undefined;
  }
}

export class GitRepo {
  private networkEnvCache?: Promise<NodeJS.ProcessEnv>;

  constructor(public readonly root: string) {
    // Everything in a repository under review is untrusted: never resolve programs from it.
    distrustDirectory(root);
  }

  /** Returns the repository containing `cwd`, or undefined when `cwd` is not inside a git work tree. */
  static async find(cwd: string): Promise<GitRepo | undefined> {
    // Before git itself runs: its own lookup must already exclude the (probable) work tree.
    distrustDirectory(cwd);
    distrustDirectory(nearestWorkTree(cwd));
    const res = await git(['rev-parse', '--show-toplevel'], { cwd, reject: false });
    if (res.exitCode !== 0) return undefined;
    return new GitRepo(String(res.stdout).trim());
  }

  async run(
    args: string[],
    opts: { cwd?: string; allowFailure?: boolean; env?: Record<string, string> } = {},
  ): Promise<string> {
    const full = [...STABLE_FLAGS, ...args];
    const res = await git(full, {
      cwd: opts.cwd ?? this.root,
      reject: false,
      stripFinalNewline: false,
      maxBuffer: 256 * 1024 * 1024,
      ...(opts.env ? { env: opts.env } : {}),
    });
    if (res.exitCode !== 0 && !opts.allowFailure) {
      throw new GitError(
        `git ${args.join(' ')} failed: ${String(res.stderr).trim() || `exit ${res.exitCode}`}`,
        args,
        String(res.stderr),
      );
    }
    return String(res.stdout);
  }

  async tryRun(args: string[], cwd?: string): Promise<{ ok: boolean; stdout: string }> {
    const res = await git([...STABLE_FLAGS, ...args], { cwd: cwd ?? this.root, reject: false });
    return { ok: res.exitCode === 0, stdout: String(res.stdout) };
  }

  async resolveCommit(ref: string): Promise<string> {
    const { ok, stdout } = await this.tryRun(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (!ok) throw new GitError(`Unknown git ref: ${ref}`, ['rev-parse', ref], '');
    return stdout.trim();
  }

  async refExists(ref: string): Promise<boolean> {
    return (await this.tryRun(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).ok;
  }

  async mergeBase(a: string, b: string): Promise<string> {
    return (await this.run(['merge-base', a, b])).trim();
  }

  async headSha(): Promise<string> {
    return this.resolveCommit('HEAD');
  }

  async currentBranch(): Promise<string | undefined> {
    const { ok, stdout } = await this.tryRun(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return ok ? stdout.trim() : undefined;
  }

  /** Best guess of the integration branch: origin/HEAD, then main/master/develop (local or origin). */
  async defaultBaseBranch(): Promise<string | undefined> {
    const originHead = await this.tryRun(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    if (originHead.ok && originHead.stdout.trim()) return originHead.stdout.trim();
    for (const candidate of ['main', 'master', 'develop', 'origin/main', 'origin/master']) {
      if (await this.refExists(candidate)) return candidate;
    }
    return undefined;
  }

  async diff(from: string, to: string, contextLines = 3): Promise<string> {
    return this.run([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '-M',
      `-U${contextLines}`,
      '--src-prefix=a/',
      '--dst-prefix=b/',
      from,
      to,
    ]);
  }

  /** Content of `file` at `sha`, or undefined if it does not exist there. */
  async show(sha: string, file: string): Promise<string | undefined> {
    const { ok, stdout } = await this.tryRun(['show', `${sha}:${file}`]);
    return ok ? stdout : undefined;
  }

  /** Tracked + untracked-but-not-ignored files under the given paths (repo-relative, posix). */
  async listFiles(paths: string[], cwd?: string): Promise<string[]> {
    const out = await this.run(
      ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z', '--', ...paths],
      { cwd },
    );
    return [...new Set(out.split('\0').filter(Boolean))];
  }

  async isClean(): Promise<boolean> {
    const out = await this.run(['status', '--porcelain', '--untracked-files=no']);
    return out.trim() === '';
  }

  /** `git status --porcelain`, optionally ignoring some repo-relative paths (e.g. our runs dir). */
  async statusPorcelain(exclude: string[] = []): Promise<string> {
    return this.run(['status', '--porcelain', '--', '.', ...exclude.map((e) => `:(exclude)${e}`)]);
  }

  async remoteUrl(name = 'origin'): Promise<string | undefined> {
    const { ok, stdout } = await this.tryRun(['remote', 'get-url', name]);
    if (ok) return stdout.trim();
    const remotes = (await this.tryRun(['remote'])).stdout.split('\n').filter(Boolean);
    if (remotes[0] && remotes[0] !== name) return this.remoteUrl(remotes[0]);
    return undefined;
  }
  /** Commit sha of `ref`, or undefined when it does not resolve to a commit. */
  async tryResolve(ref: string): Promise<string | undefined> {
    if (!ref || ref.startsWith('-')) return undefined;
    const { ok, stdout } = await this.tryRun(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return ok && stdout.trim() ? stdout.trim() : undefined;
  }

  /** True when the object exists in the local object store (no lazy fetch in partial clones). */
  async hasCommit(sha: string): Promise<boolean> {
    const res = await git([...STABLE_FLAGS, 'cat-file', '-e', `${sha}^{commit}`], {
      cwd: this.root,
      reject: false,
      env: { GIT_NO_LAZY_FETCH: '1' },
    });
    return res.exitCode === 0;
  }

  /** Configured remotes in git's order (names that could be mistaken for options are dropped). */
  async remotes(): Promise<string[]> {
    const { ok, stdout } = await this.tryRun(['remote']);
    return ok
      ? stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((r) => r && !r.startsWith('-'))
      : [];
  }

  /** Value of a git config key (last one wins), or undefined when unset. */
  async configGet(key: string): Promise<string | undefined> {
    const { ok, stdout } = await this.tryRun(['config', '--get', key]);
    const value = stdout.trim();
    return ok && value ? value : undefined;
  }

  /** Target of a symbolic ref (full name, e.g. `refs/remotes/origin/main`), or undefined. */
  async symbolicRef(ref: string): Promise<string | undefined> {
    const { ok, stdout } = await this.tryRun(['symbolic-ref', '--quiet', ref]);
    return ok && stdout.trim() ? stdout.trim() : undefined;
  }

  /** Remote name → branch its cached `refs/remotes/<remote>/HEAD` points to (set by clone / `remote set-head`). */
  async remoteHeads(): Promise<Map<string, string>> {
    const { ok, stdout } = await this.tryRun([
      'for-each-ref',
      '--format=%(refname)%00%(symref)',
      'refs/remotes/*/HEAD',
    ]);
    const heads = new Map<string, string>();
    if (!ok) return heads;
    for (const line of stdout.split('\n')) {
      const [ref = '', target = ''] = line.trim().split('\0');
      const remote = /^refs\/remotes\/(.+)\/HEAD$/.exec(ref)?.[1];
      const prefix = `refs/remotes/${remote}/`;
      if (remote && target.startsWith(prefix)) heads.set(remote, target.slice(prefix.length));
    }
    return heads;
  }

  /** Upstream of local `branch` when it tracks a remote branch (not a local one). */
  async upstream(branch: string): Promise<UpstreamInfo | undefined> {
    const { ok, stdout } = await this.tryRun([
      'for-each-ref',
      '--format=%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)',
      `refs/heads/${branch}`,
    ]);
    if (!ok) return undefined;
    const [trackingRef = '', remote = '', remoteRef = ''] = (stdout.split('\n')[0] ?? '').trim().split('\0');
    if (!trackingRef.startsWith('refs/remotes/') || !remote || !remoteRef.startsWith('refs/heads/')) {
      return undefined;
    }
    return { trackingRef, remote, branch: remoteRef.slice('refs/heads/'.length) };
  }

  async isShallow(): Promise<boolean> {
    const { ok, stdout } = await this.tryRun(['rev-parse', '--is-shallow-repository']);
    return ok && stdout.trim() === 'true';
  }

  /** Number of commits in a revision range such as `base..head`. */
  async countCommits(range: string): Promise<number> {
    const out = await this.run(['rev-list', '--count', range, '--']);
    return Number.parseInt(out.trim(), 10) || 0;
  }

  /** Commits only in `left` and only in `right` (`git rev-list --left-right --count left...right`). */
  async aheadBehind(left: string, right: string): Promise<{ left: number; right: number }> {
    const out = await this.run(['rev-list', '--left-right', '--count', `${left}...${right}`, '--']);
    const [l = '0', r = '0'] = out.trim().split(/\s+/);
    return { left: Number.parseInt(l, 10) || 0, right: Number.parseInt(r, 10) || 0 };
  }

  /** Merge-base of two commits, or undefined when there is none (unrelated or truncated history). */
  async tryMergeBase(a: string, b: string): Promise<string | undefined> {
    const { ok, stdout } = await this.tryRun(['merge-base', a, b]);
    return ok && stdout.trim() ? stdout.trim() : undefined;
  }

  /** Parent shas of a commit (empty for roots and shallow boundaries). */
  async parents(sha: string): Promise<string[]> {
    const { ok, stdout } = await this.tryRun(['rev-list', '--parents', '-n', '1', sha, '--']);
    return ok ? stdout.trim().split(/\s+/).slice(1) : [];
  }

  /** When `ref` was last updated according to its reflog (fetch, push, commit), or undefined. */
  async refUpdatedAt(ref: string): Promise<Date | undefined> {
    const { ok, stdout } = await this.tryRun(['log', '-g', '-1', '--format=%gd', '--date=unix', ref, '--']);
    const m = ok ? /@\{(\d+)\}\s*$/.exec(stdout.trim()) : null;
    return m ? new Date(Number(m[1]) * 1000) : undefined;
  }

  /** Time of the last `git fetch` that wrote FETCH_HEAD (any remote, any ref), or undefined. */
  async lastFetchAt(): Promise<Date | undefined> {
    const { ok, stdout } = await this.tryRun(['rev-parse', '--git-path', 'FETCH_HEAD']);
    if (!ok || !stdout.trim()) return undefined;
    try {
      return (await stat(path.resolve(this.root, stdout.trim()))).mtime;
    } catch {
      return undefined;
    }
  }

  /** Counts uncommitted tracked changes and untracked files, ignoring paths under `excludeDirs`. */
  async workingTreeStatus(excludeDirs: string[] = []): Promise<WorkingTreeStatus> {
    const out = await this.run(['status', '--porcelain', '-z', '--untracked-files=normal', '--no-renames']);
    const status: WorkingTreeStatus = { changed: 0, untracked: 0 };
    for (const entry of out.split('\0')) {
      if (entry.length < 4) continue;
      const file = entry.slice(3);
      if (excludeDirs.some((d) => file === d || file.startsWith(`${d.replace(/\/$/, '')}/`))) continue;
      if (entry.startsWith('??')) status.untracked++;
      else status.changed++;
    }
    return status;
  }

  /**
   * Environment for network commands: never prompt (terminal, Git Credential Manager, ssh passphrase or
   * host-key questions), unless the user configured their own ssh command.
   */
  async networkEnv(): Promise<NodeJS.ProcessEnv> {
    this.networkEnvCache ??= this.buildNetworkEnv();
    return this.networkEnvCache;
  }

  private async buildNetworkEnv(): Promise<NodeJS.ProcessEnv> {
    const env = gitEnv({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
    if (!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH && !(await this.configGet('core.sshCommand'))) {
      env.GIT_SSH_COMMAND = SSH_BATCH_COMMAND;
    }
    return env;
  }

  private async runNetwork(label: string, args: string[], opts: NetworkOptions): Promise<RunResult> {
    return runManaged('git', [...STABLE_FLAGS, ...args], {
      label,
      cwd: this.root,
      env: await this.networkEnv(),
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  /**
   * Asks `remote` which of `branches` exist (and, with `defaultBranch`, where its HEAD points) in one
   * round trip, without downloading objects.
   */
  async lsRemote(
    remote: string,
    branches: string[],
    opts: NetworkOptions & { defaultBranch?: boolean },
  ): Promise<NetworkResult & { result?: LsRemoteResult }> {
    const patterns = [...(opts.defaultBranch ? ['HEAD'] : []), ...branches.map((b) => `refs/heads/${b}`)];
    if (patterns.length === 0) return { ok: true, aborted: false, result: { heads: new Map() } };
    const res = await this.runNetwork(
      `git ls-remote ${remote}`,
      ['ls-remote', '--symref', remote, ...patterns],
      opts,
    );
    if (res.exitCode !== 0 || res.timedOut || res.aborted) {
      return { ok: false, aborted: res.aborted, error: networkFailure(res, opts.timeoutMs) };
    }
    const wanted = new Set(branches);
    const result: LsRemoteResult = { heads: new Map() };
    for (const line of res.stdout.split('\n')) {
      const symref = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(line);
      if (symref) {
        result.defaultBranch = symref[1];
        continue;
      }
      const m = /^([0-9a-f]{40,64})\trefs\/heads\/(.+)$/.exec(line);
      if (m?.[1] && m[2] && wanted.has(m[2])) result.heads.set(m[2], m[1]);
    }
    return { ok: true, aborted: false, result };
  }

  /**
   * Fetches exactly `refspecs` (plus bare shas in `wants`, used to deepen shallow history) from `remote`:
   * no tags, no submodules, no FETCH_HEAD, no auto-maintenance. Retries once when a ref lock is held by a
   * concurrent git process.
   */
  async fetchRefs(
    remote: string,
    refspecs: string[],
    opts: NetworkOptions & { depth?: number; deepen?: number; wants?: string[] },
  ): Promise<NetworkResult> {
    const args = [
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-recurse-submodules',
      '--no-write-fetch-head',
      '--no-auto-maintenance',
      '--no-show-forced-updates',
      ...(opts.depth ? [`--depth=${opts.depth}`] : []),
      ...(opts.deepen ? [`--deepen=${opts.deepen}`] : []),
      remote,
      ...refspecs,
      ...(opts.wants ?? []),
    ];
    for (let attempt = 0; ; attempt++) {
      const res = await this.runNetwork(`git fetch ${remote}`, args, opts);
      if (res.exitCode === 0 && !res.timedOut && !res.aborted) return { ok: true, aborted: false };
      const lockHeld = /\.lock'?:? File exists|Unable to create '.*\.lock'|cannot lock ref/i.test(res.stderr);
      if (attempt === 0 && lockHeld && !res.aborted && !res.timedOut) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return { ok: false, aborted: res.aborted, error: networkFailure(res, opts.timeoutMs) };
    }
  }
}
