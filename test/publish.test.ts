import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/index';
import { ConfigError, loadConfig } from '../src/config/load';
import { DEFAULT_CONFIG, type PublishSettings } from '../src/config/schema';
import { projectConfigViolations } from '../src/config/template';
import { GitRepo } from '../src/git/repo';
import { ApiClient, type FetchLike, publishRun } from '../src/publish';
import { anchorFor, commentableLines, loadCommentableDiff, planPublication } from '../src/publish/plan';
import {
  extractFingerprints,
  forgeLine,
  forgeText,
  RESOLVED_MARKER,
  REVIEW_MARKER,
  renderInlineComment,
  renderSummary,
  SUMMARY_MARKER,
} from '../src/publish/render';
import { fixedThreads, mapRange, type PostedThread, touches } from '../src/publish/resolve';
import { resolvePublishTarget, tokenFor, validateApiUrl } from '../src/publish/target';
import { computeFingerprint } from '../src/review/fingerprint';
import { runReview } from '../src/review/pipeline';
import { RunStore } from '../src/runs/store';
import type { Finding, RunRecord } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

// ---------------------------------------------------------------------------------------------------------
// Fixtures: a repository whose feature branch changes lines 20-22 of src/app.ts (hunk: new lines 17-25)
// ---------------------------------------------------------------------------------------------------------

let repo: TempRepo;
let mergeBase: string;
let headSha: string;

beforeAll(() => {
  repo = makeRepo();
  const lines = Array.from({ length: 30 }, (_, i) => `const v${i + 1} = ${i + 1};`);
  repo.write({ 'src/app.ts': `${lines.join('\n')}\n` });
  mergeBase = repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  const changed = [...lines];
  changed.splice(19, 1, 'const v20 = compute();', 'const extra1 = 1;', 'const extra2 = 2;');
  repo.write({ 'src/app.ts': `${changed.join('\n')}\n` });
  headSha = repo.commit('change');
  repo.git('checkout', '-q', 'main');
});
afterAll(() => repo.cleanup());

const FP = { f1: 'a'.repeat(32), f2: 'b'.repeat(32), f3: 'c'.repeat(32), f4: 'd'.repeat(32) };

function finding(over: Partial<Finding>): Finding {
  return {
    id: 'f',
    file: 'src/app.ts',
    startLine: 20,
    endLine: 21,
    severity: 'major',
    category: 'bug',
    title: 'Some defect',
    description: 'A concrete failure scenario.',
    confidence: 0.9,
    skills: [],
    source: { chunkIds: ['c001'], provider: 'mock' },
    ...over,
  };
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1,
    id: '20260927-100000-abcd',
    command: 'review',
    status: 'completed',
    createdAt: '2026-09-27T10:00:00.000Z',
    repo: { root: repo.root, remote: 'https://github.com/acme/shop', platform: 'github' },
    target: { kind: 'diff', base: 'main', head: 'feature', baseSha: mergeBase, headSha, mergeBase },
    options: {
      depth: 'essential',
      selfCritique: true,
      minConfidence: 0.7,
      skills: 'auto',
      tools: true,
      authors: false,
      maxChunkTokens: 40_000,
      concurrency: 3,
    },
    routing: { review: { provider: 'mock', reasoning: 'low' } },
    chunks: [{ id: 'c001', files: ['src/app.ts'], tokens: 100, skills: [], status: 'done', findings: 4 }],
    findings: [
      finding({ id: 'f1', title: 'Wrong value', description: 'Ping @octocat about #1.', fingerprint: FP.f1 }),
      finding({
        id: 'f2',
        severity: 'minor',
        startLine: 2,
        endLine: 2,
        title: 'Far away',
        fingerprint: FP.f2,
      }),
      finding({
        id: 'f3',
        severity: 'critical',
        startLine: 22,
        endLine: 22,
        title: 'Crash',
        fingerprint: FP.f3,
      }),
      finding({
        id: 'f4',
        severity: 'info',
        startLine: 24,
        endLine: 25,
        title: 'Context only',
        fingerprint: FP.f4,
      }),
    ],
    rejected: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    warnings: [],
    ...over,
  };
}

const SETTINGS: PublishSettings = { maxInlineComments: 30, minSeverity: 'info', resolveFixed: true };

// ---------------------------------------------------------------------------------------------------------
// A fake forge: routes keyed by "METHOD /path" (a list answers in order, the last one repeats)
// ---------------------------------------------------------------------------------------------------------

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  // biome-ignore lint/suspicious/noExplicitAny: request bodies are checked structurally
  body: any;
}
type Handler = (call: Call) => Response;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fakeForge(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const counters = new Map<string, number>();
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      url: u,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const key = `${method} ${u.pathname}`;
    const route = routes[key];
    if (!route) return json({ message: `no route ${key}` }, 404);
    const list = Array.isArray(route) ? route : [route];
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    return list[Math.min(n, list.length - 1)]!(call);
  };
  return {
    fetch,
    calls,
    find: (key: string) => calls.filter((c) => `${c.method} ${c.url.pathname}` === key),
  };
}

const noSleep = vi.fn(async () => {});

function comment(login: string, body: string, type = 'User', id = 1) {
  return { id, body, user: { login, type } };
}

function githubRoutes(over: Record<string, Handler | Handler[]> = {}) {
  const base = '/repos/acme/shop';
  return {
    [`GET ${base}/pulls/1`]: () => json({ number: 1, head: { sha: headSha } }),
    'GET /user': () => json({ login: 'review-bot', type: 'User' }),
    [`GET ${base}/pulls/1/comments`]: (c: Call) =>
      c.url.searchParams.get('page') === '2'
        ? json([comment('mallory', `spoofed <!-- code-reviewer:fp=${FP.f1} -->`)])
        : json([comment('review-bot', `old <!-- code-reviewer:fp=${FP.f3} -->`)], 200, {
            link: `<https://api.github.com${base}/pulls/1/comments?per_page=100&page=2>; rel="next", <https://api.github.com${base}/pulls/1/comments?per_page=100&page=2>; rel="last"`,
          }),
    [`GET ${base}/issues/1/comments`]: () =>
      json([
        comment('mallory', `${SUMMARY_MARKER}\nfake`, 'User', 5),
        comment('review-bot', `${SUMMARY_MARKER}\nold summary`, 'User', 77),
      ]),
    [`POST ${base}/pulls/1/reviews`]: () => json({ id: 1 }),
    [`PATCH ${base}/issues/comments/77`]: () => json({ id: 77 }),
    [`POST ${base}/issues/1/comments`]: () => json({ id: 78 }, 201),
    [`POST ${base}/pulls/1/comments`]: () => json({ id: 90 }, 201),
    ...over,
  };
}

async function publishGithub(
  forge: ReturnType<typeof fakeForge>,
  over: Partial<Parameters<typeof publishRun>[0]> = {},
) {
  return publishRun({
    run: makeRun(),
    repo: new GitRepo(repo.root),
    settings: SETTINGS,
    flags: { pr: '1', repo: 'acme/shop', forge: 'github' },
    env: { GITHUB_TOKEN: 'ghs_secret' },
    fetch: forge.fetch,
    sleep: noSleep,
    logger: silentLogger,
    ...over,
  });
}

// ---------------------------------------------------------------------------------------------------------

describe('publish target', () => {
  const run = { repo: { root: '/r', remote: 'https://github.com/acme/shop', platform: 'github' as const } };
  const none = { githubApiUrl: undefined, gitlabApiUrl: undefined };

  it('takes explicit flags first', async () => {
    const t = await resolvePublishTarget({ run, flags: { pr: '5', repo: 'o/r' }, settings: none, env: {} });
    expect(t).toMatchObject({ forge: 'github', apiUrl: 'https://api.github.com', repo: 'o/r', number: 5 });
    expect(t.explanation).toEqual(
      expect.arrayContaining([
        'repository o/r: --repo',
        'pull request 5: --pr',
        expect.stringContaining('public'),
      ]),
    );
  });

  it('uses GitHub Actions and GitLab CI variables, including the API URL the CI declares', async () => {
    const gh = await resolvePublishTarget({
      run,
      flags: {},
      settings: none,
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'acme/shop',
        GITHUB_API_URL: 'https://ghe.example.com/api/v3',
      },
      ci: {
        provider: 'github',
        label: 'GitHub Actions',
        baseBranch: 'main',
        baseVar: 'GITHUB_BASE_REF',
        number: '12',
      },
    });
    expect(gh).toMatchObject({
      forge: 'github',
      apiUrl: 'https://ghe.example.com/api/v3',
      repo: 'acme/shop',
      number: 12,
    });
    expect(gh.explanation).toContain(
      'API https://ghe.example.com/api/v3: GITHUB_API_URL (declared by the CI)',
    );

    const gl = await resolvePublishTarget({
      run,
      flags: {},
      settings: none,
      env: {
        GITLAB_CI: 'true',
        CI_API_V4_URL: 'https://gitlab.example.com/api/v4/',
        CI_MERGE_REQUEST_PROJECT_ID: '42',
        CI_PROJECT_ID: '41',
      },
      ci: { provider: 'gitlab', label: 'GitLab CI', baseBranch: 'main', baseVar: 'X', number: '7' },
    });
    expect(gl).toMatchObject({
      forge: 'gitlab',
      apiUrl: 'https://gitlab.example.com/api/v4',
      repo: '42',
      number: 7,
    });
  });

  it('never trusts a CI API variable outside that CI', async () => {
    const t = await resolvePublishTarget({
      run,
      flags: { pr: '1' },
      settings: none,
      env: { GITHUB_API_URL: 'https://evil.example/api' },
    });
    expect(t.apiUrl).toBe('https://api.github.com');
    expect(t.repo).toBe('acme/shop'); // from the remote, whose host matches the API
  });

  it('falls back to the open PR of the branch and its target repository', async () => {
    const find = vi.fn(async () => ({
      tool: 'gh' as const,
      number: 9,
      baseBranch: 'main',
      baseRepoUrl: 'https://github.com/upstream/shop',
    }));
    const t = await resolvePublishTarget({ run, flags: {}, settings: none, env: {}, findPullRequest: find });
    expect(t).toMatchObject({ repo: 'upstream/shop', number: 9 });
    expect(find).toHaveBeenCalledWith('github');
    // with --repo naming another repository, that PR is not used
    await expect(
      resolvePublishTarget({
        run,
        flags: { repo: 'other/x' },
        settings: none,
        env: {},
        findPullRequest: find,
      }),
    ).rejects.toThrow(/No open pull request found.*--pr/);
  });

  it('never derives the token destination from the remote of another host', async () => {
    const ghe = {
      repo: { root: '/r', remote: 'https://ghe.example.com/acme/shop', platform: 'github' as const },
    };
    await expect(
      resolvePublishTarget({ run: ghe, flags: { pr: '1' }, settings: none, env: {} }),
    ).rejects.toThrow(/is on ghe\.example\.com, but the API is https:\/\/api\.github\.com/);
    const t = await resolvePublishTarget({
      run: ghe,
      flags: { pr: '1' },
      settings: { githubApiUrl: 'https://ghe.example.com/api/v3' },
      env: {},
    });
    expect(t).toMatchObject({ apiUrl: 'https://ghe.example.com/api/v3', repo: 'acme/shop' });
    const gitlab = {
      repo: { root: '/r', remote: 'https://git.corp.example/team/app', platform: 'other' as const },
    };
    await expect(
      resolvePublishTarget({ run: gitlab, flags: { pr: '1', forge: 'gitlab' }, settings: none, env: {} }),
    ).rejects.toThrow(/git\.corp\.example/);
  });

  it('validates API URLs, repositories and numbers', async () => {
    expect(validateApiUrl('https://gitlab.example.com/api/v4/', 'x')).toBe(
      'https://gitlab.example.com/api/v4',
    );
    expect(validateApiUrl('http://127.0.0.1:8080/api', 'x')).toBe('http://127.0.0.1:8080/api');
    expect(() => validateApiUrl('http://gitlab.example.com/api/v4', 'x')).toThrow(/https/);
    expect(() => validateApiUrl('https://user:pw@example.com/api', 'x')).toThrow(/credentials/);
    expect(() => validateApiUrl('https://example.com/api?x=1', 'x')).toThrow(/query/);
    expect(() => validateApiUrl('not a url', 'x')).toThrow(/valid URL/);
    const bad = (flags: Record<string, string>) =>
      resolvePublishTarget({ run, flags, settings: none, env: {} });
    await expect(bad({ pr: '1', repo: '../x' })).rejects.toThrow(/owner\/name/);
    await expect(bad({ pr: '1', repo: 'a/b/c' })).rejects.toThrow(/owner\/name/);
    await expect(bad({ pr: '0', repo: 'o/r' })).rejects.toThrow(/number/);
    await expect(bad({ pr: '1', repo: 'o/r', forge: 'bitbucket' })).rejects.toThrow(/--forge/);
    await expect(bad({ pr: '1', repo: 'o/r', apiUrl: 'http://evil.example' })).rejects.toThrow(/https/);
    const gl = await bad({ pr: '1', repo: 'group/sub/project', forge: 'gitlab' });
    expect(gl.apiUrl).toBe('https://gitlab.com/api/v4');
  });

  it('reads tokens from the documented variables only', () => {
    expect(tokenFor('github', { GH_TOKEN: 'b' })).toEqual({ token: 'b', source: 'GH_TOKEN' });
    expect(tokenFor('github', { GITHUB_TOKEN: 'a', GH_TOKEN: 'b' })).toEqual({
      token: 'a',
      source: 'GITHUB_TOKEN',
    });
    expect(tokenFor('gitlab', { GITLAB_TOKEN: 'c', CI_JOB_TOKEN: 'j' })).toEqual({
      token: 'c',
      source: 'GITLAB_TOKEN',
    });
    expect(tokenFor('gitlab', { CI_JOB_TOKEN: 'j' })).toBeUndefined();
  });
});

describe('publish API URLs in configs', () => {
  let dir: string;
  let home: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cr-pub-config-'));
    home = mkdtempSync(path.join(tmpdir(), 'cr-pub-home-'));
    process.env.CODE_REVIEWER_HOME = home;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    delete process.env.CODE_REVIEWER_HOME;
  });

  it('are rejected in a project config (profiles too), allowed in the global config', async () => {
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'publish:\n  githubApiUrl: https://evil.example/api\n',
    );
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(ConfigError);
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(
      /publish\.githubApiUrl is not allowed/,
    );
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'profiles:\n  ci:\n    publish: { gitlabApiUrl: "https://evil.example/api/v4" }\n',
    );
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(
      /profiles\.ci\.publish\.gitlabApiUrl/,
    );

    // harmless publish settings are fine in a project config
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'publish:\n  maxInlineComments: 5\n  minSeverity: major\n',
    );
    const project = await loadConfig({ cwd: dir, stopDir: dir });
    expect(project.config.publish).toEqual({
      maxInlineComments: 5,
      minSeverity: 'major',
      resolveFixed: true,
    });

    writeFileSync(
      path.join(home, 'config.yaml'),
      'publish:\n  gitlabApiUrl: https://gitlab.example.com/api/v4\n',
    );
    const global = await loadConfig({ cwd: dir, stopDir: dir });
    expect(global.config.publish.gitlabApiUrl).toBe('https://gitlab.example.com/api/v4');
    expect(projectConfigViolations({ publish: { githubApiUrl: 'https://x.example' } })).toEqual([
      'publish.githubApiUrl',
    ]);
    expect(DEFAULT_CONFIG.publish).toEqual({
      maxInlineComments: 30,
      minSeverity: 'info',
      resolveFixed: true,
    });
  });
});

describe('comment rendering', () => {
  it('defuses mentions, references, links, images, HTML and quick actions', () => {
    const text = forgeText(
      '@admin see #12 and !3\n[click](https://evil.example) ![x](http://evil/p.png) <img src=x> www.evil.com\n/approve\n  /merge\n# Title\nuser@example.com &#64;team',
      5_000,
    );
    expect(text).not.toMatch(/@[\w-]/); // every @ is followed by a zero-width space
    expect(text).toContain('@​admin');
    expect(text).toContain('#​12');
    expect(text).toContain('!​3');
    expect(text).not.toContain('](');
    expect(text).not.toContain('[');
    expect(text).toContain('&#91;click&#93;');
    expect(text).not.toContain('<img');
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/^\s*[/#]/m); // no quick action, no heading
    expect(text).toContain('​/approve');
    expect(text).toContain('&amp;#​64;team'); // an entity cannot smuggle an @ either
    expect(forgeLine('a\n\nb `c`', 100)).toBe('a b \\`c\\`');
    expect(forgeText('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('renders an inline comment with its fingerprint marker', () => {
    const body = renderInlineComment(
      finding({
        severity: 'critical',
        title: 'SQL <b>injection</b> @here',
        suggestion: 'Use parameters',
        critique: { verdict: 'confirmed', confidence: 0.9, reason: 'r', originalConfidence: 0.8 },
        origin: 'static',
        tool: { analyzer: 'patterns', ruleId: 'sql' },
      }),
      FP.f1,
    );
    expect(body).toContain('**CRITICAL** · bug · **SQL &lt;b&gt;injection&lt;/b&gt; @​here**');
    expect(body).toContain('**Suggestion:** Use parameters');
    expect(body).toContain('confidence 0.90 · critic: confirmed · static: `patterns/sql`');
    expect(body).toContain('[code-reviewer](https://github.com/antonio112009/code-reviewer)');
    expect(extractFingerprints(body)).toEqual([FP.f1]);
    // a model cannot forge a marker: its text is escaped
    expect(extractFingerprints(forgeText(`<!-- code-reviewer:fp=${FP.f2} -->`, 500))).toEqual([]);
  });

  it('summarises counts, unreviewed code, the stale head and the remaining findings without links', () => {
    const run = makeRun({
      chunks: [
        { id: 'c001', files: ['src/app.ts'], tokens: 1, skills: [], status: 'done', findings: 1 },
        {
          id: 'c002',
          files: ['src/@evil.ts'],
          tokens: 1,
          skills: [],
          status: 'failed',
          failure: 'timeout',
          findings: 0,
        },
      ],
    });
    const body = renderSummary({
      run,
      posted: [],
      alreadyPosted: [run.findings[2]!],
      listed: [{ finding: run.findings[1]!, reason: 'outside-diff' }],
      staleHead: { prHead: 'e'.repeat(40), forced: false },
    });
    expect(body.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(body).toContain('### Code review: 4 findings');
    expect(body).toContain('**1** critical · **1** major · **1** minor · **1** info');
    expect(body).toContain(
      '1 of 2 chunks failed: part of the change was not reviewed** (`src/@evil.ts`). Reason: timeout.',
    );
    expect(body).toContain('differs from the reviewed commit');
    expect(body).toContain('Inline comments: 1 already on this pull request.');
    expect(body).toContain('#### Not commented inline (1)');
    expect(body).toContain('- **MINOR** `src/app.ts:2` · Far away _(outside the diff)_');
    expect(body).not.toMatch(/\]\(/); // link-free
  });
});

describe('pull request diff', () => {
  it('knows which lines can carry an inline comment', async () => {
    const diff = await loadCommentableDiff(new GitRepo(repo.root), mergeBase, headSha);
    const file = diff.get('src/app.ts')!;
    expect(file.hunks).toEqual([[17, 25]]);
    expect(file.lines.get(20)).toEqual({ type: 'add' });
    expect(file.lines.get(24)).toEqual({ type: 'ctx', oldLine: 22 });
    expect(anchorFor(finding({ startLine: 20, endLine: 21 }), diff)).toMatchObject({
      startLine: 20,
      endLine: 21,
      line: 20,
    });
    expect(anchorFor(finding({ startLine: 24, endLine: 25 }), diff)).toMatchObject({ line: 24, oldLine: 22 });
    expect(anchorFor(finding({ startLine: 16, endLine: 18 }), diff)).toBeUndefined(); // starts before the hunk
    expect(anchorFor(finding({ startLine: 2, endLine: 2 }), diff)).toBeUndefined();
    expect(anchorFor(finding({ file: 'other.ts' }), diff)).toBeUndefined();
  });

  it('plans inline comments worst first, with a limit, a severity floor and de-duplication', async () => {
    const diff = await loadCommentableDiff(new GitRepo(repo.root), mergeBase, headSha);
    const findings = makeRun().findings;
    const plan = planPublication(findings, {
      diff,
      maxInline: 1,
      minSeverity: 'major',
      posted: new Set([FP.f3]),
      stale: false,
    });
    expect(plan.alreadyPosted.map((f) => f.id)).toEqual(['f3']);
    expect(plan.inline.map((p) => p.finding.id)).toEqual(['f1']);
    expect(plan.summary.map((s) => [s.finding.id, s.reason])).toEqual([
      ['f2', 'severity'],
      ['f4', 'severity'],
    ]);
    const capped = planPublication(findings, {
      diff,
      maxInline: 1,
      minSeverity: 'info',
      posted: new Set(),
      stale: false,
    });
    expect(capped.summary.map((s) => [s.finding.id, s.reason])).toEqual([
      ['f1', 'limit'],
      ['f2', 'outside-diff'],
      ['f4', 'limit'],
    ]);
    const stale = planPublication(findings, {
      diff,
      maxInline: 9,
      minSeverity: 'info',
      posted: new Set(),
      stale: true,
    });
    expect(stale.inline).toEqual([]);
    expect(commentableLines([]).size).toBe(0);
  });
});

describe('API client', () => {
  it('retries 429 and 5xx honouring Retry-After, at most 3 attempts', async () => {
    const sleep = vi.fn(async () => {});
    const forge = fakeForge({
      'GET /x': [() => json({}, 429, { 'retry-after': '2' }), () => json({}, 502), () => json({ ok: 1 })],
      'GET /y': () => json({ message: 'down' }, 503),
    });
    const client = new ApiClient({ baseUrl: 'https://api.example', headers: {}, fetch: forge.fetch, sleep });
    expect((await client.request('GET', '/x')).data).toEqual({ ok: 1 });
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 2000]);
    await expect(client.request('GET', '/y')).rejects.toThrow('GET /y failed: 503 down');
    expect(forge.find('GET /y')).toHaveLength(3);
  });

  it('fails fast when rate limited for too long, and never follows redirects', async () => {
    const forge = fakeForge({
      'GET /x': () => json({}, 429, { 'retry-after': '3600' }),
      'GET /moved': () => new Response(null, { status: 301, headers: { location: 'https://evil.example/' } }),
    });
    const client = new ApiClient({
      baseUrl: 'https://api.example',
      headers: {},
      fetch: forge.fetch,
      sleep: noSleep,
    });
    await expect(client.request('GET', '/x')).rejects.toThrow(/rate limited for 3600 s/);
    await expect(client.request('GET', '/moved')).rejects.toThrow(/redirected/);
    expect(forge.calls.every((c) => c.url.origin === 'https://api.example')).toBe(true);
  });

  it('paginates through Link headers on the same origin only', async () => {
    const forge = fakeForge({
      'GET /list': (c) =>
        c.url.searchParams.get('page') === '2'
          ? json([3], 200, { link: '<https://evil.example/list?page=3>; rel="next"' })
          : json([1, 2], 200, { link: '<https://api.example/list?per_page=100&page=2>; rel="next"' }),
    });
    const client = new ApiClient({
      baseUrl: 'https://api.example',
      headers: {},
      fetch: forge.fetch,
      sleep: noSleep,
    });
    await expect(client.paginate('/list')).rejects.toThrow(
      /Refusing to send a request outside https:\/\/api\.example/,
    );
    expect(forge.calls.map((c) => c.url.href)).toEqual([
      'https://api.example/list?per_page=100',
      'https://api.example/list?per_page=100&page=2',
    ]);
  });

  it('stops on the run abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new ApiClient({
      baseUrl: 'https://api.example',
      headers: {},
      fetch: fakeForge({}).fetch,
      signal: controller.signal,
    });
    await expect(client.request('GET', '/x')).rejects.toThrow('Interrupted');
  });
});

describe('GitHub publisher', () => {
  it('posts one review, skips already-posted fingerprints and updates its summary in place', async () => {
    const forge = fakeForge(githubRoutes());
    const outcome = await publishGithub(forge);
    expect(outcome.summary).toBe('updated');
    expect(outcome.alreadyPosted.map((f) => f.id)).toEqual(['f3']);
    expect(outcome.inline.map((c) => c.finding.id)).toEqual(['f1', 'f4']); // mallory's spoofed marker is ignored

    const [review] = forge.find('POST /repos/acme/shop/pulls/1/reviews');
    expect(review!.body).toMatchObject({ commit_id: headSha, event: 'COMMENT' });
    expect(review!.body.body).toContain(REVIEW_MARKER);
    expect(review!.body.comments).toEqual([
      expect.objectContaining({
        path: 'src/app.ts',
        side: 'RIGHT',
        line: 21,
        start_line: 20,
        start_side: 'RIGHT',
      }),
      expect.objectContaining({ path: 'src/app.ts', side: 'RIGHT', line: 25, start_line: 24 }),
    ]);
    const first = review!.body.comments[0].body as string;
    expect(first).toContain(`<!-- code-reviewer:fp=${FP.f1} -->`);
    expect(first).toContain('Ping @​octocat about #​1.');
    expect(first).not.toContain('@octocat');

    // the second page of review comments was read; the summary replaced our own comment, not mallory's
    expect(forge.find('GET /repos/acme/shop/pulls/1/comments')).toHaveLength(2);
    const [patch] = forge.find('PATCH /repos/acme/shop/issues/comments/77');
    expect(patch!.body.body).toContain('#### Not commented inline (1)');
    expect(patch!.body.body).toContain('Far away _(outside the diff)_');
    expect(patch!.body.body).toContain('Inline comments: 2 new, 1 already on this pull request.');
    expect(forge.find('POST /repos/acme/shop/issues/1/comments')).toHaveLength(0);

    // the token reached the GitHub API only
    for (const call of forge.calls) {
      expect(call.url.origin).toBe('https://api.github.com');
      expect(call.headers.authorization).toBe('Bearer ghs_secret');
    }
  });

  it('falls back to single comments when the review is refused (422); refused ones go to the summary', async () => {
    const forge = fakeForge(
      githubRoutes({
        'GET /user': () => json({ message: 'Resource not accessible by integration' }, 403),
        'GET /repos/acme/shop/pulls/1/comments': () => json([]),
        'GET /repos/acme/shop/issues/1/comments': () =>
          json([comment('someone', `${SUMMARY_MARKER} theirs`, 'User', 3)]),
        'POST /repos/acme/shop/pulls/1/reviews': () =>
          json({ message: 'Unprocessable Entity', errors: ['Line could not be resolved'] }, 422),
        'POST /repos/acme/shop/pulls/1/comments': [
          () => json({ id: 1 }, 201),
          () => json({ id: 2 }, 201),
          () => json({ message: 'Validation Failed' }, 422),
        ],
      }),
    );
    const outcome = await publishGithub(forge);
    expect(outcome.inline.map((c) => c.finding.id)).toEqual(['f3', 'f1']);
    expect(outcome.listed.map((l) => [l.finding.id, l.reason])).toEqual([
      ['f2', 'outside-diff'],
      ['f4', 'rejected'],
    ]);
    const singles = forge.find('POST /repos/acme/shop/pulls/1/comments');
    expect(singles.map((c) => c.body.commit_id)).toEqual([headSha, headSha, headSha]);
    // a human's comment with the marker is never edited: a new summary is created
    expect(outcome.summary).toBe('created');
    expect(forge.find('POST /repos/acme/shop/issues/1/comments')[0]!.body.body).toContain(
      'could not be placed inline',
    );
  });

  it('does not comment inline when the pull request head moved, unless forced', async () => {
    const moved = { 'GET /repos/acme/shop/pulls/1': () => json({ head: { sha: 'e'.repeat(40) } }) };
    const forge = fakeForge(githubRoutes(moved));
    const outcome = await publishGithub(forge);
    expect(forge.find('POST /repos/acme/shop/pulls/1/reviews')).toHaveLength(0);
    expect(outcome.stale).toEqual({ prHead: 'e'.repeat(40), forced: false });
    expect(outcome.listed.map((l) => l.reason)).toEqual(['stale', 'stale', 'stale']);
    expect(forge.find('PATCH /repos/acme/shop/issues/comments/77')[0]!.body.body).toContain(
      'lines may have moved, so no inline comments were posted',
    );

    const forced = fakeForge(githubRoutes(moved));
    const again = await publishGithub(forced, { force: true });
    expect(again.inline).toHaveLength(2);
    expect(forced.find('POST /repos/acme/shop/pulls/1/reviews')[0]!.body.commit_id).toBe(headSha);
  });

  it('retries a rate-limited request and reports errors without the token', async () => {
    const sleep = vi.fn(async () => {});
    const forge = fakeForge(
      githubRoutes({
        'GET /repos/acme/shop/issues/1/comments': () => json([]),
        'POST /repos/acme/shop/issues/1/comments': [
          () => json({ message: 'slow down' }, 429, { 'retry-after': '1' }),
          () => json({ id: 5 }, 201),
        ],
      }),
    );
    await publishGithub(forge, { sleep });
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000]);
    expect(forge.find('POST /repos/acme/shop/issues/1/comments')).toHaveLength(2);

    const denied = fakeForge(
      githubRoutes({ 'GET /repos/acme/shop/pulls/1': () => json({ message: 'Not Found' }, 404) }),
    );
    const err = await publishGithub(denied).catch((e: Error) => e);
    expect((err as Error).message).toBe('GET /repos/acme/shop/pulls/1 failed: 404 Not Found');
    expect((err as Error).message).not.toContain('ghs_secret');
    await expect(publishGithub(denied, { env: {} })).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it('refuses files runs', async () => {
    await expect(
      publishGithub(fakeForge({}), {
        run: makeRun({ command: 'files', target: { kind: 'files', paths: ['src'] } }),
      }),
    ).rejects.toThrow(/Only branch reviews/);
  });
});

describe('GitLab publisher', () => {
  const mr = '/api/v4/projects/acme%2Fshop/merge_requests/3';
  function gitlabRoutes(over: Record<string, Handler | Handler[]> = {}) {
    const note = (id: number, author: number, body: string) => ({
      id,
      body,
      author: { id: author },
      system: false,
    });
    return {
      [`GET ${mr}`]: () =>
        json({ sha: headSha, diff_refs: { base_sha: mergeBase, start_sha: mergeBase, head_sha: headSha } }),
      'GET /api/v4/user': () => json({ id: 5, username: 'review-bot' }),
      [`GET ${mr}/discussions`]: () =>
        json([
          { notes: [note(1, 5, `old <!-- code-reviewer:fp=${FP.f3} -->`)] },
          { notes: [note(2, 6, `spoofed <!-- code-reviewer:fp=${FP.f1} -->`)] },
        ]),
      [`POST ${mr}/discussions`]: [
        () => json({ id: 'd1' }, 201),
        () => json({ message: '400 Bad request - Note {:line_code=>["can\'t be blank"]}' }, 400),
      ],
      [`GET ${mr}/notes`]: () =>
        json([
          note(10, 6, `${SUMMARY_MARKER} not ours`),
          note(11, 5, `${SUMMARY_MARKER} ours`),
          note(12, 5, 'other'),
        ]),
      [`PUT ${mr}/notes/11`]: () => json({ id: 11 }),
      [`POST ${mr}/notes`]: () => json({ id: 13 }, 201),
      ...over,
    };
  }

  async function publishGitlab(
    forge: ReturnType<typeof fakeForge>,
    env: NodeJS.ProcessEnv = { GITLAB_TOKEN: 'glpat' },
  ) {
    return publishRun({
      run: makeRun({ repo: { root: repo.root, remote: 'https://gitlab.com/acme/shop', platform: 'gitlab' } }),
      repo: new GitRepo(repo.root),
      settings: SETTINGS,
      flags: { pr: '3' },
      env,
      fetch: forge.fetch,
      sleep: noSleep,
      logger: silentLogger,
    });
  }

  it('opens positioned discussions, de-duplicates and updates its summary note', async () => {
    const forge = fakeForge(gitlabRoutes());
    const outcome = await publishGitlab(forge);
    expect(outcome.target).toMatchObject({
      forge: 'gitlab',
      repo: 'acme/shop',
      apiUrl: 'https://gitlab.com/api/v4',
    });
    expect(outcome.alreadyPosted.map((f) => f.id)).toEqual(['f3']);
    const posts = forge.find(`POST ${mr}/discussions`);
    expect(posts.map((p) => p.body.position)).toEqual([
      {
        position_type: 'text',
        base_sha: mergeBase,
        start_sha: mergeBase,
        head_sha: headSha,
        new_path: 'src/app.ts',
        old_path: 'src/app.ts',
        new_line: 20,
      },
      {
        position_type: 'text',
        base_sha: mergeBase,
        start_sha: mergeBase,
        head_sha: headSha,
        new_path: 'src/app.ts',
        old_path: 'src/app.ts',
        new_line: 24,
        old_line: 22,
      },
    ]);
    expect(posts[0]!.body.body).toContain(`<!-- code-reviewer:fp=${FP.f1} -->`);
    expect(outcome.inline.map((c) => c.finding.id)).toEqual(['f1']);
    expect(outcome.listed.map((l) => [l.finding.id, l.reason])).toEqual([
      ['f2', 'outside-diff'],
      ['f4', 'rejected'],
    ]);
    expect(outcome.summary).toBe('updated');
    const summary = forge.find(`PUT ${mr}/notes/11`)[0]!.body.body as string;
    expect(summary).toContain('could not be placed inline');
    expect(summary).toContain('Inline comments: 1 new, 1 already on this merge request.');
    expect(forge.find(`GET ${mr}/notes`)[0]!.url.search).toBe('?sort=asc&order_by=created_at&per_page=100');
    for (const call of forge.calls) {
      expect(call.headers['private-token']).toBe('glpat');
      expect(call.headers.authorization).toBeUndefined();
    }
  });

  it('explains a token that cannot post (CI_JOB_TOKEN)', async () => {
    const forge = fakeForge(
      gitlabRoutes({ 'GET /api/v4/user': () => json({ message: '401 Unauthorized' }, 401) }),
    );
    await expect(publishGitlab(forge)).rejects.toThrow(
      /CI_JOB_TOKEN cannot create merge request discussions/,
    );
    await expect(publishGitlab(fakeForge({}), { CI_JOB_TOKEN: 'job' })).rejects.toThrow(/Set GITLAB_TOKEN/);
  });

  it('keeps inline comments back when the merge request head moved', async () => {
    const forge = fakeForge(
      gitlabRoutes({
        [`GET ${mr}`]: () =>
          json({ diff_refs: { base_sha: mergeBase, start_sha: mergeBase, head_sha: 'f'.repeat(40) } }),
      }),
    );
    const outcome = await publishGitlab(forge);
    expect(forge.find(`POST ${mr}/discussions`)).toHaveLength(0);
    expect(outcome.stale?.prHead).toBe('f'.repeat(40));
  });
});

describe('dry run', () => {
  it('renders everything without calling the API, fingerprinting old runs from the reviewed commit', async () => {
    const forge = fakeForge({});
    const old = makeRun();
    for (const f of old.findings) delete f.fingerprint;
    const outcome = await publishRun({
      run: old,
      repo: new GitRepo(repo.root),
      settings: SETTINGS,
      flags: { pr: '1', repo: 'acme/shop' },
      env: {},
      fetch: forge.fetch,
      dryRun: true,
      logger: silentLogger,
    });
    expect(forge.calls).toHaveLength(0);
    expect(outcome.inline.map((c) => c.finding.id)).toEqual(['f3', 'f1', 'f4']);
    const headLines = repo.git('show', `${headSha}:src/app.ts`).split('\n');
    expect(outcome.inline[1]!.fingerprint).toBe(computeFingerprint(old.findings[0]!, headLines));
    expect(outcome.summaryBody).toContain('Inline comments: 3 new.');
  });
});

describe('code-reviewer runs publish --dry-run', () => {
  let cli: TempRepo;
  let home: string;
  let out: string[];
  let savedExit: typeof process.exitCode;

  beforeAll(async () => {
    home = mkdtempSync(path.join(tmpdir(), 'cr-pub-cli-home-'));
    cli = makeRepo();
    cli.write({ 'src/math.ts': 'export const one = 1;\n' });
    cli.commit('initial');
    cli.git('checkout', '-q', '-b', 'feature');
    cli.write({
      'src/math.ts': [
        'export const one = 1;',
        'export function average(xs: number[]) {',
        '  return xs.reduce((a, b) => a + b, 0) / xs.length; // BUG(major): division by zero for @everyone',
        '}',
        '',
      ].join('\n'),
    });
    cli.commit('feature');
    const outcome = await runReview({
      command: 'review',
      cwd: cli.root,
      base: 'main',
      config: testConfig(),
      logger: silentLogger,
      skipPreflight: true,
    });
    expect(outcome.run!.findings).toHaveLength(1);
    // the pipeline fingerprints kept findings from the review root
    expect(outcome.run!.findings[0]!.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    // and a files run for the error case
    mkdirSync(path.join(cli.root, '.code-reviewer/runs/20200101-000000-0000'), { recursive: true });
    await new RunStore(path.join(cli.root, '.code-reviewer/runs')).save({
      ...outcome.run!,
      id: '20200101-000000-0000',
      command: 'files',
      target: { kind: 'files', paths: [] },
    });
  });
  afterAll(() => {
    cli.cleanup();
    rmSync(home, { recursive: true, force: true });
  });
  beforeEach(() => {
    process.env.CODE_REVIEWER_HOME = home;
    savedExit = process.exitCode;
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CODE_REVIEWER_HOME;
    process.exitCode = savedExit;
  });

  const run = (...args: string[]) =>
    buildProgram().parseAsync(['node', 'code-reviewer', '-C', cli.root, ...args]);

  it('prints the comments that would be posted', async () => {
    await run('runs', 'publish', 'latest', '--dry-run', '--pr', '1', '--repo', 'o/r', '--forge', 'github');
    const text = out.join('');
    expect(process.exitCode ?? 0).toBe(0);
    expect(text).toContain('Would post to GitHub pull request o/r#1 (API https://');
    expect(text).toContain('--- Inline comment: src/math.ts:3 ---');
    expect(text).toMatch(/<!-- code-reviewer:fp=[0-9a-f]{32} -->/);
    expect(text).toContain('@​everyone');
    expect(text).toContain('--- Summary comment ---');
    expect(text).toContain(SUMMARY_MARKER);
  });

  it('prints JSON with --json', async () => {
    await run(
      'runs',
      'publish',
      'latest',
      '--dry-run',
      '--json',
      '--pr',
      '1',
      '--repo',
      'o/r',
      '--forge',
      'github',
    );
    const plan = JSON.parse(out.join(''));
    expect(plan).toMatchObject({ forge: 'github', repo: 'o/r', number: 1 });
    expect(plan.inline).toEqual([expect.objectContaining({ path: 'src/math.ts', startLine: 3, endLine: 3 })]);
    expect(plan.summary).toContain(SUMMARY_MARKER);
  });

  it('fails clearly for a files run', async () => {
    await run('runs', 'publish', '20200101-000000-0000', '--dry-run', '--pr', '1', '--repo', 'o/r');
    expect(process.exitCode).toBe(2);
    expect(out.join('')).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('resolving the threads of fixed findings', () => {
  // A later push to the pull request: line 11 and line 22 (f3's "Crash") change.
  let fixSha: string;
  beforeAll(() => {
    repo.git('checkout', '-q', 'feature');
    const lines = Array.from({ length: 30 }, (_, i) => `const v${i + 1} = ${i + 1};`);
    lines.splice(19, 1, 'const v20 = compute();', 'const extra1 = 1;', 'const extra2 = safe(2);');
    lines[10] = 'const v11 = eleven();';
    repo.git('checkout', '-q', '-b', 'feature-fix');
    repo.write({ 'src/app.ts': `${lines.join('\n')}\n` });
    fixSha = repo.commit('fix');
    repo.git('checkout', '-q', 'main');
  });

  const FIX = { kept: 'e'.repeat(32), near: '9'.repeat(32), gone: '8'.repeat(32), absent: '7'.repeat(32) };

  /** The review of the fix: one finding at line 10 (still there, so its thread stays too). */
  function fixRun(over: Partial<RunRecord> = {}): RunRecord {
    return makeRun({
      target: {
        kind: 'diff',
        base: 'main',
        head: 'feature-fix',
        baseSha: mergeBase,
        headSha: fixSha,
        mergeBase,
      },
      findings: [finding({ id: 'k', startLine: 10, endLine: 10, fingerprint: FIX.kept })],
      ...over,
    });
  }

  const thread = (over: Partial<PostedThread>): PostedThread => ({
    id: 'T',
    fingerprint: FP.f3,
    path: 'src/app.ts',
    startLine: 22,
    endLine: 22,
    commit: headSha,
    ...over,
  });

  it('maps old lines through a diff and tells which hunks touch them', () => {
    const hunks = [
      { header: '', oldStart: 5, oldLines: 0, newStart: 6, newLines: 2, lines: [] }, // 2 lines inserted after 5
      { header: '', oldStart: 10, oldLines: 2, newStart: 13, newLines: 1, lines: [] }, // 10-11 → 13
    ];
    expect(mapRange(hunks, 3, 4)).toEqual([3, 4]);
    expect(mapRange(hunks, 8, 8)).toEqual([10, 10]);
    expect(mapRange(hunks, 11, 12)).toEqual([13, 13]);
    expect(mapRange(hunks, 20, 21)).toEqual([21, 22]);
    expect(touches(hunks[1]!, 11, 14)).toBe(true);
    expect(touches(hunks[1]!, 12, 14)).toBe(false);
    expect(touches(hunks[0]!, 5, 6)).toBe(true); // inserted between lines 5 and 6
    expect(touches(hunks[0]!, 6, 8)).toBe(false);
  });

  it('resolves only threads whose code changed and whose finding is gone', async () => {
    const git = new GitRepo(repo.root);
    const run = fixRun();
    const threads = [
      thread({ id: 'fixed' }), // line 22 changed, nothing reported there
      thread({ id: 'untouched', fingerprint: FP.f2, startLine: 2, endLine: 2 }), // not reported, code unchanged
      thread({ id: 'near', fingerprint: FIX.near, startLine: 11, endLine: 11 }), // changed, but a finding at 10
      thread({ id: 'kept', fingerprint: FIX.kept, startLine: 10, endLine: 10 }), // reported again
      thread({ id: 'unknown-commit', commit: 'f'.repeat(40) }), // force-pushed away: proves nothing
      thread({ id: 'gone-file', fingerprint: FIX.gone, path: 'src/other.ts', startLine: 1, endLine: 1 }),
    ];
    const fixed = await fixedThreads(git, run, run.findings, threads);
    expect(fixed.map((f) => [f.thread.id, f.reason])).toEqual([
      ['fixed', `the commented code changed in ${fixSha.slice(0, 8)}`],
      ['gone-file', 'the pull request no longer changes this file'],
    ]);

    // a file whose review failed is not judged, and nor are local-change runs
    const failed = fixRun({
      chunks: [{ id: 'c001', files: ['src/app.ts'], tokens: 1, skills: [], status: 'failed', findings: 0 }],
    });
    expect((await fixedThreads(git, failed, failed.findings, [thread({})])).length).toBe(0);
    const local = fixRun({
      target: { ...(run.target as Extract<RunRecord['target'], { kind: 'diff' }>), local: 'staged' },
    });
    expect(await fixedThreads(git, local, local.findings, [thread({})])).toEqual([]);
  });

  it('replies and resolves on GitHub, leaving other and reopened threads alone', async () => {
    const node = (id: string, fingerprint: string, extra: object = {}, author = 'review-bot') => ({
      id,
      isResolved: false,
      path: 'src/app.ts',
      originalLine: 22,
      originalStartLine: null,
      comments: {
        nodes: [
          {
            databaseId: id.length,
            body: `finding <!-- code-reviewer:fp=${fingerprint} -->`,
            author: { login: author, __typename: 'User' },
            originalCommit: { oid: headSha },
          },
        ],
      },
      ...extra,
    });
    const forge = fakeForge(
      githubRoutes({
        'GET /repos/acme/shop/pulls/1': () => json({ number: 1, head: { sha: fixSha } }),
        'GET /repos/acme/shop/pulls/1/comments': () =>
          json([comment('review-bot', `x <!-- code-reviewer:fp=${FP.f3} -->`)]),
        'POST /graphql': (c) =>
          c.body.query.includes('resolveReviewThread')
            ? json({ data: { resolveReviewThread: { thread: { isResolved: true } } } })
            : json({
                data: {
                  repository: {
                    pullRequest: {
                      reviewThreads: {
                        pageInfo: { hasNextPage: false, endCursor: null },
                        nodes: [
                          node('PRRT_fixed', FP.f3),
                          node('PRRT_theirs', FP.f3, {}, 'mallory'),
                          node('PRRT_done', FP.f3, { isResolved: true }),
                          node('PRRT_reopened', FP.f3, {
                            comments: {
                              nodes: [
                                {
                                  databaseId: 1,
                                  body: `x <!-- code-reviewer:fp=${FP.f3} -->`,
                                  author: { login: 'review-bot', __typename: 'User' },
                                  originalCommit: { oid: headSha },
                                },
                                { body: `Resolved: … ${RESOLVED_MARKER}`, author: { login: 'review-bot' } },
                              ],
                            },
                          }),
                        ],
                      },
                    },
                  },
                },
              }),
        'POST /repos/acme/shop/pulls/1/comments/10/replies': () => json({ id: 500 }, 201),
      }),
    );
    const outcome = await publishGithub(forge, { run: fixRun() });
    expect(outcome.resolved.map((r) => r.thread.id)).toEqual(['PRRT_fixed']);
    const [reply] = forge.find('POST /repos/acme/shop/pulls/1/comments/10/replies');
    expect(reply!.body.body).toContain('the commented code changed');
    expect(reply!.body.body).toContain(RESOLVED_MARKER);
    const mutations = forge.find('POST /graphql').filter((c) => c.body.query.includes('resolveReviewThread'));
    expect(mutations.map((c) => c.body.variables)).toEqual([{ id: 'PRRT_fixed' }]);
    expect(forge.find('POST /graphql')[0]!.body.variables).toMatchObject({
      owner: 'acme',
      name: 'shop',
      number: 1,
    });
    const [patch] = forge.find('PATCH /repos/acme/shop/issues/comments/77');
    expect(patch!.body.body).toContain('1 resolved (fixed)');
    for (const call of forge.calls) expect(call.url.origin).toBe('https://api.github.com');
  });

  it('keeps publishing when the token may not resolve threads', async () => {
    const forge = fakeForge(
      githubRoutes({
        'GET /repos/acme/shop/pulls/1': () => json({ number: 1, head: { sha: fixSha } }),
        'GET /repos/acme/shop/pulls/1/comments': () =>
          json([comment('review-bot', `x <!-- code-reviewer:fp=${FP.f3} -->`)]),
        'POST /graphql': () => json({ message: 'Resource not accessible by integration' }, 403),
      }),
    );
    const outcome = await publishGithub(forge, { run: fixRun() });
    expect(outcome.resolved).toEqual([]);
    expect(outcome.summary).toBe('updated');
    expect(outcome.notes.join('\n')).toContain('could not be resolved');
  });

  it('does nothing when every earlier fingerprint is still reported, or when disabled', async () => {
    const forge = fakeForge(
      githubRoutes({ 'GET /repos/acme/shop/pulls/1': () => json({ number: 1, head: { sha: fixSha } }) }),
    );
    await publishGithub(forge, { run: fixRun({ findings: [finding({ fingerprint: FP.f3 })] }) });
    expect(forge.find('POST /graphql')).toHaveLength(0);

    const off = fakeForge(
      githubRoutes({
        'GET /repos/acme/shop/pulls/1': () => json({ number: 1, head: { sha: fixSha } }),
        'GET /repos/acme/shop/pulls/1/comments': () =>
          json([comment('review-bot', `x <!-- code-reviewer:fp=${FP.f3} -->`)]),
      }),
    );
    await publishGithub(off, { run: fixRun(), settings: { ...SETTINGS, resolveFixed: false } });
    expect(off.find('POST /graphql')).toHaveLength(0);
  });

  it('replies and resolves on GitLab', async () => {
    const mr = '/api/v4/projects/acme%2Fshop/merge_requests/3';
    const note = (author: number, body: string, extra: object = {}) => ({
      id: 1,
      body,
      author: { id: author },
      system: false,
      resolvable: true,
      resolved: false,
      position: { new_path: 'src/app.ts', new_line: 22, head_sha: headSha },
      ...extra,
    });
    const forge = fakeForge({
      [`GET ${mr}`]: () =>
        json({ sha: fixSha, diff_refs: { base_sha: mergeBase, start_sha: mergeBase, head_sha: fixSha } }),
      'GET /api/v4/user': () => json({ id: 5, username: 'review-bot' }),
      [`GET ${mr}/discussions`]: () =>
        json([
          { id: 'abc123def0', notes: [note(5, `x <!-- code-reviewer:fp=${FP.f3} -->`)] },
          { id: 'abc123def1', notes: [note(6, `x <!-- code-reviewer:fp=${FP.f3} -->`)] },
          { id: 'abc123def2', notes: [note(5, `x <!-- code-reviewer:fp=${FP.f3} -->`, { resolved: true })] },
          {
            id: 'abc123def3',
            notes: [note(5, `x <!-- code-reviewer:fp=${FP.f3} -->`), note(5, `Resolved ${RESOLVED_MARKER}`)],
          },
        ]),
      [`POST ${mr}/discussions/abc123def0/notes`]: () => json({ id: 9 }, 201),
      [`PUT ${mr}/discussions/abc123def0`]: () => json({ id: 'abc123def0', resolved: true }),
      [`GET ${mr}/notes`]: () => json([]),
      [`POST ${mr}/notes`]: () => json({ id: 13 }, 201),
    });
    const outcome = await publishRun({
      run: fixRun({ repo: { root: repo.root, remote: 'https://gitlab.com/acme/shop', platform: 'gitlab' } }),
      repo: new GitRepo(repo.root),
      settings: SETTINGS,
      flags: { pr: '3' },
      env: { GITLAB_TOKEN: 'glpat' },
      fetch: forge.fetch,
      sleep: noSleep,
      logger: silentLogger,
    });
    expect(outcome.resolved.map((r) => r.thread.id)).toEqual(['abc123def0']);
    expect(forge.find(`POST ${mr}/discussions/abc123def0/notes`)[0]!.body.body).toContain(RESOLVED_MARKER);
    const [put] = forge.find(`PUT ${mr}/discussions/abc123def0`);
    expect(put!.url.searchParams.get('resolved')).toBe('true');
  });
});
