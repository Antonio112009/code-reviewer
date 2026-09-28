import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clusterFiles } from '../src/chunking/cluster';
import {
  calledNames,
  changedCalls,
  changedSymbols,
  declaredName,
  type ExpandSource,
  enclosingDeclaration,
  expandChunks,
  type Match,
  refersTo,
} from '../src/chunking/expand';
import { callEdges } from '../src/chunking/graph';
import { runReview } from '../src/review/pipeline';
import type { Chunk, DiffLine, ReviewUnit } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

/** A modified file: `content` is the new file; `lines` describe one hunk starting at line 1. */
function unit(file: string, content: string, lines: Array<[DiffLine['type'], string]>): ReviewUnit {
  let oldLine = 1;
  let newLine = 1;
  const diffLines: DiffLine[] = lines.map(([type, text]) => {
    const l: DiffLine = { type, text };
    if (type !== 'add') l.oldLine = oldLine++;
    if (type !== 'del') l.newLine = newLine++;
    return l;
  });
  return {
    path: file,
    status: 'modified',
    language: 'typescript',
    content,
    focusRanges: [],
    hunks: [
      {
        header: '@@',
        oldStart: 1,
        oldLines: oldLine - 1,
        newStart: 1,
        newLines: newLine - 1,
        lines: diffLines,
      },
    ],
  };
}

function chunkOf(files: string[]): Chunk {
  return { id: 'c001', index: 0, parts: [], tokens: 1_000, files, languages: ['typescript'], mentions: [] };
}

describe('declaredName', () => {
  it('finds the declared name in common languages', () => {
    expect(declaredName('export function total(xs: number[]): number {')).toBe('total');
    expect(declaredName('export const load = async (id: string) => {')).toBe('load');
    expect(declaredName('  async refresh(token: string): Promise<void> {')).toBe('refresh');
    expect(declaredName('def parse_row(row):')).toBe('parse_row');
    expect(declaredName('func (s *Server) Close() error {')).toBe('Close');
    expect(declaredName('func Open(path string) (*DB, error) {')).toBe('Open');
    expect(declaredName('    public static int count(List<String> xs) throws IOException {')).toBe('count');
    expect(declaredName('static int buffer_size(const struct conf *c)')).toBe('buffer_size');
    expect(declaredName('pub fn spawn(cmd: &str) -> Result<Child> {')).toBe('spawn');
    expect(declaredName('class OrderService {')).toBe('OrderService');
  });

  it('leaves statements and calls alone', () => {
    expect(declaredName('  if (items.length > 0) {')).toBeUndefined();
    expect(declaredName('  total(xs);')).toBeUndefined();
    expect(declaredName('  return total(xs)')).toBeUndefined();
    expect(declaredName('  } else if (x) {')).toBeUndefined();
    expect(declaredName('  while (true) {')).toBeUndefined();
  });

  it('stays fast on adversarial lines', () => {
    const lines = [
      `${'public '.repeat(55)}x(`,
      `${' '.repeat(390)}a(`,
      `f(${'('.repeat(390)}`,
      `${'a '.repeat(199)}(`,
      `func (${'x'.repeat(390)}`,
    ];
    const started = performance.now();
    for (let i = 0; i < 200; i++) for (const l of lines) declaredName(l);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('changedSymbols', () => {
  it('tells removed, redeclared and changed declarations apart', () => {
    const content = [
      'export function total(xs: number[], rate: number) {',
      '  return xs.reduce((a, b) => a + b, 0) * rate;',
      '}',
      'export function average(xs: number[]) {',
      '  return total(xs, 1) / Math.max(xs.length, 1);',
      '}',
    ].join('\n');
    const u = unit('src/math.ts', content, [
      ['del', 'export function total(xs: number[]) {'],
      ['add', 'export function total(xs: number[], rate: number) {'],
      ['del', '  return xs.reduce((a, b) => a + b, 0);'],
      ['add', '  return xs.reduce((a, b) => a + b, 0) * rate;'],
      ['ctx', '}'],
      ['ctx', 'export function average(xs: number[]) {'],
      ['del', '  return total(xs) / xs.length;'],
      ['add', '  return total(xs, 1) / Math.max(xs.length, 1);'],
      ['ctx', '}'],
      ['del', 'export function legacyTotal(xs: number[]) {'],
      ['del', '  return total(xs);'],
      ['del', '}'],
    ]);
    expect(changedSymbols(u)).toEqual([
      { name: 'legacyTotal', file: 'src/math.ts', kind: 'removed' },
      { name: 'total', file: 'src/math.ts', kind: 'signature' },
      { name: 'average', file: 'src/math.ts', kind: 'body' },
    ]);
  });

  it('marks C static functions as file-local', () => {
    const u = unit('src/label.c', 'static void draw_main(int x)\n{\n  x++;\n}', [
      ['ctx', 'static void draw_main(int x)'],
      ['ctx', '{'],
      ['add', '  x++;'],
      ['ctx', '}'],
    ]);
    expect(changedSymbols(u)).toEqual([
      { name: 'draw_main', file: 'src/label.c', kind: 'body', local: true },
    ]);
  });

  it('skips new files and files that are not source code', () => {
    const added = { ...unit('src/new.ts', 'export function a() {}', [['add', 'export function a() {}']]) };
    added.status = 'added';
    expect(changedSymbols(added)).toEqual([]);
    expect(changedSymbols(unit('README.md', '# x', [['del', 'function old() {']]))).toEqual([]);
  });
});

describe('refersTo', () => {
  it('accepts files that import, include or qualify the module, or share its directory', () => {
    expect(refersTo('src/app.ts', "import { total } from './math/lib';", 'src/math/lib.ts')).toBe(true);
    expect(refersTo('src/widgets/list.c', '#include "lv_label.h"', 'src/widgets/label/lv_label.c')).toBe(
      true,
    );
    expect(
      refersTo('internal/binder/binder.go', 'x := ast.IsAmbientModule(n)', 'internal/ast/utilities.go'),
    ).toBe(true);
    expect(refersTo('pkg/a/b.go', 'package a', 'pkg/a/c.go')).toBe(true);
  });

  it('rejects files that only share a name', () => {
    expect(refersTo('scripts/lint.js', 'function runCommand() {}', 'integration-tests/test-helper.ts')).toBe(
      false,
    );
    expect(refersTo('src/roller.c', 'static void draw_main(void)', 'src/label/lv_label.c')).toBe(false);
  });
});

describe('calledNames', () => {
  it('lists what the added lines call, most called first, minus what the files declare', () => {
    const u = unit(
      'src/job.ts',
      'export function run() {\n  chargeCard(order);\n  chargeCard(retry);\n  notify(user);\n  run();\n}',
      [
        ['ctx', 'export function run() {'],
        ['add', '  chargeCard(order);'],
        ['add', '  chargeCard(retry);'],
        ['add', '  notify(user);'],
        ['add', '  run();'],
        ['add', '  if (ok) { x(1); }'],
        ['ctx', '}'],
      ],
    );
    expect(calledNames([u])).toEqual(['chargeCard', 'notify']);
  });
});

describe('enclosingDeclaration', () => {
  it('finds the closest declaration above that is not nested deeper', () => {
    const lines = ['class A {', '  run() {', '    if (x) {', '      go();', '    }', '  }', '}'];
    expect(enclosingDeclaration(lines, 4)).toEqual({ name: 'run', line: 2 });
    expect(enclosingDeclaration(lines, 1)).toEqual({ name: 'A', line: 1 });
  });
});

describe('expandChunks', () => {
  const lib = unit('src/lib.ts', 'export function total(xs: number[], rate: number) {\n  return 0;\n}', [
    ['del', 'export function total(xs: number[]) {'],
    ['add', 'export function total(xs: number[], rate: number) {'],
    ['ctx', '  return 0;'],
    ['ctx', '}'],
  ]);
  const files: Record<string, string> = {
    'src/report.ts': [
      "import { total } from './lib';",
      '',
      'export function summary(rows: number[]) {',
      '  const sum = total(rows);',
      '  return "sum: " + sum;',
      '}',
    ].join('\n'),
    'src/page.ts': 'export function page() {\n  return summary([1, 2]);\n}',
  };
  const source = (extra: Match[] = []): ExpandSource & { searched: string[][] } => {
    const searched: string[][] = [];
    return {
      searched,
      async search(names) {
        searched.push(names);
        const all: Match[] = [
          { path: 'src/report.ts', line: 1, text: "import { total } from './lib';" },
          { path: 'src/report.ts', line: 4, text: '  const sum = total(rows);' },
          { path: 'src/lib.ts', line: 1, text: 'export function total(xs: number[], rate: number) {' },
          { path: 'src/other/total.ts', line: 1, text: 'export function total() {' },
          { path: 'node_modules/x/index.ts', line: 3, text: 'total(a)' },
          { path: 'docs/usage.md', line: 3, text: 'call total(xs)' },
          { path: 'src/page.ts', line: 2, text: '  return summary([1, 2]);' },
          ...extra,
        ];
        return all.filter((m) => names.some((n) => m.text.includes(n)));
      },
      async read(p) {
        return files[p];
      },
    };
  };

  it('adds the unchanged users of a changed declaration, with why', async () => {
    const chunk = chunkOf(['src/lib.ts']);
    const stats = await expandChunks([chunk], [lib], source(), {
      level: 'refs',
      changed: new Set(['src/lib.ts']),
      maxTokens: () => 5_000,
    });
    expect(chunk.related).toEqual([
      { path: 'src/report.ts', why: 'uses `total` (redeclared in src/lib.ts)' },
    ]);
    const part = chunk.parts.find((p) => p.role === 'related')!;
    expect(part.text).toContain('## Related: src/report.ts — uses `total`');
    expect(part.text).toContain('3   export function summary(rows: number[]) {'); // the enclosing function
    expect(part.text).toContain('4     const sum = total(rows);');
    expect(chunk.tokens).toBe(1_000 + part.tokens);
    expect(stats).toMatchObject({ symbols: 1, files: 1 });
  });

  it('follows the users one step further at deep', async () => {
    const chunk = chunkOf(['src/lib.ts']);
    await expandChunks([chunk], [lib], source(), {
      level: 'deep',
      changed: new Set(['src/lib.ts']),
      maxTokens: () => 5_000,
    });
    expect(chunk.related?.map((r) => r.path)).toEqual(['src/report.ts', 'src/page.ts']);
    expect(chunk.related?.[1]?.why).toMatch(/calls `summary`, which uses `total`/);
  });

  it('keeps within the budget', async () => {
    const chunk = chunkOf(['src/lib.ts']);
    await expandChunks([chunk], [lib], source(), {
      level: 'refs',
      changed: new Set(['src/lib.ts']),
      maxTokens: () => 10,
    });
    expect(chunk.related).toBeUndefined();
    expect(chunk.parts).toEqual([]);
  });

  it('leaves out names used all over the code base', async () => {
    const many: Match[] = Array.from({ length: 30 }, (_, i) => ({
      path: `src/m${i}.ts`,
      line: 1,
      text: 'total(x)',
    }));
    const chunk = chunkOf(['src/lib.ts']);
    const stats = await expandChunks([chunk], [lib], source(many), {
      level: 'refs',
      changed: new Set(['src/lib.ts']),
      maxTokens: () => 5_000,
    });
    expect(stats.tooCommon).toEqual(['total']);
    expect(chunk.related).toBeUndefined();
  });
});

describe('runReview with review.expand', () => {
  let repo: TempRepo;

  beforeAll(() => {
    repo = makeRepo();
    repo.write({
      'src/lib.ts': 'export function total(xs: number[]) {\n  return xs.reduce((a, b) => a + b, 0);\n}\n',
      'src/report.ts': [
        "import { total } from './lib';",
        '',
        'export function summary(rows: number[]) {',
        '  return "sum: " + total(rows);',
        '}',
        '',
      ].join('\n'),
    });
    repo.commit('initial');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write({
      'src/lib.ts':
        'export function total(xs: number[], rate: number) {\n  return xs.reduce((a, b) => a + b, 0) * rate;\n}\n',
    });
    repo.commit('add a rate');
    repo.git('checkout', '-q', 'main');
  });
  afterAll(() => repo.cleanup());

  it('shows the unchanged caller to the reviewer', async () => {
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.review.expand = 'refs';
      }),
      logger: silentLogger,
    });
    const run = outcome.run!;
    expect(run.chunks[0]!.related).toEqual([
      { path: 'src/report.ts', why: 'uses `total` (redeclared in src/lib.ts)' },
    ]);
    const dir = path.join(outcome.runDir!, 'chunks');
    const artifact = JSON.parse(readFileSync(path.join(dir, readdirSync(dir)[0]!), 'utf8')) as {
      prompt: string;
    };
    expect(artifact.prompt).toContain('## Related unchanged code (read-only)');
    expect(artifact.prompt).toContain('4     return "sum: " + total(rows);');
  });

  it('reviews each chunk in a local and a contracts pass when asked', async () => {
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.review.passes = ['local', 'contracts'];
      }),
      logger: silentLogger,
    });
    const run = outcome.run!;
    expect(run.chunks.map((c) => c.id)).toEqual(['c001-local', 'c001-contracts']);
    expect(run.chunks[0]!.related).toBeUndefined();
    expect(run.chunks[1]!.related?.map((r) => r.path)).toEqual(['src/report.ts']);
    const dir = path.join(outcome.runDir!, 'chunks');
    const read = (id: string) =>
      JSON.parse(readFileSync(path.join(dir, `${id}.json`), 'utf8')) as {
        instructions: string;
        prompt: string;
      };
    expect(read('c001-local').instructions).toContain('Focus of this pass: the changed code itself');
    const contracts = read('c001-contracts');
    expect(contracts.instructions).toContain('Focus of this pass: contracts');
    expect(contracts.prompt).toContain('## Changed declarations (check the consumers of each)');
    expect(contracts.prompt).toContain('- `total` — declaration changed in src/lib.ts');
  });
});

describe('call edges between changed files', () => {
  const callee = unit(
    'pay/transfer.go',
    'package pay\n\nfunc Transfer(from, to string, cents int64) error {\n\treturn nil\n}\n',
    [
      ['ctx', 'package pay'],
      ['ctx', ''],
      ['del', 'func Transfer(from, to string, cents int) error {'],
      ['add', 'func Transfer(from, to string, cents int64) error {'],
    ],
  );
  const sameDir = unit('pay/api.go', 'package pay\n\nfunc handle() { Transfer("a", "b", 5) }\n', [
    ['ctx', 'package pay'],
    ['add', 'func handle() { Transfer("a", "b", 5) }'],
  ]);
  const qualified = unit(
    'web/h.go',
    'package web\n\nimport "acme/pay"\n\nfunc h() { pay.Transfer(x, y, 1) }\n',
    [
      ['del', 'func h() { pay.Transfer(x, y) }'],
      ['add', 'func h() { pay.Transfer(x, y, 1) }'],
    ],
  );
  // Calls a function of the same name that it cannot reach: no module reference.
  const unrelated = unit('other/x.go', 'package other\n\nfunc g() { Transfer() }\n', [
    ['add', 'func g() { Transfer() }'],
  ]);
  // Declares its own Transfer: its calls are its own.
  const own = unit('bank/t.go', 'package bank\n\nfunc Transfer() {}\nfunc k() { Transfer() }\n', [
    ['add', 'func k() { Transfer() }'],
  ]);

  it('finds the calls on changed lines, minus names the file declares', () => {
    expect([...changedCalls(qualified)]).toEqual(['Transfer']);
    expect(changedCalls(own).has('Transfer')).toBe(false);
  });

  it('links a changed function with the changed files that call it', () => {
    const edges = callEdges([callee, sameDir, qualified, unrelated, own]);
    expect(edges.map((e) => [e.a, e.b, e.reason])).toEqual([
      ['pay/api.go', 'pay/transfer.go', 'call'],
      ['pay/transfer.go', 'web/h.go', 'call'],
    ]);
    const files = [callee, sameDir, qualified, unrelated].map((u) => u.path);
    const groups = clusterFiles(files, new Map(files.map((f) => [f, 100])), edges, 10_000);
    expect(groups.map((g) => g.files)).toEqual([
      ['other/x.go'],
      ['pay/api.go', 'pay/transfer.go', 'web/h.go'],
    ]);
    expect(groups[1]!.reasons).toEqual(['calls']);
  });

  it('ignores names changed or called in too many files', () => {
    const callers = Array.from({ length: 9 }, (_, i) =>
      unit(`pay/c${i}.go`, 'package pay\n', [['add', `func c${i}() { Transfer("a", "b", 5) }`]]),
    );
    expect(callEdges([callee, ...callers])).toEqual([]);
    expect(callEdges([callee, ...callers.slice(0, 8)])).toHaveLength(8);
  });
});
