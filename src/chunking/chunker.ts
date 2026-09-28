import path from 'node:path';
import type { Chunk, ChunkPart, ReviewUnit } from '../types';
import { AffinityIndex, clusterFiles } from './cluster';
import { directoryEdges, type FileEdge, type FileGraph } from './graph';
import { orderFiles, type PackItem, packItems } from './pack';
import {
  type ContextExcerpt,
  prepareContextExcerpt,
  type RenderOptions,
  renderContextPart,
  renderUnit,
} from './render';

export type ChunkingStrategy = 'smart' | 'directory';

export interface ChunkingOptions extends Omit<RenderOptions, 'maxPartTokens'> {
  /** Token budget for the code a chunk reviews (its own files). */
  budget: number;
  /** Affinity graph from `buildFileGraph`; enables smart grouping and read-only context. */
  graph?: FileGraph;
  /**
   * `smart` (default when a graph is given): related files (imports, test pairs, co-change) share a chunk,
   * packed affinity-aware. `directory`: files packed in directory order (the default without a graph).
   */
  strategy?: ChunkingStrategy;
  /**
   * Share of `budget` a chunk may add as read-only excerpts of related files reviewed in other chunks
   * (default 0.2; 0 disables). Requires `graph`.
   */
  contextShare?: number;
  /** Hard cap for review + context tokens of one chunk (context is trimmed to fit). Default: no extra cap. */
  maxTotalTokens?: number;
}

export interface ChunkingResult {
  chunks: Chunk[];
  /** Files present in the change but not rendered (deleted files). */
  mentions: string[];
}

/** Default {@link ChunkingOptions.contextShare}. */
export const DEFAULT_CONTEXT_SHARE = 0.2;
/** Most related files shown as context in one chunk. */
const MAX_CONTEXT_FILES = 6;
/** Smallest excerpt worth rendering (header + a few lines). */
const MIN_CONTEXT_TOKENS = 120;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Renders units and packs them into chunks of at most `budget` review tokens. Nothing is dropped: every
 * rendered part lands in exactly one chunk, deleted files become mentions. Deterministic for equal input.
 *
 * With a graph (`smart`), strongly related files are grouped (union-find over imports, test pairs and
 * co-change), groups are packed affinity-aware, each chunk lists its files foundations-first, and related
 * files owned by other chunks are appended as read-only context parts (`role: 'context'`).
 */
export function buildChunks(units: ReviewUnit[], opts: ChunkingOptions): ChunkingResult {
  const sorted = [...units].sort((a, b) => cmp(a.path, b.path));
  const mentions = [...new Set(sorted.filter((u) => u.status === 'deleted').map((u) => u.path))];
  const rendered = new Map<string, ChunkPart[]>();
  const unitByPath = new Map<string, ReviewUnit>();
  for (const u of sorted) {
    if (u.status === 'deleted') continue;
    const parts = renderUnit(u, { ...opts, maxPartTokens: opts.budget }).map(
      (p): ChunkPart => ({ ...p, role: 'review' }),
    );
    if (!parts.length) continue;
    if (!unitByPath.has(u.path)) unitByPath.set(u.path, u);
    rendered.set(u.path, [...(rendered.get(u.path) ?? []), ...parts]);
  }
  const files = [...rendered.keys()];
  const edges = opts.graph?.edges ?? directoryEdges(files);
  const index = new AffinityIndex(edges, new Set(files));
  const strategy = opts.strategy ?? (opts.graph ? 'smart' : 'directory');
  const groups =
    strategy === 'smart'
      ? smartGroups(files, rendered, edges, opts, index)
      : directoryGroups(rendered, opts.budget);

  const chunks = groups.map((parts, i): Chunk => {
    const owned = [...new Set(parts.map((p) => p.path))];
    return {
      id: chunkId(i),
      index: i,
      parts,
      tokens: parts.reduce((s, p) => s + p.tokens, 0),
      files: owned,
      contextFiles: [],
      languages: [...new Set(parts.map((p) => p.language))],
      mentions: i === 0 ? mentions : [],
      groupReasons: index.reasons(owned),
    };
  });

  const share = Math.max(0, opts.contextShare ?? DEFAULT_CONTEXT_SHARE);
  if (opts.graph && share > 0 && chunks.length > 1) {
    addContext(chunks, unitByPath, opts.graph, Math.floor(share * opts.budget), opts.maxTotalTokens);
  }
  return { chunks, mentions };
}

function chunkId(i: number): string {
  return `c${String(i + 1).padStart(3, '0')}`;
}

/** Legacy packing: directory order, sequential fill. */
function directoryGroups(rendered: Map<string, ChunkPart[]>, budget: number): ChunkPart[][] {
  const ordered = [...rendered.keys()].sort(
    (a, b) => path.posix.dirname(a).localeCompare(path.posix.dirname(b)) || a.localeCompare(b),
  );
  const groups: ChunkPart[][] = [];
  let current: ChunkPart[] = [];
  let tokens = 0;
  for (const part of ordered.flatMap((f) => rendered.get(f)!)) {
    if (current.length && tokens + part.tokens > budget) {
      groups.push(current);
      current = [];
      tokens = 0;
    }
    current.push(part);
    tokens += part.tokens;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Cluster → pack → order: related files together, chunks ordered by their first path. */
function smartGroups(
  files: string[],
  rendered: Map<string, ChunkPart[]>,
  edges: readonly FileEdge[],
  opts: ChunkingOptions,
  index: AffinityIndex,
): ChunkPart[][] {
  const budget = opts.budget;
  const sizes = new Map(files.map((f) => [f, rendered.get(f)!.reduce((s, p) => s + p.tokens, 0)]));
  const items: PackItem[] = [];
  const itemParts = new Map<string, ChunkPart[]>();
  for (const g of clusterFiles(files, sizes, edges, budget, index)) {
    if (g.tokens <= budget || g.files.length > 1) {
      const key = g.files[0]!;
      items.push({ key, files: g.files, tokens: g.tokens });
      itemParts.set(
        key,
        g.files.flatMap((f) => rendered.get(f)!),
      );
      continue;
    }
    // a single file over budget: its parts are placed one by one
    const file = g.files[0]!;
    rendered.get(file)!.forEach((p, i) => {
      const key = `${file}\0${String(i).padStart(6, '0')}`;
      items.push({ key, files: [file], tokens: p.tokens });
      itemParts.set(key, [p]);
    });
  }

  const bins = packItems(items, budget, index).map((bin) => {
    const byFile = new Map<string, ChunkPart[]>();
    for (const item of bin.items) {
      for (const p of itemParts.get(item.key)!) {
        const list = byFile.get(p.path);
        if (list) list.push(p);
        else byFile.set(p.path, [p]);
      }
    }
    for (const list of byFile.values()) list.sort((a, b) => (a.part?.index ?? 0) - (b.part?.index ?? 0));
    const order = orderFiles([...byFile.keys()], opts.graph?.imports);
    const parts = order.flatMap((f) => byFile.get(f)!);
    const first = [...byFile.keys()].sort(cmp)[0]!;
    return { parts, first, firstPart: byFile.get(first)![0]!.part?.index ?? 0 };
  });
  bins.sort((a, b) => cmp(a.first, b.first) || a.firstPart - b.firstPart);
  return bins.map((b) => b.parts);
}

/**
 * Appends read-only excerpts of import neighbours owned by other chunks: files a chunk imports first
 * (their API is what the chunk's code relies on), then files importing it (its callers). Each chunk gets
 * at most `cap` context tokens (and never more than `maxTotal` in total), shared fairly among candidates.
 */
function addContext(
  chunks: Chunk[],
  units: Map<string, ReviewUnit>,
  graph: FileGraph,
  cap: number,
  maxTotal: number | undefined,
): void {
  const owners = new Map<string, string[]>();
  for (const c of chunks) {
    for (const f of c.files) {
      const list = owners.get(f);
      if (list) list.push(c.id);
      else owners.set(f, [c.id]);
    }
  }
  const importedBy = new Map<string, string[]>();
  for (const [from, targets] of graph.imports) {
    if (!owners.has(from)) continue;
    for (const t of targets) {
      if (t === from || !owners.has(t)) continue;
      const list = importedBy.get(t);
      if (list) list.push(from);
      else importedBy.set(t, [from]);
    }
  }
  const excerpts = new Map<string, ContextExcerpt | undefined>();
  const excerptOf = (file: string) => {
    if (!excerpts.has(file)) {
      const unit = units.get(file);
      excerpts.set(file, unit ? prepareContextExcerpt(unit) : undefined);
    }
    return excerpts.get(file);
  };

  for (const chunk of chunks) {
    let remaining = maxTotal === undefined ? cap : Math.min(cap, maxTotal - chunk.tokens);
    if (remaining < MIN_CONTEXT_TOKENS) continue;
    const own = new Set(chunk.files);
    const score = new Map<string, { uses: number; usedBy: number }>();
    const bump = (file: string, key: 'uses' | 'usedBy') => {
      if (own.has(file) || !owners.has(file)) return;
      const s = score.get(file) ?? { uses: 0, usedBy: 0 };
      s[key]++;
      score.set(file, s);
    };
    for (const f of chunk.files) {
      for (const t of graph.imports.get(f) ?? []) bump(t, 'uses');
      for (const d of importedBy.get(f) ?? []) bump(d, 'usedBy');
    }
    const candidates = [...score]
      .sort(
        ([pa, a], [pb, b]) =>
          Number(b.uses > 0) - Number(a.uses > 0) || b.uses + b.usedBy - (a.uses + a.usedBy) || cmp(pa, pb),
      )
      // only as many files as can get a useful excerpt, best first
      .slice(0, Math.min(MAX_CONTEXT_FILES, Math.floor(remaining / MIN_CONTEXT_TOKENS)))
      .map(([file]) => file);

    const added: ChunkPart[] = [];
    for (let i = 0; i < candidates.length && remaining >= MIN_CONTEXT_TOKENS; i++) {
      const file = candidates[i]!;
      const excerpt = excerptOf(file);
      if (!excerpt) continue;
      // fair share of what is left; unused tokens of a short excerpt go to the next file
      const allowance = Math.max(MIN_CONTEXT_TOKENS, Math.floor(remaining / (candidates.length - i)));
      const part = renderContextPart(excerpt, Math.min(allowance, remaining), owners.get(file)!);
      if (!part) continue;
      added.push(part);
      remaining -= part.tokens;
    }
    if (!added.length) continue;
    chunk.parts.push(...added);
    chunk.tokens += added.reduce((s, p) => s + p.tokens, 0);
    chunk.contextFiles = added.map((p) => p.path);
  }
}

/**
 * Splits a chunk that was too big to review in one go into two halves of about equal size (ids `<id>.1`,
 * `<id>.2`), keeping the parts of one file together when possible. Read-only context is left out to keep
 * the halves small. Undefined when the chunk reviews a single part.
 */
export function splitChunk(chunk: Chunk): [Chunk, Chunk] | undefined {
  const parts = chunk.parts.filter((p) => (p.role ?? 'review') === 'review');
  if (parts.length < 2) return undefined;
  const total = parts.reduce((s, p) => s + p.tokens, 0);
  // Cut at the file boundary closest to the middle; within a file only when the chunk is a single file.
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  let acc = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    acc += parts[i]!.tokens;
    const fileBoundary = parts[i]!.path !== parts[i + 1]!.path;
    const gap = Math.abs(total / 2 - acc) + (fileBoundary ? 0 : total);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  const half = (list: ChunkPart[], n: number, mentions: string[]): Chunk => {
    const files = [...new Set(list.map((p) => p.path))];
    return {
      id: `${chunk.id}.${n}`,
      index: chunk.index,
      parts: list,
      tokens: list.reduce((s, p) => s + p.tokens, 0),
      files,
      contextFiles: [],
      languages: [...new Set(list.map((p) => p.language))],
      mentions,
      ...(chunk.groupReasons ? { groupReasons: chunk.groupReasons } : {}),
    };
  };
  return [half(parts.slice(0, best + 1), 1, chunk.mentions), half(parts.slice(best + 1), 2, [])];
}

/** Chunk ids in execution order: largest first (shortens wall-clock time under a concurrency limit). */
export function scheduleOrder(chunks: readonly Chunk[]): string[] {
  return [...chunks].sort((a, b) => b.tokens - a.tokens || cmp(a.id, b.id)).map((c) => c.id);
}

/** Rendered code of a chunk, as placed in the prompt (review parts, then read-only context parts). */
export function chunkText(chunk: Chunk): string {
  return chunk.parts.map((p) => p.text).join('\n');
}

/** Rendered code of the parts of one role: reviewed code, read-only context or related unchanged code. */
export function chunkTextFor(chunk: Chunk, role: 'review' | 'context' | 'related'): string {
  return chunk.parts
    .filter((p) => (p.role ?? 'review') === role)
    .map((p) => p.text)
    .join('\n');
}
