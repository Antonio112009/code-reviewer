import type { StaticHit } from '../types';
import { type RawHit, type SourceFile, severityRank } from './types';

/** A raw hit tagged with the analyzer that produced it. */
export interface TaggedHit extends RawHit {
  analyzer: string;
}

/** Hits within this many lines of a changed line are kept in diff mode. */
export const DIFF_CONTEXT_LINES = 3;
/** At most this many hits per file, analyzer and rule (secrets exempt). */
export const MAX_HITS_PER_RULE_AND_FILE = 10;
const MAX_MESSAGE = 300;

const TEST_PATH =
  /(?:^|\/)(?:tests?|__tests__|specs?|fixtures?|testdata|test-data|examples?|samples?|mocks?|__mocks__|e2e)\/|[._-](?:test|spec|tests|fixture|mock)\.[^/]+$|_test\.(?:go|py|rb|exs?)$|(?:^|\/)test_[^/]+\.py$|(?:^|\/)conftest\.py$/i;

/** True for test / fixture / example paths, where risky patterns matter less. */
export function isTestPath(file: string): boolean {
  return TEST_PATH.test(file);
}

/**
 * Masks things that look like credentials in analyzer output, so hint text never carries a secret
 * into prompts or reports: well-known token prefixes and long high-entropy strings.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abeoprs]-[A-Za-z0-9-]{10,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|(?:A3T[A-Z0-9]|AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,})/g,
      '[REDACTED]',
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      '[REDACTED]',
    )
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, (m) => (looksRandom(m) ? '[REDACTED]' : m));
}

/** Shannon entropy in bits per character. */
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A long token of mixed letters and digits with high entropy that is not a path/URL fragment. */
function looksRandom(s: string): boolean {
  if (!/\d/.test(s) || !/[A-Za-z]/.test(s)) return false;
  if (s.includes('/') && s.split('/').every((seg) => seg.length <= 24)) return false;
  return entropy(s) >= 3.8;
}

function cleanMessage(message: string): string {
  const flat = redactSecrets(message)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_MESSAGE ? `${flat.slice(0, MAX_MESSAGE - 1)}…` : flat;
}

function lineCount(content: string): number {
  if (!content) return 1;
  let n = 1;
  for (let i = content.indexOf('\n'); i !== -1; i = content.indexOf('\n', i + 1)) n++;
  return content.endsWith('\n') ? n - 1 : n;
}

/** Diff mode only: a file without changed ranges (deletions only) has no line a hit could be near. */
function nearChange(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => end >= a - DIFF_CONTEXT_LINES && start <= b + DIFF_CONTEXT_LINES);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total order used for ids: file, line, analyzer, rule, end line, message. */
export function compareHits(a: Omit<StaticHit, 'id'>, b: Omit<StaticHit, 'id'>): number {
  return (
    compareStrings(a.file, b.file) ||
    a.startLine - b.startLine ||
    compareStrings(a.analyzer, b.analyzer) ||
    compareStrings(a.ruleId, b.ruleId) ||
    a.endLine - b.endLine ||
    compareStrings(a.message, b.message)
  );
}

function stronger(a: TaggedHit, b: TaggedHit): boolean {
  const s = severityRank(a.severity) - severityRank(b.severity);
  if (s !== 0) return s > 0;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence;
  if (Boolean(a.nonRejectable) !== Boolean(b.nonRejectable)) return Boolean(a.nonRejectable);
  return compareStrings(`${a.analyzer}:${a.ruleId}`, `${b.analyzer}:${b.ruleId}`) < 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Turns raw hits into the run's final hint list: drops hits on unknown files or invalid lines, keeps
 * only hits near changed lines in diff mode (±3), caps noisy rules, deduplicates by file + line + rule
 * (or shared dedupe key), lowers confidence in test code and assigns ids `H1..Hn` in a deterministic
 * order (file, line, analyzer, rule).
 */
export function finalizeHits(raw: TaggedHit[], files: SourceFile[], mode: 'diff' | 'files'): StaticHit[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const lines = new Map<string, number>();
  const valid: TaggedHit[] = [];
  for (const hit of raw) {
    const file = byPath.get(hit.file);
    if (!file || !Number.isFinite(hit.startLine)) continue;
    let total = lines.get(file.path);
    if (total === undefined) {
      total = lineCount(file.content);
      lines.set(file.path, total);
    }
    const startLine = Math.max(1, Math.trunc(hit.startLine));
    if (startLine > total) continue;
    const endLine = Math.min(total, Math.max(startLine, Math.trunc(hit.endLine ?? startLine)));
    if (mode === 'diff' && !nearChange(startLine, endLine, file.changedRanges)) continue;
    let confidence = Math.min(0.95, Math.max(0.05, hit.confidence));
    if (isTestPath(file.path)) confidence *= hit.category === 'security' ? 0.5 : 0.8;
    valid.push({ ...hit, startLine, endLine, confidence: round2(Math.max(0.05, confidence)) });
  }

  // Deterministic processing order before capping and deduplication.
  valid.sort((a, b) => compareHits(a as StaticHit, b as StaticHit));

  const perRule = new Map<string, number>();
  const best = new Map<string, TaggedHit>();
  for (const hit of valid) {
    if (!hit.nonRejectable) {
      const ruleKey = `${hit.file}\0${hit.analyzer}\0${hit.ruleId}`;
      const n = perRule.get(ruleKey) ?? 0;
      if (n >= MAX_HITS_PER_RULE_AND_FILE) continue;
      perRule.set(ruleKey, n + 1);
    }
    const key = `${hit.file}\0${hit.startLine}\0${hit.dedupeKey ?? `${hit.analyzer}:${hit.ruleId}`}`;
    const prev = best.get(key);
    if (!prev || stronger(hit, prev)) best.set(key, hit);
  }

  const finals: Array<Omit<StaticHit, 'id'>> = [...best.values()].map((h) => {
    const out: Omit<StaticHit, 'id'> = {
      analyzer: h.analyzer,
      ruleId: h.ruleId,
      file: h.file,
      startLine: h.startLine,
      endLine: h.endLine ?? h.startLine,
      severity: h.severity,
      category: h.category,
      message: cleanMessage(h.message) || h.ruleId,
      confidence: h.confidence,
    };
    if (h.nonRejectable) out.nonRejectable = true;
    if (h.help) out.help = cleanMessage(h.help);
    return out;
  });
  finals.sort(compareHits);
  return finals.map((h, i) => ({ id: `H${i + 1}`, ...h }));
}
