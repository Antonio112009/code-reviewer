import type { EdgeReason, FileEdge } from './graph';

/** Edges at least this strong keep files in the same group (imports, test pairs, full co-change). */
export const STRONG_EDGE_WEIGHT = 0.5;

/** Human-readable group reasons, as shown in the plan (`Chunk.groupReasons`). */
export const REASON_LABELS: Readonly<Record<EdgeReason, string>> = {
  import: 'imports',
  call: 'calls',
  test: 'test pair',
  cochange: 'co-change',
  directory: 'directory',
  package: 'package',
};
const REASON_ORDER: readonly EdgeReason[] = ['import', 'call', 'test', 'cochange', 'directory', 'package'];

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Summed edge weights between files, with the reasons behind each pair. */
export class AffinityIndex {
  private readonly adj = new Map<string, Map<string, number>>();
  private readonly why = new Map<string, Map<EdgeReason, number>>();

  /** @param nodes when given, edges touching other files are ignored. */
  constructor(edges: readonly FileEdge[], nodes?: ReadonlySet<string>) {
    for (const e of edges) {
      if (e.a === e.b || !(e.weight > 0)) continue;
      if (nodes && (!nodes.has(e.a) || !nodes.has(e.b))) continue;
      this.bump(e.a, e.b, e.weight);
      this.bump(e.b, e.a, e.weight);
      const key = e.a < e.b ? `${e.a}\0${e.b}` : `${e.b}\0${e.a}`;
      let reasons = this.why.get(key);
      if (!reasons) {
        reasons = new Map();
        this.why.set(key, reasons);
      }
      reasons.set(e.reason, Math.max(reasons.get(e.reason) ?? 0, e.weight));
    }
  }

  private bump(a: string, b: string, w: number): void {
    let m = this.adj.get(a);
    if (!m) {
      m = new Map();
      this.adj.set(a, m);
    }
    m.set(b, (m.get(b) ?? 0) + w);
  }

  /** Total weight between two files (0 when unrelated). */
  weight(a: string, b: string): number {
    return this.adj.get(a)?.get(b) ?? 0;
  }

  /** Neighbours of `file` with the summed weight to each. */
  neighbors(file: string): ReadonlyMap<string, number> {
    return this.adj.get(file) ?? EMPTY;
  }

  /** Whether some single edge between `a` and `b` has at least `minWeight`. */
  strong(a: string, b: string, minWeight = STRONG_EDGE_WEIGHT): boolean {
    const reasons = this.why.get(a < b ? `${a}\0${b}` : `${b}\0${a}`);
    if (!reasons) return false;
    for (const w of reasons.values()) if (w >= minWeight) return true;
    return false;
  }

  /** Labels ({@link REASON_LABELS}) of the edges with weight ≥ `minWeight` inside `files`, in a fixed order. */
  reasons(files: Iterable<string>, minWeight = 0): string[] {
    const set = new Set(files);
    const found = new Set<EdgeReason>();
    for (const f of set) {
      for (const n of this.neighbors(f).keys()) {
        if (!set.has(n) || !(f < n)) continue;
        for (const [reason, w] of this.why.get(`${f}\0${n}`) ?? []) if (w >= minWeight) found.add(reason);
      }
    }
    return REASON_ORDER.filter((r) => found.has(r)).map((r) => REASON_LABELS[r]);
  }
}

const EMPTY: ReadonlyMap<string, number> = new Map();

/** A set of files that should be reviewed together. */
export interface FileGroup {
  /** Sorted, except for split groups (kept in traversal order). */
  files: string[];
  tokens: number;
  /** Why the files are together (strong edges only), e.g. `imports`, `test pair`. */
  reasons: string[];
}

/**
 * Groups files connected by strong edges (weight ≥ {@link STRONG_EDGE_WEIGHT}) with union-find.
 * Groups over `budget` are split deterministically: breadth-first over the strongest edges, then cut
 * sequentially into pieces that fit (a single file over budget becomes its own group).
 * Output order: by first file path.
 */
export function clusterFiles(
  files: readonly string[],
  sizes: ReadonlyMap<string, number>,
  edges: readonly FileEdge[],
  budget: number,
  index: AffinityIndex = new AffinityIndex(edges, new Set(files)),
): FileGroup[] {
  const sorted = [...new Set(files)].sort(cmp);
  const parent = new Map<string, string>(sorted.map((f) => [f, f]));
  const find = (f: string): string => {
    let root = f;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = f;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const e of edges) {
    if (e.weight < STRONG_EDGE_WEIGHT || !parent.has(e.a) || !parent.has(e.b)) continue;
    const ra = find(e.a);
    const rb = find(e.b);
    // the lexicographically smaller root wins: the result does not depend on edge order
    if (ra !== rb) ra < rb ? parent.set(rb, ra) : parent.set(ra, rb);
  }
  const components = new Map<string, string[]>();
  for (const f of sorted) {
    const r = find(f);
    const list = components.get(r);
    if (list) list.push(f);
    else components.set(r, [f]);
  }

  const size = (f: string) => sizes.get(f) ?? 0;
  const groups: FileGroup[] = [];
  for (const members of components.values()) {
    const tokens = members.reduce((s, f) => s + size(f), 0);
    if (tokens <= budget || members.length === 1) {
      groups.push({ files: members, tokens, reasons: index.reasons(members, STRONG_EDGE_WEIGHT) });
      continue;
    }
    for (const piece of splitComponent(members, size, index, budget)) {
      groups.push({
        files: piece,
        tokens: piece.reduce((s, f) => s + size(f), 0),
        reasons: index.reasons(piece, STRONG_EDGE_WEIGHT),
      });
    }
  }
  return groups;
}

/** Breadth-first order over the strongest edges, cut sequentially into budget-sized pieces. */
function splitComponent(
  members: string[],
  size: (f: string) => number,
  index: AffinityIndex,
  budget: number,
): string[][] {
  const inGroup = new Set(members);
  const degree = new Map<string, number>();
  for (const f of members) {
    let d = 0;
    for (const [n, w] of index.neighbors(f)) if (inGroup.has(n)) d += w;
    degree.set(f, d);
  }
  const visited = new Set<string>();
  const order: string[] = [];
  while (order.length < members.length) {
    let seed: string | undefined;
    for (const f of members) {
      if (visited.has(f)) continue;
      if (seed === undefined || degree.get(f)! > degree.get(seed)!) seed = f;
    }
    const queue = [seed!];
    visited.add(seed!);
    for (let head = 0; head < queue.length; head++) {
      const f = queue[head]!;
      order.push(f);
      const next = [...index.neighbors(f)]
        .filter(([n]) => inGroup.has(n) && !visited.has(n))
        .sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]));
      for (const [n] of next) {
        visited.add(n);
        queue.push(n);
      }
    }
  }

  const pieces: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  const flush = () => {
    if (current.length) pieces.push(current);
    current = [];
    tokens = 0;
  };
  for (const f of order) {
    const s = size(f);
    if (s > budget) {
      flush();
      pieces.push([f]);
      continue;
    }
    if (current.length && tokens + s > budget) flush();
    current.push(f);
    tokens += s;
  }
  flush();
  return pieces;
}
