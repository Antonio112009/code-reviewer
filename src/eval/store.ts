import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { EvalResult } from './types';

export const RESULT_FILE = 'result.json';

/** Eval ids become path segments (same rule as run ids). */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Writes `<dir>/result.json` atomically; returns its path. */
export async function saveEvalResult(dir: string, result: EvalResult): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, RESULT_FILE);
  await writeFile(`${file}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
  return file;
}

const count = z.number().finite().nonnegative();
const ratio = z.number().finite().min(0).max(1).nullable();

/** What `--compare` reads from a previous result, validated: the file may have been edited or planted. */
const MetricsSchema = z.object({
  runs: count,
  errors: count,
  expected: count,
  found: count,
  missed: count,
  unexpected: count,
  duplicates: count,
  falsePositives: count,
  underrated: count,
  lost: count,
  saved: count,
  recall: ratio,
  precision: ratio,
  f1: ratio,
  rawRecall: ratio,
  rawPrecision: ratio,
  chunks: count,
  failedChunks: count,
  inputTokens: count,
  cachedInputTokens: count.optional(),
  outputTokens: count,
  cost: count.optional(),
  unpricedCalls: count.optional(),
  durationMs: count,
});

const ResultSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      defects: z.array(
        z.object({
          file: z.string(),
          startLine: count,
          endLine: count,
          note: z.string().optional(),
          found: count,
        }),
      ),
      metrics: MetricsSchema,
    }),
  ),
});

async function readResult(file: string): Promise<EvalResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: not a readable eval result (${(err as Error).message})`);
  }
  const parsed = ResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file}: not an eval result:\n${z.prettifyError(parsed.error)}`);
  return raw as EvalResult;
}

/** Eval directories under `evalsDir` holding a result, newest first (ids sort by time). */
export async function listEvalIds(evalsDir: string): Promise<string[]> {
  if (!existsSync(evalsDir)) return [];
  const entries = await readdir(evalsDir, { withFileTypes: true });
  return entries
    .filter(
      (e) => e.isDirectory() && SEGMENT.test(e.name) && existsSync(path.join(evalsDir, e.name, RESULT_FILE)),
    )
    .map((e) => e.name)
    .sort()
    .reverse();
}

/**
 * Loads a previous result for `--compare`: a result file, a directory holding one, an eval id (or a unique
 * prefix) in `evalsDir`, or `latest`.
 */
export async function loadEvalResult(
  ref: string,
  opts: { cwd: string; evalsDir: string },
): Promise<{ result: EvalResult; file: string }> {
  if (ref === 'latest' || ref === 'last') {
    const [latest] = await listEvalIds(opts.evalsDir);
    if (!latest) throw new Error(`No eval results in ${opts.evalsDir}`);
    const file = path.join(opts.evalsDir, latest, RESULT_FILE);
    return { result: await readResult(file), file };
  }
  const asPath = path.resolve(opts.cwd, ref);
  if (existsSync(asPath)) {
    const file = statSync(asPath).isDirectory() ? path.join(asPath, RESULT_FILE) : asPath;
    return { result: await readResult(file), file };
  }
  if (SEGMENT.test(ref)) {
    const matches = (await listEvalIds(opts.evalsDir)).filter((id) => id === ref || id.startsWith(ref));
    const exact = matches.find((id) => id === ref);
    const id = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (matches.length > 1 && !exact)
      throw new Error(`Ambiguous eval id "${ref}": ${matches.slice(0, 5).join(', ')}`);
    if (id) {
      const file = path.join(opts.evalsDir, id, RESULT_FILE);
      return { result: await readResult(file), file };
    }
  }
  throw new Error(
    `Eval result "${ref}" not found (a result.json, its directory, an id in ${opts.evalsDir} or "latest")`,
  );
}
