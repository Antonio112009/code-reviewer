import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitError, type GitRepo, hookIndexFile } from './repo';

/** Changes not yet committed that `review --staged` / `--uncommitted` reviews. */
export type LocalChanges = 'staged' | 'uncommitted';

/** The local changes, committed to a throw-away commit on top of HEAD. */
export interface LocalSnapshot {
  mode: LocalChanges;
  /** The snapshot commit: HEAD plus the changes; referenced by nothing (pruned by `git gc` later). */
  sha: string;
  /** HEAD, its parent. */
  parent: string;
  /** Untracked files taken in (`uncommitted`). */
  untracked: number;
  /** Changes left out (`staged`): tracked files with unstaged modifications, untracked files. */
  leftOut: { unstaged: number; untracked: number };
}

export class NothingLocalError extends Error {}

/** git blame shows uncommitted lines as "Not Committed Yet"; the snapshot commit says the same. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Not Committed Yet',
  GIT_AUTHOR_EMAIL: 'not.committed.yet',
  GIT_COMMITTER_NAME: 'Not Committed Yet',
  GIT_COMMITTER_EMAIL: 'not.committed.yet',
};

export interface LocalSnapshotOptions {
  /**
   * Repository-relative directories whose untracked files are never taken in (the runs directory, whose
   * reports quote code).
   */
  excludeUntracked?: string[];
  /** The index to start from (default: the one a git hook was given, else the repository's). */
  indexFile?: string;
}

/**
 * Commits the staged changes (`staged`: the index, exactly what `git commit` would record) or every
 * uncommitted change including untracked, non-ignored files (`uncommitted`) to a commit whose parent is
 * HEAD, so that the review, its snapshot, blame and cache work as for any commit. Nothing the user sees
 * changes: no ref, index or working-tree file is written (`uncommitted` stages into a temporary copy of
 * the index); only objects are added to the object database. Hooks do not run.
 */
export async function commitLocalChanges(
  repo: GitRepo,
  mode: LocalChanges,
  opts: LocalSnapshotOptions = {},
): Promise<LocalSnapshot> {
  const parent = await repo.tryResolve('HEAD');
  if (!parent) {
    throw new Error(
      'HEAD does not point to a commit yet: the first commit of a repository cannot be reviewed with --staged or --uncommitted.',
    );
  }
  const index = opts.indexFile ?? hookIndexFile();
  const withIndex = index ? { GIT_INDEX_FILE: index } : undefined;
  const exclude = (opts.excludeUntracked ?? []).map((d) => d.replace(/\/+$/, ''));
  const excluded = (file: string) => exclude.some((d) => file === d || file.startsWith(`${d}/`));

  let tree: string;
  let untracked = 0;
  const leftOut = { unstaged: 0, untracked: 0 };
  if (mode === 'staged') {
    tree = await writeTree(repo, withIndex);
    const status = await repo.run(['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'], {
      ...(withIndex ? { env: withIndex } : {}),
    });
    for (const entry of status.split('\0')) {
      if (entry.length < 4 || excluded(entry.slice(3))) continue;
      if (entry.startsWith('??')) leftOut.untracked++;
      else if (entry[1] !== ' ') leftOut.unstaged++;
    }
  } else {
    const dir = await mkdtemp(path.join(tmpdir(), 'cr-index-'));
    try {
      const temp = path.join(dir, 'index');
      const env = { GIT_INDEX_FILE: temp };
      // A copy keeps the stat data, so `add` hashes only the files that changed.
      const source =
        index ?? path.resolve(repo.root, (await repo.run(['rev-parse', '--git-path', 'index'])).trim());
      const copied = await copyFile(source, temp).then(
        () => true,
        () => false,
      );
      if (!copied) await repo.run(['read-tree', 'HEAD'], { env });
      await repo.run(['add', '--update', '--', ':/'], { env });
      const others = (
        await repo.run(['ls-files', '--others', '--exclude-standard', '-z', '--', ':/'], { env })
      )
        .split('\0')
        .filter((f) => f && !excluded(f));
      if (others.length) {
        const list = path.join(dir, 'untracked');
        await writeFile(list, `${others.join('\0')}\0`);
        await repo.run(
          ['--literal-pathspecs', 'add', `--pathspec-from-file=${list}`, '--pathspec-file-nul'],
          {
            env,
          },
        );
      }
      untracked = others.length;
      tree = await writeTree(repo, env);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const parentTree = (await repo.run(['rev-parse', `${parent}^{tree}`])).trim();
  if (tree === parentTree) {
    throw new NothingLocalError(
      mode === 'staged'
        ? `Nothing staged to review${leftOut.unstaged || leftOut.untracked ? ' (`git add` the changes first, or use --uncommitted)' : ''}.`
        : 'No uncommitted changes to review.',
    );
  }
  const message = `${mode} changes (code-reviewer snapshot)`;
  const sha = (
    await repo.run(['commit-tree', '--no-gpg-sign', '-p', parent, '-m', message, tree], { env: IDENTITY })
  ).trim();
  return { mode, sha, parent, untracked, leftOut };
}

async function writeTree(repo: GitRepo, env: Record<string, string> | undefined): Promise<string> {
  try {
    return (await repo.run(['write-tree'], env ? { env } : {})).trim();
  } catch (err) {
    if (err instanceof GitError && /unmerged|conflict/i.test(err.stderr)) {
      throw new Error('The index has unresolved merge conflicts: resolve them before reviewing.');
    }
    throw err;
  }
}
