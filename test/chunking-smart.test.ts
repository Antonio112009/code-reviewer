import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildChunks, chunkTextFor, scheduleOrder } from '../src/chunking/chunker';
import { AffinityIndex, clusterFiles } from '../src/chunking/cluster';
import {
  buildFileGraph,
  coChangeFromLog,
  type FileEdge,
  type FileGraph,
  pairTests,
  parseNameLog,
  testSubject,
  unquoteGitPath,
} from '../src/chunking/graph';
import { initImportLexer } from '../src/chunking/imports';
import { orderFiles, packItems } from '../src/chunking/pack';
import { estimateTokens } from '../src/chunking/tokens';
import { GitRepo } from '../src/git/repo';
import type { Chunk, Hunk, ReviewUnit } from '../src/types';
import { makeRepo, type TempRepo } from './helpers';

const renderOpts = { fullFileTokens: 3_000, contextLines: 10 };

/** A modified TS file: `imports` first, then `padding` filler lines; lines 1..n are marked changed. */
function tsUnit(
  path: string,
  imports: string[] = [],
  padding = 12,
  status: ReviewUnit['status'] = 'modified',
): ReviewUnit {
  const lines = [
    ...imports.map((spec, i) => `import { dep${i} } from '${spec}';`),
    ...Array.from(
      { length: padding },
      (_, i) => `export const ${varName(path)}${i} = compute(${i}) * factor + offset;`,
    ),
  ];
  const hunk: Hunk = {
    header: `@@ -1,1 +1,${lines.length} @@`,
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: lines.length,
    lines: [
      { type: 'del', text: 'old', oldLine: 1 },
      ...lines.map((text, i) => ({ type: 'add' as const, text, newLine: i + 1 })),
    ],
  };
  return {
    path,
    status,
    language: 'typescript',
    hunks: [hunk],
    content: `${lines.join('\n')}\n`,
    focusRanges: [[1, lines.length]],
  };
}

function varName(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '_');
}

async function graphFor(units: ReviewUnit[], extra: string[] = []): Promise<FileGraph> {
  return buildFileGraph({ units, allFiles: [...units.map((u) => u.path), ...extra] });
}

function reviewParts(chunks: Chunk[]) {
  return chunks.flatMap((c) => c.parts.filter((p) => p.role !== 'context'));
}

beforeAll(async () => {
  await initImportLexer();
});

describe('test pairing', () => {
  it('recognises test files by naming convention', () => {
    expect(testSubject('src/a/user.test.ts')).toEqual({ stem: 'user', family: 'js' });
    expect(testSubject('src/a/user.spec.tsx')).toEqual({ stem: 'user', family: 'js' });
    expect(testSubject('src/a/__tests__/user.ts')).toEqual({ stem: 'user', family: 'js' });
    expect(testSubject('tests/test_models.py')).toEqual({ stem: 'models', family: 'python' });
    expect(testSubject('pkg/models_test.py')).toEqual({ stem: 'models', family: 'python' });
    expect(testSubject('internal/db/db_test.go')).toEqual({ stem: 'db', family: 'go' });
    expect(testSubject('src/test/java/a/UserServiceTest.java')).toEqual({
      stem: 'UserService',
      family: 'jvm',
    });
    expect(testSubject('src/test/kotlin/a/RepoTests.kt')).toEqual({ stem: 'Repo', family: 'jvm' });
    expect(testSubject('spec/models/user_spec.rb')).toEqual({ stem: 'user', family: 'ruby' });
    expect(testSubject('src/a/user.ts')).toBeUndefined();
    expect(testSubject('src/Latest.java')).toBeUndefined();
    expect(testSubject('README.md')).toBeUndefined();
  });

  it('pairs tests with sources in the most plausible directory', () => {
    const files = [
      'src/api/user.ts',
      'src/api/user.test.ts',
      'src/ui/__tests__/button.tsx',
      'src/ui/button.tsx',
      'app/models.py',
      'app/tests/test_models.py',
      'internal/db/db.go',
      'internal/db/db_test.go',
      'other/db_test.go',
      'src/main/java/com/acme/UserService.java',
      'src/test/java/com/acme/UserServiceTest.java',
      'lib/models/user.rb',
      'spec/models/user_spec.rb',
      'src/chunking/chunker.ts',
      'test/chunker.test.ts',
      'a/index.ts',
      'b/index.ts',
      'test/index.test.ts',
    ];
    expect(pairTests(files).sort()).toEqual(
      [
        ['app/tests/test_models.py', 'app/models.py'],
        ['internal/db/db_test.go', 'internal/db/db.go'],
        ['spec/models/user_spec.rb', 'lib/models/user.rb'],
        ['src/api/user.test.ts', 'src/api/user.ts'],
        ['src/test/java/com/acme/UserServiceTest.java', 'src/main/java/com/acme/UserService.java'],
        ['src/ui/__tests__/button.tsx', 'src/ui/button.tsx'],
        ['test/chunker.test.ts', 'src/chunking/chunker.ts'],
      ].sort(),
    );
  });
});

describe('buildFileGraph', () => {
  it('links imports (both directions), test pairs and directories; keeps unchanged import targets', async () => {
    const units = [
      tsUnit('src/api/users.ts', ['../db/client', '../lib/unchanged']),
      tsUnit('src/db/client.ts'),
      tsUnit('src/db/pool.ts'),
      tsUnit('test/users.test.ts', ['../src/api/users']),
      { ...tsUnit('src/old.ts'), status: 'deleted' as const, content: undefined },
    ];
    const graph = await graphFor(units, ['src/lib/unchanged.ts']);
    expect(graph.imports.get('src/api/users.ts')).toEqual(['src/db/client.ts', 'src/lib/unchanged.ts']);
    expect(graph.imports.get('src/db/client.ts')).toEqual([]);
    expect(graph.imports.has('src/old.ts')).toBe(false);
    const edge = (a: string, b: string, reason: string) =>
      graph.edges.find((e) => e.a === a && e.b === b && e.reason === reason);
    expect(edge('src/api/users.ts', 'src/db/client.ts', 'import')?.weight).toBe(1);
    expect(edge('src/api/users.ts', 'test/users.test.ts', 'import')?.weight).toBe(1);
    expect(edge('src/api/users.ts', 'test/users.test.ts', 'test')?.weight).toBe(1);
    expect(edge('src/db/client.ts', 'src/db/pool.ts', 'directory')?.weight).toBe(0.3);
    expect(graph.edges.some((e) => e.reason === 'package')).toBe(false); // single package: no information
    expect(graph.edges.some((e) => e.a === 'src/old.ts' || e.b === 'src/old.ts')).toBe(false);
    for (const e of graph.edges) expect(e.a < e.b).toBe(true);
  });

  it('adds weak package edges only in multi-package repositories', async () => {
    const units = [
      tsUnit('packages/a/src/x.ts'),
      tsUnit('packages/a/lib/y.ts'),
      tsUnit('packages/b/src/z.ts'),
    ];
    const graph = await graphFor(units, ['packages/a/package.json', 'packages/b/package.json']);
    const pkg = graph.edges.filter((e) => e.reason === 'package');
    expect(pkg).toEqual([
      { a: 'packages/a/lib/y.ts', b: 'packages/a/src/x.ts', weight: 0.1, reason: 'package' },
    ]);
  });

  it('computes co-change from commit lists (≥ 2 shared commits, coupling-scaled)', () => {
    const alias = new Map([
      ['a.ts', 'a.ts'],
      ['b.ts', 'b.ts'],
      ['c.ts', 'c.ts'],
      ['old-b.ts', 'b.ts'],
    ]);
    const commits = [['a.ts', 'b.ts'], ['a.ts', 'old-b.ts'], ['a.ts', 'c.ts'], ['a.ts'], ['x.ts', 'a.ts']];
    expect(coChangeFromLog(commits, alias)).toEqual([
      { a: 'a.ts', b: 'b.ts', weight: 0.5, reason: 'cochange' },
    ]);
    const log = `\u0000${'a'.repeat(40)}\n\na.ts\n"t\\tab.ts"\n\u0000${'b'.repeat(40)}\n\nb.ts\n`;
    expect(parseNameLog(log)).toEqual([['a.ts', 't\tab.ts'], ['b.ts']]);
    expect(unquoteGitPath('"caf\\303\\251.ts"')).toBe('café.ts');
  });

  describe('co-change from git history', () => {
    let repo: TempRepo | undefined;
    afterEach(() => repo?.cleanup());

    it('links files changed together in earlier commits', async () => {
      repo = makeRepo();
      repo.write({ 'a.ts': '1', 'b.ts': '1', 'c.ts': '1', 'd.ts': '1' });
      repo.commit('init');
      repo.write({ 'a.ts': '2', 'b.ts': '2' });
      repo.commit('a+b');
      repo.write({ 'a.ts': '3', 'b.ts': '3', 'c.ts': '3' });
      repo.commit('a+b+c');
      repo.write({ 'c.ts': '4' });
      const base = repo.commit('c');
      // the change under review touches every file at once: it must not count as evidence
      repo.write({ 'a.ts': '5', 'b.ts': '5', 'c.ts': '5', 'd.ts': '5' });
      const head = repo.commit('change');
      const units = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((p) => tsUnit(p));
      const graph = await buildFileGraph({
        units,
        allFiles: units.map((u) => u.path),
        repo: new GitRepo(repo.root),
        headSha: head,
        baseSha: base,
      });
      const co = graph.edges.filter((e) => e.reason === 'cochange');
      // a,b: 3 shared commits of 3 → 0.5; a,c and b,c: 2 shared of min(3, 3) → 0.33; d only in init
      expect(co.map((e) => [e.a, e.b, Number(e.weight.toFixed(3))])).toEqual([
        ['a.ts', 'b.ts', 0.5],
        ['a.ts', 'c.ts', 0.333],
        ['b.ts', 'c.ts', 0.333],
      ]);
    });

    it('yields no co-change edges when git fails', async () => {
      repo = makeRepo(); // no commits: git log fails
      const units = [tsUnit('a.ts'), tsUnit('b.ts')];
      const graph = await buildFileGraph({ units, allFiles: [], repo: new GitRepo(repo.root) });
      expect(graph.edges.filter((e) => e.reason === 'cochange')).toEqual([]);
    });
  });
});

describe('clustering and packing', () => {
  const edge = (a: string, b: string, weight: number, reason: FileEdge['reason'] = 'import'): FileEdge => ({
    a,
    b,
    weight,
    reason,
  });

  it('keeps a strongly connected component together and leaves weak links apart', () => {
    const files = ['a', 'b', 'c', 'd', 'e'];
    const sizes = new Map(files.map((f) => [f, 100]));
    const edges = [
      edge('a', 'b', 1),
      edge('b', 'c', 1, 'test'),
      edge('c', 'd', 0.3, 'directory'),
      edge('d', 'e', 0.5, 'cochange'),
    ];
    const groups = clusterFiles(files, sizes, edges, 1_000);
    expect(groups.map((g) => g.files)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    expect(groups[0]!.reasons).toEqual(['imports', 'test pair']);
    expect(groups[1]!.reasons).toEqual(['co-change']);
  });

  it('splits an oversized component deterministically into pieces within budget', () => {
    const files = ['hub', ...Array.from({ length: 9 }, (_, i) => `f${i}`)];
    const sizes = new Map(files.map((f) => [f, 100]));
    const edges = files.slice(1).map((f) => edge('hub', f, 1));
    edges.push(edge('f0', 'f1', 1));
    const groups = clusterFiles(files, sizes, edges, 300);
    expect(groups.every((g) => g.tokens <= 300)).toBe(true);
    expect(groups.flatMap((g) => g.files).sort()).toEqual([...files].sort());
    expect(groups[0]!.files[0]).toBe('hub'); // highest degree seeds the traversal
    expect(clusterFiles([...files].reverse(), sizes, [...edges].reverse(), 300)).toEqual(groups);
  });

  it('packs first-fit-decreasing and prefers the bin with the strongest affinity', () => {
    const index = new AffinityIndex([edge('small', 'b2', 0.3, 'directory')]);
    const bins = packItems(
      [
        { key: 'b1', files: ['b1'], tokens: 600 },
        { key: 'b2', files: ['b2'], tokens: 500 },
        { key: 'small', files: ['small'], tokens: 100 },
      ],
      1_000,
      index,
    );
    expect(bins.map((b) => b.items.map((i) => i.key))).toEqual([['b1'], ['b2', 'small']]);
  });

  it('orders a chunk foundations-first with tests last', () => {
    const imports = new Map([
      ['api.ts', ['db.ts', 'types.ts']],
      ['db.ts', ['types.ts']],
      ['api.test.ts', ['api.ts']],
      ['cycle-a.ts', ['cycle-b.ts']],
      ['cycle-b.ts', ['cycle-a.ts']],
    ]);
    expect(
      orderFiles(['api.test.ts', 'api.ts', 'cycle-b.ts', 'db.ts', 'types.ts', 'cycle-a.ts'], imports),
    ).toEqual(['types.ts', 'db.ts', 'api.ts', 'cycle-b.ts', 'cycle-a.ts', 'api.test.ts']);
  });
});

describe('buildChunks (smart)', () => {
  function sample(): ReviewUnit[] {
    return [
      tsUnit('src/api/users.ts', ['../db/client']),
      tsUnit('src/db/client.ts'),
      tsUnit('test/users.test.ts', ['../src/api/users']),
      tsUnit('src/ui/button.tsx', ['./theme']),
      tsUnit('src/ui/theme.ts'),
      tsUnit('src/misc/x.ts'),
      { ...tsUnit('src/removed.ts'), status: 'deleted', content: undefined },
    ];
  }

  it('groups related files across directories and records why', async () => {
    const units = sample();
    const graph = await graphFor(units);
    const size = buildChunks(units, { ...renderOpts, budget: 100_000 }).chunks[0]!.tokens;
    const budget = Math.floor(size * 0.6);
    const { chunks, mentions } = buildChunks(units, { ...renderOpts, budget, graph, contextShare: 0 });
    expect(mentions).toEqual(['src/removed.ts']);
    expect(chunks.length).toBeGreaterThan(1);
    const withUsers = chunks.find((c) => c.files.includes('src/api/users.ts'))!;
    expect(withUsers.files).toEqual(['src/db/client.ts', 'src/api/users.ts', 'test/users.test.ts']);
    expect(withUsers.groupReasons).toEqual(expect.arrayContaining(['imports', 'test pair']));
    const withButton = chunks.find((c) => c.files.includes('src/ui/button.tsx'))!;
    const at = (f: string) => withButton.files.indexOf(f);
    expect(at('src/ui/theme.ts')).toBe(at('src/ui/button.tsx') - 1); // dependency right before its user
    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => `c${String(i + 1).padStart(3, '0')}`));
    expect(chunks[0]!.mentions).toEqual(['src/removed.ts']);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(budget);
  });

  it('never drops or duplicates a part, even when big files are split', async () => {
    const units = [...sample(), tsUnit('src/big.ts', ['./api/users'], 900), tsUnit('src/tiny.ts', [], 1)];
    const graph = await graphFor(units);
    const budget = 1_500;
    const { chunks } = buildChunks(units, { ...renderOpts, budget, graph });
    const legacy = buildChunks(units, { ...renderOpts, budget, strategy: 'directory' });
    const key = (p: { path: string; part?: { index: number } }) => `${p.path}#${p.part?.index ?? 0}`;
    expect(reviewParts(chunks).map(key).sort()).toEqual(reviewParts(legacy.chunks).map(key).sort());
    expect(new Set(reviewParts(chunks).map(key)).size).toBe(reviewParts(chunks).length);
    for (const c of chunks) {
      const review = c.parts.filter((p) => p.role !== 'context').reduce((s, p) => s + p.tokens, 0);
      expect(review).toBeLessThanOrEqual(budget);
    }
    const bigParts = reviewParts(chunks).filter((p) => p.path === 'src/big.ts');
    expect(bigParts.length).toBeGreaterThan(1);
  });

  it('adds capped read-only context for import neighbours reviewed in other chunks', async () => {
    const units = [
      tsUnit('src/core/types.ts', [], 30),
      ...Array.from({ length: 10 }, (_, i) => tsUnit(`src/feature/f${i}.ts`, ['../core/types'], 14)),
    ];
    const graph = await graphFor(units);
    const budget = 1_200;
    const contextShare = 0.25;
    const cap = Math.floor(budget * contextShare);
    const { chunks } = buildChunks(units, { ...renderOpts, budget, graph, contextShare });
    expect(chunks.length).toBeGreaterThan(2);
    const owner = chunks.find((c) => c.files.includes('src/core/types.ts'))!;
    for (const c of chunks) {
      const context = c.parts.filter((p) => p.role === 'context');
      const contextTokens = context.reduce((s, p) => s + p.tokens, 0);
      expect(contextTokens).toBeLessThanOrEqual(cap);
      expect(c.tokens).toBe(c.parts.reduce((s, p) => s + p.tokens, 0));
      expect(c.contextFiles).toEqual(context.map((p) => p.path));
      for (const p of context) expect(c.files).not.toContain(p.path);
      expect(c.languages).toEqual(['typescript']);
      if (c === owner) continue;
      expect(c.contextFiles).toEqual(['src/core/types.ts']);
      expect(
        context[0]!.text.startsWith(`## Context: src/core/types.ts (read-only — reviewed in ${owner.id})\n`),
      ).toBe(true);
      expect(chunkTextFor(c, 'context')).toBe(context[0]!.text);
      expect(chunkTextFor(c, 'review')).not.toContain('## Context:');
    }
    // the hub's chunk sees (some of) its callers
    expect(owner.contextFiles!.length).toBeGreaterThan(0);
    expect(owner.contextFiles!.every((f) => f.startsWith('src/feature/'))).toBe(true);
  });

  it('respects contextShare = 0 and maxTotalTokens', async () => {
    const units = [
      tsUnit('src/core/types.ts', [], 30),
      ...Array.from({ length: 10 }, (_, i) => tsUnit(`src/feature/f${i}.ts`, ['../core/types'], 14)),
    ];
    const graph = await graphFor(units);
    const none = buildChunks(units, { ...renderOpts, budget: 1_200, graph, contextShare: 0 });
    expect(none.chunks.every((c) => c.parts.every((p) => p.role !== 'context'))).toBe(true);
    const capped = buildChunks(units, { ...renderOpts, budget: 1_200, graph, maxTotalTokens: 1_200 });
    for (const c of capped.chunks) expect(c.tokens).toBeLessThanOrEqual(1_200);
  });

  it('is deterministic: same input (in any order) → identical chunks', async () => {
    const units = [...sample(), tsUnit('src/big.ts', ['./api/users'], 300)];
    const graph = await graphFor(units);
    const opts = { ...renderOpts, budget: 900, graph };
    const first = buildChunks(units, opts);
    const second = buildChunks(units, opts);
    expect(second).toEqual(first);
    const shuffledGraph = await graphFor([...units].reverse());
    expect(shuffledGraph).toEqual(graph);
    const shuffled = buildChunks([...units].reverse(), {
      ...opts,
      graph: { edges: [...graph.edges].reverse(), imports: graph.imports },
    });
    expect(shuffled).toEqual(first);
  });

  it('keeps the legacy directory packing without a graph', () => {
    const units = sample();
    const { chunks } = buildChunks(units, { ...renderOpts, budget: 100_000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.files).toEqual([
      'src/api/users.ts',
      'src/db/client.ts',
      'src/misc/x.ts',
      'src/ui/button.tsx',
      'src/ui/theme.ts',
      'test/users.test.ts',
    ]);
    expect(chunks[0]!.contextFiles).toEqual([]);
  });

  it('schedules chunks largest first', () => {
    const chunk = (id: string, tokens: number) => ({ id, tokens }) as Chunk;
    expect(
      scheduleOrder([chunk('c001', 10), chunk('c002', 30), chunk('c003', 30), chunk('c004', 20)]),
    ).toEqual(['c002', 'c003', 'c004', 'c001']);
  });
});

describe('performance', () => {
  it('builds the graph and packs 500 changed files in < 300 ms', async () => {
    const units: ReviewUnit[] = [];
    for (let d = 0; d < 25; d++) {
      for (let i = 0; i < 20; i++) {
        const deps = [`./m${(i + 1) % 20}`, `../d${(d + 1) % 25}/m${i}`, '@/shared/util', 'react'];
        units.push(tsUnit(`src/d${d}/m${i}.ts`, deps, 3));
      }
    }
    const allFiles = [
      ...units.map((u) => u.path),
      'tsconfig.json',
      'src/shared/util.ts',
      ...Array.from({ length: 5_000 }, (_, i) => `vendor/x${i % 50}/f${i}.ts`),
    ];
    const tsconfig = '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }';
    const readFile = async (p: string) => (p === 'tsconfig.json' ? tsconfig : undefined);
    const sizes = new Map(units.map((u) => [u.path, estimateTokens(u.content!)]));

    const start = performance.now();
    const graph = await buildFileGraph({ units, allFiles, readFile });
    const index = new AffinityIndex(graph.edges);
    const groups = clusterFiles(
      units.map((u) => u.path),
      sizes,
      graph.edges,
      20_000,
      index,
    );
    const bins = packItems(
      groups.map((g) => ({ key: g.files[0]!, files: g.files, tokens: g.tokens })),
      20_000,
      index,
    );
    const elapsed = performance.now() - start;
    expect(graph.imports.get('src/d0/m0.ts')).toEqual(['src/d0/m1.ts', 'src/d1/m0.ts', 'src/shared/util.ts']);
    expect(bins.length).toBeGreaterThan(1);
    expect(elapsed).toBeLessThan(300);
  });
});
