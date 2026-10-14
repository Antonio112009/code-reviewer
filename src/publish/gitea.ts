import type { Logger } from '../util/logger';
import { type ApiClient, ApiError } from './http';
import type { ForgeAdapter, InlineComment, InlineResult } from './plan';
import { extractFingerprints, renderReviewBody, SUMMARY_MARKER } from './render';
import type { PostedThread } from './resolve';
import { PublishError, type PublishTarget, targetLabel } from './target';

/*
 * Gitea / Forgejo / Codeberg REST API (v1), a close cousin of GitHub's: one review (`event: COMMENT`) carries
 * the inline comments, each on a new-side line (`new_position`); a review the server refuses is retried
 * comment by comment, and the refused ones move to the summary. The summary is an issue comment with a
 * hidden marker, updated in place on later runs. The API has no way to resolve a review thread, so fixed
 * findings are only listed in the summary.
 */

interface GiteaUser {
  id?: number;
  login?: string;
}

interface GiteaComment {
  id?: number;
  body?: string;
  user?: GiteaUser | null;
}

interface GiteaReview {
  id?: number;
  user?: GiteaUser | null;
}

interface GiteaPull {
  head?: { sha?: string };
}

const SHA_RE = /^[0-9a-f]{40,64}$/i;
/** Reviews read per pull request at most: each one costs a request for its comments. */
const MAX_REVIEWS = 200;

/** Headers for the Gitea API (the token is never logged). */
export function giteaHeaders(token: string, userAgent: string): Record<string, string> {
  return { accept: 'application/json', authorization: `token ${token}`, 'user-agent': userAgent };
}

export function giteaAdapter(target: PublishTarget, client: ApiClient, logger: Logger): ForgeAdapter {
  const [owner = '', name = ''] = target.repo.split('/');
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const n = target.number;
  const label = targetLabel(target);
  let selfId: number | undefined;

  // Only our own comments count (de-duplication, summary updates): anyone can paste a marker into theirs.
  const isOwn = (user: GiteaUser | null | undefined) => selfId !== undefined && user?.id === selfId;

  async function whoAmI(): Promise<number> {
    try {
      const res = await client.request<GiteaUser>('GET', '/user');
      if (typeof res.data?.id === 'number') return res.data.id;
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) throw err;
    }
    throw new PublishError(
      'Gitea rejected the token: GITEA_TOKEN must be an access token with write access to the repository (issue and pull request scopes).',
    );
  }

  function toApi(c: InlineComment): Record<string, unknown> {
    // Gitea anchors a review comment on one line: the end of the range (GitHub's `line`).
    return { path: c.anchor.path, body: c.body, new_position: c.anchor.endLine, old_position: 0 };
  }

  return {
    async load() {
      const pr = await client.request<GiteaPull>('GET', `${repoPath}/pulls/${n}`);
      const headSha = pr.data?.head?.sha;
      if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) {
        throw new PublishError(`Gitea did not return the head commit of pull request ${label}.`);
      }
      selfId = await whoAmI();
      const posted = new Set<string>();
      const reviews = (await client.paginate<GiteaReview>(`${repoPath}/pulls/${n}/reviews`)).slice(
        0,
        MAX_REVIEWS,
      );
      for (const review of reviews) {
        if (!Number.isSafeInteger(review.id) || !isOwn(review.user)) continue;
        const comments = await client.paginate<GiteaComment>(
          `${repoPath}/pulls/${n}/reviews/${review.id}/comments`,
        );
        for (const c of comments)
          if (isOwn(c.user)) for (const fp of extractFingerprints(c.body)) posted.add(fp);
      }
      const summary = (await client.paginate<GiteaComment>(`${repoPath}/issues/${n}/comments`))
        .filter((c) => isOwn(c.user) && typeof c.body === 'string' && c.body.startsWith(SUMMARY_MARKER))
        .at(-1)?.body;
      return { headSha: headSha.toLowerCase(), posted, ...(typeof summary === 'string' ? { summary } : {}) };
    },

    async postInline(comments, commitSha): Promise<InlineResult> {
      const review = (list: InlineComment[]) =>
        client.request('POST', `${repoPath}/pulls/${n}/reviews`, {
          commit_id: commitSha,
          event: 'COMMENT',
          body: renderReviewBody(list.length),
          comments: list.map(toApi),
        });
      try {
        await review(comments);
        return { posted: [...comments], rejected: [] };
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 401 || err.status === 403) throw err;
        logger.debug(`publish: the review was refused (${err.message}); posting the comments one by one`);
      }
      const result: InlineResult = { posted: [], rejected: [] };
      for (const c of comments) {
        try {
          await review([c]);
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
      const comments = await client.paginate<GiteaComment>(`${repoPath}/issues/${n}/comments`);
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

    // The Gitea API cannot resolve a review thread: nothing to offer, so fixed findings stay in the summary.
    async openThreads(): Promise<PostedThread[]> {
      return [];
    },

    async resolveThread() {
      throw new ApiError('the Gitea API cannot resolve review threads', 0);
    },
  };
}
