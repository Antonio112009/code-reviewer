import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Installed dependency sources a model may read (outside the review root, read-only). */
export interface DependencyRoot {
  /** What it holds, for the instructions: `Go modules`, `node_modules`, … */
  label: string;
  /** Real path of the directory (symlinks resolved). */
  dir: string;
}

/** `dir` when it is a real directory (not a symlink, which a reviewed checkout could point anywhere). */
function realDir(dir: string): string | undefined {
  try {
    if (lstatSync(dir).isSymbolicLink() || !statSync(dir).isDirectory()) return undefined;
    const real = realpathSync(dir);
    // A dependency root is never the file system root or the home directory itself.
    return real === path.parse(real).root || real === realpathSync(homedir()) ? undefined : real;
  } catch {
    return undefined;
  }
}

/**
 * Where the installed dependencies of a review are: the Go module cache (`GOMODCACHE`, `$GOPATH/pkg/mod`,
 * `~/go/pkg/mod`) and Cargo's registry sources from the user's environment, and `node_modules` and a
 * virtualenv's `site-packages` of the user's checkout (`repoRoot`: the review snapshot has no untracked
 * files). Only real directories count; files are later accepted only when their real path lies inside one.
 */
export function dependencyRoots(
  repoRoot: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): DependencyRoot[] {
  const home = homedir();
  const candidates: Array<[string, string | undefined]> = [
    [
      'Go modules',
      env.GOMODCACHE?.trim() ||
        (env.GOPATH?.trim() ? path.join(env.GOPATH.split(path.delimiter)[0]!, 'pkg', 'mod') : undefined) ||
        path.join(home, 'go', 'pkg', 'mod'),
    ],
    ['Rust crates', path.join(env.CARGO_HOME?.trim() || path.join(home, '.cargo'), 'registry', 'src')],
  ];
  // Inside the checkout (which a reviewed branch controls): no symlink anywhere below the checkout.
  const inRepo: Array<[string, string]> = [];
  if (repoRoot) {
    inRepo.push(['node_modules', 'node_modules']);
    for (const venv of ['.venv', 'venv']) {
      let pythons: string[] = [];
      try {
        pythons = readdirSync(path.join(repoRoot, venv, 'lib')).filter((d) => /^python\d/.test(d));
      } catch {
        // no virtualenv
      }
      for (const p of pythons) inRepo.push(['Python packages', path.join(venv, 'lib', p, 'site-packages')]);
    }
  }
  const out: DependencyRoot[] = [];
  const add = (label: string, real: string | undefined) => {
    if (real && !out.some((r) => r.dir === real)) out.push({ label, dir: real });
  };
  for (const [label, dir] of candidates) add(label, dir && path.isAbsolute(dir) ? realDir(dir) : undefined);
  if (repoRoot && inRepo.length) {
    let realRepo: string | undefined;
    try {
      realRepo = realpathSync(repoRoot);
    } catch {
      realRepo = undefined;
    }
    for (const [label, rel] of inRepo) {
      const real = realRepo ? realDir(path.join(repoRoot, rel)) : undefined;
      add(label, real && real === path.join(realRepo!, rel) ? real : undefined);
    }
  }
  return out;
}

function isInside(dir: string, p: string): boolean {
  const rel = path.relative(dir, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The real path of `p` when it is an existing file inside one of `roots` (after resolving every symlink),
 * else undefined: a link from `node_modules` to `~/.ssh` resolves outside and is refused.
 */
export function resolveDependencyPath(roots: readonly string[], p: string): string | undefined {
  if (!roots.length || !path.isAbsolute(p)) return undefined;
  let real: string;
  try {
    real = realpathSync(p);
    if (!statSync(real).isFile()) return undefined;
  } catch {
    return undefined;
  }
  return roots.some((r) => isInside(r, real)) ? real : undefined;
}
