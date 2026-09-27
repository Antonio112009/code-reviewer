import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedRoot: string | undefined;

/** Root directory of this package (works both from `src/` in dev/tests and from bundled `dist/`). */
export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = JSON.parse(readFileSync(pkg, 'utf8')).name;
        if (typeof name === 'string' && name.endsWith('code-reviewer')) {
          cachedRoot = dir;
          return dir;
        }
      } catch {
        // keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Unable to locate code-reviewer package root');
    dir = parent;
  }
}

export function packageVersion(): string {
  return JSON.parse(readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')).version;
}

/** Absolute path of the CLI entry used to spawn `code-reviewer mcp-serve` for ACP agents. */
export function cliEntryPath(): string {
  return path.join(packageRoot(), 'dist', 'cli.js');
}

/**
 * The trusted per-user directory (global config, user skills). `CODE_REVIEWER_HOME` counts only when it is
 * an absolute path: an empty or relative value (e.g. an unset CI variable) would resolve against the
 * current directory — the checkout under review — and make a repository file the trusted global config.
 */
export function globalConfigDir(): string {
  const home = process.env.CODE_REVIEWER_HOME;
  return home && path.isAbsolute(home) ? home : path.join(homedir(), '.code-reviewer');
}

export const PROJECT_DIR = '.code-reviewer';

function isOutside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/**
 * Resolves `rel` inside `root`, refusing paths that escape it — lexically (`../`) or through
 * symlinks (a checked-in link pointing at ~/.aws/credentials must not be readable).
 */
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (isOutside(root, abs)) throw new Error(`Path escapes the review root: ${rel}`);
  let existing = abs;
  while (!existsSync(existing) && existing !== root) existing = path.dirname(existing);
  if (existsSync(existing) && isOutside(realpathSync(root), realpathSync(existing))) {
    throw new Error(`Path escapes the review root through a symlink: ${rel}`);
  }
  return abs;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
