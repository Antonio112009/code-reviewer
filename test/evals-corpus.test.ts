/**
 * Validates the built-in eval corpus (evals/): every case parses, is self-contained (except `real` cases,
 * which replay a public repository and record their provenance), stays small, carries no hints for the
 * reviewer, and its expected defects lie in the lines the change touches. Real-repository cases are
 * cloned and checked only with EVAL_REAL_REPOS=1 (network).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtinCorpusDir, loadCases } from '../src/eval/cases';
import { type CaseRepo, type MaterializeOptions, materializeCase } from '../src/eval/repo';
import type { EvalCase } from '../src/eval/types';
import { parseUnifiedDiff } from '../src/git/diff-parser';
import { GitRepo } from '../src/git/repo';

const MIN_CASES = 14;
const MIN_CLEAN = 4;
/** Cases stay small enough to read in one sitting. */
const MAX_CASE_LINES = 160;
/** Cases tagged `large` hide a defect in a big, noisy change (a rename or refactor across many files). */
const MAX_LARGE_CASE_LINES = 1200;
const MIN_LARGE_CHANGED_LINES = 300;
/** The categories of the `hard` subset (docs/evals.md). */
const HARD_CATEGORIES = ['cross-file', 'large', 'logic', 'tempting', 'real'];
/** Provenance comments of a `real` case: the commit that introduced the bug (its headRef) and the fix. */
const INTRODUCED = /^# Introduced: https:\/\/\S+\/commit\/([0-9a-f]{40})\b/m;
const FIXED = /^# Fixed: +https:\/\/\S+\/commit\/[0-9a-f]{40}\b/m;
const REAL_REPOS = process.env.EVAL_REAL_REPOS === '1';
/** Marker comments a reviewer (or the mock provider) could take as the answer. */
const HINTS = /\bBUG\b|\bFIXME\b|\bXXX\b|\bvulnerab|\binsecure\b|\bdeliberate/i;

let cases: EvalCase[] = [];

beforeAll(async () => {
  cases = await loadCases([], process.cwd());
});

/** The defects a case requires (optional ones are acceptable findings, not requirements). */
const required = (c: { expect: Array<{ optional?: boolean }> }) => c.expect.filter((d) => !d.optional);

describe('built-in eval corpus', () => {
  it('has enough cases, including clean ones', () => {
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES);
    expect(cases.filter((c) => required(c).length === 0).length).toBeGreaterThanOrEqual(MIN_CLEAN);
    for (const c of cases) {
      if (required(c).length === 0)
        expect(c.tags, `${c.id}: clean cases are tagged "clean"`).toContain('clean');
      else expect(c.tags, `${c.id}: only clean cases are tagged "clean"`).not.toContain('clean');
    }
  });

  it('hard cases name one category; tempting cases are clean', () => {
    for (const c of cases) {
      const categories = c.tags.filter((t) => HARD_CATEGORIES.includes(t));
      if (c.tags.includes('hard'))
        expect(categories, `${c.id}: one of ${HARD_CATEGORIES.join(', ')}`).toHaveLength(1);
      else expect(categories, `${c.id}: category tags belong to hard cases`).toEqual([]);
      if (c.tags.includes('tempting')) expect(required(c), `${c.id}: tempting cases are clean`).toEqual([]);
    }
  });

  it('cases are self-contained, tagged, small and without hints', () => {
    for (const c of cases) {
      expect(c.file.startsWith(builtinCorpusDir()), c.id).toBe(true);
      if (c.tags.includes('real')) {
        expect(c.source.kind, `${c.id}: real cases replay a public repository`).toBe('repo');
        if (c.source.kind === 'repo') {
          expect(c.source.repo, `${c.id}: an https URL`).toMatch(/^https:\/\//);
          const text = readFileSync(c.file, 'utf8');
          expect(INTRODUCED.exec(text)?.[1], `${c.id}: "# Introduced:" names headRef`).toBe(c.source.headRef);
          expect(text, `${c.id}: "# Fixed:" names the fixing commit`).toMatch(FIXED);
        }
      } else {
        expect(c.source.kind, `${c.id}: built-in cases must not need a network or a local repository`).toBe(
          'inline',
        );
      }
      expect(c.tags.length, `${c.id}: tags`).toBeGreaterThan(0);
      expect(required(c).length, `${c.id}: one or two required defects per case`).toBeLessThanOrEqual(2);
      for (const d of c.expect) expect(d.note, `${c.id}: every expected defect explains itself`).toBeTruthy();
      const lines = readFileSync(c.file, 'utf8').split('\n').length;
      const maxLines = c.tags.includes('large') ? MAX_LARGE_CASE_LINES : MAX_CASE_LINES;
      expect(lines, `${c.id}: ${lines} lines`).toBeLessThanOrEqual(maxLines);
      if (c.source.kind !== 'inline') continue;
      for (const [file, content] of [...Object.entries(c.source.base), ...Object.entries(c.source.head)]) {
        if (content === null) continue;
        const hint = HINTS.exec(content);
        expect(hint, `${c.id}: ${file} contains "${hint?.[0]}"`).toBeNull();
      }
    }
  });

  describe('expected defects lie in the change', () => {
    const repos = new Map<string, CaseRepo>();
    let cacheDir: string | undefined;
    afterAll(async () => {
      for (const r of repos.values()) await r.dispose();
      if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
    });

    async function checkChange(c: EvalCase, opts: MaterializeOptions = {}): Promise<void> {
      const repo = await materializeCase(c, opts);
      repos.set(c.id, repo);
      const git = new GitRepo(repo.root);
      const diff = parseUnifiedDiff(await git.diff(repo.base, repo.head, 3));
      if (c.tags.includes('large')) {
        let changed = 0;
        for (const f of diff)
          for (const h of f.hunks) changed += h.lines.filter((l) => l.type !== 'ctx').length;
        expect(changed, `${c.id}: a large case changes many lines`).toBeGreaterThanOrEqual(
          MIN_LARGE_CHANGED_LINES,
        );
      }
      for (const d of c.expect) {
        const file = diff.find((f) => f.path === d.file);
        expect(file, `${c.id}: ${d.file} is not changed`).toBeDefined();
        const inHunk = file!.hunks.some(
          (h) => d.startLine <= h.newStart + h.newLines - 1 && d.endLine >= h.newStart,
        );
        expect(inHunk, `${c.id}: ${d.file}:${d.startLine}-${d.endLine} is outside the changed hunks`).toBe(
          true,
        );
        // `also` may point anywhere in the head revision (e.g. the unchanged caller that crashes)
        for (const a of d.also ?? []) {
          const where = `${a.file ?? d.file}:${a.startLine}-${a.endLine}`;
          const text = await git.run(['show', `${repo.head}:${a.file ?? d.file}`]).catch(() => undefined);
          expect(text, `${c.id}: also ${where} is not in the head revision`).toBeDefined();
          expect(a.endLine, `${c.id}: also ${where} is past the end of the file`).toBeLessThanOrEqual(
            text!.split('\n').length,
          );
        }
      }
    }

    it('materialises every inline case and finds each expected range in a changed hunk', async () => {
      for (const c of cases) if (c.source.kind === 'inline') await checkChange(c);
    }, 120_000);

    it.skipIf(!REAL_REPOS)(
      'clones every real-repository case and checks it the same way',
      async () => {
        cacheDir = mkdtempSync(path.join(tmpdir(), 'cr-eval-real-'));
        for (const c of cases) if (c.source.kind === 'repo') await checkChange(c, { cacheDir });
      },
      600_000,
    );
  });
});
