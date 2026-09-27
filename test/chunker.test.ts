import { describe, expect, it } from 'vitest';
import { buildChunks, chunkText } from '../src/chunking/chunker';
import { estimateTokens } from '../src/chunking/tokens';
import type { Hunk, ReviewUnit } from '../src/types';

function fileUnit(path: string, lines: number): ReviewUnit {
  const content = Array.from(
    { length: lines },
    (_, i) => `const value${i} = compute(${i}) + offset * ${i};`,
  ).join('\n');
  return { path, status: 'file', language: 'typescript', hunks: [], content, focusRanges: [] };
}

function diffUnit(path: string, lines: number, changedAt: number[]): ReviewUnit {
  const content = Array.from(
    { length: lines },
    (_, i) => `line ${i + 1} of ${path} with some padding text`,
  ).join('\n');
  const hunks: Hunk[] = changedAt.map((n) => ({
    header: `@@ -${n},1 +${n},1 @@`,
    oldStart: n,
    oldLines: 1,
    newStart: n,
    newLines: 1,
    lines: [
      { type: 'del', text: 'old', oldLine: n },
      { type: 'add', text: `line ${n}`, newLine: n },
    ],
  }));
  return {
    path,
    status: 'modified',
    language: 'typescript',
    hunks,
    content,
    focusRanges: changedAt.map((n): [number, number] => [n, n]),
  };
}

const opts = { fullFileTokens: 3_000, contextLines: 10 };

describe('buildChunks', () => {
  it('packs small files into one chunk and marks added lines', () => {
    const { chunks } = buildChunks([diffUnit('a.ts', 20, [5]), diffUnit('b.ts', 20, [7])], {
      ...opts,
      budget: 10_000,
    });
    expect(chunks).toHaveLength(1);
    const text = chunkText(chunks[0]!);
    expect(text).toContain('## File: a.ts (modified)');
    expect(text).toMatch(/\n\s*5 \+ line 5 of a\.ts/);
    expect(text).toContain('__removed code__');
  });

  it('never exceeds the budget and splits large files into parts', () => {
    const budget = 2_000;
    const { chunks } = buildChunks([fileUnit('big.ts', 600), fileUnit('small.ts', 10)], { ...opts, budget });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.tokens).toBeLessThanOrEqual(budget);
      for (const p of c.parts) expect(estimateTokens(p.text)).toBeLessThanOrEqual(budget);
    }
    const bigParts = chunks.flatMap((c) => c.parts).filter((p) => p.path === 'big.ts');
    expect(bigParts.length).toBeGreaterThan(1);
    expect(bigParts[0]!.text).toContain('[part 1/');
  });

  it('shows only windows around hunks for large diffs', () => {
    const { chunks } = buildChunks([diffUnit('huge.ts', 2_000, [100, 1_500])], { ...opts, budget: 20_000 });
    const text = chunks.map(chunkText).join('\n');
    expect(text).toContain('lines 90-110');
    expect(text).toContain('lines 1490-1510');
    expect(text).not.toContain('line 500 of huge.ts');
  });

  it('lists deleted files as mentions only', () => {
    const deleted: ReviewUnit = {
      path: 'old.ts',
      status: 'deleted',
      language: 'typescript',
      hunks: [],
      focusRanges: [],
    };
    const { chunks, mentions } = buildChunks([deleted, diffUnit('a.ts', 5, [1])], {
      ...opts,
      budget: 10_000,
    });
    expect(mentions).toEqual(['old.ts']);
    expect(chunks[0]!.files).toEqual(['a.ts']);
    expect(chunks[0]!.mentions).toEqual(['old.ts']);
  });

  it('budgets large deletions and shows each removed block once', () => {
    const fileLines = 1_000;
    const content = Array.from(
      { length: fileLines },
      (_, i) => `const keep${i} = ${i}; // unchanged line`,
    ).join('\n');
    const removed = Array.from({ length: 3_000 }, (_, i) => ({
      type: 'del' as const,
      text: `legacyHandler${i}(request, response, next); // removed`,
      oldLine: 500 + i,
    }));
    const addedLines = Array.from({ length: 5 }, (_, i) => ({
      type: 'add' as const,
      text: `newHandler${i}();`,
      newLine: 500 + i,
    }));
    const unit: ReviewUnit = {
      path: 'server.ts',
      status: 'modified',
      language: 'typescript',
      content,
      hunks: [
        {
          header: '@@ -500,3000 +500,5 @@',
          oldStart: 500,
          oldLines: 3_000,
          newStart: 500,
          newLines: 5,
          lines: [...removed, ...addedLines],
        },
      ],
      focusRanges: [[500, 504]],
    };
    const budget = 2_000;
    const { chunks } = buildChunks([unit], { ...opts, budget });
    const parts = chunks.flatMap((c) => c.parts);
    for (const p of parts) expect(estimateTokens(p.text)).toBeLessThanOrEqual(budget);
    const text = parts.map((p) => p.text).join('\n');
    expect(text.match(/__removed code__/g)).toHaveLength(1);
    expect(text).toMatch(/more removed lines omitted/);
    expect(text).toMatch(/\n500 \+ /); // added lines are marked in the new-code window
  });
});
