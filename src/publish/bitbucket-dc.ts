import type { Logger } from '../util/logger';
import { type ApiClient, ApiError } from './http';
import type { ForgeAdapter, InlineComment, InlineResult } from './plan';
import { extractFingerprints, SUMMARY_MARKER } from './render';
import type { PostedThread } from './resolve';
import { PublishError, type PublishTarget, targetLabel } from './target';

/*
 * Bitbucket Data Center REST API (1.0; Bitbucket Server too): inline comments are pull request comments
 * with an `anchor` on a line of the new side (`fileType: TO`, `lineType: ADDED` or `CONTEXT`); one request
 * per comment. The summary is a comment without an anchor, carrying the hidden marker and updated in place
 * (PUT with the comment's `version`). Comments are read from the pull request's activities, paged with
 * `start` / `isLastPage` / `nextPageStart`.
 *
 * The authenticated user comes from the `X-AUSERNAME` header Data Center sets on every response, or from
 * BITBUCKET_DC_USERNAME. Fixed findings are only listed in the summary, as on Bitbucket Cloud.
 *
 * Authentication: an HTTP access token (personal, project or repository) as a bearer token.
 */

interface DcUser {
  name?: string;
  slug?: string;
}

interface DcComment {
  id?: number;
  version?: number;
  text?: string;
  author?: DcUser | null;
}

interface DcActivity {
  action?: string;
  commentAction?: string;
  comment?: DcComment | null;
  commentAnchor?: { path?: string; line?: number } | null;
}

interface DcPull {
  fromRef?: { latestCommit?: string } | null;
}

const SHA_RE = /^[0-9a-f]{40,64}$/i;
const USERNAME_RE = /^[^\s/]{1,255}$/;

/** Headers for the Bitbucket Data Center API (the token is never logged). */
export function bitbucketDcHeaders(token: string, userAgent: string): Record<string, string> {
  return { accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': userAgent };
}

export function bitbucketDcAdapter(
  target: PublishTarget,
  client: ApiClient,
  logger: Logger,
  env: NodeJS.ProcessEnv = {},
): ForgeAdapter {
  const [project = '', slug = ''] = target.repo.split('/');
  // Personal repositories live under `~user`; the REST path keeps the tilde.
  const prPath = `/projects/${encodeURIComponent(project).replace(/^%7E/i, '~')}/repos/${encodeURIComponent(slug)}/pull-requests/${target.number}`;
  const label = targetLabel(target);
  let self: string | undefined;

  // Only our own comments count (de-duplication, summary updates): anyone can paste a marker into theirs.
  const isOwn = (user: DcUser | null | undefined) =>
    self !== undefined && (user?.name?.toLowerCase() === self || user?.slug?.toLowerCase() === self);

  const rejected = () =>
    new PublishError(
      'Bitbucket Data Center rejected the token: set BITBUCKET_DC_TOKEN to an HTTP access token (personal, project or repository) with repository write permission.',
    );

  async function whoAmI(): Promise<string> {
    let header: string | null = null;
    try {
      // Answers anyone; Data Center names the authenticated user in X-AUSERNAME on every response.
      const res = await client.request<unknown>('GET', '/application-properties');
      header = res.headers.get('x-ausername');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) throw rejected();
      throw err;
    }
    const configured = env.BITBUCKET_DC_USERNAME?.trim();
    const name = header?.trim() || configured;
    if (name && USERNAME_RE.test(name)) return name.toLowerCase();
    throw new PublishError(
      'Bitbucket Data Center did not say who the token belongs to (no X-AUSERNAME header): check BITBUCKET_DC_TOKEN, or set BITBUCKET_DC_USERNAME to the user (or token bot user) that posts the comments.',
    );
  }

  /** Our comments, newest first, without deleted ones; inline ones carry their anchor. */
  async function myComments(): Promise<Array<{ comment: DcComment; inline: boolean }>> {
    const activities = await client.paginate<DcActivity>(`${prPath}/activities?fromType=COMMENT`);
    const deleted = new Set<number>();
    const seen = new Map<number, { comment: DcComment; inline: boolean }>();
    // Activities come newest first: the first one of a comment holds its latest text.
    for (const a of activities) {
      const c = a.comment;
      if (a.action !== 'COMMENTED' || !c || !Number.isSafeInteger(c.id)) continue;
      if (a.commentAction === 'DELETED') deleted.add(c.id!);
      else if (!seen.has(c.id!)) seen.set(c.id!, { comment: c, inline: !!a.commentAnchor });
    }
    return [...seen.entries()]
      .filter(([id, v]) => !deleted.has(id) && isOwn(v.comment.author))
      .sort(([a], [b]) => b - a)
      .map(([, v]) => v);
  }

  const isSummary = (c: DcComment) => typeof c.text === 'string' && c.text.startsWith(SUMMARY_MARKER);

  /** The comment as it is now (text and version), or undefined when it is gone. */
  async function current(id: number): Promise<DcComment | undefined> {
    try {
      return (await client.request<DcComment>('GET', `${prPath}/comments/${id}`)).data ?? undefined;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return undefined;
      throw err;
    }
  }

  function toApi(c: InlineComment): Record<string, unknown> {
    // The line type must match the line: a context line of the diff is CONTEXT, an added one ADDED.
    const lineType = c.anchor.oldLine !== undefined ? 'CONTEXT' : 'ADDED';
    return { text: c.body, anchor: { path: c.anchor.path, line: c.anchor.line, lineType, fileType: 'TO' } };
  }

  return {
    async load() {
      // The identity first: a rejected token must say so instead of surfacing a 401 from the pull request.
      self = await whoAmI();
      const pr = await client.request<DcPull>('GET', prPath);
      const headSha = pr.data?.fromRef?.latestCommit;
      if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) {
        throw new PublishError(
          `Bitbucket Data Center did not return the head commit of pull request ${label}.`,
        );
      }
      const mine = await myComments();
      const posted = new Set(
        mine.filter((m) => m.inline).flatMap((m) => extractFingerprints(m.comment.text)),
      );
      const found = mine.find((m) => !m.inline && isSummary(m.comment));
      const summary = found ? (await current(found.comment.id!))?.text : undefined;
      return { headSha: headSha.toLowerCase(), posted, ...(typeof summary === 'string' ? { summary } : {}) };
    },

    async postInline(list): Promise<InlineResult> {
      const result: InlineResult = { posted: [], rejected: [] };
      for (const c of list) {
        try {
          await client.request('POST', `${prPath}/comments`, toApi(c));
          result.posted.push(c);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status === 401 || err.status === 403) throw err;
          logger.debug(`publish: ${c.anchor.path}:${c.anchor.line}: ${err.message}`);
          result.rejected.push({ comment: c, reason: err.message });
        }
      }
      return result;
    },

    async upsertSummary(text) {
      const found = (await myComments()).find((m) => !m.inline && isSummary(m.comment));
      if (found) {
        // The version guards against concurrent edits: read it fresh, and once more after a conflict.
        for (let attempt = 0; attempt < 2; attempt++) {
          const now = await current(found.comment.id!);
          if (!now || !Number.isSafeInteger(now.version)) break;
          try {
            await client.request('PUT', `${prPath}/comments/${found.comment.id}`, {
              text,
              version: now.version,
            });
            return 'updated';
          } catch (err) {
            if (!(err instanceof ApiError) || ![403, 404, 409].includes(err.status)) throw err;
            logger.debug(`publish: could not update the summary comment (${err.message})`);
            if (err.status !== 409) break;
          }
        }
      }
      await client.request('POST', `${prPath}/comments`, { text });
      return 'created';
    },

    // Fixed findings are listed in the summary; the comments are left as they are.
    async openThreads(): Promise<PostedThread[]> {
      return [];
    },

    async resolveThread() {
      throw new ApiError(
        'Bitbucket Data Center comments are not resolved by this tool; fixed findings are listed in the summary',
        0,
      );
    },
  };
}
