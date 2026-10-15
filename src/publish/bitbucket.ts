import type { Logger } from '../util/logger';
import { type ApiClient, ApiError } from './http';
import type { ForgeAdapter, InlineResult } from './plan';
import { extractFingerprints, SUMMARY_MARKER } from './render';
import type { PostedThread } from './resolve';
import { PublishError, type PublishTarget, targetLabel } from './target';

/*
 * Bitbucket Cloud REST API (2.0): inline comments are pull request comments with an `inline` anchor on a
 * new-side line (`to`); one request per comment. The summary is a pull request comment without an anchor,
 * carrying the hidden marker and updated in place (PUT) on later runs. Lists are paginated with a `next`
 * URL in the body. The API gives the pull request head as a short hash, and offers no way to anchor a
 * comment to a commit, so fixed findings are only listed in the summary.
 *
 * Authentication: an API token with the account's e-mail (Basic) or a repository / workspace access token
 * (Bearer). App passwords stopped working in June 2026.
 */

interface BitbucketUser {
  uuid?: string;
  account_id?: string;
}

interface BitbucketComment {
  id?: number;
  content?: { raw?: string } | null;
  user?: BitbucketUser | null;
  inline?: { path?: string; to?: number | null; from?: number | null } | null;
  deleted?: boolean;
}

interface BitbucketPull {
  source?: { commit?: { hash?: string } | null } | null;
}

const SHORT_SHA_RE = /^[0-9a-f]{7,64}$/i;

/** Headers for the Bitbucket Cloud API (the token is never logged). */
export function bitbucketHeaders(
  token: string,
  userAgent: string,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const email = env.BITBUCKET_EMAIL?.trim();
  // An API token authenticates as the account (Basic with its e-mail); access tokens are bearer tokens.
  const authorization = email
    ? `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`
    : `Bearer ${token}`;
  return { accept: 'application/json', authorization, 'user-agent': userAgent };
}

export function bitbucketAdapter(target: PublishTarget, client: ApiClient, logger: Logger): ForgeAdapter {
  const [workspace = '', slug = ''] = target.repo.split('/');
  const prPath = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/pullrequests/${target.number}`;
  const label = targetLabel(target);
  let self: BitbucketUser | undefined;

  // Only our own comments count (de-duplication, summary updates): anyone can paste a marker into theirs.
  const isOwn = (user: BitbucketUser | null | undefined) =>
    self !== undefined &&
    ((self.uuid !== undefined && user?.uuid === self.uuid) ||
      (self.account_id !== undefined && user?.account_id === self.account_id));

  async function whoAmI(): Promise<BitbucketUser> {
    try {
      const res = await client.request<BitbucketUser>('GET', '/user');
      if (typeof res.data?.uuid === 'string' || typeof res.data?.account_id === 'string') return res.data;
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) throw err;
    }
    throw new PublishError(
      'Bitbucket rejected the token: set BITBUCKET_TOKEN to an API token (with BITBUCKET_EMAIL, the account e-mail) or to a repository / workspace access token with pull request write permission.',
    );
  }

  const comments = () => client.paginate<BitbucketComment>(`${prPath}/comments`);
  const body = (c: BitbucketComment) => (typeof c.content?.raw === 'string' ? c.content.raw : undefined);
  const mySummary = (list: BitbucketComment[]) =>
    list
      .filter((c) => !c.deleted && !c.inline && isOwn(c.user) && body(c)?.startsWith(SUMMARY_MARKER))
      .at(-1);

  return {
    async load() {
      // The identity first: a rejected token must say so instead of surfacing a 401 from the pull request.
      self = await whoAmI();
      const pr = await client.request<BitbucketPull>('GET', prPath);
      const headSha = pr.data?.source?.commit?.hash;
      if (typeof headSha !== 'string' || !SHORT_SHA_RE.test(headSha)) {
        throw new PublishError(`Bitbucket did not return the head commit of pull request ${label}.`);
      }
      const list = await comments();
      const posted = new Set(
        list
          .filter((c) => !c.deleted && c.inline && isOwn(c.user))
          .flatMap((c) => extractFingerprints(body(c))),
      );
      const summary = body(mySummary(list) ?? {});
      return { headSha: headSha.toLowerCase(), posted, ...(typeof summary === 'string' ? { summary } : {}) };
    },

    async postInline(list): Promise<InlineResult> {
      const result: InlineResult = { posted: [], rejected: [] };
      for (const c of list) {
        try {
          await client.request('POST', `${prPath}/comments`, {
            content: { raw: c.body },
            inline: { path: c.anchor.path, to: c.anchor.endLine },
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

    async upsertSummary(text) {
      const mine = mySummary(await comments());
      if (mine && Number.isSafeInteger(mine.id)) {
        try {
          await client.request('PUT', `${prPath}/comments/${mine.id}`, { content: { raw: text } });
          return 'updated';
        } catch (err) {
          if (!(err instanceof ApiError) || (err.status !== 403 && err.status !== 404)) throw err;
          logger.debug(`publish: could not update the summary comment (${err.message}); creating a new one`);
        }
      }
      await client.request('POST', `${prPath}/comments`, { content: { raw: text } });
      return 'created';
    },

    // A Bitbucket comment records no commit, so where its lines ended up cannot be told: nothing to resolve.
    async openThreads(): Promise<PostedThread[]> {
      return [];
    },

    async resolveThread() {
      throw new ApiError(
        'Bitbucket comments are not anchored to a commit; fixed findings are listed in the summary',
        0,
      );
    },
  };
}
