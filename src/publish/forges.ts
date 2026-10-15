import type { PUBLISH_URL_KEYS } from '../config/schema';
import type { CiProvider } from '../git/ci';
import type { ForgeTool } from '../git/forge';

/*
 * The forge registry: everything that differs between the code hosts a review can be posted to, in one
 * place. Adding a forge is one entry here plus its adapter (`./<forge>.ts`, registered in `index.ts`); the
 * target resolution, the renderer and the CLI read the entry instead of switching on the kind. This module
 * imports nothing from the publishing code, so every other module can import it.
 */

export type ForgeKind = 'github' | 'gitlab' | 'gitea' | 'bitbucket' | 'bitbucket-dc' | 'azure';
export const FORGES: readonly ForgeKind[] = [
  'github',
  'gitlab',
  'gitea',
  'bitbucket',
  'bitbucket-dc',
  'azure',
];
/**
 * The order CI markers are checked in: Gitea / Forgejo Actions set GitHub's variables too (`GITHUB_ACTIONS`,
 * `GITHUB_API_URL`), so their own marker has to win, or the token would follow GitHub's rules.
 */
export const CI_ORDER: readonly ForgeKind[] = ['gitea', 'github', 'gitlab', 'bitbucket', 'azure'];

export interface ForgeSpec {
  kind: ForgeKind;
  /** Human name, e.g. "GitHub". */
  label: string;
  /**
   * The public API, used when neither the CI nor the global config names one. A forge whose API is scoped
   * (Azure DevOps: one URL per organisation) has none and derives it from the remote with `remoteTarget`.
   */
  publicApiUrl?: string;
  /**
   * API and repository from a repository web URL, for forges whose API is scoped: only for the vendor's own
   * hosts, so the remote can name the organisation but never send the token elsewhere.
   */
  remoteTarget?: (webUrl: string) => { apiUrl: string; repo: string } | undefined;
  /** The repository from the CI's variables when they do not hold it in one piece. */
  ciRepo?: (env: NodeJS.ProcessEnv) => string | undefined;
  /** What a change request is called ("pull request" / "merge request") and its sigil (`#` / `!`). */
  requestNoun: string;
  refSigil: string;
  /** Environment variables that may hold the access token, in order. */
  tokenVars: readonly string[];
  /** What to set when no token is found. */
  missingToken: string;
  /** The CI system that belongs to the forge, as `detectCiPullRequest` names it (none: no CI detection). */
  ci?: CiProvider;
  /**
   * Variable that marks that CI ("true", or any value with `ciVarAnyValue`), the CI's own API URL variable
   * when the CI declares one, and the repository variables.
   */
  ciVar?: string;
  ciVarAnyValue?: boolean;
  ciApiUrlVar?: string;
  ciRepoVars: readonly string[];
  /** Global-config key of a self-hosted API URL, for forges that can be self-hosted. */
  apiUrlKey?: (typeof PUBLISH_URL_KEYS)[number];
  /** An example API URL for the error message of a forge without a public API. */
  apiUrlExample?: string;
  /** The repository from the path of its web URL, when that path is not the repository name itself. */
  repoFromWebPath?: (path: string) => string | undefined;
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
  'bitbucket-dc': {
    kind: 'bitbucket-dc',
    label: 'Bitbucket Data Center',
    requestNoun: 'pull request',
    refSigil: '#',
    tokenVars: ['BITBUCKET_DC_TOKEN'],
    missingToken:
      'Set BITBUCKET_DC_TOKEN to an HTTP access token (personal, project or repository) with repository write permission.',
    // Bamboo and Jenkins expose no common pull request variables: --pr (and --repo, or the remote) name it.
    apiUrlKey: 'bitbucketDcApiUrl',
    apiUrlExample: 'its REST API, e.g. https://bitbucket.example.com/rest/api/1.0',
    ciRepoVars: [],
    repoPattern: /^~?[A-Za-z0-9_.-]{1,128}\/[A-Za-z0-9_.-]{1,128}$/,
    repoHint: 'PROJECT/repo-slug (~user/repo-slug for a personal repository)',
    webHostOfApi: sameHost,
    repoFromWebPath: (path) => {
      const m = /(?:^|\/)(projects|users)\/([^/]+)\/repos\/([^/]+)$/.exec(path);
      if (!m) return undefined;
      return m[1] === 'users' ? `~${m[2]}/${m[3]}` : `${m[2]}/${m[3]}`;
    },
    // Applicable suggestions exist in Data Center 8; through the API they are unconfirmed, so the fix is shown as text.
    suggestionStyle: 'none',
  },
  azure: {
    kind: 'azure',
    label: 'Azure DevOps',
    requestNoun: 'pull request',
    refSigil: '#',
    tokenVars: ['AZURE_DEVOPS_TOKEN', 'SYSTEM_ACCESSTOKEN'],
    missingToken:
      'Set AZURE_DEVOPS_TOKEN to a personal access token with Code (read & write) and Pull Request Threads scopes, or map System.AccessToken into the step as SYSTEM_ACCESSTOKEN in Azure Pipelines.',
    ci: 'azure',
    ciVar: 'TF_BUILD',
    ciVarAnyValue: true,
    // The collection URL, e.g. https://dev.azure.com/fabrikam/ (Azure DevOps Server: https://server/tfs/Collection/).
    ciApiUrlVar: 'SYSTEM_TEAMFOUNDATIONCOLLECTIONURI',
    ciRepoVars: [],
    ciRepo: (env) => {
      const project = env.SYSTEM_TEAMPROJECT?.trim();
      const repo = env.BUILD_REPOSITORY_NAME?.trim();
      return project && repo ? `${project}/${repo}` : undefined;
    },
    apiUrlKey: 'azureApiUrl',
    apiUrlExample: "the organisation's collection URL, e.g. https://dev.azure.com/your-org",
    repoPattern: /^[^/\s][^/]{0,255}\/[^/\s][^/]{0,255}$/,
    repoHint: 'project/repository',
    webHostOfApi: sameHost,
    remoteTarget: azureRemoteTarget,
    // Applicable `suggestion` blocks exist in the UI; through the API they are unconfirmed, so the fix is shown as text.
    suggestionStyle: 'none',
  },
};

/**
 * `https://dev.azure.com/{org}/{project}/_git/{repo}` (or `{org}.visualstudio.com/{project}/_git/{repo}`) → the
 * organisation's API and `project/repo`. Only Microsoft's hosts: a self-hosted server needs `publish.azureApiUrl`.
 */
export function azureRemoteTarget(webUrl: string): { apiUrl: string; repo: string } | undefined {
  let u: URL;
  try {
    u = new URL(webUrl);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const parts = decodeURIComponent(u.pathname)
    .replace(/^\/+|\/+$/g, '')
    .split('/');
  const git = parts.indexOf('_git');
  if (git < 1 || git + 1 >= parts.length) return undefined;
  const repo = parts[git + 1]!.replace(/\.git$/, '');
  if (host === 'dev.azure.com') {
    const org = parts[0];
    const project = parts[git - 1];
    if (!org || !project || git !== 2) return undefined;
    return { apiUrl: `https://dev.azure.com/${encodeURIComponent(org)}`, repo: `${project}/${repo}` };
  }
  const m = /^([a-z0-9-]+)\.visualstudio\.com$/.exec(host);
  if (m) {
    const project = parts[git - 1];
    if (!project) return undefined;
    return { apiUrl: `https://dev.azure.com/${m[1]}`, repo: `${project}/${repo}` };
  }
  return undefined;
}

export const FORGE_LABELS: Record<ForgeKind, string> = Object.fromEntries(
  FORGES.map((k) => [k, FORGE_SPECS[k].label]),
) as Record<ForgeKind, string>;

export function isForgeKind(value: string): value is ForgeKind {
  return (FORGES as readonly string[]).includes(value);
}
