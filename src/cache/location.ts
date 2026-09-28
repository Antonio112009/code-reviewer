import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { PROJECT_DIR } from '../util/paths';

export type CacheDirSource = 'env' | 'config' | 'project' | 'os' | 'tmp';

export interface CacheLocation {
  dir: string;
  source: CacheDirSource;
}

const APP = 'code-reviewer';

/**
 * The per-user cache directory of the platform: `~/Library/Caches/code-reviewer` (macOS),
 * `%LOCALAPPDATA%\code-reviewer\Cache` (Windows; never the roaming profile, which is synced to a server),
 * `$XDG_CACHE_HOME/code-reviewer` or `~/.cache/code-reviewer` (Linux and others).
 */
export function osCacheDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', APP);
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    const base = local && path.win32.isAbsolute(local) ? local : path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, APP, 'Cache');
  }
  const xdg = env.XDG_CACHE_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, '.cache'), APP);
}

/** Last resort: a per-user directory in the system temp dir (the OS may clean it; only misses follow). */
function tmpCacheDir(tmp: string = tmpdir()): string {
  let user = 'user';
  try {
    user = userInfo().username.replace(/[^\w.-]/g, '_') || user;
  } catch {
    // no user name (some containers): shared name, entries are still signed
  }
  return path.join(tmp, `${APP}-cache-${user}`);
}

export interface CacheDirOptions {
  env?: NodeJS.ProcessEnv;
  /** `cache.dir` of the (global) configuration: an absolute path or `project`. */
  configured?: string;
  /** Repository root, for `cache.dir: project`. */
  repoRoot?: string;
  platform?: NodeJS.Platform;
  home?: string;
  tmp?: string;
}

/**
 * Where the cache may live, in order: `CODE_REVIEWER_CACHE_DIR` (absolute paths only: a relative value would
 * point into the checkout), `cache.dir` (an absolute path, or `project` for `.code-reviewer/cache` in the
 * repository), the platform's cache directory, then the temp directory.
 */
export function cacheDirCandidates(opts: CacheDirOptions = {}): CacheLocation[] {
  const env = opts.env ?? process.env;
  const out: CacheLocation[] = [];
  const fromEnv = env.CODE_REVIEWER_CACHE_DIR?.trim();
  if (fromEnv && path.isAbsolute(fromEnv)) out.push({ dir: fromEnv, source: 'env' });
  if (opts.configured === 'project' && opts.repoRoot) {
    out.push({ dir: path.join(opts.repoRoot, PROJECT_DIR, 'cache'), source: 'project' });
  } else if (opts.configured && path.isAbsolute(opts.configured)) {
    out.push({ dir: opts.configured, source: 'config' });
  }
  out.push({ dir: osCacheDir(opts.platform, env, opts.home), source: 'os' });
  out.push({ dir: tmpCacheDir(opts.tmp), source: 'tmp' });
  return out;
}

/** True when files can be created (and removed) in `dir`, which is created if needed. */
export async function isWritableDir(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.probe-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, '');
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first writable candidate. Locked-down machines (read-only home, managed folders) fall through to the
 * next one; undefined when none is writable, and the review runs without a cache.
 */
export async function pickCacheDir(
  candidates: CacheLocation[],
  onSkip?: (location: CacheLocation) => void,
): Promise<CacheLocation | undefined> {
  for (const c of candidates) {
    if (await isWritableDir(c.dir)) return c;
    onSkip?.(c);
  }
  return undefined;
}
