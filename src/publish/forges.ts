import type { PublishSettings } from '../config/schema';
import type { CiProvider } from '../git/ci';
import type { ForgeTool } from '../git/forge';

/*
 * The forge registry: everything that differs between the code hosts a review can be posted to, in one
 * place. Adding a forge is one entry here plus its adapter (`./<forge>.ts`, registered in `index.ts`); the
 * target resolution, the renderer and the CLI read the entry instead of switching on the kind. This module
 * imports nothing from the publishing code, so every other module can import it.
 */

export type ForgeKind = 'github' | 'gitlab' | 'gitea' | 'bitbucket';
export const FORGES: readonly ForgeKind[] = ['github', 'gitlab', 'gitea', 'bitbucket'];
/**
 * The order CI markers are checked in: Gitea / Forgejo Actions set GitHub's variables too (`GITHUB_ACTIONS`,
 * `GITHUB_API_URL`), so their own marker has to win, or the token would follow GitHub's rules.
 */
export const CI_ORDER: readonly ForgeKind[] = ['gitea', 'github', 'gitlab', 'bitbucket'];

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
  /**
   * Variable that marks that CI ("true", or any value with `ciVarAnyValue`), the CI's own API URL variable
   * when the CI declares one, and the repository variables.
   */
  ciVar: string;
  ciVarAnyValue?: boolean;
  ciApiUrlVar?: string;
  ciRepoVars: readonly string[];
  /** Global-config key of a self-hosted API URL, for forges that can be self-hosted. */
  apiUrlKey?: keyof Pick<PublishSettings, 'githubApiUrl' | 'gitlabApiUrl' | 'giteaApiUrl'>;
  /** The local CLI that knows the branch's open request (`findOpenPullRequest`), when one exists. */
  tool?: ForgeTool;
  /** What `--repo` must look like, and the words for the error message. */
  repoPattern: RegExp;
  repoHint: string;
  /** The web host an API URL belongs to (api.github.com → github.com; others: the same host). */
  webHostOfApi: (apiHost: string) => string;
  /** How a one-click suggestion is fenced: GitHub on the comment's range, GitLab with line offsets, or not at all. */
  suggestionStyle: 'range' | 'offsets' | 'none';
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
  },
  gitea: {
    kind: 'gitea',
    label: 'Gitea',
    // Codeberg is the public Forgejo instance; a self-hosted Gitea / Forgejo needs publish.giteaApiUrl.
    publicApiUrl: 'https://codeberg.org/api/v1',
    requestNoun: 'pull request',
    refSigil: '#',
    tokenVars: ['GITEA_TOKEN', 'FORGEJO_TOKEN'],
    missingToken:
      'Set GITEA_TOKEN (or FORGEJO_TOKEN) to an access token with write access to the repository (issue and pull request scopes).',
    ci: 'gitea',
    ciVar: 'GITEA_ACTIONS',
    ciApiUrlVar: 'GITHUB_API_URL',
    ciRepoVars: ['GITHUB_REPOSITORY'],
    apiUrlKey: 'giteaApiUrl',
    repoPattern: /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/,
    repoHint: 'owner/name',
    webHostOfApi: sameHost,
    // Applicable `suggestion` blocks exist in Forgejo only, and not through the API in vanilla Gitea.
    suggestionStyle: 'none',
  },
  bitbucket: {
    kind: 'bitbucket',
    label: 'Bitbucket',
    publicApiUrl: 'https://api.bitbucket.org/2.0',
    requestNoun: 'pull request',
    refSigil: '#',
    tokenVars: ['BITBUCKET_TOKEN'],
    missingToken:
      'Set BITBUCKET_TOKEN to an API token (with BITBUCKET_EMAIL, the account e-mail) or to a repository / workspace access token with pull request write permission. App passwords no longer work.',
    ci: 'bitbucket',
    // Pipelines set no "true" flag; the build number is always there.
    ciVar: 'BITBUCKET_BUILD_NUMBER',
    ciVarAnyValue: true,
    ciRepoVars: ['BITBUCKET_REPO_FULL_NAME'],
    repoPattern: /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/,
    repoHint: 'workspace/repo-slug',
    webHostOfApi: (host) => (host === 'api.bitbucket.org' ? 'bitbucket.org' : host),
    // Whether a `suggestion` fence posted through the API is applicable is unconfirmed: the fix is shown as text.
    suggestionStyle: 'none',
  },
};

export const FORGE_LABELS: Record<ForgeKind, string> = Object.fromEntries(
  FORGES.map((k) => [k, FORGE_SPECS[k].label]),
) as Record<ForgeKind, string>;

export function isForgeKind(value: string): value is ForgeKind {
  return (FORGES as readonly string[]).includes(value);
}
