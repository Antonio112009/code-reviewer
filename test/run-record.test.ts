import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stagesLabel } from '../src/report/common';
import { renderMarkdown } from '../src/report/markdown';
import { runReview } from '../src/review/pipeline';
import type { RunRecord } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { packageVersion } from '../src/util/paths';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;

beforeAll(() => {
  repo = makeRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    'src/a.ts': 'export const a = 1;\nexport const b = a / 0; // BUG(major): division by zero\n',
  });
  repo.commit('feature');
  repo.git('checkout', '-q', 'main');
});
afterAll(() => repo.cleanup());

describe('run record', () => {
  it('records the version and every setting that shapes what the run reports', async () => {
    const { run } = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.review.deepen = true;
      }),
      logger: silentLogger,
    });
    expect(run!.version).toBe(packageVersion());
    expect(run!.options).toMatchObject({
      depth: 'full',
      selfCritique: true,
      advisoryConfidence: 0.6,
      secondOpinion: true,
      deepen: true,
      notes: true,
      maxNotes: 5,
      passes: ['general'],
      audit: false,
    });
    expect(stagesLabel(run!)).toBe(
      'critic · second opinion · maintainability notes (max 5) · second pass (--deepen)',
    );
    const md = renderMarkdown(run!);
    expect(md).toContain('| Stages | critic · second opinion · maintainability notes (max 5)');
    expect(md).toContain(`| Code Reviewer | ${packageVersion()} |`);
  });

  it('names what was off, and nothing for runs older than these settings', () => {
    const options = {
      selfCritique: false,
      secondOpinion: true,
      deepen: false,
      notes: false,
    } as RunRecord['options'];
    expect(stagesLabel({ options })).toBe('no critic');
    expect(stagesLabel({ options: { selfCritique: true } as RunRecord['options'] })).toBeUndefined();
  });
});
