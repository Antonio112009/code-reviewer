import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderSummary } from '../src/publish/render';
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
      '  return sum; // BUG(info): result is not rounded to cents',
      '}',
      '',
    ].join('\n'),
  });
  repo.commit('sum the cart');
  repo.git('checkout', '-q', 'main');
});
afterAll(() => repo.cleanup());

describe('"worth a look" findings', () => {
  let run: RunRecord;
  let runDir: string;

  beforeAll(async () => {
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig(),
      logger: silentLogger,
    });
    run = outcome.run!;
    runDir = outcome.runDir!;
  });

  it('keeps info and low-confidence findings apart from the main list', () => {
    expect(run.findings.map((f) => [f.startLine, f.severity])).toEqual([[3, 'major']]);
    expect(run.advisory?.map((f) => [f.startLine, f.severity])).toEqual([[4, 'info']]);
  });

  it('lists them in the reports, but not in the pull request comment', () => {
    const md = readFileSync(path.join(runDir, 'report.md'), 'utf8');
    expect(md).toContain('## Worth a look (1)');
    expect(md).toContain('result is not rounded to cents');
    const html = readFileSync(path.join(runDir, 'report.html'), 'utf8');
    expect(html).toContain('show worth a look');
    const summary = renderSummary({ run, forge: 'github', posted: [], alreadyPosted: [], listed: [] });
    expect(summary).toContain('### Code review: 1 finding');
    expect(summary).toContain(
      '1 more finding of lower confidence or `info` severity is listed as "worth a look"',
    );
  });

  it('has no such list at essential depth', async () => {
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.review.depth = 'essential';
        c.review.minSeverity = 'major';
        c.review.advisoryConfidence = 0;
      }),
      logger: silentLogger,
    });
    expect(outcome.run!.findings.map((f) => f.severity)).toEqual(['major']);
    expect(outcome.run!.advisory).toBeUndefined();
  });
});
