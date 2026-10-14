import type { PublishSettings } from '../config/schema';
import type { CiProvider } from '../git/ci';
import type { ForgeTool } from '../git/forge';
import type { Logger } from '../util/logger';
import { githubAdapter, githubHeaders } from './github';
import { gitlabAdapter, gitlabHeaders } from './gitlab';
import type { ApiClient } from './http';
import type { ForgeAdapter } from './plan';
import type { PublishTarget } from './target';

/*
 * The forge registry: everything that differs between the code hosts a review can be posted to, in one
 * place. Adding a forge is one entry here plus its adapter (`./<forge>.ts`); the target resolution, the
 * renderer and the CLI read the entry instead of switching on the kind.
 */

export type ForgeKind = 'github' | 'gitlab';
export const FORGES: readonly ForgeKind[] = ['github', 'gitlab'];

export interface ForgeSpec {
  kind: ForgeKind;
  /** Human name, e.g. "GitHub". */
  label: string;
  /** The public API, used when neither the CI nor the global config names one. */
  publicApiUrl: string;
  /** What a change request is called ("pull request" / "merge request") and its sigil (`#` / `!`). */
  requestNoun: string;
  refSigil: string;
  /** Environment variables that may hold the access token, in order. */
  tokenVars: readonly string[];
  /** What to set when no token is found. */
  missingToken: string;
  /** The CI system that belongs to the forge, as `detectCiPullRequest` names it. */
  ci: CiProvider;
  /** Variable that is "true" inside that CI, the CI's own API URL variable, and the repository variables. */
  ciVar: string;
  ciApiUrlVar: string;
  ciRepoVars: readonly string[];
  /** Global-config key of a self-hosted API URL. */
  apiUrlKey: keyof Pick<PublishSettings, 'githubApiUrl' | 'gitlabApiUrl'>;
  /** The local CLI that knows the branch's open request (`findOpenPullRequest`). */
  tool: ForgeTool;
  /** What `--repo` must look like, and the words for the error message. */
  repoPattern: RegExp;
  repoHint: string;
  /** The web host an API URL belongs to (api.github.com → github.com; others: the same host). */
  webHostOfApi: (apiHost: string) => string;
  /** How a one-click suggestion is fenced: GitHub on the comment's range, GitLab with line offsets. */
  suggestionStyle: 'range' | 'offsets';
  headers: (token: string, userAgent: string) => Record<string, string>;
  adapter: (target: PublishTarget, client: ApiClient, logger: Logger) => ForgeAdapter;
}

const sameHost = (host: string) => host;

export const FORGE_SPECS: Record<ForgeKind, ForgeSpec> = {
  github: {
    kind: 'github',
    label: 'GitHub',
    publicApiUrl: 'https://api.github.com',
    requestNoun: 'pull request',
    refSigil: '#',
    tokenVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
    missingToken:
      'Set GITHUB_TOKEN (or GH_TOKEN) to a token that may write pull request comments (pull-requests: write).',
    ci: 'github',
    ciVar: 'GITHUB_ACTIONS',
    ciApiUrlVar: 'GITHUB_API_URL',
    ciRepoVars: ['GITHUB_REPOSITORY'],
    apiUrlKey: 'githubApiUrl',
    tool: 'gh',
    repoPattern: /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/,
    repoHint: 'owner/name',
    webHostOfApi: (host) => (host === 'api.github.com' ? 'github.com' : host),
    suggestionStyle: 'range',
    headers: githubHeaders,
    adapter: githubAdapter,
  },
  gitlab: {
    kind: 'gitlab',
    label: 'GitLab',
    publicApiUrl: 'https://gitlab.com/api/v4',
    requestNoun: 'merge request',
    refSigil: '!',
    tokenVars: ['GITLAB_TOKEN'],
    missingToken:
      'Set GITLAB_TOKEN to a project or group access token with the api scope (CI_JOB_TOKEN cannot create merge request discussions).',
    ci: 'gitlab',
    ciVar: 'GITLAB_CI',
    ciApiUrlVar: 'CI_API_V4_URL',
    ciRepoVars: ['CI_MERGE_REQUEST_PROJECT_ID', 'CI_PROJECT_ID'],
    apiUrlKey: 'gitlabApiUrl',
    tool: 'glab',
    repoPattern: /^(?:\d{1,20}|[A-Za-z0-9_.-]{1,255}(?:\/[A-Za-z0-9_.-]{1,255}){1,20})$/,
    repoHint: 'a project id or group/project path',
    webHostOfApi: sameHost,
    suggestionStyle: 'offsets',
    headers: gitlabHeaders,
    adapter: gitlabAdapter,
  },
};

export const FORGE_LABELS: Record<ForgeKind, string> = Object.fromEntries(
  FORGES.map((k) => [k, FORGE_SPECS[k].label]),
) as Record<ForgeKind, string>;

export function isForgeKind(value: string): value is ForgeKind {
  return (FORGES as readonly string[]).includes(value);
}
