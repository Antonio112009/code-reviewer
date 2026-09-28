import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hookCommand, hookScript, installHook, uninstallHook } from '../src/cli/commands/hook';
import { DEFAULT_CONFIG } from '../src/config/schema';
import { commitLocalChanges, NothingLocalError } from '../src/git/local-changes';
import { GitRepo } from '../src/git/repo';
import { PublishError, publishRun } from '../src/publish';
import { runReview } from '../src/review/pipeline';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;
let git: GitRepo;

beforeEach(() => {
  repo = makeRepo();
  repo.write({
    'a.js': 'export const a = 1;\n',
    'b.js': 'export const b = 1;\n',
    '.gitignore': 'secret.txt\n',
  });
  repo.commit('initial');
  git = new GitRepo(repo.root);
});
afterEach(() => repo.cleanup());

/** What the user sees of the repository: HEAD, refs, the staged paths and the index file. */
function userState() {
  return {
    head: repo.git('rev-parse', 'HEAD'),
    refs: repo.git('for-each-ref'),
    staged: repo.git('diff', '--cached', '--name-only'),
    status: repo.git('status', '--porcelain'),
  };
}

/** A file of a commit, or undefined when the commit does not have it. */
const show = (sha: string, file: string): string | undefined => {
  const res = spawnSync('git', ['show', `${sha}:${file}`], { cwd: repo.root, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : undefined;
};

describe('commitLocalChanges', () => {
  it('commits the index for --staged and leaves everything the user sees alone', async () => {
    repo.write({ 'a.js': 'export const a = 2;\n' });
    repo.git('add', 'a.js');
    repo.write({ 'a.js': 'export const a = 3;\n', 'b.js': 'export const b = 2;\n', 'c.js': 'new\n' });
    const before = userState();

    const snap = await commitLocalChanges(git, 'staged');

    expect(show(snap.sha, 'a.js')).toBe('export const a = 2;\n'); // the staged version, not the working one
    expect(show(snap.sha, 'b.js')).toBe('export const b = 1;\n');
    expect(show(snap.sha, 'c.js')).toBeUndefined();
    expect(snap.parent).toBe(before.head.trim());
    expect(repo.git('rev-parse', `${snap.sha}^`).trim()).toBe(snap.parent);
    expect(repo.git('log', '-1', '--format=%an', snap.sha).trim()).toBe('Not Committed Yet');
    // a.js is also modified after staging: it counts as unstaged too
    expect(snap.leftOut).toEqual({ unstaged: 2, untracked: 1 });
    expect(userState()).toEqual(before);
  });

  it('takes in every uncommitted change and untracked file for --uncommitted, but not ignored files or runs', async () => {
    repo.write({ 'a.js': 'export const a = 2;\n' });
    repo.git('add', 'a.js');
    repo.write({
      'a.js': 'export const a = 3;\n',
      'b.js': 'export const b = 2;\n',
      'c.js': 'new\n',
      'secret.txt': 'token\n',
      '.code-reviewer/runs/r1/report.md': 'quoted code\n',
    });
    repo.git('rm', '-q', '--cached', 'b.js');
    const before = userState();

    const snap = await commitLocalChanges(git, 'uncommitted', { excludeUntracked: ['.code-reviewer/runs'] });

    expect(show(snap.sha, 'a.js')).toBe('export const a = 3;\n');
    expect(show(snap.sha, 'b.js')).toBe('export const b = 2;\n'); // untracked again, still in the tree
    expect(show(snap.sha, 'c.js')).toBe('new\n');
    expect(show(snap.sha, 'secret.txt')).toBeUndefined();
    expect(show(snap.sha, '.code-reviewer/runs/r1/report.md')).toBeUndefined();
    expect(snap.untracked).toBe(2);
    expect(userState()).toEqual(before);
  });

  it('says when there is nothing to review', async () => {
    await expect(commitLocalChanges(git, 'uncommitted')).rejects.toThrow('No uncommitted changes');
    repo.write({ 'a.js': 'export const a = 2;\n' });
    const err = await commitLocalChanges(git, 'staged').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NothingLocalError);
    expect((err as Error).message).toMatch(/Nothing staged.*git add.*--uncommitted/);
  });

  it('reads the index a pre-commit hook was given (git commit -a)', async () => {
    repo.write({ 'b.js': 'export const b = 2;\n' });
    // `git commit -a` hands its hook a temporary index holding every tracked change
    const index = path.join(repo.root, '.git', 'index.lock-test');
    execFileSync('cp', [path.join(repo.root, '.git', 'index'), index]);
    execFileSync('git', ['add', '-u'], { cwd: repo.root, env: { ...process.env, GIT_INDEX_FILE: index } });
    const saved = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = index;
    try {
      const snap = await commitLocalChanges(git, 'staged');
      expect(show(snap.sha, 'b.js')).toBe('export const b = 2;\n');
    } finally {
      if (saved === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = saved;
    }
  });

  it('never lets other git commands use a hook index', async () => {
    repo.write({ 'b.js': 'export const b = 2;\n' });
    repo.commit('second');
    // What `git commit -a` hands its hook: a copy of the index with the commit's content.
    const hookIndex = path.join(repo.root, '.git', 'hook-index');
    execFileSync('cp', [path.join(repo.root, '.git', 'index'), hookIndex]);
    const before = readFileSync(hookIndex);
    const saved = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = hookIndex;
    const worktree = mkdtempSync(path.join(tmpdir(), 'cr-wt-'));
    try {
      // Passed on, `worktree add` would write the checked-out tree into it (the snapshot's own index).
      await git.run(['worktree', 'add', '-q', '--detach', worktree, 'HEAD~1']);
      await git.run(['status', '--porcelain']);
      expect(readFileSync(hookIndex).equals(before)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = saved;
      await git.run(['worktree', 'remove', '--force', worktree]);
    }
  });

  it('refuses an index with merge conflicts', async () => {
    repo.git('checkout', '-q', '-b', 'other');
    repo.write({ 'a.js': 'export const a = "other";\n' });
    repo.commit('other');
    repo.git('checkout', '-q', 'main');
    repo.write({ 'a.js': 'export const a = "main";\n' });
    repo.commit('main');
    spawnSync('git', ['merge', 'other'], { cwd: repo.root });
    await expect(commitLocalChanges(git, 'staged')).rejects.toThrow(/merge conflicts/);
  });
});

describe('review --staged / --uncommitted (mock provider)', () => {
  beforeEach(() => {
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write({ 'a.js': 'export const a = 1;\nconst x = 1 / 0; // BUG: committed on the branch\n' });
    repo.commit('feature');
    repo.write({ 'b.js': 'export const b = 1;\nconst y = null.z; // BUG: staged\n' });
    repo.git('add', 'b.js');
    repo.write({ 'c.js': 'const z = undefined(); // BUG: untracked\n' });
  });

  const review = (local: 'staged' | 'uncommitted', base?: string) =>
    runReview({
      command: 'review',
      cwd: repo.root,
      local,
      ...(base ? { base } : {}),
      config: testConfig((c) => {
        c.review.selfCritique = false;
      }),
      logger: silentLogger,
      skipPreflight: true,
    }).then((o) => o.run!);

  it('reviews only what is staged, on top of HEAD', async () => {
    const run = await review('staged');
    expect(run.findings.map((f) => f.file)).toEqual(['b.js']);
    expect(run.target).toMatchObject({
      kind: 'diff',
      local: 'staged',
      base: 'HEAD',
      head: 'staged changes on feature',
    });
    expect(run.refs).toMatchObject({ baseSource: 'local' });
    expect(run.refs!.commits).toBeUndefined();
    expect(run.refs!.notes).toContain('1 untracked file not reviewed (`git add` them, or use --uncommitted)');
  });

  it('reviews untracked files too with --uncommitted, and the branch with --base', async () => {
    expect((await review('uncommitted')).findings.map((f) => f.file).sort()).toEqual(['b.js', 'c.js']);
    const withBranch = await review('uncommitted', 'main');
    expect(withBranch.findings.map((f) => f.file).sort()).toEqual(['a.js', 'b.js', 'c.js']);
    expect(withBranch.refs).toMatchObject({ baseSource: 'flag', commits: 1 });
  });

  it('cannot be posted to a pull request', async () => {
    const run = await review('staged');
    await expect(
      publishRun({
        run,
        settings: DEFAULT_CONFIG.publish,
        flags: { pr: '1', repo: 'o/r' },
        dryRun: true,
        env: {},
        logger: silentLogger,
      }),
    ).rejects.toThrow(PublishError);
  });
});

describe('pre-commit hook', () => {
  const hookFile = () => path.join(repo.root, '.git', 'hooks', 'pre-commit');

  it('installs, updates and removes only its own hook', async () => {
    expect(await installHook(git, { failOn: 'major', args: [] })).toMatchObject({ status: 'installed' });
    expect(readFileSync(hookFile(), 'utf8')).toContain('code-reviewer review --staged -y --fail-on major');
    if (process.platform !== 'win32') expect(statSync(hookFile()).mode & 0o111).toBeTruthy();
    expect(await installHook(git, { failOn: 'critical', args: [] })).toMatchObject({ status: 'updated' });
    expect(await uninstallHook(git)).toMatchObject({ status: 'removed' });
    expect(existsSync(hookFile())).toBe(false);

    writeFileSync(hookFile(), '#!/bin/sh\nnpm test\n');
    expect(await installHook(git, { failOn: 'major', args: [] })).toMatchObject({ status: 'foreign' });
    expect(await uninstallHook(git)).toMatchObject({ status: 'foreign' });
    expect(readFileSync(hookFile(), 'utf8')).toBe('#!/bin/sh\nnpm test\n');
  });

  it('leaves hooks managed by another tool alone', async () => {
    repo.git('config', 'core.hooksPath', '.husky/_');
    const result = await installHook(git, { failOn: 'none', args: ['--provider', 'ollama'] });
    expect(result).toMatchObject({
      status: 'managed',
      hooksPath: '.husky/_',
      command: 'code-reviewer review --staged -y --provider ollama',
    });
    expect(existsSync(path.join(repo.root, '.husky'))).toBe(false);
  });

  it('quotes review arguments for the shell', () => {
    expect(hookCommand({ failOn: 'none', args: ['--model', "it's a model", '$(rm -rf /)'] })).toBe(
      `code-reviewer review --staged -y --model 'it'\\''s a model' '$(rm -rf /)'`,
    );
  });

  describe.skipIf(process.platform === 'win32')('when git runs it', () => {
    let bin: string;
    beforeEach(() => {
      // A stand-in for the CLI: records its arguments and index, exits with $FAKE_EXIT.
      bin = mkdtempSync(path.join(tmpdir(), 'cr-bin-'));
      writeFileSync(
        path.join(bin, 'code-reviewer'),
        '#!/bin/sh\necho "$* | $GIT_INDEX_FILE" >> "$FAKE_LOG"\nexit "$FAKE_EXIT"\n',
      );
      chmodSync(path.join(bin, 'code-reviewer'), 0o755);
      writeFileSync(hookFile(), hookScript({ failOn: 'major', args: [] }), { mode: 0o755 });
    });
    afterEach(() => rmSync(bin, { recursive: true, force: true }));

    const commit = (exit: number, extraEnv: Record<string, string> = {}) => {
      repo.write({ 'a.js': `export const a = ${Math.random()};\n` });
      const log = path.join(bin, 'log');
      const res = spawnSync('git', ['commit', '-qam', 'change'], {
        cwd: repo.root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_EXIT: String(exit),
          FAKE_LOG: log,
          ...extraEnv,
        },
      });
      return {
        status: res.status,
        stderr: res.stderr,
        log: existsSync(log) ? readFileSync(log, 'utf8') : '',
      };
    };

    it('blocks the commit on findings only', () => {
      const blocked = commit(1);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toMatch(/findings \(major or worse\)/);
      expect(blocked.log).toMatch(/^review --staged -y --fail-on major \| \S+/);

      const failed = commit(2);
      expect(failed.status).toBe(0);
      expect(failed.stderr).toMatch(/did not complete \(exit 2\)/);

      const skipped = commit(1, { CODE_REVIEWER_SKIP: '1' });
      expect(skipped.status).toBe(0);
    });
  });
});
