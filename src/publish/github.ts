import type { Logger } from '../util/logger';
import { type ApiClient, ApiError } from './http';
import type { ForgeAdapter, InlineComment, InlineResult } from './plan';
import { extractFingerprints, renderReviewBody, SUMMARY_MARKER } from './render';
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
  };
}
