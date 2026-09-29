import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Config } from '../config/schema';
import {
  type ReportedFinding,
  ReportedFindingSchema,
  type ReportedVerdict,
  SEVERITIES,
  type StaticHit,
  VERDICTS,
} from '../types';
import type { Logger } from '../util/logger';
import { resolveInside } from '../util/paths';
import { type CacheLocation, cacheDirCandidates, pickCacheDir } from './location';
import { CACHE_FORMAT, cacheKey, loadCacheSecret, ResultCache, sha256 } from './store';

/** Files larger than this are never hashed for validation: a result that read one is not cached. */
const MAX_HASHED_FILE = 8 * 1024 * 1024;

export interface CacheRoute {
  provider: string;
  model?: string;
  reasoning: string;
}

/**
 * Opens the result cache for a run, or undefined when it is off or no candidate directory is writable
 * (with a warning: the review goes on without it).
 */
export async function openResultCache(opts: {
  config: Config;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  warn: (message: string) => void;
  logger: Logger;
}): Promise<{ cache: ResultCache; location: CacheLocation } | undefined> {
  if (!opts.config.cache.enabled) return undefined;
  const candidates = cacheDirCandidates({
    env: opts.env,
    configured: opts.config.cache.dir,
    repoRoot: opts.repoRoot,
  });
  const location = await pickCacheDir(candidates, (c) =>
    opts.logger.debug(`cache: ${c.dir} (${c.source}) is not writable`),
  );
  if (!location) {
    opts.warn(
      'No writable cache directory: reviewing without the result cache (set CODE_REVIEWER_CACHE_DIR).',
    );
    return undefined;
  }
  const { secret, persistent } = await loadCacheSecret(opts.env);
  if (!persistent) opts.logger.debug('cache: no persistent signing key; entries only serve this run');
  opts.logger.debug(`cache: ${location.dir} (${location.source})`);
  return { cache: new ResultCache(location.dir, secret), location };
}

// ---------------------------------------------------------------------------
// Files the model read
// ---------------------------------------------------------------------------

/** Content hashes of the files a model read, or undefined when one cannot be hashed (then: no caching). */
export async function hashReads(
  root: string,
  reads: readonly string[],
): Promise<Record<string, string> | undefined> {
  const out: Record<string, string> = {};
  for (const rel of [...new Set(reads)].sort()) {
    try {
      const abs = resolveInside(root, rel);
      const info = await stat(abs);
      if (!info.isFile() || info.size > MAX_HASHED_FILE) return undefined;
      out[rel] = sha256(await readFile(abs));
    } catch {
      // A file that is gone now was read in an earlier state: nothing to compare against later.
      out[rel] = 'missing';
    }
  }
  return out;
}

/** True when every file a cached answer relied on still has the same content in `root`. */
export async function readsUnchanged(root: string, reads: Record<string, string>): Promise<boolean> {
  const now = await hashReads(root, Object.keys(reads));
  if (!now) return false;
  return Object.entries(reads).every(([rel, hash]) => now[rel] === hash);
}

// ---------------------------------------------------------------------------
// Review answers
// ---------------------------------------------------------------------------

/** Hint ids (`H3`) are numbered per run; cached answers refer to hints by what they are. */
export function hintIdentity(
  h: Pick<StaticHit, 'analyzer' | 'ruleId' | 'file' | 'startLine' | 'endLine'>,
): string {
  return `${h.analyzer}|${h.ruleId}|${h.file}|${h.startLine}|${h.endLine}`;
}

/** Key of a review task: the answer-deciding parts of its prompt (see `reviewPromptIdentity`) and model. */
export function reviewCacheKey(material: {
  route: CacheRoute;
  instructions: string;
  prompt: unknown;
  readTools: boolean;
  git: boolean;
  maxOutputTokens?: number;
}): string {
  return cacheKey({
    format: CACHE_FORMAT,
    kind: 'review',
    route: {
      provider: material.route.provider,
      model: material.route.model ?? null,
      reasoning: material.route.reasoning,
    },
    instructions: material.instructions,
    prompt: material.prompt,
    readTools: material.readTools,
    git: material.git,
    maxOutputTokens: material.maxOutputTokens ?? null,
  });
}

const UsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
});

/**
 * A cached review: the model's findings (hints referred to by identity), or `split`, a chunk that had to be
 * split to be reviewed at all (the next run starts with its halves).
 */
export const CachedReviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('result'),
    items: z.array(ReportedFindingSchema).max(500),
    provider: z.string(),
    model: z.string().optional(),
    /** Tokens the answer took when it was made (shown as saved). */
    usage: UsageSchema.optional(),
    reads: z.record(z.string(), z.string()),
  }),
  z.object({ kind: z.literal('split') }),
]);
export type CachedReview = z.infer<typeof CachedReviewSchema>;

/** Replaces run-local hint ids by hint identities (to store) or back (to use); unknown hints are dropped. */
export function mapHints(
  items: readonly ReportedFinding[],
  map: ReadonlyMap<string, string>,
): ReportedFinding[] {
  return items.map((r) => {
    if (!r.hint) return r;
    const { hint, ...rest } = r;
    const mapped = map.get(hint);
    return mapped ? { ...rest, hint: mapped } : rest;
  });
}

export async function getReview(
  cache: ResultCache,
  key: string,
  root: string,
): Promise<CachedReview | undefined> {
  const parsed = CachedReviewSchema.safeParse(await cache.get('review', key));
  if (!parsed.success) return undefined;
  if (parsed.data.kind === 'result' && !(await readsUnchanged(root, parsed.data.reads))) return undefined;
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Critique verdicts
// ---------------------------------------------------------------------------

/** Key of the critic's verdict on one finding: the finding as shown, its code excerpt and the critic. */
export function critiqueCacheKey(material: {
  route: CacheRoute;
  instructions: string;
  finding: unknown;
  excerpt: string;
  readTools: boolean;
}): string {
  return cacheKey({
    format: CACHE_FORMAT,
    kind: 'critique',
    route: {
      provider: material.route.provider,
      model: material.route.model ?? null,
      reasoning: material.route.reasoning,
    },
    instructions: material.instructions,
    finding: material.finding,
    excerpt: material.excerpt,
    readTools: material.readTools,
  });
}

export const CachedVerdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(4_000),
  severity: z.enum(SEVERITIES).optional(),
  replacementOk: z.boolean().optional(),
  reads: z.record(z.string(), z.string()),
});
export type CachedVerdict = z.infer<typeof CachedVerdictSchema>;

export async function getVerdict(
  cache: ResultCache,
  key: string,
  root: string,
): Promise<Omit<ReportedVerdict, 'id'> | undefined> {
  const parsed = CachedVerdictSchema.safeParse(await cache.get('critique', key));
  if (!parsed.success || !(await readsUnchanged(root, parsed.data.reads))) return undefined;
  const { reads: _reads, ...verdict } = parsed.data;
  return verdict;
}
