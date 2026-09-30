import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderSummary } from '../src/publish/render';
import { renderSarif } from '../src/report/sarif';
import { runReview } from '../src/review/pipeline';
import type { RunRecord } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;

beforeAll(() => {
  repo = makeRepo();
  repo.write({ 'src/cart.ts': 'export function total(xs: number[]) {\n  return 0;\n}\n' });
  repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    'src/cart.ts': [
      'export function total(xs: number[]) {',
      '  let sum = 0;',
      '  for (let i = 0; i <= xs.length; i++) sum += xs[i]; // BUG(major): off-by-one reads past the end',
      '  const factor = 100; // NOTE: magic value 100 is not explained',
      '  const tax = 0.2; // NOTE: the tax rate is a bare literal',
      '  return sum * factor * tax; // NOTE: false positive: the name is fine',
      '}',
      '',
    ].join('\n'),
  });
  repo.commit('sum the cart');
  repo.git('checkout', '-q', 'main');
});
afterAll(() => repo.cleanup());

const review = (tweak?: (c: ReturnType<typeof testConfig>) => void) =>
  runReview({
    command: 'review',
    cwd: repo.root,
    base: 'main',
    head: 'feature',
    config: testConfig(tweak),
    logger: silentLogger,
  });

describe('maintainability notes', () => {
  let run: RunRecord;
  let runDir: string;

  beforeAll(async () => {
    const outcome = await review();
    run = outcome.run!;
    runDir = outcome.runDir!;
  });

  it('keeps the notes the critic confirmed apart from the defects', () => {
    expect(run.findings.map((f) => [f.startLine, f.severity, f.category])).toEqual([[3, 'major', 'bug']]);
    expect(run.advisory).toBeUndefined();
    expect(run.notes?.map((f) => [f.startLine, f.severity, f.category])).toEqual([
      [4, 'info', 'maintainability'],
      [5, 'info', 'maintainability'],
    ]);
    expect(run.notes?.every((f) => f.critique?.verdict === 'confirmed' && f.fingerprint)).toBe(true);
    // the mock critic rejects titles that say "false positive": a note that is not true of the code goes
    const dropped = run.rejected.find((f) => f.startLine === 6);
    expect(dropped?.droppedReason).toBe('critique');
  });

  it('lists them in the reports and the summary comment, never as inline comments or in SARIF', () => {
    const md = readFileSync(path.join(runDir, 'report.md'), 'utf8');
    expect(md).toContain('## Maintainability notes (2)');
    expect(md).toContain('magic value 100 is not explained');
    const html = readFileSync(path.join(runDir, 'report.html'), 'utf8');
    expect(html).toContain('show maintainability notes');
    const summary = renderSummary({ run, forge: 'github', posted: [], alreadyPosted: [], listed: [] });
    expect(summary).toContain('### Code review: 1 finding');
    expect(summary).toContain('**Maintainability notes**');
    expect(summary).toContain('the tax rate is a bare literal');
    const sarif = renderSarif(run);
    expect(sarif).toContain('off-by-one');
    expect(sarif).not.toContain('magic value');
  });

  it('keeps the most confident notes up to review.maxNotes', async () => {
    const outcome = await review((c) => {
      c.review.maxNotes = 1;
    });
    expect(outcome.run!.notes).toHaveLength(1);
    expect(outcome.run!.rejected.filter((f) => f.droppedReason === 'notes-cap')).toHaveLength(1);
  });

  it('reports none at essential depth, or with notes off', async () => {
    const essential = await review((c) => {
      c.review.depth = 'essential';
      c.review.minSeverity = 'major';
      c.review.advisoryConfidence = 0;
      c.review.notes = false;
    });
    expect(essential.run!.notes).toBeUndefined();
    expect(essential.run!.findings.map((f) => f.severity)).toEqual(['major']);
    expect(essential.run!.rejected.filter((f) => f.droppedReason === 'notes-off')).toHaveLength(3);
  });
});
