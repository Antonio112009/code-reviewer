import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cacheDirCandidates, osCacheDir, pickCacheDir } from '../src/cache/location';
import { hashReads, mapHints, readsUnchanged } from '../src/cache/review';
import { cacheKey, canonicalJson, loadCacheSecret, ResultCache } from '../src/cache/store';
import { ConfigError, loadConfig } from '../src/config/load';
import type { Config } from '../src/config/schema';
import { evalRunConfig } from '../src/eval/runner';
import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/registry';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import { runReview } from '../src/review/pipeline';
import type { ReportedFinding } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

const KEY = 'a'.repeat(64);
let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'cr-cache-'));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function freshDir(name: string): string {
  const dir = path.join(scratch, `${name}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function entryFile(dir: string, kind: string, key: string): string {
  return path.join(dir, 'v1', kind, key.slice(0, 2), `${key}.json`);
}

describe('ResultCache', () => {
  it('returns what was stored, and nothing for another key, kind or signing key', async () => {
    const dir = freshDir('rt');
    const cache = new ResultCache(dir, Buffer.from('secret-one'));
    expect(await cache.set('review', KEY, { kind: 'result', n: 1 })).toBe(true);
    expect(await cache.get('review', KEY)).toEqual({ kind: 'result', n: 1 });
    expect(await cache.get('critique', KEY)).toBeUndefined();
    expect(await cache.get('review', 'b'.repeat(64))).toBeUndefined();
    expect(await cache.get('review', '../../etc/passwd')).toBeUndefined();
    expect(await new ResultCache(dir, Buffer.from('secret-two')).get('review', KEY)).toBeUndefined();
  });

  it('treats a tampered, planted or damaged entry as a miss', async () => {
    const dir = freshDir('tamper');
    const cache = new ResultCache(dir, Buffer.from('secret'));
    await cache.set('review', KEY, { kind: 'result', items: [{ title: 'SQL injection' }] });
    const file = entryFile(dir, 'review', KEY);
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    // a clean result planted for malicious code: the signature does not match
    writeFileSync(file, JSON.stringify({ ...entry, data: { kind: 'result', items: [] } }));
    expect(await cache.get('review', KEY)).toBeUndefined();
    writeFileSync(file, '{not json');
    expect(await cache.get('review', KEY)).toBeUndefined();
    writeFileSync(file, JSON.stringify({ ...entry, key: 'b'.repeat(64) }));
    expect(await cache.get('review', KEY)).toBeUndefined();
  });

  it('prunes by age, then least recently used above the size limit, and clears only its own tree', async () => {
    const dir = freshDir('prune');
    const cache = new ResultCache(dir, Buffer.from('secret'));
    const keys = ['1', '2', '3'].map((d) => d.repeat(64));
    for (const k of keys) await cache.set('review', k, { payload: 'x'.repeat(1000) });
    const now = Date.now();
    const age = (k: string, days: number) => {
      const t = new Date(now - days * 86_400_000);
      utimesSync(entryFile(dir, 'review', k), t, t);
    };
    age(keys[0]!, 40);
    age(keys[1]!, 2);
    age(keys[2]!, 1);
    expect((await cache.stats()).entries).toEqual({ review: 3, critique: 0 });

    const size = statSync(entryFile(dir, 'review', keys[1]!)).size;
    const r = await cache.prune({ maxAgeMs: 30 * 86_400_000, maxBytes: size + 10, now });
    expect(r).toMatchObject({ removed: 2, remaining: 1 });
    expect(await cache.get('review', keys[2]!)).toEqual({ payload: 'x'.repeat(1000) });
    expect(await cache.get('review', keys[1]!)).toBeUndefined();

    writeFileSync(path.join(dir, 'unrelated.txt'), 'keep me');
    await cache.clear();
    expect((await cache.stats()).entries).toEqual({ review: 0, critique: 0 });
    expect(readFileSync(path.join(dir, 'unrelated.txt'), 'utf8')).toBe('keep me');
  });

  it('prunes automatically at most once a day', async () => {
    const cache = new ResultCache(freshDir('auto'), Buffer.from('secret'));
    expect(await cache.autoPrune({ maxAgeMs: 1, maxBytes: 1 })).toBeDefined();
    expect(await cache.autoPrune({ maxAgeMs: 1, maxBytes: 1 })).toBeUndefined();
  });

  it('keys do not depend on property order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
    expect(cacheKey({ a: 1, b: 2 })).toBe(cacheKey({ b: 2, a: 1 }));
    expect(cacheKey({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cache location', () => {
  it('uses the platform cache directory, never the roaming profile', () => {
    expect(osCacheDir('darwin', {}, '/Users/ann')).toBe('/Users/ann/Library/Caches/code-reviewer');
    expect(osCacheDir('linux', {}, '/home/ann')).toBe('/home/ann/.cache/code-reviewer');
    expect(osCacheDir('linux', { XDG_CACHE_HOME: '/var/cache/ann' }, '/home/ann')).toBe(
      '/var/cache/ann/code-reviewer',
    );
    expect(osCacheDir('linux', { XDG_CACHE_HOME: 'relative' }, '/home/ann')).toBe(
      '/home/ann/.cache/code-reviewer',
    );
    expect(osCacheDir('win32', { LOCALAPPDATA: 'C:\\Users\\ann\\AppData\\Local' }, 'C:\\Users\\ann')).toBe(
      'C:\\Users\\ann\\AppData\\Local\\code-reviewer\\Cache',
    );
    expect(osCacheDir('win32', {}, 'C:\\Users\\ann')).toBe(
      'C:\\Users\\ann\\AppData\\Local\\code-reviewer\\Cache',
    );
  });

  it('orders the candidates and ignores relative overrides', () => {
    const base = { platform: 'linux' as const, home: '/home/ann', tmp: '/tmp' };
    const sources = (opts: Parameters<typeof cacheDirCandidates>[0]) =>
      cacheDirCandidates({ ...base, ...opts }).map((c) => `${c.source}:${c.dir}`);
    expect(sources({ env: { CODE_REVIEWER_CACHE_DIR: '/ci/cache' }, configured: '/data/cr' })).toEqual([
      'env:/ci/cache',
      'config:/data/cr',
      'os:/home/ann/.cache/code-reviewer',
      expect.stringMatching(/^tmp:\/tmp\/code-reviewer-cache-/),
    ]);
    expect(
      sources({ env: { CODE_REVIEWER_CACHE_DIR: 'cache' }, configured: 'project', repoRoot: '/repo' }),
    ).toEqual([
      'project:/repo/.code-reviewer/cache',
      'os:/home/ann/.cache/code-reviewer',
      expect.stringMatching(/^tmp:/),
    ]);
  });

  it('skips directories that cannot be written to', async () => {
    const blocker = path.join(freshDir('blocked'), 'file');
    writeFileSync(blocker, '');
    const good = freshDir('good');
    const skipped: string[] = [];
    const picked = await pickCacheDir(
      [
        { dir: path.join(blocker, 'sub'), source: 'config' },
        { dir: good, source: 'os' },
      ],
      (c) => skipped.push(c.source),
    );
    expect(picked).toEqual({ dir: good, source: 'os' });
    expect(skipped).toEqual(['config']);
  });

  it('signs with the environment key, else a private key file in the global directory', async () => {
    const env = { CODE_REVIEWER_CACHE_KEY: 'k'.repeat(40) };
    expect((await loadCacheSecret(env)).secret.toString()).toBe('k'.repeat(40));
    const home = freshDir('home');
    const saved = process.env.CODE_REVIEWER_HOME;
    process.env.CODE_REVIEWER_HOME = home;
    try {
      const first = await loadCacheSecret({ CODE_REVIEWER_CACHE_KEY: 'too-short' });
      expect(first.persistent).toBe(true);
      const file = path.join(home, 'cache.key');
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
      expect((await loadCacheSecret({})).secret.equals(first.secret)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.CODE_REVIEWER_HOME;
      else process.env.CODE_REVIEWER_HOME = saved;
    }
  });
});

describe('cache settings', () => {
  it('a project config may turn the cache off but not choose its directory', async () => {
    const dir = freshDir('project');
    mkdirSync(path.join(dir, '.code-reviewer'));
    const write = (yaml: string) => writeFileSync(path.join(dir, '.code-reviewer', 'config.yaml'), yaml);
    write('cache:\n  enabled: false\n');
    expect((await loadConfig({ cwd: dir, stopDir: dir, ignoreGlobal: true })).config.cache.enabled).toBe(
      false,
    );
    write('cache:\n  dir: /tmp/planted\n');
    await expect(loadConfig({ cwd: dir, stopDir: dir, ignoreGlobal: true })).rejects.toThrow(ConfigError);
    write('profiles:\n  x:\n    cache: { dir: project }\n');
    await expect(loadConfig({ cwd: dir, stopDir: dir, ignoreGlobal: true })).rejects.toThrow(/cache\.dir/);
  });
});

describe('files the model read', () => {
  it('stay valid while their content is unchanged, including files that were missing', async () => {
    const root = freshDir('reads');
    writeFileSync(path.join(root, 'a.ts'), 'one');
    const reads = (await hashReads(root, ['a.ts', 'gone.ts', 'a.ts']))!;
    expect(Object.keys(reads)).toEqual(['a.ts', 'gone.ts']);
    expect(reads['gone.ts']).toBe('missing');
    expect(await readsUnchanged(root, reads)).toBe(true);
    writeFileSync(path.join(root, 'a.ts'), 'two');
    expect(await readsUnchanged(root, reads)).toBe(false);
    writeFileSync(path.join(root, 'a.ts'), 'one');
    writeFileSync(path.join(root, 'gone.ts'), 'back');
    expect(await readsUnchanged(root, reads)).toBe(false);
  });

  it('maps hint references between run-local ids and identities', () => {
    const item = { title: 'x', hint: 'H3' } as ReportedFinding;
    const stored = mapHints([item], new Map([['H3', 'secretlint|rule|a.ts|1|1']]));
    expect(stored[0]!.hint).toBe('secretlint|rule|a.ts|1|1');
    expect(mapHints(stored, new Map([['secretlint|rule|a.ts|1|1', 'H7']]))[0]!.hint).toBe('H7');
    expect(mapHints(stored, new Map())[0]).not.toHaveProperty('hint');
  });
});

// ---------------------------------------------------------------------------------------------------
// End to end: runs of the pipeline sharing one cache
// ---------------------------------------------------------------------------------------------------

/** The mock provider, counting calls; `script` may change a result (reads, salvage, failures). */
class CountingProvider implements Provider {
  readonly id = 'mock';
  readonly kind = 'mock' as const;
  calls = { findings: 0, verdicts: 0 };
  private readonly mock = new MockProvider('mock');

  constructor(
    private readonly script: (task: AgentTask) => Partial<AgentResult> | undefined = () => undefined,
  ) {}

  async run(task: AgentTask): Promise<AgentResult> {
    this.calls[task.kind]++;
    const result = await this.mock.run(task);
    return { ...result, ...this.script(task) };
  }

  async dispose(): Promise<void> {}
}

describe('runReview with the result cache', () => {
  let repo: TempRepo;
  const savedDir = process.env.CODE_REVIEWER_CACHE_DIR;

  beforeEach(() => {
    process.env.CODE_REVIEWER_CACHE_DIR = freshDir('run');
    repo = makeRepo();
    repo.write({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/helper.ts': 'export const helper = () => 1;\n',
    });
    repo.commit('initial');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write({
      'src/a.ts': 'export const a = 1;\nexport const x = a / 0; // BUG(major): division by zero\n',
      'src/b.ts':
        'export const b = 2;\nexport const y = b.foo.bar; // BUG(major): reads a missing property\n',
    });
    repo.commit('feature');
  });
  afterEach(() => {
    repo.cleanup();
    process.env.CODE_REVIEWER_CACHE_DIR = savedDir;
  });

  async function review(
    provider: Provider,
    adjust: (c: Config) => void = () => {},
    command: 'review' | 'files' = 'review',
  ) {
    const config = testConfig((c) => {
      c.cache.enabled = true;
      c.output.formats = [];
      adjust(c);
    });
    const registry = new ProviderRegistry(config, silentLogger);
    (registry as unknown as { instances: Map<string, Provider> }).instances.set('mock', provider);
    const outcome = await runReview({
      command,
      cwd: repo.root,
      ...(command === 'review' ? { base: 'main', head: 'feature' } : { paths: ['src/a.ts'] }),
      config,
      logger: silentLogger,
      providers: registry,
      skipPreflight: true,
    });
    return outcome.run!;
  }

  it('answers an unchanged change from the cache: no model calls, same findings', async () => {
    const first = new CountingProvider();
    const run1 = await review(first);
    expect(first.calls).toEqual({ findings: 1, verdicts: 1 });
    expect(run1.cache).toMatchObject({ hits: 0, misses: 1, critiqueHits: 0, critiqueMisses: 2 });

    const second = new CountingProvider();
    const run2 = await review(second);
    expect(second.calls).toEqual({ findings: 0, verdicts: 0 });
    expect(run2.cache).toMatchObject({ hits: 1, misses: 0, critiqueHits: 2, critiqueMisses: 0 });
    expect(run2.cache!.saved.inputTokens).toBeGreaterThan(0);
    expect(run2.chunks[0]).toMatchObject({ status: 'done', cached: 'all', attempts: 0 });
    expect(run2.usage.inputTokens).toBe(0);
    expect(run2.findings.map((f) => [f.file, f.startLine, f.critique?.verdict])).toEqual(
      run1.findings.map((f) => [f.file, f.startLine, f.critique?.verdict]),
    );
  });

  it('reviews again what changed, and a different model or --no-cache', async () => {
    await review(new CountingProvider());
    repo.write({
      'src/b.ts':
        'export const b = 3;\nexport const y = b.foo.bar; // BUG(major): reads a missing property\n',
    });
    repo.commit('change b');
    const changed = new CountingProvider();
    expect((await review(changed)).cache).toMatchObject({ hits: 0, misses: 1 });
    expect(changed.calls.findings).toBe(1);

    const otherModel = new CountingProvider();
    await review(otherModel, (c) => {
      c.roles.review!.model = 'another-model';
    });
    expect(otherModel.calls.findings).toBe(1);

    const off = new CountingProvider();
    const run = await review(off, (c) => {
      c.cache.enabled = false;
    });
    expect(off.calls.findings).toBe(1);
    expect(run.cache).toBeUndefined();
  });

  it('is invalidated when a file the model read changes', async () => {
    const reading = () =>
      new CountingProvider((t) => (t.kind === 'findings' ? { reads: ['src/helper.ts'] } : undefined));
    await review(reading(), () => {}, 'files');
    const same = reading();
    await review(same, () => {}, 'files');
    expect(same.calls.findings).toBe(0);

    repo.write({ 'src/helper.ts': 'export const helper = () => 2;\n' });
    repo.commit('helper changed');
    const after = reading();
    const run = await review(after, () => {}, 'files');
    expect(after.calls.findings).toBe(1);
    expect(run.cache).toMatchObject({ hits: 0, misses: 1 });
  });

  it('never caches an early (salvaged) answer', async () => {
    const hurried = () =>
      new CountingProvider((t) =>
        t.kind === 'findings' ? { salvaged: 'the time limit was reached' } : undefined,
      );
    await review(hurried());
    const again = hurried();
    await review(again);
    expect(again.calls.findings).toBe(1);
  });

  it('remembers that a chunk had to be split and starts with its halves', async () => {
    const files = (t: AgentTask) => [...t.prompt.matchAll(/^## File: /gm)].length;
    const limited = () =>
      new CountingProvider((t) =>
        t.kind === 'findings' && files(t) > 1
          ? { submission: { calls: 0 }, text: '', stopReason: 'max_turn_requests' }
          : undefined,
      );
    const first = limited();
    const run1 = await review(first);
    expect(first.calls.findings).toBe(3);
    expect(run1.chunks[0]!.status).toBe('done');

    const second = limited();
    const run2 = await review(second);
    expect(second.calls.findings).toBe(0);
    expect(run2.cache).toMatchObject({ hits: 2, misses: 0 });
    expect(run2.chunks[0]).toMatchObject({ status: 'done', cached: 'all' });
    expect(run2.chunks[0]!.recovery?.[0]).toMatch(/as in an earlier run/);
    expect(run2.findings.map((f) => f.file).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('is off in evals, which measure the model', () => {
    expect(
      evalRunConfig(
        testConfig((c) => (c.cache.enabled = true)),
        '/tmp/eval',
      ).cache.enabled,
    ).toBe(false);
  });
});
