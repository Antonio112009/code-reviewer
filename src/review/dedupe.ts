import type { Finding } from '../types';

const LINE_SLACK = 2;
const TITLE_SIMILARITY = 0.5;
/** On the exact same span, a lower bar: the same defect reported by two overlapping chunks. */
const SAME_SPAN_SIMILARITY = 0.15;

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length > 2),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

function isDuplicate(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false;
  const overlap = a.startLine <= b.endLine + LINE_SLACK && b.startLine <= a.endLine + LINE_SLACK;
  if (!overlap) return false;
  // Adjacent lines often hold different bugs, and so does one span (a function with several defects): merge
  // on a similar title, or on the exact same span when the titles share something.
  const similarity = titleSimilarity(a.title, b.title);
  const sameSpan = a.startLine === b.startLine && a.endLine === b.endLine && a.category === b.category;
  return similarity >= TITLE_SIMILARITY || (sameSpan && similarity >= SAME_SPAN_SIMILARITY);
}

/**
 * Merges findings that describe the same defect (typically from overlapping chunks of a split file).
 * The most confident one wins; sources and skills are unioned, and `nonRejectable` / the static rule
 * of any merged finding are kept.
 */
export function dedupeFindings(findings: Finding[]): { unique: Finding[]; merged: number } {
  const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
  const unique: Finding[] = [];
  let merged = 0;
  for (const f of sorted) {
    const dup = unique.find((u) => isDuplicate(u, f));
    if (!dup) {
      unique.push({ ...f, source: { ...f.source, chunkIds: [...f.source.chunkIds] }, skills: [...f.skills] });
      continue;
    }
    merged++;
    dup.source.chunkIds = [...new Set([...dup.source.chunkIds, ...f.source.chunkIds])];
    dup.skills = [...new Set([...dup.skills, ...f.skills])];
    // A merged-away secret / vulnerable-dependency hit keeps the survivor from being critiqued away.
    if (f.nonRejectable) dup.nonRejectable = true;
    if (!dup.tool && f.tool) dup.tool = f.tool;
  }
  return { unique, merged };
}
