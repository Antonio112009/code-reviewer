import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { SEVERITY_ORDER } from '../report/common';
import type { Finding } from '../types';
import { resolveInside } from '../util/paths';

/*
 * A finding fingerprint must survive re-runs and unrelated edits: it hashes what the finding is about (file,
 * category, static rule) and the code it points at, whitespace-normalised, but never line numbers. Lines
 * inserted above the finding, re-indentation or a different model wording keep it; editing the reported
 * code changes it. SARIF `partialFingerprints`, GitLab Code Quality and pull request comments use it.
 */

/** Part of every hash: bump it when the algorithm changes, so old and new fingerprints never match. */
const VERSION = 'v1';
/** Bounded work on untrusted input: at most this many reported lines / characters are hashed. */
const MAX_LINES = 200;
const MAX_CHARS = 20_000;
/** Files larger than this are not read (the title fallback is used). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Well-formed fingerprint (a run.json from the checkout may carry anything). */
export const FINGERPRINT_RE = /^[0-9a-f]{16,64}$/;

/** Lines of a repository file, or undefined when it cannot be read. */
export type LineReader = (file: string) => string[] | undefined;

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
}

/** Code lines with runs of whitespace collapsed, trimmed, blank lines dropped. */
export function normalizeCode(lines: string[]): string {
  return lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_CHARS);
}

function normalizeTitle(title: string): string {
  return String(title).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** The static rule is part of a static finding's identity (a model finding may or may not claim a hint). */
function ruleOf(f: Finding): string {
  return f.origin === 'static' && f.tool ? `${f.tool.analyzer}/${f.tool.ruleId}` : '';
}

/** Used when the reported code cannot be read: file, category, static rule and the normalised title. */
export function fallbackFingerprint(f: Finding): string {
  return hash([VERSION, 'title', String(f.file), String(f.category), ruleOf(f), normalizeTitle(f.title)]);
}

/** Fingerprint of one finding from the lines of its file (undefined lines: the title fallback). */
export function computeFingerprint(f: Finding, fileLines: string[] | undefined): string {
  const start = Math.max(1, Math.floor(f.startLine));
  const end = Math.min(Math.max(start, Math.floor(f.endLine)), start + MAX_LINES - 1);
  const code = fileLines ? normalizeCode(fileLines.slice(start - 1, end)) : '';
  if (!code) return fallbackFingerprint(f);
  return hash([VERSION, 'code', f.file, f.category, ruleOf(f), code]);
}

/** Worst first, then position and title: decides which of two colliding findings keeps the plain hash. */
function collisionOrder(a: Finding, b: Finding): number {
  return (
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
    a.startLine - b.startLine ||
    String(a.title).localeCompare(String(b.title)) ||
    String(a.id).localeCompare(String(b.id))
  );
}

/**
 * Findings with a usable, unique fingerprint each. A missing or malformed one (runs saved before fingerprints
 * existed, a run.json from the checkout) becomes the title fallback. When two findings share one (same code,
 * same category), the first in {@link collisionOrder} keeps it and the others get their title mixed in (then
 * a counter).
 */
export function uniqueFingerprints(findings: Finding[]): Finding[] {
  const out = [...findings];
  const order = out.map((_, i) => i).sort((a, b) => collisionOrder(out[a]!, out[b]!));
  const seen = new Set<string>();
  for (const i of order) {
    const f = out[i]!;
    const base = f.fingerprint && FINGERPRINT_RE.test(f.fingerprint) ? f.fingerprint : fallbackFingerprint(f);
    let fp = base;
    for (let n = 1; seen.has(fp); n++) fp = hash([VERSION, 'dup', base, normalizeTitle(f.title), String(n)]);
    seen.add(fp);
    if (fp !== f.fingerprint) out[i] = { ...f, fingerprint: fp };
  }
  return out;
}

/** Sets `fingerprint` on every finding, reading each reported file once through `read`. */
export function fingerprintFindings(findings: Finding[], read: LineReader): Finding[] {
  const cache = new Map<string, string[] | undefined>();
  const linesOf = (file: string) => {
    if (!cache.has(file)) cache.set(file, read(file));
    return cache.get(file);
  };
  return uniqueFingerprints(
    findings.map((f) => ({ ...f, fingerprint: computeFingerprint(f, linesOf(f.file)) })),
  );
}

/** Reads files of the review root; paths are confined to it (`resolveInside`), unreadable files → undefined. */
export function reviewRootReader(root: string): LineReader {
  return (file) => {
    try {
      const abs = resolveInside(root, file);
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return undefined;
      return readFileSync(abs, 'utf8').split('\n');
    } catch {
      return undefined;
    }
  };
}
