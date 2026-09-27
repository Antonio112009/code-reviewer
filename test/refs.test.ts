import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type GitSettings } from '../src/config/schema';
import { detectCiPullRequest } from '../src/git/ci';
import { findExecutable, parseGhPullRequest, parseGlabMergeRequest } from '../src/git/forge';
import { classifyRef, formatAge, type ResolveRefsOptions, resolveRefs } from '../src/git/refs';
import { GitRepo, isValidBranchName } from '../src/git/repo';

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commit(cwd: string, file: string, message: string): string {
  writeFileSync(path.join(cwd, file), `${message}\n`);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function identity(cwd: string): void {
  git(cwd, 'config', 'user.email', 'dev@example.com');
  git(cwd, 'config', 'user.name', 'Dev');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

function settings(change: (s: GitSettings) => void = () => {}): GitSettings {
  const s = structuredClone(DEFAULT_CONFIG.git);
  s.base.useForge = false;
  change(s);
  return s;
}

let tmp: string;
let remoteUrl: string;
/** Clone whose remote-tracking refs and local branches are stale relative to the remote. */
let template: string;
const shas = { c1: '', c2: '', d1: '', d2: '', d3: '', f1: '', f2: '', m3: '', g1: '' };
let copies = 0;

/** A fresh copy of the stale clone (tests mutate refs by fetching). */
function work(): { dir: string; repo: GitRepo } {
  const dir = path.join(tmp, `work-${++copies}`);
  cpSync(template, dir, { recursive: true });
  return { dir, repo: new GitRepo(dir) };
}

function resolve(repo: GitRepo, opts: Partial<ResolveRefsOptions> = {}) {
  return resolveRefs({ repo, settings: settings(), env: {}, ...opts });
}

beforeAll(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  tmp = mkdtempSync(path.join(tmpdir(), 'cr-refs-'));
  const bare = path.join(tmp, 'remote.git');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
  remoteUrl = `file://${bare}`;

  // Seed: main c1-c2, develop d1.
  const seed = path.join(tmp, 'seed');
  git(tmp, 'clone', '-q', remoteUrl, seed);
  identity(seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  shas.c1 = commit(seed, 'a.txt', 'c1');
  shas.c2 = commit(seed, 'b.txt', 'c2');
  git(seed, 'push', '-q', 'origin', 'main');
  git(seed, 'checkout', '-q', '-b', 'develop');
  shas.d1 = commit(seed, 'd.txt', 'd1');
  git(seed, 'push', '-q', 'origin', 'develop');

  // Template clone: tracking develop, feature/x pushed at f1 plus one unpushed commit f2.
  template = path.join(tmp, 'template');
  git(tmp, 'clone', '-q', remoteUrl, template);
  identity(template);
  git(template, 'branch', '-q', '--track', 'develop', 'origin/develop');
  git(template, 'checkout', '-q', '-b', 'feature/x', 'origin/develop');
  shas.f1 = commit(template, 'f.txt', 'f1');
  git(template, 'push', '-q', '-u', 'origin', 'feature/x');
  shas.f2 = commit(template, 'f2.txt', 'f2');

  // Someone else pushes: develop d2-d3, main m3, feature/x g1.
  const other = path.join(tmp, 'other');
  git(tmp, 'clone', '-q', remoteUrl, other);
  identity(other);
  git(other, 'checkout', '-q', 'develop');
  shas.d2 = commit(other, 'd2.txt', 'd2');
  shas.d3 = commit(other, 'd3.txt', 'd3');
  git(other, 'checkout', '-q', 'main');
  shas.m3 = commit(other, 'm3.txt', 'm3');
  git(other, 'checkout', '-q', 'feature/x');
  shas.g1 = commit(other, 'g1.txt', 'g1');
  git(other, 'push', '-q', 'origin', 'develop', 'main', 'feature/x');
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe('resolveRefs with a remote', () => {
  it('resolves a bare --base name to the freshly fetched remote branch', async () => {
    const { dir, repo } = work();
    expect(git(dir, 'rev-parse', 'origin/develop')).toBe(shas.d1);
    const r = await resolve(repo, { base: 'develop' });
    expect(r.base).toBe('origin/develop');
    expect(r.baseSha).toBe(shas.d3);
    expect(r.head).toBe('HEAD (feature/x)');
    expect(r.headSha).toBe(shas.f2);
    expect(r.mergeBase).toBe(shas.d1);
    expect(r.info.baseSource).toBe('flag');
    expect(r.info.fetched).toBe(true);
    expect(r.info.remote).toBe('origin');
    expect(git(dir, 'rev-parse', 'origin/develop')).toBe(shas.d3);
    // Only the needed refs were fetched.
    expect(git(dir, 'rev-parse', 'origin/main')).toBe(shas.c2);
    expect(r.info.notes).toContain(
      'local develop is 2 behind origin/develop; comparing against origin/develop',
    );
    expect(r.info.explanation.join('\n')).toMatch(/origin: fetched develop and feature\/x/);
  });

  it('reports unpushed commits and a head that is behind its upstream', async () => {
    const { repo } = work();
    const r = await resolve(repo, { base: 'develop' });
    expect(r.info.notes).toContain('1 unpushed commit on feature/x included in the review');
    expect(r.info.notes).toContain(
      'local feature/x is 1 behind origin/feature/x; those commits are not reviewed (pull to include them)',
    );
  });

  it('does not touch the network when offline', async () => {
    const { dir, repo } = work();
    // Give origin/develop a reflog (a fresh clone has none) so its age is known.
    git(dir, 'update-ref', '-m', 'test', 'refs/remotes/origin/develop', shas.c2);
    git(dir, 'update-ref', '-m', 'test', 'refs/remotes/origin/develop', shas.d1);
    const r = await resolve(repo, { base: 'develop', offline: true });
    expect(r.baseSha).toBe(shas.d1);
    expect(r.info.fetched).toBe(false);
    expect(r.info.explanation).toContain('no fetch (--offline)');
    expect(r.info.explanation).toContain(
      'origin/develop not fetched (--offline): cached ref, last updated just now',
    );
    expect(git(dir, 'rev-parse', 'origin/develop')).toBe(shas.d1);
    const never = await resolve(repo, { base: 'develop', settings: settings((s) => (s.fetch = 'never')) });
    expect(never.baseSha).toBe(shas.d1);
    expect(never.info.explanation).toContain('no fetch (git.fetch=never)');
    const env = await resolve(repo, { base: 'develop', env: { CODE_REVIEWER_OFFLINE: '1' } });
    expect(env.baseSha).toBe(shas.d1);
  });

  it('applies rules: feature/x → nearest existing candidate', async () => {
    const { repo } = work();
    const r = await resolve(repo);
    expect(r.info.baseSource).toBe('rules');
    expect(r.base).toBe('origin/develop');
    expect(r.baseSha).toBe(shas.d3);
    // Nearest ancestor beats rule order.
    const reordered = await resolve(repo, {
      settings: settings((s) => (s.base.rules = [{ match: 'feature/**', base: ['main', 'develop'] }])),
    });
    expect(reordered.base).toBe('origin/develop');
    expect(reordered.info.explanation.join('\n')).toMatch(/origin\/main \+3, origin\/develop \+2/);
    // A candidate that exists nowhere is skipped.
    const fallback = await resolve(repo, {
      settings: settings((s) => (s.base.rules = [{ match: 'feature/**', base: ['staging', 'main'] }])),
    });
    expect(fallback.base).toBe('origin/main');
    expect(fallback.baseSha).toBe(shas.m3);
  });

  it('applies rules: develop → main', async () => {
    const { dir, repo } = work();
    git(dir, 'checkout', '-q', 'develop');
    const r = await resolve(repo);
    expect(r.info.baseSource).toBe('rules');
    expect(r.base).toBe('origin/main');
    expect(r.baseSha).toBe(shas.m3);
    expect(r.mergeBase).toBe(shas.c2);
    expect(r.info.notes.some((n) => n.startsWith('local develop is 2 behind origin/develop'))).toBe(true);
  });

  it('prefers the CI target branch over rules', async () => {
    const { repo } = work();
    const r = await resolve(repo, { env: { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' } });
    expect(r.info.baseSource).toBe('ci');
    expect(r.base).toBe('origin/main');
    expect(r.baseSha).toBe(shas.m3);
    expect(r.info.explanation.join('\n')).toMatch(/GitHub Actions: GITHUB_BASE_REF=main/);
    const ignored = await resolve(repo, {
      env: { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' },
      settings: settings((s) => (s.base.useCi = false)),
    });
    expect(ignored.info.baseSource).toBe('rules');
  });

  it('uses branch config (gh-merge-base) before rules', async () => {
    const { dir, repo } = work();
    git(dir, 'config', 'branch.feature/x.gh-merge-base', 'main');
    const r = await resolve(repo);
    expect(r.info.baseSource).toBe('branch-config');
    expect(r.base).toBe('origin/main');
  });

  it('detects the remote default branch (origin/HEAD, then ls-remote, then main/master/trunk)', async () => {
    const { dir, repo } = work();
    git(dir, 'checkout', '-q', '-b', 'topic', 'origin/main');
    commit(dir, 't.txt', 't1');
    const r = await resolve(repo);
    expect(r.info.baseSource).toBe('default');
    expect(r.base).toBe('origin/main');
    expect(r.info.explanation.join('\n')).toMatch(/default branch of origin \(origin\/HEAD\)/);
    git(dir, 'remote', 'set-head', 'origin', '-d');
    const probed = await resolve(repo);
    expect(probed.base).toBe('origin/main');
    expect(probed.info.explanation.join('\n')).toMatch(/default branch of origin \(ls-remote\)/);
    const offline = await resolve(repo, { offline: true });
    expect(offline.base).toBe('origin/main');
    expect(offline.info.explanation.join('\n')).toMatch(/first existing of main, master, trunk/);
  });

  it('does not let a branch missing on the remote break the fetch', async () => {
    const { dir, repo } = work();
    git(dir, 'branch', 'staging', shas.d1);
    const r = await resolve(repo, {
      settings: settings((s) => (s.base.rules = [{ match: 'feature/**', base: ['staging', 'develop'] }])),
    });
    // staging exists only locally (not fetched); develop is fetched. Both are 2 commits behind head: rule order wins.
    expect(r.info.fetched).toBe(true);
    expect(git(dir, 'rev-parse', 'origin/develop')).toBe(shas.d3);
    expect(r.base).toBe('staging');
    const flag = await resolve(repo, { base: 'staging' });
    expect(flag.base).toBe('staging');
    expect(flag.info.notes).toContain('origin has no branch staging; using local staging');
  });

  it('throws a helpful error on the base branch itself with nothing to compare', async () => {
    const { dir, repo } = work();
    git(dir, 'checkout', '-q', 'main');
    await expect(resolve(repo)).rejects.toThrow(/on main, the base branch itself.*--base/);
    // With an unpushed commit on main there is something to review.
    commit(dir, 'hotfix.txt', 'hotfix');
    git(dir, 'fetch', '-q', 'origin');
    git(dir, 'rebase', '-q', 'origin/main');
    const r = await resolve(repo);
    expect(r.base).toBe('origin/main');
    expect(r.info.notes).toContain('1 unpushed commit on main included in the review');
    expect(r.info.explanation.join('\n')).toMatch(/on the base branch main itself/);
  });

  it('reviews the remote head with headSource=remote and says what is left out', async () => {
    const { repo } = work();
    const r = await resolve(repo, { base: 'develop', settings: settings((s) => (s.headSource = 'remote')) });
    expect(r.head).toBe('origin/feature/x');
    expect(r.headSha).toBe(shas.g1);
    expect(r.info.notes).toContain(
      '1 local commit on feature/x not pushed to origin/feature/x is not reviewed (git.headSource=remote)',
    );
  });

  it('notes uncommitted and untracked files', async () => {
    const { dir, repo } = work();
    writeFileSync(path.join(dir, 'f.txt'), 'changed\n');
    writeFileSync(path.join(dir, 'new.txt'), 'new\n');
    mkdirSync(path.join(dir, '.code-reviewer'));
    writeFileSync(path.join(dir, '.code-reviewer', 'run.json'), '{}');
    const r = await resolve(repo, { base: 'develop', offline: true });
    expect(r.info.notes).toContain(
      '1 uncommitted change and 1 untracked file not reviewed (commit them to include them)',
    );
  });

  it('falls back to cached refs when the fetch fails (auto) and fails with fetch=always', async () => {
    const { dir, repo } = work();
    git(dir, 'remote', 'set-url', 'origin', `file://${path.join(tmp, 'missing.git')}`);
    const warnings: string[] = [];
    const r = await resolve(repo, { base: 'develop', warn: (m) => warnings.push(m) });
    expect(r.baseSha).toBe(shas.d1);
    expect(r.info.fetched).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(
      r.info.notes.some((n) =>
        /^origin\/develop could not be fetched \(.+\); using the cached ref, age unknown$/.test(n),
      ),
    ).toBe(true);
    await expect(
      resolve(repo, { base: 'develop', settings: settings((s) => (s.fetch = 'always')) }),
    ).rejects.toThrow(/Could not fetch from origin/);
  });

  it('uses rev expressions and shas as given, and rejects unknown refs', async () => {
    const { repo } = work();
    const r = await resolve(repo, { base: 'HEAD~1', offline: true });
    expect(r.baseSha).toBe(shas.f1);
    expect(r.base).toBe('HEAD~1');
    const sha = await resolve(repo, { base: shas.c1, offline: true });
    expect(sha.baseSha).toBe(shas.c1);
    await expect(resolve(repo, { base: 'nope', offline: true })).rejects.toThrow(/Base ref "nope" not found/);
  });

  it('accepts remote-qualified bases and explicit heads', async () => {
    const { repo } = work();
    const r = await resolve(repo, { base: 'origin/main', head: 'develop' });
    expect(r.base).toBe('origin/main');
    expect(r.baseSha).toBe(shas.m3);
    // --head is local by default (the stale local develop, not origin/develop).
    expect(r.head).toBe('develop');
    expect(r.headSha).toBe(shas.d1);
    const remoteHead = await resolve(repo, { base: 'main', head: 'origin/feature/x' });
    expect(remoteHead.headSha).toBe(shas.g1);
  });

  it('refuses a branch without commits of its own, and honours an aborted signal', async () => {
    const { dir, repo } = work();
    git(dir, 'fetch', '-q', 'origin', 'develop');
    git(dir, 'checkout', '-q', '-b', 'feature/empty', 'origin/develop');
    await expect(resolve(repo)).rejects.toThrow(/Nothing to review: HEAD \(feature\/empty\) has no commits/);
    await expect(resolve(repo, { signal: AbortSignal.abort() })).rejects.toThrow();
  });

  it('falls back to the first parent of a CI merge commit when the target branch is unavailable', async () => {
    const { dir, repo } = work();
    git(dir, 'checkout', '-q', '--detach', 'origin/main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'feature/x');
    const r = await resolve(repo, {
      offline: true,
      env: { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'gone' },
    });
    expect(r.info.baseSource).toBe('ci');
    expect(r.base).toBe('HEAD^1');
    expect(r.baseSha).toBe(shas.c2);
    expect(r.head).toMatch(/^HEAD \(detached at [0-9a-f]{7}\)$/);
  });

  it('deepens a shallow clone until the merge-base is found', async () => {
    const dir = path.join(tmp, 'shallow');
    git(tmp, 'clone', '-q', '--depth', '1', '--branch', 'feature/x', remoteUrl, dir);
    const repo = new GitRepo(dir);
    const r = await resolve(repo, { base: 'develop' });
    expect(r.baseSha).toBe(shas.d3);
    expect(r.headSha).toBe(shas.g1);
    expect(r.mergeBase).toBe(shas.d1);
    expect(r.info.explanation.join('\n')).toMatch(/shallow clone: fetched \d+ more commits/);
  });

  it.skipIf(process.platform === 'win32')(
    'asks gh for the open PR (forge) before branch config and rules',
    async () => {
      const { dir, repo } = work();
      git(dir, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git');
      git(dir, 'config', `url.${remoteUrl}.insteadOf`, 'https://github.com/acme/app.git');
      git(dir, 'config', 'branch.feature/x.gh-merge-base', 'develop');
      const bin = path.join(tmp, 'bin');
      mkdirSync(bin, { recursive: true });
      const pr = { number: 7, state: 'OPEN', baseRefName: 'main', url: 'https://github.com/acme/app/pull/7' };
      writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho '${JSON.stringify(pr)}'\n`);
      chmodSync(path.join(bin, 'gh'), 0o755);
      const r = await resolve(repo, {
        env: { PATH: bin },
        settings: settings((s) => (s.base.useForge = true)),
      });
      expect(r.info.baseSource).toBe('forge');
      expect(r.base).toBe('origin/main');
      expect(r.baseSha).toBe(shas.m3);
      expect(r.info.explanation.join('\n')).toMatch(/open PR #7 \(gh\) targets main/);
      // Offline: no forge lookup.
      const offline = await resolve(repo, {
        env: { PATH: bin },
        offline: true,
        settings: settings((s) => (s.base.useForge = true)),
      });
      expect(offline.info.baseSource).toBe('branch-config');
    },
  );
});

describe('resolveRefs without a remote', () => {
  it('compares local branches and never fetches', async () => {
    const dir = path.join(tmp, 'local');
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    identity(dir);
    const base = commit(dir, 'a.txt', 'a');
    git(dir, 'checkout', '-q', '-b', 'feature/y');
    const head = commit(dir, 'b.txt', 'b');
    const r = await resolve(new GitRepo(dir));
    expect(r.base).toBe('main');
    expect(r.baseSha).toBe(base);
    expect(r.headSha).toBe(head);
    expect(r.info.remote).toBeUndefined();
    expect(r.info.explanation).toContain('no git remote configured: comparing local branches only');
    expect(r.info.explanation).toContain('no fetch (no remote)');
  });
});

describe('classifyRef', () => {
  const remotes = ['origin', 'upstream'];
  it.each([
    ['develop', { kind: 'branch', name: 'develop' }],
    ['feature/a', { kind: 'branch', name: 'feature/a' }],
    ['origin/develop', { kind: 'remote', remote: 'origin', name: 'develop' }],
    ['refs/remotes/upstream/main', { kind: 'remote', remote: 'upstream', name: 'main' }],
    ['refs/heads/main', { kind: 'local', name: 'main' }],
    ['HEAD~3', { kind: 'rev', rev: 'HEAD~3' }],
    ['v1.2.0^{}', { kind: 'rev', rev: 'v1.2.0^{}' }],
    ['0f70c1fac109', { kind: 'rev', rev: '0f70c1fac109' }],
    ['refs/tags/v1', { kind: 'rev', rev: 'refs/tags/v1' }],
  ])('%s', (input, expected) => {
    expect(classifyRef(input, remotes)).toEqual(expected);
  });
});

describe('helpers', () => {
  it('validates branch names conservatively', () => {
    for (const ok of ['main', 'feature/x', 'release-1.2', 'a_b']) expect(isValidBranchName(ok)).toBe(true);
    for (const bad of [
      '',
      '-x',
      'a..b',
      'a b',
      'x.lock',
      'a/.b',
      'a~1',
      'a:b',
      'HEAD',
      'a@{1}',
      '/a',
      'a/',
    ]) {
      expect(isValidBranchName(bad)).toBe(false);
    }
  });

  it('formats ages', () => {
    expect(formatAge(10_000)).toBe('just now');
    expect(formatAge(5 * 60_000)).toBe('5 min ago');
    expect(formatAge(3 * 3_600_000)).toBe('3 h ago');
    expect(formatAge(2 * 86_400_000)).toBe('2 days ago');
  });

  it('finds executables only on absolute PATH entries outside the excluded root', async () => {
    const root = path.join(tmp, 'exe-root');
    const bin = path.join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'tool'), '#!/bin/sh\n');
    chmodSync(path.join(bin, 'tool'), 0o755);
    expect(await findExecutable('tool', { PATH: bin })).toBe(path.join(bin, 'tool'));
    expect(await findExecutable('tool', { PATH: bin }, root)).toBeUndefined();
    expect(await findExecutable('tool', { PATH: 'bin' })).toBeUndefined();
  });
});

describe('detectCiPullRequest', () => {
  it('reads GitHub Actions variables and the event payload', async () => {
    const event = path.join(tmp, 'event.json');
    writeFileSync(
      event,
      JSON.stringify({
        number: 12,
        pull_request: { number: 12, base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } },
      }),
    );
    const pr = await detectCiPullRequest({
      GITHUB_ACTIONS: 'true',
      GITHUB_BASE_REF: 'main',
      GITHUB_HEAD_REF: 'feature/x',
      GITHUB_EVENT_PATH: event,
    });
    expect(pr).toMatchObject({
      provider: 'github',
      baseBranch: 'main',
      headBranch: 'feature/x',
      baseSha: 'a'.repeat(40),
      number: '12',
    });
    expect(await detectCiPullRequest({ GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: '' })).toBeUndefined();
  });

  it('reads GitLab, Azure DevOps and Bitbucket variables', async () => {
    expect(
      await detectCiPullRequest({
        GITLAB_CI: 'true',
        CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'develop',
        CI_MERGE_REQUEST_DIFF_BASE_SHA: 'c'.repeat(40),
        CI_MERGE_REQUEST_IID: '4',
      }),
    ).toMatchObject({ provider: 'gitlab', baseBranch: 'develop', baseSha: 'c'.repeat(40), number: '4' });
    expect(
      await detectCiPullRequest({
        BUILD_REASON: 'PullRequest',
        SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main',
      }),
    ).toMatchObject({ provider: 'azure', baseBranch: 'main' });
    expect(
      await detectCiPullRequest({ BITBUCKET_PR_ID: '9', BITBUCKET_PR_DESTINATION_BRANCH: 'master' }),
    ).toMatchObject({ provider: 'bitbucket', baseBranch: 'master', number: '9' });
    expect(
      await detectCiPullRequest({ GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: '--upload-pack=x' }),
    ).toBeUndefined();
    expect(await detectCiPullRequest({})).toBeUndefined();
  });
});

describe('forge output parsing', () => {
  it('accepts open PRs/MRs only', () => {
    expect(
      parseGhPullRequest(
        JSON.stringify({
          number: 3,
          state: 'OPEN',
          baseRefName: 'develop',
          url: 'https://github.com/o/r/pull/3',
        }),
      ),
    ).toMatchObject({ tool: 'gh', number: 3, baseBranch: 'develop', baseRepoUrl: 'https://github.com/o/r' });
    expect(
      parseGhPullRequest(JSON.stringify({ number: 3, state: 'MERGED', baseRefName: 'develop' })),
    ).toBeUndefined();
    expect(parseGhPullRequest('not json')).toBeUndefined();
    expect(
      parseGlabMergeRequest(
        JSON.stringify({
          iid: 5,
          state: 'opened',
          target_branch: 'main',
          web_url: 'https://gitlab.com/g/sub/p/-/merge_requests/5',
          diff_refs: { base_sha: 'd'.repeat(40) },
        }),
      ),
    ).toMatchObject({
      tool: 'glab',
      number: 5,
      baseBranch: 'main',
      baseSha: 'd'.repeat(40),
      baseRepoUrl: 'https://gitlab.com/g/sub/p',
    });
    expect(
      parseGlabMergeRequest(JSON.stringify({ iid: 5, state: 'merged', target_branch: 'main' })),
    ).toBeUndefined();
  });
});
