import { describe, expect, it } from 'vitest';
import { coverageMap } from '../src/review/coverage';
import type { Chunk, ReviewUnit } from '../src/types';

function unit(path: string, added = 2): ReviewUnit {
  return {
    path,
    status: 'modified',
    language: 'typescript',
    content: 'x\n'.repeat(10),
    focusRanges: [],
    hunks: [
      {
        header: '@@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: added,
        lines: [
          { type: 'del', text: 'old', oldLine: 1 },
          ...Array.from({ length: added }, (_, i) => ({
            type: 'add' as const,
            text: `new${i}`,
            newLine: i + 1,
          })),
          { type: 'ctx', text: 'same', oldLine: 2, newLine: added + 1 },
        ],
      },
    ],
  };
}
const chunk = (files: string[]) => ({ files }) as Chunk;

describe('coverageMap', () => {
  it('tells reviewed, interrupted, partly failed, failed and skipped files apart, problems first', () => {
    const units = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((p) => unit(p));
    const map = coverageMap(
      units,
      [{ path: 'big.bin', reason: 'binary' }],
      [chunk(['a.ts', 'b.ts']), chunk(['c.ts']), chunk(['c.ts', 'd.ts']), chunk(['e.ts'])],
      [
        { files: ['a.ts', 'b.ts'], kind: 'done', reads: ['b.ts', 'src/elsewhere.ts'] },
        { files: ['c.ts'], kind: 'interrupted' },
        { files: ['c.ts', 'd.ts'], kind: 'failed' },
      ],
    );
    expect(map).toEqual([
      { path: 'd.ts', changed: 3, status: 'failed' },
      { path: 'e.ts', changed: 3, status: 'failed', reason: 'not run' },
      { path: 'c.ts', changed: 3, status: 'partial' },
      { path: 'big.bin', changed: 0, status: 'skipped', reason: 'binary' },
      { path: 'a.ts', changed: 3, status: 'reviewed' },
      { path: 'b.ts', changed: 3, status: 'reviewed', opened: true },
    ]);
  });
});
