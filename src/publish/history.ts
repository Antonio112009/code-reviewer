import { z } from 'zod';
import { type Finding, SEVERITIES, type Severity } from '../types';

/*
 * What the previous review on a pull request reported, carried in our own summary comment as a hidden,
 * base64-encoded marker, so the next publication can say what was fixed, what is new and what is still open.
 * The marker is parsed as untrusted data: a strict schema, bounded sizes, and every string escaped on output.
 */

/** Most findings remembered, and the longest title kept. */
const MAX_REMEMBERED = 100;
const MAX_TITLE = 80;
const STATE_RE = /<!-- code-reviewer:state ([A-Za-z0-9+/=]{1,60000}) -->/;

const RememberedSchema = z.object({
  fp: z.string().regex(/^[0-9a-f]{16,64}$/),
  file: z.string().max(500),
  line: z.number().int().positive(),
  severity: z.enum(SEVERITIES),
  title: z.string().max(MAX_TITLE),
});
const StateSchema = z.object({
  head: z.string().regex(/^[0-9a-f]{7,64}$/i),
  findings: z.array(RememberedSchema).max(MAX_REMEMBERED),
});
export type ReviewState = z.infer<typeof StateSchema>;
export type RememberedFinding = z.infer<typeof RememberedSchema>;

/** The hidden marker recording this review (worst findings first when there are too many). */
export function stateMarker(head: string, findings: readonly Finding[]): string {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const remembered = findings
    .filter((f): f is Finding & { fingerprint: string } => typeof f.fingerprint === 'string')
    .sort((a, b) => rank(a.severity) - rank(b.severity))
    .slice(0, MAX_REMEMBERED)
    .map((f) => ({
      fp: f.fingerprint,
      file: f.file.slice(0, 500),
      line: f.startLine,
      severity: f.severity,
      title: f.title.slice(0, MAX_TITLE),
    }));
  const state: ReviewState = { head: head.toLowerCase(), findings: remembered };
  return `<!-- code-reviewer:state ${Buffer.from(JSON.stringify(state), 'utf8').toString('base64')} -->`;
}

/** The state recorded in an earlier summary comment, or undefined when it is missing or malformed. */
export function parseState(body: string | undefined): ReviewState | undefined {
  const m = body ? STATE_RE.exec(body) : null;
  if (!m) return undefined;
  try {
    const parsed = StateSchema.safeParse(JSON.parse(Buffer.from(m[1]!, 'base64').toString('utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export interface SinceLastReview {
  previousHead: string;
  /** Earlier findings whose thread was resolved because the commented code changed. */
  fixed: RememberedFinding[];
  /** Earlier findings the new review no longer reports (their thread, if any, stays open). */
  gone: RememberedFinding[];
  /** Findings the earlier review did not report. */
  added: Finding[];
  /** Earlier findings reported again. */
  open: number;
}

/** What changed since the previous review; undefined without one, or when it reviewed the same commit. */
export function sinceLastReview(
  previous: ReviewState | undefined,
  head: string,
  findings: readonly Finding[],
  resolved: ReadonlySet<string>,
): SinceLastReview | undefined {
  if (!previous || previous.head === head.toLowerCase()) return undefined;
  const now = new Set(
    findings.map((f) => f.fingerprint).filter((fp): fp is string => typeof fp === 'string'),
  );
  const before = new Set(previous.findings.map((f) => f.fp));
  const missing = previous.findings.filter((f) => !now.has(f.fp));
  return {
    previousHead: previous.head,
    fixed: missing.filter((f) => resolved.has(f.fp)),
    gone: missing.filter((f) => !resolved.has(f.fp)),
    added: findings.filter((f) => f.fingerprint !== undefined && !before.has(f.fingerprint)),
    open: previous.findings.length - missing.length,
  };
}
