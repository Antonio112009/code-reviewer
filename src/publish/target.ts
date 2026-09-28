import type { PublishSettings } from '../config/schema';
import type { CiPullRequest } from '../git/ci';
import type { ForgePullRequest } from '../git/forge';
import type { Platform } from '../git/remote';
import type { RunRecord } from '../types';

/*
 * Where a review is posted: which forge, which API, which repository, which pull/merge request.
 *
 * Token destination rule: an access token is only ever sent to
 * - the public APIs (api.github.com, gitlab.com),
 * - the API URL the CI itself declares (GITHUB_API_URL in GitHub Actions, CI_API_V4_URL in GitLab CI),
 * - an API URL from the global config (`publish.githubApiUrl` / `publish.gitlabApiUrl`) or `--api-url`.
 * The repository's remote URL never chooses an API host; it only names the repository, and only when its
 * host matches the chosen API (so a GitHub Enterprise remote never leads to posting on github.com).
 */

export type ForgeKind = 'github' | 'gitlab';
export const FORGES: readonly ForgeKind[] = ['github', 'gitlab'];

export const PUBLIC_API_URLS: Record<ForgeKind, string> = {
  github: 'https://api.github.com',
  gitlab: 'https://gitlab.com/api/v4',
};

export const FORGE_LABELS: Record<ForgeKind, string> = { github: 'GitHub', gitlab: 'GitLab' };

export class PublishError extends Error {}

/** Command-line choices (`--pr`, `--repo`, `--forge`, `--api-url`). */
export interface PublishFlags {
  pr?: string;
  repo?: string;
  forge?: string;
  apiUrl?: string;
}

export interface PublishTarget {
  forge: ForgeKind;
  /** API base without a trailing slash, e.g. https://api.github.com or https://gitlab.com/api/v4. */
  apiUrl: string;
  /** GitHub `owner/name`; GitLab numeric project id or `group/project` path. */
  repo: string;
  /** Pull request number / merge request iid. */
  number: number;
  /** How each part was chosen, one line per decision (debug log). */
  explanation: string[];
}

export interface ResolveTargetOptions {
  run: Pick<RunRecord, 'repo'>;
  flags: PublishFlags;
  /** Merged config: API URLs can only come from the global config (the loader rejects them elsewhere). */
  settings: Pick<PublishSettings, 'githubApiUrl' | 'gitlabApiUrl'>;
  env: NodeJS.ProcessEnv;
  /** The CI's pull/merge request (`detectCiPullRequest`). */
  ci?: CiPullRequest;
  /** Local lookup of the branch's open PR/MR (gh / glab); not called when flags and CI answer everything. */
  findPullRequest?: (platform: Platform) => Promise<ForgePullRequest | undefined>;
}

const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const GITLAB_PROJECT_RE = /^(?:\d{1,20}|[A-Za-z0-9_.-]{1,255}(?:\/[A-Za-z0-9_.-]{1,255}){1,20})$/;

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Checks an API base URL and returns it normalised (no trailing slash): https only (plain http only for
 * loopback hosts), no credentials, no query or fragment.
 */
export function validateApiUrl(raw: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PublishError(`${origin}: not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new PublishError(`${origin}: the API URL must use https (got ${url.protocol}//${url.host}).`);
  }
  if (url.username || url.password) {
    throw new PublishError(`${origin}: the API URL must not contain credentials.`);
  }
  if (url.search || url.hash) {
    throw new PublishError(`${origin}: the API URL must not have a query or fragment.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The web host that belongs to an API URL (api.github.com → github.com; others: the same host). */
export function webHostOfApi(apiUrl: string): string {
  const host = new URL(apiUrl).host.toLowerCase();
  return host === 'api.github.com' ? 'github.com' : host;
}

/** The forge whose CI is running this process, if any. */
function ciForge(env: NodeJS.ProcessEnv): ForgeKind | undefined {
  if (envValue(env, 'GITHUB_ACTIONS') === 'true') return 'github';
  if (envValue(env, 'GITLAB_CI') === 'true') return 'gitlab';
  return undefined;
}

function resolveForge(opts: ResolveTargetOptions, why: string[]): ForgeKind {
  const { flags, env, run, settings } = opts;
  if (flags.forge !== undefined) {
    if (!(FORGES as readonly string[]).includes(flags.forge)) {
      throw new PublishError(`--forge must be one of: ${FORGES.join(', ')} (got "${flags.forge}")`);
    }
    why.push(`forge ${flags.forge}: --forge`);
    return flags.forge as ForgeKind;
  }
  const ci = ciForge(env);
  if (ci) {
    why.push(`forge ${ci}: running in ${ci === 'github' ? 'GitHub Actions' : 'GitLab CI'}`);
    return ci;
  }
  const platform = run.repo?.platform;
  if (platform === 'github' || platform === 'gitlab') {
    why.push(`forge ${platform}: the repository remote is on ${FORGE_LABELS[platform]}`);
    return platform;
  }
  if (settings.gitlabApiUrl && !settings.githubApiUrl) {
    why.push('forge gitlab: only publish.gitlabApiUrl is configured');
    return 'gitlab';
  }
  why.push('forge github: nothing else detected (use --forge gitlab for GitLab)');
  return 'github';
}

function resolveApiUrl(forge: ForgeKind, opts: ResolveTargetOptions, why: string[]): string {
  const { flags, env, settings } = opts;
  if (flags.apiUrl) {
    const url = validateApiUrl(flags.apiUrl, '--api-url');
    why.push(`API ${url}: --api-url`);
    return url;
  }
  // The CI's own API URL counts only inside that CI (a stray variable elsewhere is not trusted).
  const ciVar =
    forge === 'github'
      ? envValue(env, 'GITHUB_ACTIONS') === 'true'
        ? 'GITHUB_API_URL'
        : undefined
      : envValue(env, 'GITLAB_CI') === 'true'
        ? 'CI_API_V4_URL'
        : undefined;
  const ciUrl = ciVar ? envValue(env, ciVar) : undefined;
  if (ciVar && ciUrl) {
    const url = validateApiUrl(ciUrl, ciVar);
    why.push(`API ${url}: ${ciVar} (declared by the CI)`);
    return url;
  }
  const key = forge === 'github' ? 'githubApiUrl' : 'gitlabApiUrl';
  const configured = settings[key];
  if (configured) {
    const url = validateApiUrl(configured, `publish.${key}`);
    why.push(`API ${url}: publish.${key} (global config)`);
    return url;
  }
  why.push(`API ${PUBLIC_API_URLS[forge]}: the public ${FORGE_LABELS[forge]} API`);
  return PUBLIC_API_URLS[forge];
}

function checkRepo(forge: ForgeKind, repo: string, origin: string): string {
  const ok = forge === 'github' ? GITHUB_REPO_RE.test(repo) : GITLAB_PROJECT_RE.test(repo);
  if (!ok || repo.split('/').some((s) => s === '.' || s === '..')) {
    const expected = forge === 'github' ? 'owner/name' : 'a project id or group/project path';
    throw new PublishError(`${origin}: expected ${expected} (got ${JSON.stringify(repo)})`);
  }
  return repo;
}

function parseNumber(raw: string, origin: string): number {
  const n = Number(raw);
  if (!/^\d{1,10}$/.test(raw.trim()) || !Number.isSafeInteger(n) || n <= 0) {
    throw new PublishError(`${origin}: expected a pull/merge request number (got ${JSON.stringify(raw)})`);
  }
  return n;
}

/**
 * `{ host, path }` of a repository web URL (`https://host/owner/name`); undefined for anything else. The URL
 * comes from the local remote or from gh/glab.
 */
export function repoFromWebUrl(url: string | undefined): { host: string; path: string } | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    const path = decodeURIComponent(u.pathname)
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/, '');
    return path ? { host: u.host.toLowerCase(), path } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the pull/merge request to publish to: explicit flags first, then the CI environment, then the
 * local remote and the branch's open PR/MR (gh / glab). Every decision is recorded in `explanation`.
 */
export async function resolvePublishTarget(opts: ResolveTargetOptions): Promise<PublishTarget> {
  const why: string[] = [];
  const { flags, env } = opts;
  const forge = resolveForge(opts, why);
  const apiUrl = resolveApiUrl(forge, opts, why);
  const inCi = ciForge(env) === forge;

  let repo: string | undefined;
  if (flags.repo) {
    repo = checkRepo(forge, flags.repo.trim(), '--repo');
    why.push(`repository ${repo}: --repo`);
  } else if (inCi) {
    const name = forge === 'github' ? 'GITHUB_REPOSITORY' : 'CI_MERGE_REQUEST_PROJECT_ID';
    const value = envValue(env, name) ?? (forge === 'gitlab' ? envValue(env, 'CI_PROJECT_ID') : undefined);
    if (value) {
      repo = checkRepo(forge, value, name);
      why.push(`repository ${repo}: ${envValue(env, name) ? name : 'CI_PROJECT_ID'}`);
    }
  }

  let number: number | undefined;
  if (flags.pr) {
    number = parseNumber(flags.pr, '--pr');
    why.push(`${forge === 'github' ? 'pull request' : 'merge request'} ${number}: --pr`);
  } else if (inCi && opts.ci?.provider === forge && opts.ci.number) {
    number = parseNumber(opts.ci.number, `${opts.ci.label} pull request number`);
    why.push(`${forge === 'github' ? 'pull request' : 'merge request'} ${number}: ${opts.ci.label}`);
  }

  // Local fallback: the branch's open PR/MR (gh / glab) and the remote. Only a repository on the chosen
  // API's host is accepted: the remote names the repository, never where the token goes.
  let local: ForgePullRequest | undefined;
  if ((number === undefined || repo === undefined) && opts.findPullRequest) {
    local = await opts.findPullRequest(forge);
    const tool = forge === 'github' ? 'gh' : 'glab';
    if (local && local.tool !== tool) local = undefined;
    // A PR of another repository than the one named by --repo / the CI is not this target.
    const localRepo = repoFromWebUrl(local?.baseRepoUrl)?.path;
    if (local && repo !== undefined && localRepo?.toLowerCase() !== repo.toLowerCase()) {
      why.push(`ignored the open ${tool} pull/merge request of ${localRepo ?? 'an unknown repository'}`);
      local = undefined;
    }
    if (local && number === undefined) {
      number = local.number;
      why.push(
        `${forge === 'github' ? 'pull request' : 'merge request'} ${number}: open for this branch (${tool})`,
      );
    }
  }
  if (repo === undefined) {
    const candidates: Array<[string, string | undefined]> = [
      [
        `the ${forge === 'github' ? 'pull request' : 'merge request'} (${forge === 'github' ? 'gh' : 'glab'})`,
        local?.baseRepoUrl,
      ],
      ['the git remote', opts.run.repo?.remote],
    ];
    for (const [origin, url] of candidates) {
      const parsed = repoFromWebUrl(url);
      if (!parsed) continue;
      const apiHost = webHostOfApi(apiUrl);
      if (parsed.host !== apiHost) {
        throw new PublishError(
          `The repository (${origin}) is on ${parsed.host}, but the API is ${apiUrl}. Set publish.${forge}ApiUrl in the global config or pass --api-url, or name the repository with --repo.`,
        );
      }
      repo = checkRepo(forge, parsed.path, origin);
      why.push(`repository ${repo}: ${origin}`);
      break;
    }
  }
  if (repo === undefined) {
    throw new PublishError(
      `Could not tell which ${FORGE_LABELS[forge]} repository to post to: pass --repo ${forge === 'github' ? 'owner/name' : 'group/project'}.`,
    );
  }
  if (number === undefined) {
    throw new PublishError(
      `No open ${forge === 'github' ? 'pull request' : 'merge request'} found for this branch: pass --pr <number>.`,
    );
  }
  return { forge, apiUrl, repo, number, explanation: why };
}

/** The access token for a forge from the environment, with the variable it came from. */
export function tokenFor(
  forge: ForgeKind,
  env: NodeJS.ProcessEnv,
): { token: string; source: string } | undefined {
  const names = forge === 'github' ? ['GITHUB_TOKEN', 'GH_TOKEN'] : ['GITLAB_TOKEN'];
  for (const name of names) {
    const token = envValue(env, name);
    if (token) return { token, source: name };
  }
  return undefined;
}

export function missingTokenMessage(forge: ForgeKind): string {
  return forge === 'github'
    ? 'Set GITHUB_TOKEN (or GH_TOKEN) to a token that may write pull request comments (pull-requests: write).'
    : 'Set GITLAB_TOKEN to a project or group access token with the api scope (CI_JOB_TOKEN cannot create merge request discussions).';
}

/** `owner/name#12` / `group/project!12`. */
export function targetLabel(t: Pick<PublishTarget, 'forge' | 'repo' | 'number'>): string {
  return `${t.repo}${t.forge === 'github' ? '#' : '!'}${t.number}`;
}
