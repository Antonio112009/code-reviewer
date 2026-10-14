import type { PublishSettings } from '../config/schema';
import type { CiPullRequest } from '../git/ci';
import type { ForgePullRequest } from '../git/forge';
import type { Platform } from '../git/remote';
import type { RunRecord } from '../types';
import { CI_ORDER, FORGE_SPECS, FORGES, type ForgeKind, type ForgeSpec, isForgeKind } from './forges';

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

export { FORGE_LABELS, FORGE_SPECS, FORGES, type ForgeKind, type ForgeSpec } from './forges';

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
  settings: Pick<PublishSettings, 'githubApiUrl' | 'gitlabApiUrl' | 'giteaApiUrl'>;
  env: NodeJS.ProcessEnv;
  /** The CI's pull/merge request (`detectCiPullRequest`). */
  ci?: CiPullRequest;
  /** Local lookup of the branch's open PR/MR (gh / glab); not called when flags and CI answer everything. */
  findPullRequest?: (platform: Platform) => Promise<ForgePullRequest | undefined>;
}

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
export function webHostOfApi(apiUrl: string, forge?: ForgeKind): string {
  const host = new URL(apiUrl).host.toLowerCase();
  const specs = forge ? [FORGE_SPECS[forge]] : FORGES.map((k) => FORGE_SPECS[k]);
  for (const spec of specs) {
    const web = spec.webHostOfApi(host);
    if (web !== host) return web;
  }
  return host;
}

/** Whether this process runs in the forge's own CI. */
function inCiOf(spec: ForgeSpec, env: NodeJS.ProcessEnv): boolean {
  return envValue(env, spec.ciVar) === 'true';
}

/** The forge whose CI is running this process, if any. */
function ciForge(env: NodeJS.ProcessEnv): ForgeKind | undefined {
  return CI_ORDER.find((k) => inCiOf(FORGE_SPECS[k], env));
}

function resolveForge(opts: ResolveTargetOptions, why: string[]): ForgeKind {
  const { flags, env, run, settings } = opts;
  if (flags.forge !== undefined) {
    if (!isForgeKind(flags.forge)) {
      throw new PublishError(`--forge must be one of: ${FORGES.join(', ')} (got "${flags.forge}")`);
    }
    why.push(`forge ${flags.forge}: --forge`);
    return flags.forge;
  }
  const ci = ciForge(env);
  if (ci) {
    why.push(`forge ${ci}: running in ${FORGE_SPECS[ci].label} CI (${FORGE_SPECS[ci].ciVar})`);
    return ci;
  }
  const platform = run.repo?.platform;
  if (platform && isForgeKind(platform)) {
    why.push(`forge ${platform}: the repository remote is on ${FORGE_SPECS[platform].label}`);
    return platform;
  }
  // Exactly one self-hosted API configured: that forge.
  const configured = FORGES.filter((k) => settings[FORGE_SPECS[k].apiUrlKey]);
  if (configured.length === 1) {
    why.push(`forge ${configured[0]}: only publish.${FORGE_SPECS[configured[0]!].apiUrlKey} is configured`);
    return configured[0]!;
  }
  const others = FORGES.filter((k) => k !== 'github');
  why.push(
    `forge github: nothing else detected (use --forge ${others.join('|')} for ${others.map((k) => FORGE_SPECS[k].label).join(' / ')})`,
  );
  return 'github';
}

function resolveApiUrl(forge: ForgeKind, opts: ResolveTargetOptions, why: string[]): string {
  const { flags, env, settings } = opts;
  const spec = FORGE_SPECS[forge];
  if (flags.apiUrl) {
    const url = validateApiUrl(flags.apiUrl, '--api-url');
    why.push(`API ${url}: --api-url`);
    return url;
  }
  // The CI's own API URL counts only inside that CI (a stray variable elsewhere is not trusted).
  const ciUrl = inCiOf(spec, env) ? envValue(env, spec.ciApiUrlVar) : undefined;
  if (ciUrl) {
    const url = validateApiUrl(ciUrl, spec.ciApiUrlVar);
    why.push(`API ${url}: ${spec.ciApiUrlVar} (declared by the CI)`);
    return url;
  }
  const configured = settings[spec.apiUrlKey];
  if (configured) {
    const url = validateApiUrl(configured, `publish.${spec.apiUrlKey}`);
    why.push(`API ${url}: publish.${spec.apiUrlKey} (global config)`);
    return url;
  }
  why.push(`API ${spec.publicApiUrl}: the public ${spec.label} API`);
  return spec.publicApiUrl;
}

function checkRepo(forge: ForgeKind, repo: string, origin: string): string {
  const spec = FORGE_SPECS[forge];
  if (!spec.repoPattern.test(repo) || repo.split('/').some((s) => s === '.' || s === '..')) {
    throw new PublishError(`${origin}: expected ${spec.repoHint} (got ${JSON.stringify(repo)})`);
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
  const spec = FORGE_SPECS[forge];
  const apiUrl = resolveApiUrl(forge, opts, why);
  const inCi = inCiOf(spec, env);

  let repo: string | undefined;
  if (flags.repo) {
    repo = checkRepo(forge, flags.repo.trim(), '--repo');
    why.push(`repository ${repo}: --repo`);
  } else if (inCi) {
    const name = spec.ciRepoVars.find((v) => envValue(env, v));
    if (name) {
      repo = checkRepo(forge, envValue(env, name)!, name);
      why.push(`repository ${repo}: ${name}`);
    }
  }

  let number: number | undefined;
  if (flags.pr) {
    number = parseNumber(flags.pr, '--pr');
    why.push(`${spec.requestNoun} ${number}: --pr`);
  } else if (inCi && opts.ci?.provider === spec.ci && opts.ci.number) {
    number = parseNumber(opts.ci.number, `${opts.ci.label} pull request number`);
    why.push(`${spec.requestNoun} ${number}: ${opts.ci.label}`);
  }

  // Local fallback: the branch's open PR/MR (gh / glab) and the remote. Only a repository on the chosen
  // API's host is accepted: the remote names the repository, never where the token goes.
  let local: ForgePullRequest | undefined;
  const tool = spec.tool;
  if (tool && (number === undefined || repo === undefined) && opts.findPullRequest) {
    local = await opts.findPullRequest(forge);
    if (local && local.tool !== tool) local = undefined;
    // A PR of another repository than the one named by --repo / the CI is not this target.
    const localRepo = repoFromWebUrl(local?.baseRepoUrl)?.path;
    if (local && repo !== undefined && localRepo?.toLowerCase() !== repo.toLowerCase()) {
      why.push(`ignored the open ${tool} pull/merge request of ${localRepo ?? 'an unknown repository'}`);
      local = undefined;
    }
    if (local && number === undefined) {
      number = local.number;
      why.push(`${spec.requestNoun} ${number}: open for this branch (${tool})`);
    }
  }
  if (repo === undefined) {
    const candidates: Array<[string, string | undefined]> = [
      ...(tool
        ? [[`the ${spec.requestNoun} (${tool})`, local?.baseRepoUrl] as [string, string | undefined]]
        : []),
      ['the git remote', opts.run.repo?.remote],
    ];
    for (const [origin, url] of candidates) {
      const parsed = repoFromWebUrl(url);
      if (!parsed) continue;
      const apiHost = webHostOfApi(apiUrl, forge);
      if (parsed.host !== apiHost) {
        throw new PublishError(
          `The repository (${origin}) is on ${parsed.host}, but the API is ${apiUrl}. Set publish.${spec.apiUrlKey} in the global config or pass --api-url, or name the repository with --repo.`,
        );
      }
      repo = checkRepo(forge, parsed.path, origin);
      why.push(`repository ${repo}: ${origin}`);
      break;
    }
  }
  if (repo === undefined) {
    throw new PublishError(
      `Could not tell which ${spec.label} repository to post to: pass --repo ${spec.repoHint}.`,
    );
  }
  if (number === undefined) {
    throw new PublishError(`No open ${spec.requestNoun} found for this branch: pass --pr <number>.`);
  }
  return { forge, apiUrl, repo, number, explanation: why };
}

/** The access token for a forge from the environment, with the variable it came from. */
export function tokenFor(
  forge: ForgeKind,
  env: NodeJS.ProcessEnv,
): { token: string; source: string } | undefined {
  for (const name of FORGE_SPECS[forge].tokenVars) {
    const token = envValue(env, name);
    if (token) return { token, source: name };
  }
  return undefined;
}

export function missingTokenMessage(forge: ForgeKind): string {
  return FORGE_SPECS[forge].missingToken;
}

/** `owner/name#12` / `group/project!12`. */
export function targetLabel(t: Pick<PublishTarget, 'forge' | 'repo' | 'number'>): string {
  return `${t.repo}${FORGE_SPECS[t.forge].refSigil}${t.number}`;
}
