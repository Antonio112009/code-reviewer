import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareVersions, parseVersion } from './versions';

/*
 * Self-update support: how this copy was installed (so `code-reviewer upgrade` knows whether it may run npm
 * or can only say what to run), what changed between two versions (from the CHANGELOG the package ships),
 * and the once-a-day "update available" notice after interactive reviews.
 */

export const PACKAGE_NAME = '@antonio112009/code-reviewer';
export const RELEASES_URL = 'https://github.com/Antonio112009/code-reviewer/releases';

export type InstallKind =
  | 'npm-global'
  | 'pnpm-global'
  | 'yarn-global'
  | 'bun-global'
  | 'npx'
  | 'source'
  | 'project';

export interface Install {
  kind: InstallKind;
  /** The package directory of the running copy. */
  root: string;
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Whether `dir` is this package inside npm's global `node_modules`. npm masks UUID-like parts of what it
 * prints (they might be tokens), so a `***` in its answer stands for one unknown piece of a path segment.
 */
function isNpmGlobal(dirs: readonly string[], npmGlobalRoot: string): boolean {
  const expected = path.join(npmGlobalRoot, PACKAGE_NAME);
  if (!expected.includes('***')) return dirs.includes(real(expected));
  const pattern = expected
    .split('***')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/\\\\]+');
  const re = new RegExp(`^${pattern}$`, process.platform === 'win32' ? 'i' : '');
  return dirs.some((d) => re.test(d));
}

/**
 * How the copy at `root` was installed. `npmGlobalRoot` is `npm root -g` (undefined when npm is not
 * available): a copy inside it is an npm global install, the only kind `upgrade` updates by itself.
 */
export function detectInstall(root: string, npmGlobalRoot?: string): Install {
  const dir = real(root);
  const segments = dir.replace(/\\/g, '/').toLowerCase().split('/');
  const has = (...names: string[]) => names.every((n) => segments.includes(n));
  let kind: InstallKind;
  if (existsSync(path.join(dir, '.git'))) kind = 'source';
  else if (has('_npx')) kind = 'npx';
  else if (npmGlobalRoot && isNpmGlobal([dir, path.resolve(root)], npmGlobalRoot)) kind = 'npm-global';
  else if (has('.bun', 'install', 'global')) kind = 'bun-global';
  else if (has('pnpm', 'global')) kind = 'pnpm-global';
  else if (has('yarn', 'global')) kind = 'yarn-global';
  else kind = 'project';
  return { kind, root: dir };
}

/** The command that installs `version` for an install of this kind (what `upgrade` runs or prints). */
export function upgradeCommand(kind: InstallKind, version: string): string[] | undefined {
  const spec = `${PACKAGE_NAME}@${version}`;
  switch (kind) {
    case 'npm-global':
      // --prefer-online: a version published minutes ago is not in the local metadata cache yet
      return ['npm', 'install', '--global', spec, '--prefer-online'];
    case 'pnpm-global':
      return ['pnpm', 'add', '--global', spec];
    case 'yarn-global':
      return ['yarn', 'global', 'add', spec];
    case 'bun-global':
      return ['bun', 'add', '--global', spec];
    case 'project':
      return ['npm', 'install', spec];
    case 'npx':
    case 'source':
      return undefined;
  }
}

/** Whether `candidate` is a newer version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return a !== undefined && b !== undefined && compareVersions(a, b) > 0;
}

/**
 * The CHANGELOG sections of the versions after `from` up to and including `to` (`## 0.6.0 — date`
 * headings; "Unreleased" is never included), newest first as in the file.
 */
export function changelogBetween(changelog: string, from: string, to: string): string {
  const out: string[] = [];
  let keep = false;
  for (const line of changelog.split(/\r?\n/)) {
    const heading = /^## +v?(\d+\.\d+\.\d+)\b/.exec(line);
    if (heading) keep = isNewer(heading[1]!, from) && !isNewer(heading[1]!, to);
    else if (/^## /.test(line)) keep = false;
    if (keep) out.push(line);
  }
  return out.join('\n').trim();
}

// ---------------------------------------------------------------------------------------------------
// Update notice
// ---------------------------------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 3_000;

export interface UpdateCheck {
  checkedAt: number;
  latest: string;
}

export async function readUpdateCheck(file: string): Promise<UpdateCheck | undefined> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return typeof data?.checkedAt === 'number' && typeof data?.latest === 'string' ? data : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the notice's cached answer is too old (or missing) and should be refreshed. */
export function updateCheckDue(check: UpdateCheck | undefined, now = Date.now()): boolean {
  return !check || now - check.checkedAt >= CHECK_INTERVAL_MS || check.checkedAt > now;
}

/**
 * Asks the registry for the latest version (one small GET, 3 s at most) and caches the answer. Failures
 * are silent: the notice is a convenience and must never break or slow down a command.
 */
export async function refreshUpdateCheck(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const registry = (env.npm_config_registry || 'https://registry.npmjs.org/').replace(/\/?$/, '/');
    const res = await fetchImpl(`${registry}${PACKAGE_NAME.replace('/', '%2F')}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const latest = ((await res.json()) as { version?: unknown }).version;
    if (typeof latest !== 'string' || !parseVersion(latest)) return;
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ checkedAt: Date.now(), latest } satisfies UpdateCheck));
    await rename(tmp, file);
  } catch {
    // offline, blocked or slow registry: try again next time
  }
}

/** Whether the notice may run: an interactive terminal, not CI, not turned off. */
export function updateNoticeEnabled(env: NodeJS.ProcessEnv, isTTY: boolean, ci: boolean): boolean {
  const off = env.CODE_REVIEWER_NO_UPDATE_CHECK ?? env.NO_UPDATE_NOTIFIER;
  return isTTY && !ci && (off === undefined || off === '' || off === '0' || off.toLowerCase() === 'false');
}

/**
 * The "update available" line for `current`, from the cached answer; refreshes the cache first when it is
 * a day old. Started alongside a review, so the registry request overlaps the work.
 */
export async function updateNotice(
  current: string,
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  let check = await readUpdateCheck(file);
  if (updateCheckDue(check)) {
    await refreshUpdateCheck(file, env, fetchImpl);
    check = (await readUpdateCheck(file)) ?? check;
  }
  return check && isNewer(check.latest, current)
    ? `Update available: ${current} → ${check.latest}. Run "code-reviewer upgrade" (turn this off with CODE_REVIEWER_NO_UPDATE_CHECK=1).`
    : undefined;
}
