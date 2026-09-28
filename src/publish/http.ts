import { setTimeout as delay } from 'node:timers/promises';
import { clipText, stripUnsafeChars } from '../report/common';
import type { Logger } from '../util/logger';
import { PublishError } from './target';

/** `fetch` as used here; injectable for tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** Waits `ms` unless `signal` aborts first; injectable for tests. */
export type SleepLike = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface ApiClientOptions {
  /** API base, e.g. https://api.github.com. Every request (pagination links too) must stay on its origin. */
  baseUrl: string;
  /** Sent with every request (authentication included); never logged. */
  headers: Record<string, string>;
  fetch?: FetchLike;
  sleep?: SleepLike;
  /** The run's abort signal (Ctrl+C). */
  signal?: AbortSignal;
  /** Per request (default 30 s). */
  timeoutMs?: number;
  /** Attempts per request for 429 / 5xx / network errors (default 3). */
  maxAttempts?: number;
  /** A `Retry-After` longer than this fails the request instead of waiting (default 60 s). */
  maxRetryWaitMs?: number;
  /** Pages read by {@link ApiClient.paginate} at most (default 50). */
  maxPages?: number;
  logger?: Logger;
}

export class ApiError extends PublishError {
  constructor(
    message: string,
    /** HTTP status, 0 for network errors. */
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_MAX_RETRY_WAIT_MS = 60_000;
const DEFAULT_MAX_PAGES = 50;
const PAGE_SIZE = 100;

const defaultSleep: SleepLike = async (ms, signal) => {
  await delay(ms, undefined, { signal });
};

function isRetryable(res: Response): boolean {
  if (res.status === 429 || (res.status >= 500 && res.status <= 599)) return true;
  // GitHub's secondary rate limit answers 403 with Retry-After or an exhausted quota.
  return (
    res.status === 403 && (res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0')
  );
}

/** Milliseconds a response asks to wait (`Retry-After` seconds or date, GitHub's rate-limit reset), if any. */
export function retryAfterMs(res: Response, now = Date.now()): number | undefined {
  const header = res.headers.get('retry-after')?.trim();
  if (header) {
    if (/^\d+$/.test(header)) return Number(header) * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const reset = res.headers.get('x-ratelimit-reset');
  if (res.headers.get('x-ratelimit-remaining') === '0' && reset && /^\d+$/.test(reset)) {
    return Math.max(0, Number(reset) * 1000 - now);
  }
  return undefined;
}

/** The `rel="next"` URL of a `Link` header. */
export function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const m = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (m && /;\s*rel="?next"?(?:\s|;|$)/i.test(m[2]!)) return m[1];
  }
  return undefined;
}

/** A forge's error body (`message`, `error`, GitHub's `errors[]`) as one clipped line. */
function errorDetail(data: unknown): string {
  if (typeof data === 'string') return clipText(stripUnsafeChars(data).replace(/\s+/g, ' ').trim(), 300);
  if (!data || typeof data !== 'object') return '';
  const d = data as { message?: unknown; error?: unknown; errors?: unknown };
  const parts: string[] = [];
  const message = d.message ?? d.error;
  if (typeof message === 'string') parts.push(message);
  else if (message && typeof message === 'object') parts.push(JSON.stringify(message));
  if (Array.isArray(d.errors)) {
    for (const e of d.errors.slice(0, 3)) {
      parts.push(typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : JSON.stringify(e));
    }
  }
  return clipText(stripUnsafeChars(parts.join('; ')).replace(/\s+/g, ' ').trim(), 300);
}

/**
 * Minimal JSON client for the GitHub / GitLab REST APIs: per-request timeouts plus the run's abort signal,
 * retries of 429 / 5xx / network errors with backoff that honours `Retry-After`, `Link` pagination, and no
 * redirects or cross-origin URLs (the authentication headers must only ever reach `baseUrl`).
 */
export class ApiClient {
  private readonly origin: string;
  private readonly fetchFn: FetchLike;
  private readonly sleep: SleepLike;

  constructor(private readonly opts: ApiClientOptions) {
    this.origin = new URL(opts.baseUrl).origin;
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Absolute URL for an API path (`/repos/…`) or a pagination link; refuses any other origin. */
  private resolve(pathOrUrl: string): string {
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${this.opts.baseUrl}${pathOrUrl}`;
    if (new URL(url).origin !== this.origin) {
      throw new PublishError(`Refusing to send a request outside ${this.origin}: ${new URL(url).origin}`);
    }
    return url;
  }

  async request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.resolve(pathOrUrl);
    const shown = `${method} ${new URL(url).pathname}`;
    const attempts = this.opts.maxAttempts ?? DEFAULT_ATTEMPTS;
    const headers: Record<string, string> = { ...this.opts.headers };
    if (body !== undefined) headers['content-type'] = 'application/json';
    for (let attempt = 1; ; attempt++) {
      this.throwIfAborted();
      const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = this.opts.signal ? AbortSignal.any([this.opts.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
          // A redirect could carry the token to another host (custom headers survive cross-origin redirects).
          redirect: 'manual',
        });
      } catch (err) {
        this.throwIfAborted();
        const reason = timeout.aborted ? 'timed out' : (err as Error).message || 'network error';
        if (attempt >= attempts) throw new ApiError(`${shown} failed: ${reason}`, 0);
        this.opts.logger?.debug(`publish: ${shown}: ${reason}; retrying (${attempt}/${attempts - 1})`);
        await this.wait(1000 * 2 ** (attempt - 1));
        continue;
      }
      this.opts.logger?.debug(`publish: ${shown} → ${res.status}`);
      if (isRetryable(res) && attempt < attempts) {
        const wait = retryAfterMs(res) ?? 1000 * 2 ** (attempt - 1);
        await res.body?.cancel().catch(() => undefined);
        if (wait > (this.opts.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS)) {
          throw new ApiError(
            `${shown} failed: ${res.status} (rate limited for ${Math.ceil(wait / 1000)} s)`,
            res.status,
          );
        }
        await this.wait(wait);
        continue;
      }
      const data = await this.readBody(res);
      if (res.status >= 300 && res.status < 400) {
        throw new ApiError(
          `${shown} was redirected (${res.status}); check the API URL and the repository name`,
          res.status,
        );
      }
      if (!res.ok) {
        const detail = errorDetail(data);
        throw new ApiError(`${shown} failed: ${res.status}${detail ? ` ${detail}` : ''}`, res.status);
      }
      return { status: res.status, data: data as T, headers: res.headers };
    }
  }

  /** GET of a list endpoint, following `Link: rel="next"` (same origin only) up to `maxPages`. */
  async paginate<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = `${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}`;
    for (let page = 0; next && page < (this.opts.maxPages ?? DEFAULT_MAX_PAGES); page++) {
      const res: ApiResponse<unknown> = await this.request<unknown>('GET', next);
      if (!Array.isArray(res.data)) throw new ApiError(`GET ${path}: expected a list`, res.status);
      out.push(...(res.data as T[]));
      next = nextLink(res.headers.get('link'));
    }
    return out;
  }

  private async readBody(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => '');
    if (!text) return undefined;
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  private throwIfAborted(): void {
    if (this.opts.signal?.aborted) throw new PublishError('Interrupted');
  }

  private async wait(ms: number): Promise<void> {
    try {
      await this.sleep(ms, this.opts.signal);
    } catch {
      this.throwIfAborted();
    }
  }
}
