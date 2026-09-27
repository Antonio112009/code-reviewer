import type { SourceFile } from './types';

/**
 * 1-based line numbers covered by the file's changed ranges (clamped to `total`, sorted, unique).
 * Empty ranges mean the whole file.
 */
export function changedLineNumbers(file: SourceFile, total: number): number[] {
  if (file.changedRanges.length === 0) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>();
  for (const [a, b] of file.changedRanges) {
    const start = Math.max(1, Math.trunc(Math.min(a, b)));
    const end = Math.min(total, Math.trunc(Math.max(a, b)));
    for (let n = start; n <= end; n++) set.add(n);
  }
  return [...set].sort((x, y) => x - y);
}
