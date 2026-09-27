import { open } from 'node:fs/promises';
import { isValidBranchName } from './repo';

export type CiProvider = 'github' | 'gitlab' | 'azure' | 'bitbucket';

/** The pull/merge request a CI job was started for, as described by the CI's environment. */
export interface CiPullRequest {
  provider: CiProvider;
  /** Human name for explanations, e.g. "GitHub Actions". */
  label: string;
  /** Target branch, without `refs/heads/`. */
  baseBranch: string;
  /** Environment variable that named the target branch. */
  baseVar: string;
  /** Base commit when the CI provides one (GitHub event `base.sha`, GitLab diff base). May be abbreviated. */
  baseSha?: string;
  headBranch?: string;
  headSha?: string;
  /** PR/MR number or id. */
  number?: string;
}

/** Event payloads are small; anything bigger is not a GitHub event file. */
const MAX_EVENT_BYTES = 8 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{7,64}$/i;

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function branchName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.replace(/^refs\/heads\//, '');
  return isValidBranchName(name) ? name : undefined;
}

function sha(raw: unknown): string | undefined {
  return typeof raw === 'string' && SHA_RE.test(raw) ? raw.toLowerCase() : undefined;
}

async function readJson(file: string): Promise<unknown> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size > MAX_EVENT_BYTES) return undefined;
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

interface GithubEvent {
  number?: unknown;
  pull_request?: { number?: unknown; base?: { sha?: unknown }; head?: { sha?: unknown; ref?: unknown } };
}

async function github(env: NodeJS.ProcessEnv): Promise<CiPullRequest | undefined> {
  if (value(env, 'GITHUB_ACTIONS') !== 'true') return undefined;
  // Only set for pull_request / pull_request_target events.
  const baseBranch = branchName(value(env, 'GITHUB_BASE_REF'));
  if (!baseBranch) return undefined;
  const pr: CiPullRequest = {
    provider: 'github',
    label: 'GitHub Actions',
    baseBranch,
    baseVar: 'GITHUB_BASE_REF',
    headBranch: branchName(value(env, 'GITHUB_HEAD_REF')),
  };
  const eventPath = value(env, 'GITHUB_EVENT_PATH');
  if (eventPath) {
    try {
      const event = (await readJson(eventPath)) as GithubEvent | undefined;
      const p = event?.pull_request;
      pr.baseSha = sha(p?.base?.sha);
      pr.headSha = sha(p?.head?.sha);
      const n = p?.number ?? event?.number;
      if (typeof n === 'number' && Number.isInteger(n)) pr.number = String(n);
    } catch {
      // unreadable or malformed event file: the branch name is enough
    }
  }
  return pr;
}

function gitlab(env: NodeJS.ProcessEnv): CiPullRequest | undefined {
  if (value(env, 'GITLAB_CI') !== 'true') return undefined;
  const baseBranch = branchName(value(env, 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME'));
  if (!baseBranch) return undefined;
  return {
    provider: 'gitlab',
    label: 'GitLab CI',
    baseBranch,
    baseVar: 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
    // Already the merge-base of source and target at pipeline creation.
    baseSha: sha(value(env, 'CI_MERGE_REQUEST_DIFF_BASE_SHA')),
    headBranch: branchName(value(env, 'CI_MERGE_REQUEST_SOURCE_BRANCH_NAME')),
    headSha: sha(value(env, 'CI_COMMIT_SHA')),
    number: value(env, 'CI_MERGE_REQUEST_IID'),
  };
}

function azure(env: NodeJS.ProcessEnv): CiPullRequest | undefined {
  if (value(env, 'BUILD_REASON') !== 'PullRequest') return undefined;
  // TARGETBRANCHNAME is newer; TARGETBRANCH is `refs/heads/main` on Azure Repos but `main` for GitHub repos.
  const baseVar = value(env, 'SYSTEM_PULLREQUEST_TARGETBRANCHNAME')
    ? 'SYSTEM_PULLREQUEST_TARGETBRANCHNAME'
    : 'SYSTEM_PULLREQUEST_TARGETBRANCH';
  const baseBranch = branchName(value(env, baseVar));
  if (!baseBranch) return undefined;
  return {
    provider: 'azure',
    label: 'Azure Pipelines',
    baseBranch,
    baseVar,
    headBranch: branchName(value(env, 'SYSTEM_PULLREQUEST_SOURCEBRANCH')),
    headSha: sha(value(env, 'SYSTEM_PULLREQUEST_SOURCECOMMITID')),
    number:
      value(env, 'SYSTEM_PULLREQUEST_PULLREQUESTNUMBER') ?? value(env, 'SYSTEM_PULLREQUEST_PULLREQUESTID'),
  };
}

function bitbucket(env: NodeJS.ProcessEnv): CiPullRequest | undefined {
  const number = value(env, 'BITBUCKET_PR_ID');
  const baseBranch = branchName(value(env, 'BITBUCKET_PR_DESTINATION_BRANCH'));
  if (!number || !baseBranch) return undefined;
  return {
    provider: 'bitbucket',
    label: 'Bitbucket Pipelines',
    baseBranch,
    baseVar: 'BITBUCKET_PR_DESTINATION_BRANCH',
    baseSha: sha(value(env, 'BITBUCKET_PR_DESTINATION_COMMIT')),
    headBranch: branchName(value(env, 'BITBUCKET_BRANCH')),
    headSha: sha(value(env, 'BITBUCKET_COMMIT')),
    number,
  };
}

/**
 * Detects a pull/merge-request CI job (GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket Pipelines)
 * and returns its target branch. Undefined outside CI and for non-PR jobs (pushes, schedules).
 */
export async function detectCiPullRequest(env: NodeJS.ProcessEnv): Promise<CiPullRequest | undefined> {
  return (await github(env)) ?? gitlab(env) ?? azure(env) ?? bitbucket(env);
}
