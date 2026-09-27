import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { runManaged } from '../util/processes';
import type { Platform } from './remote';
import { isValidBranchName } from './repo';

export type ForgeTool = 'gh' | 'glab';

/** The open pull/merge request for the current branch, as reported by a forge CLI. */
export interface ForgePullRequest {
  tool: ForgeTool;
  number: number;
  url?: string;
  /** Target branch, without `refs/heads/`. */
  baseBranch: string;
  /** Target branch tip (GitHub) or diff base (GitLab) as known to the forge. */
  baseSha?: string;
  /** Web URL of the repository the request targets, e.g. `https://github.com/owner/repo`. */
  baseRepoUrl?: string;
}

export interface FindPullRequestOptions {
  /** Repository root (the CLI runs there; binaries inside it are never used). */
  cwd: string;
  /** Hosting platform of the remote; `other` tries both CLIs. */
  platform: Platform;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Per-CLI timeout (default 5 s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const SHA_RE = /^[0-9a-f]{7,64}$/i;

function isInside(dir: string, root: string): boolean {
  const rel = path.relative(root, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Absolute path of `name` on `env.PATH`, skipping relative PATH entries and directories inside `exclude`
 * (so a checked-in `./gh` can never be picked up). Undefined when not installed.
 */
export async function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  exclude?: string,
): Promise<string | undefined> {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter);
  const exts =
    process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    if (!dir || !path.isAbsolute(dir)) continue;
    if (exclude && isInside(path.resolve(dir), path.resolve(exclude))) continue;
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try {
        await access(file, constants.X_OK);
        if ((await stat(file)).isFile()) return file;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

function toRecord(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    return toRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Parses `gh pr view --json number,url,state,baseRefName,baseRefOid`; only open PRs count. */
export function parseGhPullRequest(text: string): ForgePullRequest | undefined {
  const pr = parseJson(text);
  if (pr?.state !== 'OPEN') return undefined;
  const base = pr.baseRefName;
  const number = pr.number;
  if (typeof base !== 'string' || !isValidBranchName(base)) return undefined;
  if (typeof number !== 'number' || !Number.isInteger(number)) return undefined;
  const url = typeof pr.url === 'string' ? pr.url : undefined;
  const repo = url ? /^(https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+)\/pull\/\d+$/.exec(url)?.[1] : undefined;
  return {
    tool: 'gh',
    number,
    url,
    baseBranch: base,
    baseSha: typeof pr.baseRefOid === 'string' && SHA_RE.test(pr.baseRefOid) ? pr.baseRefOid : undefined,
    baseRepoUrl: repo,
  };
}

/** Parses `glab mr view -F json`; only open MRs count. */
export function parseGlabMergeRequest(text: string): ForgePullRequest | undefined {
  const mr = parseJson(text);
  if (mr?.state !== 'opened') return undefined;
  const base = mr.target_branch;
  const number = mr.iid;
  if (typeof base !== 'string' || !isValidBranchName(base)) return undefined;
  if (typeof number !== 'number' || !Number.isInteger(number)) return undefined;
  const url = typeof mr.web_url === 'string' ? mr.web_url : undefined;
  const repo = url ? /^(https:\/\/[^\s]+?)\/-\/merge_requests\/\d+$/.exec(url)?.[1] : undefined;
  const baseSha = toRecord(mr.diff_refs)?.base_sha;
  return {
    tool: 'glab',
    number,
    url,
    baseBranch: base,
    baseSha: typeof baseSha === 'string' && SHA_RE.test(baseSha) ? baseSha : undefined,
    baseRepoUrl: repo,
  };
}

interface ToolSpec {
  tool: ForgeTool;
  args: string[];
  env: NodeJS.ProcessEnv;
  parse: (text: string) => ForgePullRequest | undefined;
}

const TOOLS: Record<ForgeTool, ToolSpec> = {
  gh: {
    tool: 'gh',
    // No branch argument: gh then resolves the PR from the current branch and its push/tracking config.
    args: ['pr', 'view', '--json', 'number,url,state,baseRefName,baseRefOid'],
    env: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1' },
    parse: parseGhPullRequest,
  },
  glab: {
    tool: 'glab',
    args: ['mr', 'view', '-F', 'json'],
    env: { NO_PROMPT: '1', GLAB_CHECK_UPDATE: 'false' },
    parse: parseGlabMergeRequest,
  },
};

async function ask(spec: ToolSpec, opts: FindPullRequestOptions): Promise<ForgePullRequest | undefined> {
  const bin = await findExecutable(spec.tool, opts.env, opts.cwd);
  if (!bin || opts.signal?.aborted) return undefined;
  try {
    const res = await runManaged(bin, spec.args, {
      label: `${spec.tool} (pull request lookup)`,
      cwd: opts.cwd,
      env: { ...opts.env, ...spec.env, NO_COLOR: '1', CLICOLOR: '0', GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: opts.signal,
      maxBuffer: 1024 * 1024,
    });
    if (res.exitCode !== 0 || res.timedOut || res.aborted) return undefined;
    return spec.parse(res.stdout);
  } catch {
    return undefined;
  }
}

/**
 * Asks `gh` (GitHub) or `glab` (GitLab) for the open PR/MR of the current branch. Silent by design:
 * a missing CLI, missing auth, no PR, a timeout or unexpected output all yield undefined.
 */
export async function findOpenPullRequest(
  opts: FindPullRequestOptions,
): Promise<ForgePullRequest | undefined> {
  const order: ForgeTool[] =
    opts.platform === 'github' ? ['gh'] : opts.platform === 'gitlab' ? ['glab'] : ['gh', 'glab'];
  for (const tool of order) {
    const pr = await ask(TOOLS[tool], opts);
    if (pr) return pr;
  }
  return undefined;
}
