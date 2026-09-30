import { execFileSync } from 'node:child_process';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AST_GREP_LANGUAGES,
  bundledAstGrep,
  parseAstGrep,
  ruleDocuments,
  type StructuralCheck,
  StructuralCheckSchema,
} from '../src/analyzers/ast-grep';
import { runAnalyzers } from '../src/analyzers/index';
import { DEFAULT_CONFIG } from '../src/config/schema';
import { loadSkills } from '../src/skills/loader';
import { detectLanguage } from '../src/util/language';

/** The ast-grep binary from devDependencies; the tests that run it are skipped without it. */
const BIN_DIR = path.resolve('node_modules/.bin');
const HAS_AST_GREP = existsSync(path.join(BIN_DIR, 'ast-grep'));
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'cr-ast-grep-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const check = (over: Partial<StructuralCheck> = {}): StructuralCheck => ({
  skill: 'javascript/core/async-promises',
  id: 'async-foreach',
  language: ['TypeScript'],
  message: 'async callback passed to forEach',
  rule: { pattern: '$A.forEach(async ($$$P) => $$$B)' },
  examples: ['items.forEach(async (x) => save(x));'],
  ...over,
});

describe('structural check schema', () => {
  it('accepts declarative rules and refuses fixes, transforms and unknown languages', () => {
    const base = {
      id: 'x',
      language: 'Go',
      message: 'a message',
      rule: { kind: 'defer_statement' },
      examples: ['defer f()'],
    };
    expect(StructuralCheckSchema.parse(base).language).toEqual(['Go']);
    expect(StructuralCheckSchema.safeParse({ ...base, fix: '' }).success).toBe(false);
    expect(StructuralCheckSchema.safeParse({ ...base, transform: {} }).success).toBe(false);
    expect(StructuralCheckSchema.safeParse({ ...base, language: 'Brainfuck' }).success).toBe(false);
    expect(StructuralCheckSchema.safeParse({ ...base, rule: { pattern: 'x'.repeat(5000) } }).success).toBe(
      false,
    );
  });

  it('parses stream output back to the check that matched', () => {
    const line = JSON.stringify({
      file: 'src/a.ts',
      ruleId: 'c0-typescript',
      range: { start: { line: 4, column: 0 }, end: { line: 6, column: 2 } },
    });
    expect(parseAstGrep(`${line}\n`, [check()], '/box', new Set(['src/a.ts']))).toEqual([
      expect.objectContaining({
        ruleId: 'javascript/core/async-promises#async-foreach',
        file: 'src/a.ts',
        startLine: 5,
        endLine: 7,
        severity: 'minor',
        confidence: 0.5,
      }),
    ]);
    // a file outside the sandbox list is dropped
    expect(parseAstGrep(`${line}\n`, [check()], '/box', new Set(['other.ts']))).toEqual([]);
  });
});

/** A copy of the binary outside the working directory (tools inside it are refused). */
function trustedBin(): string {
  const dir = path.join(scratch, 'bin');
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'ast-grep');
  if (!existsSync(target)) {
    copyFileSync(realpathSync(path.join(BIN_DIR, 'ast-grep')), target, constants.COPYFILE_FICLONE);
  }
  return dir;
}

describe.skipIf(!HAS_AST_GREP)('with ast-grep', () => {
  it('every check in the library matches its examples and none of its counterexamples', async () => {
    const skills = await loadSkills(undefined, () => {});
    const checks = skills.flatMap((s) => s.checks ?? []);
    expect(checks.length).toBeGreaterThan(0);
    for (const [i, c] of checks.entries()) {
      const dir = path.join(scratch, `lib-${i}`);
      mkdirSync(dir, { recursive: true });
      const ext = AST_GREP_LANGUAGES[c.language[0]!][0];
      for (const [j, e] of c.examples.entries()) writeFileSync(path.join(dir, `ex${j}${ext}`), `${e}\n`);
      for (const [j, e] of (c.counterexamples ?? []).entries())
        writeFileSync(path.join(dir, `ok${j}${ext}`), `${e}\n`);
      writeFileSync(
        path.join(dir, 'rules.yml'),
        ruleDocuments({ ...c, language: [c.language[0]!] }, 0).join('\n---\n'),
      );
      const out = execFileSync(
        path.join(BIN_DIR, 'ast-grep'),
        ['scan', '--rule', 'rules.yml', '--json=stream', '.'],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      );
      const matched = new Set(
        out
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l).file as string),
      );
      for (const j of c.examples.keys()) {
        expect(matched.has(`ex${j}${ext}`), `${c.skill}#${c.id} example ${j + 1}`).toBe(true);
      }
      for (const j of (c.counterexamples ?? []).keys()) {
        expect(matched.has(`ok${j}${ext}`), `${c.skill}#${c.id} counterexample ${j + 1}`).toBe(false);
      }
    }
  });

  it('turns matches in changed lines into hints, ignoring the repository ast-grep config', async () => {
    const content = [
      'export async function saveAll(items: string[]) {',
      '  items.forEach(async (x) => {',
      '    await save(x);',
      '  });',
      '}',
      ...Array.from({ length: 30 }, (_, i) => `const unchanged${i} = ${i};`),
      'old.forEach(async (x) => save(x)); // unchanged: no hint',
    ].join('\n');
    const { hits, runs } = await runAnalyzers({
      files: [
        { path: 'src/a.ts', content, language: detectLanguage('src/a.ts'), changedRanges: [[1, 5]] },
        // would switch rules off if it were ever read
        { path: 'sgconfig.yml', content: 'ruleDirs: []\n', language: 'yaml', changedRanges: [[1, 1]] },
      ],
      settings: { ...DEFAULT_CONFIG.analyzers, builtin: false },
      mode: 'diff',
      checks: [check({ severity: 'major', confidence: 0.6 })],
      // Programs inside the working directory are never trusted: run a copy from outside it.
      env: { PATH: trustedBin(), HOME: scratch },
    });
    expect(runs.find((r) => r.id === 'ast-grep')).toMatchObject({ status: 'ok', hits: 1 });
    expect(hits.filter((h) => h.analyzer === 'ast-grep')).toEqual([
      expect.objectContaining({
        ruleId: 'javascript/core/async-promises#async-foreach',
        file: 'src/a.ts',
        startLine: 2,
        severity: 'major',
      }),
    ]);
  });
});

describe('bundled ast-grep', () => {
  it('finds the binary of this platform in the optional dependency, and none for unknown platforms', () => {
    const bin = bundledAstGrep();
    if (HAS_AST_GREP) {
      expect(bin).toMatch(/@ast-grep[\\/]cli-[\w-]+[\\/]ast-grep(?:\.exe)?$/);
      expect(existsSync(bin!)).toBe(true);
    }
    expect(bundledAstGrep('freebsd', 'x64')).toBeUndefined();
  });
});
