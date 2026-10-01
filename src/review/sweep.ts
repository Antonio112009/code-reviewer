import { chunkTextFor } from '../chunking/chunker';
import { estimateTokens } from '../chunking/tokens';
import type { Chunk, Finding } from '../types';

/** `source.chunkIds` of a finding the sweep reported (`review.sweep`): it comes from no chunk. */
export const SWEEP_SOURCE = 'sweep';

/** Most findings listed to the sweep as already reported, and the longest title shown. */
const MAX_REPORTED = 200;
const MAX_TITLE = 160;

/**
 * The chunks each sweep call reads together: every chunk once (a focused pass's copy of a chunk shows the same
 * code), in order, grouped up to `maxTokens` of code per call — one call for most changes.
 */
export function sweepParts(chunks: readonly Chunk[], maxTokens: number): Chunk[][] {
  const seen = new Set<string>();
  const parts: Chunk[][] = [];
  let current: Chunk[] = [];
  let tokens = 0;
  for (const c of chunks) {
    const base = c.pass ? c.id.slice(0, -(c.pass.length + 1)) : c.id;
    if (seen.has(base)) continue;
    seen.add(base);
    const size = estimateTokens(chunkTextFor(c, 'review'));
    if (current.length && tokens + size > maxTokens) {
      parts.push(current);
      current = [];
      tokens = 0;
    }
    current.push(c);
    tokens += size;
  }
  if (current.length) parts.push(current);
  return parts;
}

/** What the chunk reviews reported in `files`, one `file:lines — title` line each, for the sweep to skip. */
export function reportedLines(findings: readonly Finding[], files: ReadonlySet<string>): string[] {
  return findings
    .filter((f) => files.has(f.file))
    .slice(0, MAX_REPORTED)
    .map((f) => {
      const lines = f.endLine > f.startLine ? `${f.startLine}-${f.endLine}` : `${f.startLine}`;
      const title = f.title.replace(/\s+/g, ' ').slice(0, MAX_TITLE);
      return `- ${f.file}:${lines} — ${title}`;
    });
}
