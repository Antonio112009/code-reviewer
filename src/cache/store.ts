import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { globalConfigDir } from '../util/paths';

/** Bumped when the meaning of cached entries changes: old entries then simply stop matching. */
export const CACHE_FORMAT = 1;
/** Entries live under `<dir>/v<format>/<kind>/<2 hex>/<key>.json`; only that tree is ever pruned or cleared. */
const TREE = `v${CACHE_FORMAT}`;
const KINDS = ['review', 'critique'] as const;
export type CacheKind = (typeof KINDS)[number];

const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const KEY_RE = /^[0-9a-f]{64}$/;
const SECRET_FILE = 'cache.key';
const MIN_SECRET_CHARS = 32;
const PRUNE_MARKER = 'last-prune';
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Temp files of interrupted writes older than this are removed by `prune`. */
const STALE_TMP_MS = 60 * 60 * 1000;

interface Envelope {
  format: number;
  kind: CacheKind;
  key: string;
  createdAt: string;
  data: unknown;
  mac: string;
}

/** Deterministic JSON (object keys sorted) for hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** Cache key of everything that decides an answer. */
export function cacheKey(material: unknown): string {
  return createHash('sha256').update(canonicalJson(material)).digest('hex');
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The secret that signs cache entries: `CODE_REVIEWER_CACHE_KEY` (for a cache shared between CI jobs), else
 * a random key kept in the global config directory. Entries are signed so that a cache inside the reviewed
 * repository, or one restored from another job, cannot be seeded with a clean result for malicious code.
 * Without a usable key an in-memory one is made: the cache then only serves the current run.
 */
export async function loadCacheSecret(env: NodeJS.ProcessEnv = process.env): Promise<{
  secret: Buffer;
  persistent: boolean;
}> {
  const fromEnv = env.CODE_REVIEWER_CACHE_KEY?.trim();
  if (fromEnv && fromEnv.length >= MIN_SECRET_CHARS)
    return { secret: Buffer.from(fromEnv), persistent: true };
  const file = path.join(globalConfigDir(), SECRET_FILE);
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length >= MIN_SECRET_CHARS) return { secret: Buffer.from(existing), persistent: true };
  } catch {
    // not created yet
  }
  const fresh = randomBytes(32).toString('hex');
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${fresh}\n`, { mode: 0o600, flag: 'wx' });
    return { secret: Buffer.from(fresh), persistent: true };
  } catch {
    // Another process created it first: use theirs.
    try {
      const existing = (await readFile(file, 'utf8')).trim();
      if (existing.length >= MIN_SECRET_CHARS) return { secret: Buffer.from(existing), persistent: true };
    } catch {
      // unreadable: fall through
    }
    return { secret: Buffer.from(fresh), persistent: false };
  }
}

export interface CacheStatsSummary {
  dir: string;
  entries: Record<CacheKind, number>;
  bytes: number;
  oldest?: Date;
  newest?: Date;
}

export interface PruneResult {
  removed: number;
  freedBytes: number;
  remaining: number;
  remainingBytes: number;
}

interface EntryFile {
  file: string;
  size: number;
  mtimeMs: number;
}

/**
 * Content-addressed store of model answers. Entries are signed JSON files written atomically, so
 * concurrent runs are safe; a damaged, foreign or tampered entry is a miss, never an error. Reads refresh
 * the modification time, which `prune` uses to drop the least recently used entries.
 */
export class ResultCache {
  constructor(
    readonly dir: string,
    private readonly secret: Buffer,
  ) {}

  private fileFor(kind: CacheKind, key: string): string {
    return path.join(this.dir, TREE, kind, key.slice(0, 2), `${key}.json`);
  }

  private mac(kind: CacheKind, key: string, data: unknown): string {
    return createHmac('sha256', this.secret)
      .update(`${kind}\n${key}\n${canonicalJson(data)}`)
      .digest('hex');
  }

  async get(kind: CacheKind, key: string): Promise<unknown | undefined> {
    if (!KEY_RE.test(key)) return undefined;
    const file = this.fileFor(kind, key);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_ENTRY_BYTES) return undefined;
      const entry = JSON.parse(await readFile(file, 'utf8')) as Partial<Envelope> | null;
      if (!entry || entry.format !== CACHE_FORMAT || entry.kind !== kind || entry.key !== key)
        return undefined;
      if (typeof entry.mac !== 'string' || !/^[0-9a-f]{64}$/.test(entry.mac)) return undefined;
      const expected = Buffer.from(this.mac(kind, key, entry.data), 'hex');
      if (!timingSafeEqual(expected, Buffer.from(entry.mac, 'hex'))) return undefined;
      const now = new Date();
      await utimes(file, now, now).catch(() => undefined);
      return entry.data;
    } catch {
      return undefined;
    }
  }

  /** Stores an entry; failures (full disk, permissions) are ignored: the cache is an optimisation. */
  async set(kind: CacheKind, key: string, data: unknown): Promise<boolean> {
    if (!KEY_RE.test(key)) return false;
    const file = this.fileFor(kind, key);
    const entry: Envelope = {
      format: CACHE_FORMAT,
      kind,
      key,
      createdAt: new Date().toISOString(),
      data,
      mac: this.mac(kind, key, data),
    };
    const text = JSON.stringify(entry);
    if (Buffer.byteLength(text) > MAX_ENTRY_BYTES) return false;
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(tmp, text);
      await rename(tmp, file);
      return true;
    } catch {
      await unlink(tmp).catch(() => undefined);
      return false;
    }
  }

  private async files(): Promise<{ entries: Array<EntryFile & { kind: CacheKind }>; tmp: EntryFile[] }> {
    const entries: Array<EntryFile & { kind: CacheKind }> = [];
    const tmp: EntryFile[] = [];
    for (const kind of KINDS) {
      const base = path.join(this.dir, TREE, kind);
      const shards = await readdir(base, { withFileTypes: true }).catch(() => []);
      for (const shard of shards) {
        if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
        const names = await readdir(path.join(base, shard.name)).catch(() => []);
        for (const name of names) {
          const file = path.join(base, shard.name, name);
          const info = await stat(file).catch(() => undefined);
          if (!info?.isFile()) continue;
          const item = { file, size: info.size, mtimeMs: info.mtimeMs };
          if (name.endsWith('.tmp')) tmp.push(item);
          else if (name.endsWith('.json')) entries.push({ ...item, kind });
        }
      }
    }
    return { entries, tmp };
  }

  async stats(): Promise<CacheStatsSummary> {
    const { entries } = await this.files();
    const counts: Record<CacheKind, number> = { review: 0, critique: 0 };
    for (const e of entries) counts[e.kind]++;
    const times = entries.map((e) => e.mtimeMs);
    return {
      dir: this.dir,
      entries: counts,
      bytes: entries.reduce((n, e) => n + e.size, 0),
      ...(times.length ? { oldest: new Date(Math.min(...times)), newest: new Date(Math.max(...times)) } : {}),
    };
  }

  /** Removes entries unused for `maxAgeMs`, then the least recently used ones above `maxBytes`. */
  async prune(opts: { maxAgeMs?: number; maxBytes?: number; now?: number }): Promise<PruneResult> {
    const now = opts.now ?? Date.now();
    const { entries, tmp } = await this.files();
    let removed = 0;
    let freed = 0;
    const drop = async (e: EntryFile) => {
      if (
        await unlink(e.file).then(
          () => true,
          () => false,
        )
      ) {
        removed++;
        freed += e.size;
      }
    };
    for (const t of tmp) if (now - t.mtimeMs > STALE_TMP_MS) await unlink(t.file).catch(() => undefined);
    let kept = entries;
    if (opts.maxAgeMs !== undefined) {
      const cutoff = now - opts.maxAgeMs;
      for (const e of entries.filter((x) => x.mtimeMs < cutoff)) await drop(e);
      kept = entries.filter((x) => x.mtimeMs >= cutoff);
    }
    let bytes = kept.reduce((n, e) => n + e.size, 0);
    if (opts.maxBytes !== undefined && bytes > opts.maxBytes) {
      const oldestFirst = [...kept].sort((a, b) => a.mtimeMs - b.mtimeMs);
      const survivors = new Set(kept);
      for (const e of oldestFirst) {
        if (bytes <= opts.maxBytes) break;
        await drop(e);
        survivors.delete(e);
        bytes -= e.size;
      }
      kept = [...survivors];
    }
    return { removed, freedBytes: freed, remaining: kept.length, remainingBytes: bytes };
  }

  /** Prunes at most once a day (a marker file records the last time). */
  async autoPrune(opts: { maxAgeMs: number; maxBytes: number }): Promise<PruneResult | undefined> {
    const marker = path.join(this.dir, PRUNE_MARKER);
    const last = await stat(marker).then(
      (s) => s.mtimeMs,
      () => 0,
    );
    if (Date.now() - last < PRUNE_INTERVAL_MS) return undefined;
    await writeFile(marker, '').catch(() => undefined);
    return this.prune(opts);
  }

  /** Deletes every entry (only this tool's entry tree: the directory itself may be shared). */
  async clear(): Promise<void> {
    await rm(path.join(this.dir, TREE), { recursive: true, force: true });
    await rm(path.join(this.dir, PRUNE_MARKER), { force: true });
  }
}
