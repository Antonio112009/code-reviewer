import type { Logger } from '../util/logger';
import { type ApiClient, ApiError } from './http';
import type { ForgeAdapter, InlineComment, InlineResult } from './plan';
import { extractFingerprints, RESOLVED_MARKER, renderReviewBody, SUMMARY_MARKER } from './render';
import type { PostedThread } from './resolve';
import { PublishError, type PublishTarget, targetLabel } from './target';

/*
 * GitHub REST API: one review (`event: COMMENT`) carries the inline comments; if GitHub rejects it (422, e.g.
 * a line outside its diff), the comments are posted one by one and the refused ones move to the summary.
 * The summary is an issue comment with a hidden marker, updated in place on later runs.
 */

interface GithubUser {
  login?: string;
  type?: string;
}

interface GithubComment {
  id?: number;
  body?: string;
  user?: GithubUser | null;
}

interface GithubPull {
  head?: { sha?: string };
}

interface ThreadNode {
  id?: string;
  isResolved?: boolean;
  path?: string;
  originalLine?: number | null;
  originalStartLine?: number | null;
  comments?: {
    nodes?: Array<{
      databaseId?: number;
      body?: string;
      author?: { login?: string; __typename?: string } | null;
      originalCommit?: { oid?: string } | null;
    } | null>;
  };
}

interface ThreadsPage {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: Array<ThreadNode | null>;
        };
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved path originalLine originalStartLine
          comments(first: 30) { nodes { databaseId body author { login __typename } originalCommit { oid } } }
        }
      }
    }
  }
}`;
const RESOLVE_MUTATION = `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`;
const MAX_THREAD_PAGES = 10;

/** The GraphQL endpoint next to a REST API URL (github.com: /graphql; Enterprise Server: /api/graphql). */
export function githubGraphqlUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, '');
  return /\/api\/v3$/i.test(base) ? base.replace(/\/v3$/i, '/graphql') : `${base}/graphql`;
}

/** Headers for the GitHub API (the token is never logged). */
export function githubHeaders(token: string, userAgent: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': userAgent,
  };
}

export function githubAdapter(target: PublishTarget, client: ApiClient, logger: Logger): ForgeAdapter {
  const [owner = '', name = ''] = target.repo.split('/');
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const n = target.number;
  const label = targetLabel(target);
  /** Login of the token's user; undefined for the Actions token (`GET /user` is not allowed for it). */
  let self: string | undefined;

  // Only our own comments count (de-duplication, summary updates): anyone can paste a marker into theirs.
  // Without a known login (GITHUB_TOKEN of Actions, a GitHub App), comments by bot accounts count.
  const isOwn = (user: GithubUser | null | undefined) => (self ? user?.login === self : user?.type === 'Bot');
  // GraphQL names the Actions bot `github-actions` (REST: `github-actions[bot]`) and types it as a Bot.
  const isOwnAuthor = (author: { login?: string; __typename?: string } | null | undefined) =>
    self ? author?.login === self : author?.__typename === 'Bot';
  const graphqlUrl = githubGraphqlUrl(target.apiUrl);

  async function graphql<T extends { errors?: Array<{ message?: string }> }>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const res = await client.request<T>('POST', graphqlUrl, { query, variables });
    const error = res.data?.errors?.[0]?.message;
    if (error) throw new ApiError(`GitHub GraphQL: ${error.slice(0, 300)}`, res.status);
    return res.data;
  }

  async function whoAmI(): Promise<string | undefined> {
    try {
      const res = await client.request<GithubUser>('GET', '/user');
      return typeof res.data?.login === 'string' ? res.data.login : undefined;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw new PublishError('GitHub rejected the token (401): check GITHUB_TOKEN / GH_TOKEN.');
      }
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return undefined;
      throw err;
    }
  }

  function toApi(c: InlineComment): Record<string, unknown> {
    const { path, startLine, endLine } = c.anchor;
    return {
      path,
      body: c.body,
      side: 'RIGHT',
      line: endLine,
      ...(startLine < endLine ? { start_line: startLine, start_side: 'RIGHT' } : {}),
    };
  }

  return {
    async load() {
      const pr = await client.request<GithubPull>('GET', `${repoPath}/pulls/${n}`);
      const headSha = pr.data?.head?.sha;
      if (typeof headSha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(headSha)) {
        throw new PublishError(`GitHub did not return the head commit of pull request ${label}.`);
      }
      self = await whoAmI();
      logger.debug(`publish: GitHub user ${self ?? '(unknown: bot comments count as ours)'}`);
      const comments = await client.paginate<GithubComment>(`${repoPath}/pulls/${n}/comments`);
      const posted = new Set(
        comments.filter((c) => isOwn(c.user)).flatMap((c) => extractFingerprints(c.body)),
      );
      return { headSha: headSha.toLowerCase(), posted };
    },

    async postInline(comments, commitSha): Promise<InlineResult> {
      try {
        await client.request('POST', `${repoPath}/pulls/${n}/reviews`, {
          commit_id: commitSha,
          event: 'COMMENT',
          body: renderReviewBody(comments.length),
          comments: comments.map(toApi),
        });
        return { posted: comments, rejected: [] };
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 422) throw err;
        logger.debug(`publish: GitHub refused the review (${err.message}); posting the comments one by one`);
      }
      const result: InlineResult = { posted: [], rejected: [] };
      for (const c of comments) {
        try {
          await client.request('POST', `${repoPath}/pulls/${n}/comments`, {
            commit_id: commitSha,
            ...toApi(c),
          });
          result.posted.push(c);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status === 401 || err.status === 403) throw err;
          logger.debug(`publish: ${c.anchor.path}:${c.anchor.endLine}: ${err.message}`);
          result.rejected.push({ comment: c, reason: err.message });
        }
      }
      return result;
    },

    async upsertSummary(body) {
      const comments = await client.paginate<GithubComment>(`${repoPath}/issues/${n}/comments`);
      const mine = comments
        .filter((c) => isOwn(c.user) && typeof c.body === 'string' && c.body.startsWith(SUMMARY_MARKER))
        .at(-1);
      if (mine && Number.isSafeInteger(mine.id)) {
        try {
          await client.request('PATCH', `${repoPath}/issues/comments/${mine.id}`, { body });
          return 'updated';
        } catch (err) {
          if (!(err instanceof ApiError) || (err.status !== 403 && err.status !== 404)) throw err;
          logger.debug(`publish: could not update the summary comment (${err.message}); creating a new one`);
        }
      }
      await client.request('POST', `${repoPath}/issues/${n}/comments`, { body });
      return 'created';
    },

    async openThreads() {
      const out: PostedThread[] = [];
      let after: string | null = null;
      for (let page = 0; page < MAX_THREAD_PAGES; page++) {
        const data: ThreadsPage = await graphql<ThreadsPage>(THREADS_QUERY, {
          owner,
          name,
          number: n,
          after,
        });
        const threads = data.data?.repository?.pullRequest?.reviewThreads;
        for (const t of threads?.nodes ?? []) {
          const first = t?.comments?.nodes?.[0];
          const fingerprint = extractFingerprints(first?.body)[0];
          const commit = first?.originalCommit?.oid;
          const end = t?.originalLine;
          if (!t?.id || t.isResolved || !first || !isOwnAuthor(first.author) || !fingerprint) continue;
          // resolved by us before and reopened by someone: their call
          const reopened = t.comments?.nodes?.some(
            (c) =>
              c && isOwnAuthor(c.author) && typeof c.body === 'string' && c.body.includes(RESOLVED_MARKER),
          );
          if (reopened) continue;
          if (!t.path || typeof commit !== 'string' || typeof end !== 'number') continue;
          out.push({
            id: t.id,
            ...(Number.isSafeInteger(first.databaseId) ? { commentId: first.databaseId } : {}),
            fingerprint,
            path: t.path,
            startLine: typeof t.originalStartLine === 'number' ? t.originalStartLine : end,
            endLine: end,
            commit: commit.toLowerCase(),
          });
        }
        if (!threads?.pageInfo?.hasNextPage || !threads.pageInfo.endCursor) break;
        after = threads.pageInfo.endCursor;
      }
      return out;
    },

    async resolveThread(thread, body) {
      if (thread.commentId !== undefined) {
        await client.request('POST', `${repoPath}/pulls/${n}/comments/${thread.commentId}/replies`, { body });
      }
      await graphql(RESOLVE_MUTATION, { id: thread.id });
    },
  };
}
