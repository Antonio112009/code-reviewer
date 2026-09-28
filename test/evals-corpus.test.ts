/**
 * Validates the built-in eval corpus (evals/): every case parses, is self-contained, stays small, carries
 * no hints for the reviewer, and its expected defects lie in the lines the change touches.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtinCorpusDir, loadCases } from '../src/eval/cases';
import { type CaseRepo, materializeCase } from '../src/eval/repo';
import type { EvalCase } from '../src/eval/types';
import { parseUnifiedDiff } from '../src/git/diff-parser';
import { GitRepo } from '../src/git/repo';

const MIN_CASES = 14;
const MIN_CLEAN = 4;
/** Cases stay small enough to read in one sitting. */
const MAX_CASE_LINES = 160;
/** Marker comments a reviewer (or the mock provider) could take as the answer. */
const HINTS = /\bBUG\b|\bFIXME\b|\bXXX\b|\bvulnerab|\binsecure\b|\bdeliberate/i;

let cases: EvalCase[] = [];

beforeAll(async () => {
  cases = await loadCases([], process.cwd());
});

describe('built-in eval corpus', () => {
  it('has enough cases, including clean ones', () => {
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES);
    expect(cases.filter((c) => c.expect.length === 0).length).toBeGreaterThanOrEqual(MIN_CLEAN);
    for (const c of cases) {
      if (c.expect.length === 0) expect(c.tags, `${c.id}: clean cases are tagged "clean"`).toContain('clean');
      else expect(c.tags, `${c.id}: only clean cases are tagged "clean"`).not.toContain('clean');
    }
  });

  it('cases are self-contained, tagged, small and without hints', () => {
    for (const c of cases) {
      expect(c.file.startsWith(builtinCorpusDir()), c.id).toBe(true);
      expect(c.source.kind, `${c.id}: built-in cases must not need a network or a local repository`).toBe(
        'inline',
      );
      expect(c.tags.length, `${c.id}: tags`).toBeGreaterThan(0);
      expect(c.expect.length, `${c.id}: one or two defects per case`).toBeLessThanOrEqual(2);
      for (const d of c.expect) expect(d.note, `${c.id}: every expected defect explains itself`).toBeTruthy();
      const lines = readFileSync(c.file, 'utf8').split('\n').length;
      expect(lines, `${c.id}: ${lines} lines`).toBeLessThanOrEqual(MAX_CASE_LINES);
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
    afterAll(async () => {
      for (const r of repos.values()) await r.dispose();
    });

    it('materialises every case and finds each expected range in a changed hunk', async () => {
      for (const c of cases) {
        const repo = await materializeCase(c);
        repos.set(c.id, repo);
        const git = new GitRepo(repo.root);
        const diff = parseUnifiedDiff(await git.diff(repo.base, repo.head, 3));
        for (const d of c.expect) {
          const file = diff.find((f) => f.path === d.file);
          expect(file, `${c.id}: ${d.file} is not changed`).toBeDefined();
          const inHunk = file!.hunks.some(
            (h) => d.startLine <= h.newStart + h.newLines - 1 && d.endLine >= h.newStart,
          );
          expect(inHunk, `${c.id}: ${d.file}:${d.startLine}-${d.endLine} is outside the changed hunks`).toBe(
            true,
          );
        }
      }
    }, 120_000);
  });
});
