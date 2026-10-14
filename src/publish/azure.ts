import type { Logger } from '../util/logger';
import { type ApiClient, ApiError } from './http';
import type { ForgeAdapter, InlineComment, InlineResult } from './plan';
import { extractFingerprints, RESOLVED_MARKER, SUMMARY_MARKER } from './render';
import type { PostedThread } from './resolve';
import { PublishError, type PublishTarget, targetLabel } from './target';

/*
 * Azure DevOps (Azure Repos) REST API, version 7.1 (Azure DevOps Server from 2019 answers it too): one
 * "thread" endpoint carries everything. An inline comment is a thread with a `threadContext` on new-side
 * lines; the summary is a thread without one, whose first comment is updated in place (PATCH) on later runs.
 * The API base is the organisation's collection URL (`https://dev.azure.com/{org}`); the repository is
 * `project/repository`. Lists come back as `{ count, value }`, unpaginated.
 *
 * Authentication: a personal access token (Basic with an empty user) or Azure Pipelines' `System.AccessToken`
 * (bearer). A thread records no commit, so fixed findings are only listed in the summary.
 */

interface AzureIdentity {
  id?: string;
}

interface AzureComment {
  id?: number;
  content?: string;
  author?: AzureIdentity | null;
  isDeleted?: boolean;
}

interface AzureThread {
  id?: number;
  status?: string;
  isDeleted?: boolean;
  comments?: AzureComment[] | null;
  threadContext?: {
    filePath?: string;
    rightFileStart?: { line?: number } | null;
    rightFileEnd?: { line?: number } | null;
  } | null;
}

interface AzurePull {
  lastMergeSourceCommit?: { commitId?: string } | null;
}

interface AzureConnection {
  authenticatedUser?: AzureIdentity | null;
}

const API_VERSION = 'api-version=7.1';
const SHA_RE = /^[0-9a-f]{40,64}$/i;

/** Headers for the Azure DevOps API (the token is never logged): a PAT is Basic, System.AccessToken is bearer. */
export function azureHeaders(
  token: string,
  userAgent: string,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const authorization =
    env.SYSTEM_ACCESSTOKEN?.trim() === token
      ? `Bearer ${token}`
      : `Basic ${Buffer.from(`:${token}`, 'utf8').toString('base64')}`;
  return { accept: 'application/json', authorization, 'user-agent': userAgent };
}

export function azureAdapter(target: PublishTarget, client: ApiClient, logger: Logger): ForgeAdapter {
  const [project = '', repository = ''] = target.repo.split('/');
  const prPath = `/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository)}/pullRequests/${target.number}`;
  const threadsPath = `${prPath}/threads`;
  const label = targetLabel(target);
  let selfId: string | undefined;

  // Only our own threads count (de-duplication, summary updates): anyone can paste a marker into theirs.
  const isOwn = (c: AzureComment | undefined) => selfId !== undefined && c?.author?.id === selfId;
  const first = (t: AzureThread) => (t.comments ?? []).find((c) => !c.isDeleted);
  const mySummary = (threads: AzureThread[]) =>
    threads
      .filter(
        (t) =>
          !t.isDeleted &&
          !t.threadContext?.filePath &&
          isOwn(first(t)) &&
          first(t)?.content?.startsWith(SUMMARY_MARKER),
      )
      .at(-1);

  async function whoAmI(): Promise<string> {
    try {
      const res = await client.request<AzureConnection>(
        'GET',
        `/_apis/connectionData?${API_VERSION}-preview`,
      );
      const id = res.data?.authenticatedUser?.id;
      if (typeof id === 'string' && id) return id;
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403 && err.status !== 203))
        throw err;
    }
    throw new PublishError(
      'Azure DevOps rejected the token: set AZURE_DEVOPS_TOKEN to a personal access token with Code (read & write) and Pull Request Threads scopes, or map System.AccessToken into the step as SYSTEM_ACCESSTOKEN in Azure Pipelines.',
    );
  }

  const threads = () => client.paginate<AzureThread>(`${threadsPath}?${API_VERSION}`);

  function inlineBody(c: InlineComment): Record<string, unknown> {
    return {
      status: 'active',
      comments: [{ parentCommentId: 0, content: c.body, commentType: 'text' }],
      threadContext: {
        filePath: `/${c.anchor.path}`,
        rightFileStart: { line: c.anchor.startLine, offset: 1 },
        rightFileEnd: { line: c.anchor.endLine, offset: 1 },
      },
    };
  }

  return {
    async load() {
      const pr = await client.request<AzurePull>('GET', `${prPath}?${API_VERSION}`);
      const headSha = pr.data?.lastMergeSourceCommit?.commitId;
      if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) {
        throw new PublishError(`Azure DevOps did not return the source commit of pull request ${label}.`);
      }
      selfId = await whoAmI();
      const all = await threads();
      const posted = new Set(
        all
          .filter((t) => !t.isDeleted && t.threadContext?.filePath && isOwn(first(t)))
          .flatMap((t) => extractFingerprints(first(t)?.content)),
      );
      const summary = first(mySummary(all) ?? {})?.content;
      return { headSha: headSha.toLowerCase(), posted, ...(typeof summary === 'string' ? { summary } : {}) };
    },

    async postInline(comments): Promise<InlineResult> {
      const result: InlineResult = { posted: [], rejected: [] };
      for (const c of comments) {
        try {
          await client.request('POST', `${threadsPath}?${API_VERSION}`, inlineBody(c));
          result.posted.push(c);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status === 401 || err.status === 403) throw err;
          logger.debug(`publish: ${c.anchor.path}:${c.anchor.startLine}: ${err.message}`);
          result.rejected.push({ comment: c, reason: err.message });
        }
      }
      return result;
    },

    async upsertSummary(body) {
      const mine = mySummary(await threads());
      const comment = mine ? first(mine) : undefined;
      if (mine && Number.isSafeInteger(mine.id) && comment && Number.isSafeInteger(comment.id)) {
        try {
          await client.request('PATCH', `${threadsPath}/${mine.id}/comments/${comment.id}?${API_VERSION}`, {
            content: body,
          });
          return 'updated';
        } catch (err) {
          if (!(err instanceof ApiError) || (err.status !== 403 && err.status !== 404)) throw err;
          logger.debug(`publish: could not update the summary thread (${err.message}); creating a new one`);
        }
      }
      await client.request('POST', `${threadsPath}?${API_VERSION}`, {
        status: 'closed',
        comments: [{ parentCommentId: 0, content: body, commentType: 'text' }],
      });
      return 'created';
    },

    // A thread records no commit, so where its lines ended up cannot be told: nothing to resolve.
    async openThreads(): Promise<PostedThread[]> {
      return [];
    },

    async resolveThread() {
      throw new ApiError(
        `Azure DevOps threads are not anchored to a commit (${RESOLVED_MARKER} unused); fixed findings are listed in the summary`,
        0,
      );
    },
  };
}
