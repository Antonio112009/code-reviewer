import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside } from './env';
import type { Sandbox, SourceFile } from './types';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Validates a repo-relative POSIX path before it is written into a sandbox or passed to a tool:
 * no absolute paths, drive letters, backslashes, NUL bytes, empty/`.`/`..` segments.
 */
export function safeRelativePath(p: string): string | undefined {
  if (!p || p.length > 4096 || p.includes('\0') || p.includes('\\')) return undefined;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return undefined;
  if (IS_WINDOWS && /[<>:"|?*]/.test(p)) return undefined;
  const segments = p.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return undefined;
  return p;
}

/** A path argument for a tool: `./rel` so that a file named `-rf` is never parsed as an option. */
export function toolArg(rel: string): string {
  return `./${rel}`;
}

export interface OwnedSandbox extends Sandbox {
  /** Removes the whole sandbox (our own temp dir). Never throws. */
  remove(): Promise<void>;
}

/**
 * Writes `files` into a fresh temp dir outside the repository. Only regular files are created (never
 * symlinks), each exclusively (`wx`), so nothing a PR contains can redirect a write or a later read.
 */
export async function createSandbox(
  label: string,
  files: SourceFile[],
  opts: { repoRoot?: string; transform?: (file: SourceFile) => string } = {},
): Promise<OwnedSandbox> {
  const safeLabel = label.replace(/[^\w-]/g, '_').slice(0, 32);
  const created = await mkdtemp(path.join(tmpdir(), `cr-analyze-${safeLabel}-`));
  const root = await realpath(created);
  const remove = async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  };
  if (opts.repoRoot && isInside(opts.repoRoot, root)) {
    await remove();
    throw new Error('the temporary directory is inside the repository under review');
  }
  const dir = path.join(root, 'src');
  const outDir = path.join(root, 'out');
  await mkdir(dir, { mode: 0o700 });
  await mkdir(outDir, { mode: 0o700 });
  const written: string[] = [];
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    const rel = safeRelativePath(file.path);
    if (!rel) continue;
    const abs = path.join(dir, ...rel.split('/'));
    try {
      await mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
      await writeFile(abs, opts.transform ? opts.transform(file) : file.content, { flag: 'wx', mode: 0o600 });
      written.push(rel);
    } catch {
      // Case-insensitive collision, file/directory clash, …: analyse the rest.
    }
  }
  return { dir, outDir, files: written, remove };
}

/**
 * Maps a path reported by a tool (relative to `baseDir`, absolute, `./`-prefixed or a `file://` URI)
 * back to a repo-relative POSIX path, if it is one of `known`.
 */
export function toRepoPath(
  reported: string,
  baseDir: string,
  known: ReadonlySet<string>,
): string | undefined {
  const rel = repoRelativePath(reported, baseDir);
  return rel !== undefined && known.has(rel) ? rel : undefined;
}

/**
 * Like `toRepoPath`, for any path inside `baseDir` (e.g. a lockfile the change did not touch); undefined
 * when it is outside `baseDir` or not a safe relative path.
 */
export function repoRelativePath(reported: string, baseDir: string): string | undefined {
  let p = reported.trim();
  if (!p) return undefined;
  if (p.startsWith('file:')) {
    try {
      p = fileURLToPath(p);
    } catch {
      return undefined;
    }
  }
  let rel: string;
  if (path.isAbsolute(p)) {
    const candidates = [path.relative(baseDir, p)];
    try {
      // macOS: /var/folders/… vs /private/var/folders/…
      candidates.push(path.relative(baseDir, p.replace(/^\/private\//, '/')));
      candidates.push(path.relative(baseDir.replace(/^\/private\//, '/'), p));
    } catch {
      // ignore
    }
    const inside = candidates.find((c) => c && !c.startsWith('..') && !path.isAbsolute(c));
    if (!inside) return undefined;
    rel = inside;
  } else {
    rel = p;
  }
  rel = rel
    .split(path.sep)
    .join('/')
    .replace(/^(?:\.\/)+/, '');
  return safeRelativePath(rel);
}
