import type { Logger } from '../util/logger';
import { type ApiClient, ApiError } from './http';
import type { ForgeAdapter, InlineResult } from './plan';
import { extractFingerprints, RESOLVED_MARKER, SUMMARY_MARKER } from './render';
import type { PostedThread } from './resolve';
import { PublishError, type PublishTarget, targetLabel } from './target';

/*
 * GitLab REST API (v4): inline comments are merge request discussions with a text `position` built from the
 * merge request's `diff_refs`; a position GitLab refuses moves the finding to the summary. The summary is a
 * merge request note with a hidden marker, updated in place (PUT) on later runs.
 */

interface GitlabUser {
  id?: number;
  username?: string;
}

interface GitlabNote {
  id?: number;
  body?: string;
  system?: boolean;
  author?: GitlabUser | null;
  resolvable?: boolean;
  resolved?: boolean;
  position?: { new_path?: string; new_line?: number | null; head_sha?: string } | null;
}

interface GitlabDiscussion {
  id?: string;
  notes?: GitlabNote[] | null;
}

/** GitLab discussion ids are hex strings. */
const DISCUSSION_ID_RE = /^[0-9a-f]{8,64}$/i;

interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}

interface GitlabMergeRequest {
  sha?: string;
  diff_refs?: Partial<DiffRefs> | null;
}

const SHA_RE = /^[0-9a-f]{40,64}$/i;

/** Headers for the GitLab API (the token is never logged). */
export function gitlabHeaders(token: string, userAgent: string): Record<string, string> {
  return { accept: 'application/json', 'private-token': token, 'user-agent': userAgent };
}

export function gitlabAdapter(target: PublishTarget, client: ApiClient, logger: Logger): ForgeAdapter {
  const mrPath = `/projects/${encodeURIComponent(target.repo)}/merge_requests/${target.number}`;
  const label = targetLabel(target);
  let selfId: number | undefined;
  let refs: DiffRefs | undefined;
  let discussions: GitlabDiscussion[] = [];

  const isOwn = (note: GitlabNote) => selfId !== undefined && note.author?.id === selfId && !note.system;

  async function whoAmI(): Promise<number> {
    try {
      const res = await client.request<GitlabUser>('GET', '/user');
      if (typeof res.data?.id === 'number') return res.data.id;
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) throw err;
    }
    throw new PublishError(
      'GitLab rejected the token: GITLAB_TOKEN must be a project or group access token (or a personal access token) with the api scope. CI_JOB_TOKEN cannot create merge request discussions.',
    );
  }

  return {
    async load() {
      const mr = await client.request<GitlabMergeRequest>('GET', mrPath);
      const d = mr.data?.diff_refs;
      if (
        d &&
        SHA_RE.test(d.base_sha ?? '') &&
        SHA_RE.test(d.start_sha ?? '') &&
        SHA_RE.test(d.head_sha ?? '')
      ) {
        refs = { base_sha: d.base_sha!, start_sha: d.start_sha!, head_sha: d.head_sha! };
      }
      const headSha = refs?.head_sha ?? mr.data?.sha;
      if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) {
        throw new PublishError(`GitLab did not return the head commit of merge request ${label}.`);
      }
      selfId = await whoAmI();
      discussions = await client.paginate<GitlabDiscussion>(`${mrPath}/discussions`);
      const posted = new Set(
        discussions
          .flatMap((d) => d.notes ?? [])
          .filter(isOwn)
          .flatMap((note) => extractFingerprints(note.body)),
      );
      return { headSha: headSha.toLowerCase(), posted };
    },

    async postInline(comments): Promise<InlineResult> {
      const result: InlineResult = { posted: [], rejected: [] };
      if (!refs) {
        for (const comment of comments)
          result.rejected.push({ comment, reason: 'the merge request has no diff yet' });
        return result;
      }
      for (const c of comments) {
        const { path, oldPath, line, oldLine } = c.anchor;
        try {
          await client.request('POST', `${mrPath}/discussions`, {
            body: c.body,
            position: {
              position_type: 'text',
              ...refs,
              new_path: path,
              old_path: oldPath ?? path,
              new_line: line,
              ...(oldLine !== undefined ? { old_line: oldLine } : {}),
            },
          });
          result.posted.push(c);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status === 401 || err.status === 403) throw err;
          logger.debug(`publish: ${path}:${line}: ${err.message}`);
          result.rejected.push({ comment: c, reason: err.message });
        }
      }
      return result;
    },

    async upsertSummary(body) {
      const notes = await client.paginate<GitlabNote>(`${mrPath}/notes?sort=asc&order_by=created_at`);
      const mine = notes
        .filter(
          (note) => isOwn(note) && typeof note.body === 'string' && note.body.startsWith(SUMMARY_MARKER),
        )
        .at(-1);
      if (mine && Number.isSafeInteger(mine.id)) {
        try {
          await client.request('PUT', `${mrPath}/notes/${mine.id}`, { body });
          return 'updated';
        } catch (err) {
          if (!(err instanceof ApiError) || (err.status !== 403 && err.status !== 404)) throw err;
          logger.debug(`publish: could not update the summary note (${err.message}); creating a new one`);
        }
      }
      await client.request('POST', `${mrPath}/notes`, { body });
      return 'created';
    },

    async openThreads() {
      const out: PostedThread[] = [];
      for (const d of discussions) {
        const first = d.notes?.[0];
        const fingerprint = extractFingerprints(first?.body)[0];
        const pos = first?.position;
        if (!d.id || !DISCUSSION_ID_RE.test(d.id) || !first || !isOwn(first) || !fingerprint) continue;
        if (!first.resolvable || first.resolved || !pos?.new_path || typeof pos.new_line !== 'number')
          continue;
        if (typeof pos.head_sha !== 'string' || !SHA_RE.test(pos.head_sha)) continue;
        // resolved by us before and reopened by someone: their call
        if ((d.notes ?? []).some((note) => isOwn(note) && note.body?.includes(RESOLVED_MARKER))) continue;
        out.push({
          id: d.id,
          fingerprint,
          path: pos.new_path,
          startLine: pos.new_line,
          endLine: pos.new_line,
          commit: pos.head_sha.toLowerCase(),
        });
      }
      return out;
    },

    async resolveThread(thread, body) {
      const path = `${mrPath}/discussions/${encodeURIComponent(thread.id)}`;
      await client.request('POST', `${path}/notes`, { body });
      await client.request('PUT', `${path}?resolved=true`);
    },
  };
}
