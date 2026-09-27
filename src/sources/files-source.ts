import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GitRepo } from '../git/repo';
import type { ReviewUnit } from '../types';
import { detectLanguage } from '../util/language';
import { toPosix } from '../util/paths';
import { type CollectedUnits, makeExcluder, type SkippedFile } from './diff-source';

const MAX_FILE_BYTES = 512 * 1024;
const WALK_IGNORES = new Set([
  '.git',
  'node_modules',
  '.code-reviewer',
  'dist',
  'build',
  '.venv',
  'venv',
  '__pycache__',
]);

/**
 * Builds whole-file review units for the given paths (files or directories).
 * Inside a git repository `.gitignore` is honoured via `git ls-files`.
 * Returned paths are relative to `root`.
 */
export async function collectFileUnits(opts: {
  root: string;
  cwd: string;
  paths: string[];
  exclude: string[];
  repo?: GitRepo;
}): Promise<CollectedUnits> {
  const isExcluded = makeExcluder(opts.exclude);
  const inputs = opts.paths.length ? opts.paths : ['.'];
  const candidates = opts.repo
    ? await opts.repo.listFiles(inputs, opts.cwd)
    : await walk(
        opts.root,
        inputs.map((p) => path.resolve(opts.cwd, p)),
      );

  const units: ReviewUnit[] = [];
  const skipped: SkippedFile[] = [];
  for (const rel of candidates.sort()) {
    if (isExcluded(rel)) {
      skipped.push({ path: rel, reason: 'excluded' });
      continue;
    }
    const abs = path.join(opts.root, rel);
    let size: number;
    try {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        // never follow links: they can point outside the repository (e.g. at credentials)
        skipped.push({ path: rel, reason: 'symlink' });
        continue;
      }
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue; // listed by git but deleted in the working tree
    }
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: `too large (${Math.round(size / 1024)} KiB)` });
      continue;
    }
    const buf = await readFile(abs);
    if (buf.includes(0)) {
      skipped.push({ path: rel, reason: 'binary' });
      continue;
    }
    units.push({
      path: rel,
      status: 'file',
      language: detectLanguage(rel),
      hunks: [],
      content: buf.toString('utf8'),
      focusRanges: [],
    });
  }
  return { units, skipped };
}

async function walk(root: string, starts: string[]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (abs: string) => {
    let st: Awaited<ReturnType<typeof lstat>>;
    try {
      st = await lstat(abs);
    } catch {
      return;
    }
    if (st.isFile() || st.isSymbolicLink()) {
      out.push(toPosix(path.relative(root, abs)));
      return;
    }
    if (!st.isDirectory()) return;
    for (const entry of await readdir(abs)) {
      if (WALK_IGNORES.has(entry)) continue;
      await visit(path.join(abs, entry));
    }
  };
  for (const s of starts) await visit(s);
  return [...new Set(out)];
}
