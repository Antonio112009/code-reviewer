import type { AffinityIndex } from './cluster';
import { testSubject } from './graph';

/** Something to place into a chunk: a group of files, or one part of a file too big for any chunk. */
export interface PackItem {
  /** Unique, stable key (used for deterministic ordering). */
  key: string;
  files: string[];
  tokens: number;
}

export interface PackBin {
  items: PackItem[];
  tokens: number;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Affinity-aware first-fit-decreasing: items are placed largest first; among the open bins with room,
 * the one with the strongest links to the item wins (ties and zero affinity → the first that fits);
 * when none has room a new bin is opened. Items over `budget` get a bin of their own.
 */
export function packItems(items: readonly PackItem[], budget: number, index: AffinityIndex): PackBin[] {
  const ordered = [...items].sort((a, b) => b.tokens - a.tokens || cmp(a.key, b.key));
  const bins: PackBin[] = [];
  /** file → bins holding (a part of) it */
  const binsOf = new Map<string, number[]>();
  for (const item of ordered) {
    const affinity = new Map<number, number>();
    for (const f of item.files) {
      for (const [n, w] of index.neighbors(f)) {
        for (const b of binsOf.get(n) ?? []) affinity.set(b, (affinity.get(b) ?? 0) + w);
      }
    }
    let chosen = -1;
    let best = 0;
    for (let b = 0; b < bins.length; b++) {
      if (bins[b]!.tokens + item.tokens > budget) continue;
      const a = affinity.get(b) ?? 0;
      if (chosen < 0 || a > best) {
        chosen = b;
        best = a;
      }
    }
    if (chosen < 0) {
      chosen = bins.length;
      bins.push({ items: [], tokens: 0 });
    }
    const bin = bins[chosen]!;
    bin.items.push(item);
    bin.tokens += item.tokens;
    for (const f of item.files) {
      const list = binsOf.get(f);
      if (!list) binsOf.set(f, [chosen]);
      else if (!list.includes(chosen)) list.push(chosen);
    }
  }
  return bins;
}

/**
 * Orders the files of one chunk foundations-first: each file comes right after the files it imports
 * (depth-first, dependencies in path order), sources before tests, otherwise by path. Import cycles are
 * broken at the file first reached.
 */
export function orderFiles(
  files: readonly string[],
  imports?: ReadonlyMap<string, readonly string[]>,
): string[] {
  const set = new Set(files);
  const isTest = (f: string) => testSubject(f) !== undefined;
  const roots = [...set].sort((a, b) => Number(isTest(a)) - Number(isTest(b)) || cmp(a, b));
  const state = new Map<string, 'visiting' | 'done'>();
  const out: string[] = [];
  const visit = (f: string) => {
    if (state.has(f)) return;
    state.set(f, 'visiting');
    const deps = [...new Set(imports?.get(f) ?? [])].filter((t) => t !== f && set.has(t)).sort(cmp);
    for (const d of deps) visit(d);
    state.set(f, 'done');
    out.push(f);
  };
  for (const f of roots) visit(f);
  return out;
}
