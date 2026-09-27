import { describe, expect, it } from 'vitest';
import { extractImports, resolveImports } from '../src/chunking/imports';
import { clipLine, renderUnit } from '../src/chunking/render';
import { estimateTokens } from '../src/chunking/tokens';
import type { ReviewUnit } from '../src/types';
import { extractJson } from '../src/util/json';

/** Runs `fn` and fails when it takes longer than `ms` (the event loop must stay responsive). */
function fast<T>(fn: () => T, ms: number, what: string): T {
  const started = performance.now();
  const out = fn();
  const took = performance.now() - started;
  expect(took, `${what} took ${took.toFixed(0)} ms`).toBeLessThan(ms);
  return out;
}

describe('token estimation', () => {
  it('counts special-token strings as text instead of throwing', () => {
    for (const s of ['<|endoftext|>', '<|im_start|>user', '<|fim_prefix|>x<|fim_suffix|>'])
      expect(estimateTokens(`const EOS = "${s}";`)).toBeGreaterThan(0);
  });

  it('is linear on long runs of spaces, letters or base64', () => {
    const mb = 1024 * 1024;
    for (const [what, text] of [
      ['spaces', ' '.repeat(mb)],
      ['letters', 'a'.repeat(mb)],
      ['base64', 'QUJD'.repeat(mb / 4)],
      ['mixed', `${'x'.repeat(300)} `.repeat(mb / 301)],
    ] as const) {
      const n = fast(() => estimateTokens(text), 1_500, what);
      expect(n, what).toBeGreaterThan(mb / 16);
    }
    // ordinary code is still counted by the tokenizer
    expect(estimateTokens('export function f(a: number) { return a + 1; }')).toBeLessThan(25);
  });
});

describe('import graph on hostile repositories', () => {
  it('parses Python aliases linearly', () => {
    const n = 400_000;
    fast(
      () => extractImports('evil.py', `import a${' '.repeat(n)}b\nfrom x import a${' '.repeat(n)}b\n`),
      1_000,
      'py',
    );
    expect(extractImports('ok.py', 'from pkg.mod import a  as  b, c\nimport os.path as p\n')).toEqual([
      { scheme: 'python', specifier: 'pkg.mod', names: ['a', 'c'] },
      { scheme: 'python', specifier: 'os.path' },
    ]);
  });

  it('bounds tsconfig extends fan-out and paths targets', async () => {
    const configs: Record<string, string> = {};
    for (let level = 1; level <= 5; level++) {
      const next = level < 5 ? `./c${level + 1}.json` : undefined;
      configs[`c${level}.json`] = JSON.stringify(next ? { extends: Array(60).fill(next) } : {});
    }
    configs['tsconfig.json'] = JSON.stringify({
      extends: Array(60).fill('./c1.json'),
      compilerOptions: { baseUrl: '.', paths: { '*': Array.from({ length: 20_000 }, (_, i) => `t${i}/*`) } },
    });
    const specs = Array.from({ length: 3_000 }, (_, i) => `import x${i} from 'pkg${i}';`).join('\n');
    const started = performance.now();
    const out = await resolveImports({
      files: [{ path: 'src/a.ts', content: specs }],
      allFiles: [...Object.keys(configs), 'src/a.ts'],
      readFile: async (p) => configs[p],
    });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(out.get('src/a.ts')).toEqual([]);
  });
});

describe('rendering', () => {
  const unit = (content: string, changed: number[]): ReviewUnit => ({
    path: 'src/assets.ts',
    status: 'modified',
    language: 'typescript',
    content,
    focusRanges: [],
    hunks: [
      {
        oldStart: changed[0]!,
        oldLines: 1,
        newStart: changed[0]!,
        newLines: changed.length,
        header: '@@',
        lines: changed.map((n) => ({
          type: 'add' as const,
          text: content.split('\n')[n - 1] ?? '',
          newLine: n,
        })),
      },
    ],
  });

  it('clips very long lines so every part stays within the budget', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `export const v${i} = ${i};`);
    lines[99] = `export const logo = "data:image/png;base64,${'A'.repeat(240_000)}";`;
    const parts = renderUnit(unit(lines.join('\n'), [100]), {
      maxPartTokens: 4_000,
      fullFileTokens: 0,
      contextLines: 30,
    });
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect(p.tokens).toBeLessThanOrEqual(4_000 * 1.2);
    expect(parts.map((p) => p.text).join('\n')).toContain('more characters on this line omitted');
    expect(clipLine('short')).toBe('short');
  });

  it('whole files with uneven line lengths are split within the budget', () => {
    const lines = Array.from({ length: 400 }, (_, i) => (i % 50 === 0 ? 'x'.repeat(1_900) : `line ${i}`));
    const parts = renderUnit(
      {
        path: 'a.ts',
        status: 'file',
        language: 'typescript',
        content: lines.join('\n'),
        hunks: [],
        focusRanges: [],
      },
      { maxPartTokens: 2_000, fullFileTokens: 0, contextLines: 0 },
    );
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.tokens).toBeLessThanOrEqual(2_000);
  });
});

describe('JSON extraction from replies', () => {
  it('is linear on unbalanced brackets and still finds the payload', () => {
    const noise = '{['.repeat(100_000);
    const json = '{"findings": [{"file": "a.ts"}]}';
    expect(fast(() => extractJson(`${noise} ${json}`), 1_000, 'unbalanced')).toEqual({
      findings: [{ file: 'a.ts' }],
    });
    expect(extractJson('He said "hi" then: {"a": [1, 2]} ok')).toEqual({ a: [1, 2] });
    expect(extractJson('```json\r\n{"x": 1,}\n```')).toEqual({ x: 1 });
  });
});
