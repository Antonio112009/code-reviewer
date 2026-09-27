import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Programs are resolved without letting the reviewed code substitute them. Directories that may hold
 * repository-controlled files are never searched: registered untrusted roots (the checkout, snapshots,
 * the directory the CLI started in), relative PATH entries and `node_modules/.bin`. On case-insensitive
 * platforms (macOS, Windows) paths are compared case-insensitively, and a candidate whose real path leads
 * into an untrusted root is skipped too.
 */

const IS_WINDOWS = process.platform === 'win32';
const FOLD_CASE = IS_WINDOWS || process.platform === 'darwin';

/** Directories whose content the reviewed code controls. */
const untrusted = new Set<string>();

/** Marks `dir` (a checkout, a snapshot, the start directory) as never to be searched for programs. */
export function distrustDirectory(dir: string | undefined): void {
  if (dir) untrusted.add(path.resolve(dir));
}

/** Untrusted roots registered so far (tests, diagnostics). */
export function untrustedDirectories(): string[] {
  return [...untrusted];
}

function realOrResolved(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function fold(p: string): string {
  return FOLD_CASE ? p.toLowerCase() : p;
}

function within(root: string, target: string): boolean {
  const rel = path.relative(fold(root), fold(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** True when `target` is `root` or inside it — lexically or through symlinks, case-insensitively where the platform is. */
export function isInsideDir(root: string, target: string): boolean {
  return (
    within(path.resolve(root), path.resolve(target)) || within(realOrResolved(root), realOrResolved(target))
  );
}

function isUntrusted(p: string, extra: readonly string[]): boolean {
  for (const root of [...untrusted, ...extra]) if (isInsideDir(root, p)) return true;
  return false;
}

/** Why a PATH entry must not be searched (undefined = usable). */
export function rejectPathEntry(entry: string, extra: readonly string[] = []): string | undefined {
  if (!entry || !path.isAbsolute(entry)) return 'relative';
  const segments = path.resolve(entry).split(path.sep);
  if (segments.some((s, i) => s === 'node_modules' && segments[i + 1] === '.bin')) return 'node_modules/.bin';
  if (isUntrusted(entry, extra)) return 'inside the reviewed code';
  return undefined;
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? env.Path ?? '').split(path.delimiter);
}

/** PATH without the entries {@link rejectPathEntry} rejects: for children whose own lookups (`#!/usr/bin/env node`) must stay safe. */
export function trustedPath(env: NodeJS.ProcessEnv = process.env, extra: readonly string[] = []): string {
  return pathEntries(env)
    .filter((e) => rejectPathEntry(e, extra) === undefined)
    .join(path.delimiter);
}

function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (!IS_WINDOWS) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute path of program `name` from the trusted PATH entries, or undefined. On Windows, PATHEXT
 * extensions are tried (a bare name is never resolved against the current directory).
 */
export function findTrustedExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  extra: readonly string[] = [],
): string | undefined {
  if (path.isAbsolute(name)) return isExecutableFile(name) && !isUntrusted(name, extra) ? name : undefined;
  if (name.includes('/') || name.includes('\\')) return undefined; // relative paths resolve against cwd
  const exts = IS_WINDOWS
    ? [
        '',
        ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
          .map((e) => e.toLowerCase()),
      ]
    : [''];
  for (const entry of pathEntries(env)) {
    if (rejectPathEntry(entry, extra)) continue;
    for (const ext of exts) {
      const candidate = path.join(entry, name + ext);
      if (!isExecutableFile(candidate)) continue;
      // A symlink on a trusted PATH entry that points into the reviewed code is just as bad.
      if (isUntrusted(realOrResolved(candidate), extra)) continue;
      return candidate;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------
// Windows: .cmd / .bat shims cannot be spawned without a shell (CVE-2024-27980 hardening)
// ---------------------------------------------------------------------------------------------------

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdArgument(arg: string): string {
  let out = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  out = `"${out}"`;
  // twice: npm shims pass `%*` through a second cmd.exe expansion
  return out.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/**
 * How to spawn `command` with `args`: `.cmd` / `.bat` files on Windows go through `cmd.exe /d /s /c`
 * with every argument escaped for cmd (the approach of cross-spawn); anything else is spawned directly.
 */
export function spawnPlan(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) return { command, args: [...args] };
  const shellCommand = [command.replace(CMD_META, '^$1'), ...args.map(escapeCmdArgument)].join(' ');
  const systemRoot = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
  return {
    command: path.win32.join(systemRoot, 'System32', 'cmd.exe'),
    args: ['/d', '/s', '/c', `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
}
