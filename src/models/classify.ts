import { extractJson } from '../util/json';
import type { ErrorClass } from './types';

interface ErrorFacts {
  /** Lower-cased text of every message, body and code found on the error and its causes. */
  text: string;
  status?: number;
  retryable?: boolean;
  aborted: boolean;
}

const MAX_DEPTH = 6;

/** Collects status codes, retry hints and texts from an error, its `cause` chain and AI SDK wrappers. */
function factsOf(error: unknown): ErrorFacts {
  const texts: string[] = [];
  let status: number | undefined;
  let retryable: boolean | undefined;
  let aborted = false;
  const seen = new Set<unknown>();

  const visit = (e: unknown, depth: number): void => {
    if (e === undefined || e === null || depth > MAX_DEPTH || seen.has(e)) return;
    if (typeof e === 'string') {
      texts.push(e);
      return;
    }
    if (typeof e !== 'object') {
      texts.push(String(e));
      return;
    }
    seen.add(e);
    const o = e as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : undefined;
    if (name === 'AbortError') aborted = true;
    for (const key of ['name', 'message', 'code', 'type', 'reason', 'responseBody', 'finishReason']) {
      const v = o[key];
      if (typeof v === 'string' && v) texts.push(v);
    }
    if (o.data !== undefined) texts.push(typeof o.data === 'string' ? o.data : safeJson(o.data));
    const meta = o.$metadata as { httpStatusCode?: unknown } | undefined;
    for (const candidate of [o.statusCode, o.status, meta?.httpStatusCode]) {
      if (status === undefined && typeof candidate === 'number' && candidate >= 100 && candidate < 600) {
        status = candidate;
      }
    }
    if (retryable === undefined && typeof o.isRetryable === 'boolean') retryable = o.isRetryable;
    // AI SDK RetryError keeps the individual attempts.
    visit(o.lastError, depth + 1);
    if (Array.isArray(o.errors)) for (const inner of o.errors.slice(-3)) visit(inner, depth + 1);
    visit(o.cause, depth + 1);
    if (typeof o.error === 'object') visit(o.error, depth + 1);
  };
  visit(error, 0);

  const text = texts.join('\n').toLowerCase();
  status ??= statusFromText(text);
  return { text, status, retryable, aborted };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const STATUS_PATTERNS = [
  /"status(?:code)?"\s*:\s*(\d{3})\b/,
  /\bstatus(?:\s*code)?\s*[:=]?\s*(\d{3})\b/,
  /\bhttp(?:\/[\d.]+)?\s+(\d{3})\b/,
  /\bapi error:?\s*(\d{3})\b/,
  /\b(\d{3})\s+(?:bad request|unauthorized|forbidden|not found|request timeout|too many requests|internal server error|bad gateway|service unavailable|gateway timeout)\b/,
];

function statusFromText(text: string): number | undefined {
  for (const re of STATUS_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (n >= 400 && n < 600) return n;
    }
  }
  return undefined;
}

/** Credentials missing, expired or rejected: switching models does not help; the user must log in. */
const AUTH = [
  /expiredtoken|token (?:has |is )?expired|expired token|security token included in the request is (?:expired|invalid)/,
  /unrecognizedclientexception|invalidsignatureexception|incompletesignature|signature(?:doesnotmatch| does not match)/,
  /could not load credentials|credentialsprovidererror|unable to locate credentials|missing credentials/,
  /sso session .*(?:expired|invalid)|sso token .*(?:expired|invalid)|refresh token .*(?:expired|invalid|revoked)|token refresh failed/,
  /not logged in|please (?:run \/?)?log ?in|please login|run \/login|authentication[_ ](?:required|error|failed)/,
  /invalid (?:api[_ -]?key|x-api-key|bearer token|authentication)|incorrect api key|api key (?:is )?(?:invalid|missing)/,
  /oauth token (?:has )?(?:expired|revoked)|unauthorized|auth_required/,
];

/** The request (prompt + context) does not fit the model. */
const TOO_LONG = [
  /context[_ ](?:length|window)[_ ](?:exceeded|limit)|model_context_window_exceeded|exceeds? (?:the )?(?:model'?s? )?(?:maximum )?context/,
  /prompt is too long|input is too long|too many (?:input )?tokens in (?:the )?(?:prompt|request|input)/,
  /maximum context length|request[_ ]too[_ ]large|input length and `?max_tokens`? exceed/,
  /reduce the length of the messages|string too long/,
];

/** The model declined (safety classifiers, content filters, guardrails). */
const REFUSAL = [
  /stop[_ ]?reason"?\s*[:=]?\s*"?refusal|\brefusal\b|content[-_ ]filter(?:ed)?|guardrail[_ ]intervened/,
  /blocked by (?:content|safety) (?:filtering|policy)|output blocked|responsible ai policy/,
];

/** The account may not use this model (IAM, entitlement): checked before AUTH, whose words overlap. */
const NO_ACCESS = [
  /(?:don'?t|do not) have access to (?:the |this )?model|access to (?:the |this )?model is (?:denied|not allowed)/,
  /accessdeniedexception|not authorized to perform:? ?bedrock:invoke|permission[_ ]error|model access/,
];

/** Plan or credit exhausted: never recovers within a run, so it is a reason to switch models. */
const QUOTA = [
  /credit balance is too low|insufficient[_ ]quota|exceeded your current quota|(?:hit|reached) your usage limit|usage limit reached/,
];

/** The model cannot be used with this account / region / plan: fall back to another one. */
const UNAVAILABLE = [
  ...NO_ACCESS,
  ...QUOTA,
  /ftuformnotfilled|use case details (?:have not been|haven'?t been) submitted/,
  /(?:invalid|unknown|unsupported) model(?: identifier| id| name)?\b|model identifier is invalid|no such model/,
  /model[_ ]not[_ ]found|not_found_error|resourcenotfoundexception|model .{0,80}(?:does not|doesn'?t) exist/,
  /on-demand throughput (?:isn['’]t|is not) supported|with on-demand throughput/,
  /not supported when using codex|model is not supported|model .{0,80}is not (?:supported|available|enabled)/,
  /may not exist or you may not have access|issue with the selected model/,
  /not offered by|(?:reached|past) (?:the )?end[- ]of[- ]life|model (?:is )?(?:deprecated|retired)/,
];

/** Worth a retry (rate limits, overload, network trouble, timeouts). */
const TRANSIENT = [
  /rate[_ ]?limit|too many requests|throttl|overloaded|capacity|try again later|temporarily unavailable/,
  /serviceunavailable|service unavailable|internalserver|internal server error|modelnotready|bad gateway/,
  /econnreset|econnrefused|etimedout|eai_again|enotfound|epipe|socket hang up|network error|fetch failed/,
  /timed? ?out|timeouterror|deadline exceeded|stream (?:disconnected|closed)|connection (?:closed|reset)/,
];

/**
 * Classifies a provider error (or an agent reply text) to decide between retry, fallback and failure.
 * Understands ProviderError chains (`cause`), AI SDK `APICallError`/`RetryError` (statusCode, isRetryable,
 * responseBody), AWS SDK errors (`$metadata.httpStatusCode`) and raw agent texts such as
 * `{"type":"error","status":400,…}` or Claude Code's "API Error: 404 …".
 */
export function classifyError(error: unknown): ErrorClass {
  const { text, status, retryable, aborted } = factsOf(error);
  if (aborted && !/timeout/.test(text)) return 'unknown';
  const any = (patterns: RegExp[]) => patterns.some((re) => re.test(text));

  // Status codes that are unambiguous about retrying win over wording.
  if (status === 429 || status === 408 || status === 529 || (status !== undefined && status >= 500)) {
    // …except quota exhaustion, which OpenAI reports as 429 but never recovers within a run.
    if (any(QUOTA)) return 'unavailable';
    return 'transient';
  }
  if (any(AUTH) && !any(NO_ACCESS)) return 'auth';
  if (any(TOO_LONG) || status === 413) return 'too-long';
  if (any(REFUSAL)) return 'refusal';
  if (any(UNAVAILABLE)) return 'unavailable';
  if (status === 401) return 'auth';
  if (status === 403 || status === 404) return 'unavailable';
  if (retryable || any(TRANSIENT)) return 'transient';
  return 'unknown';
}

const ERROR_REPLY = [
  /^\s*\{\s*"type"\s*:\s*"error"/,
  /^\s*api error\b/i,
  /^\s*error:/i,
  /^\s*there'?s an issue with the selected model/i,
];

/**
 * When an agent turn ended without a submission, tells whether its reply text is really an error message
 * (agents often report backend failures as their final text). Returns the error text, or undefined for an
 * ordinary answer. Only short replies are considered so review prose mentioning "timeout" is not misread.
 */
export function detectReplyError(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2_000) return undefined;
  if (ERROR_REPLY.some((re) => re.test(trimmed))) return trimmed;
  // A JSON payload (findings, verdicts) is an answer, whatever words it contains ("401 Unauthorized").
  if (extractJson(trimmed) !== undefined) return undefined;
  // Free text is only read as an unavailable model — never as a credential error, which stops the run.
  if (trimmed.length <= 600 && classifyError(trimmed) === 'unavailable') return trimmed;
  return undefined;
}

/** Short user-facing explanation of an error class. */
export function describeErrorClass(cls: ErrorClass): string {
  switch (cls) {
    case 'unavailable':
      return 'model not available for this account/region';
    case 'transient':
      return 'temporary failure (rate limit, overload or network)';
    case 'refusal':
      return 'the model declined the request';
    case 'too-long':
      return 'the request exceeds the model context window';
    case 'auth':
      return 'credentials missing or expired';
    case 'unknown':
      return 'unexpected error';
  }
}
