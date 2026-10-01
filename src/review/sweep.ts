import { chunkTextFor } from '../chunking/chunker';
import { estimateTokens } from '../chunking/tokens';
import type { Chunk, Finding } from '../types';

/** `source.chunkIds` of a finding the sweep reported (`review.sweep`): it comes from no chunk. */
export const SWEEP_SOURCE = 'sweep';

/** Lines a sweep finding may be off from a chunk finding and still be at the same spot. */
const LINE_SLACK = 2;

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

/**
 * A sweep finding at the spot of a finding the chunk reviews reported (same file, overlapping lines give or take
 * two): the same defect in other words, as a rule. Dropped before the critic, so it is neither checked nor
 * reported twice; a second defect on the very same lines is lost with it.
 */
export function atReportedSpot(f: Finding, reported: readonly Finding[]): boolean {
  return reported.some(
    (o) =>
      o.file === f.file && f.startLine <= o.endLine + LINE_SLACK && o.startLine <= f.endLine + LINE_SLACK,
  );
}
