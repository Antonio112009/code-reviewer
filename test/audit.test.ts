import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runReview } from '../src/review/pipeline';
import { reviewInstructions, reviewPrompt } from '../src/review/prompts';
import type { Chunk, RunRecord } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

describe('function audit (review.audit)', () => {
  const chunk: Chunk = {
    id: 'c001',
    index: 0,
    parts: [],
    tokens: 100,
    files: ['src/a.ts'],
    languages: ['typescript'],
    mentions: [],
    declarations: [
      { name: 'charge', file: 'src/a.ts', kind: 'body' },
      { name: 'refund', file: 'src/a.ts', kind: 'signature' },
      { name: 'legacy', file: 'src/a.ts', kind: 'removed' },
    ],
  };
  const target = { kind: 'files' as const, paths: ['src'] };

  it('lists the changed functions and asks to audit each one', () => {
    const prompt = reviewPrompt({ target, chunk, totalChunks: 1, otherFiles: [], audit: true });
    expect(prompt).toContain('## Changed functions to audit (each one)');
    expect(prompt).toContain('- `charge` — body changed in src/a.ts');
    expect(prompt).toContain('- `refund` — declaration changed in src/a.ts');
    expect(prompt).not.toContain('`legacy`'); // removed: nothing left to audit
    expect(reviewPrompt({ target, chunk, totalChunks: 1, otherFiles: [] })).not.toContain(
      'functions to audit',
    );
    const rules = reviewInstructions({ mode: 'diff', skills: [], audit: true });
    expect(rules).toContain('keep checking the same function');
    expect(rules).toContain('"audit" field of submit_findings');
    expect(reviewInstructions({ mode: 'diff', skills: [] })).not.toContain('Changed functions to audit');
  });

  describe('end to end (mock provider, expand off)', () => {
    let repo: TempRepo;
    let run: RunRecord;
    beforeAll(async () => {
      repo = makeRepo();
      repo.write({ 'src/a.ts': 'export function charge(x: number) {\n  return x;\n}\n' });
      repo.commit('initial');
      repo.git('checkout', '-q', '-b', 'feature');
      repo.write({ 'src/a.ts': 'export function charge(x: number) {\n  return x * 2; // BUG: doubled\n}\n' });
      repo.commit('feature');
      repo.git('checkout', '-q', 'main');
      run = (
        await runReview({
          command: 'review',
          cwd: repo.root,
          base: 'main',
          head: 'feature',
          config: testConfig((c) => {
            c.review.audit = true;
            c.review.expand = 'off';
            c.output.formats = [];
          }),
          logger: silentLogger,
        })
      ).run!;
    });
    afterAll(() => repo.cleanup());

    it('records how many changed functions were listed for the audit', () => {
      expect(run.chunks[0]!.audit).toEqual({ listed: 1, audited: 0 });
    });
  });
});
