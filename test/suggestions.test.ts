import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderInlineComment, suggestionBlock } from '../src/publish/render';
import { runReview } from '../src/review/pipeline';
import { validateFindings } from '../src/review/validate';
import type { Finding, RunRecord } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    file: 'src/a.ts',
    startLine: 2,
    endLine: 3,
    severity: 'major',
    category: 'bug',
    title: 'Off-by-one',
    description: 'Reads past the end of the array.',
    confidence: 0.9,
    skills: [],
    source: { chunkIds: ['c001'], provider: 'mock' },
    ...over,
  };
}

describe('one-click suggestions', () => {
  const anchor = { path: 'src/a.ts', startLine: 2, endLine: 3, line: 3 };
  const fix = 'for (let i = 0; i < n; i++) {\n  sum += xs[i];';

  it('is offered only for a replacement the critic approved, on the anchored lines', () => {
    expect(suggestionBlock(finding({ replacement: fix, replacementOk: true }), anchor, 'github')).toBe(
      `\`\`\`suggestion\n${fix}\n\`\`\``,
    );
    // GitLab anchors on one line: the range is given as offsets from it
    expect(suggestionBlock(finding({ replacement: fix, replacementOk: true }), anchor, 'gitlab')).toBe(
      `\`\`\`suggestion:-1+0\n${fix}\n\`\`\``,
    );
    expect(suggestionBlock(finding({ replacement: fix }), anchor, 'github')).toBeUndefined(); // not checked
    expect(
      suggestionBlock(finding({ replacement: fix, replacementOk: false }), anchor, 'github'),
    ).toBeUndefined();
    expect(
      suggestionBlock(
        finding({ replacement: fix, replacementOk: true }),
        { ...anchor, startLine: 1 },
        'github',
      ),
    ).toBeUndefined();
    const body = renderInlineComment(finding({ replacement: fix, replacementOk: true }), 'a'.repeat(32), {
      anchor,
      forge: 'github',
    });
    expect(body).toContain('```suggestion');
    expect(
      renderInlineComment(finding({ replacement: fix, replacementOk: true }), 'a'.repeat(32)),
    ).not.toContain('```suggestion');
  });
});

describe('replacement validation', () => {
  let repo: TempRepo;
  beforeAll(() => {
    repo = makeRepo();
    repo.write({ 'src/a.ts': 'const n = xs.length;\nfor (let i = 0; i <= n; i++) {\n  sum += xs[i];\n}\n' });
  });
  afterAll(() => repo.cleanup());

  const kept = (over: Partial<Finding>) =>
    validateFindings([finding(over)], { root: repo.root, units: [], mode: 'files' }).kept[0]!;

  it('keeps a replacement only when it can be applied as is', () => {
    const fix = 'for (let i = 0; i < n; i++) {\n  sum += xs[i];';
    expect(kept({ replacement: fix }).replacement).toBe(fix);
    // identical to the current lines: nothing to change
    expect(
      kept({ replacement: 'for (let i = 0; i <= n; i++) {\n  sum += xs[i];' }).replacement,
    ).toBeUndefined();
    // would break out of the suggestion fence
    expect(kept({ replacement: '```\nx' }).replacement).toBeUndefined();
    // too long to review as a one-click change
    expect(
      kept({ replacement: Array.from({ length: 61 }, () => 'x;').join('\n') }).replacement,
    ).toBeUndefined();
    // the finding itself survives
    expect(kept({ replacement: '```' }).title).toBe('Off-by-one');
  });
});

describe('suggestions end to end (mock provider)', () => {
  let repo: TempRepo;
  let run: RunRecord;
  beforeAll(async () => {
    repo = makeRepo();
    repo.write({ 'src/sum.ts': 'export function sum(xs: number[]) {\n  return 0;\n}\n' });
    repo.commit('initial');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write({
      'src/sum.ts': [
        'export function sum(xs: number[]) {',
        '  let total = 0;',
        '  for (let i = 0; i <= xs.length; i++) total += xs[i]; // BUG(major): off-by-one FIX:   for (let i = 0; i < xs.length; i++) total += xs[i];',
        '  const avg = total / xs.length; // BUG(minor): bad fix for empty input FIX:   const avg = total / 0;',
        '  const same = 1; // BUG(minor): no-op fix FIX:   const same = 1; // BUG(minor): no-op fix FIX:   const same = 1;',
        '  return total;',
        '}',
        '',
      ].join('\n'),
    });
    repo.commit('feature');
    repo.git('checkout', '-q', 'main');
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.review.minConfidence = 0;
        c.output.formats = ['md'];
      }),
      logger: silentLogger,
    });
    run = outcome.run!;
  });
  afterAll(() => repo.cleanup());

  it('carries the replacement and the critic’s check into the run', () => {
    const byLine = new Map(run.findings.map((f) => [f.startLine, f]));
    expect(byLine.get(3)).toMatchObject({
      replacement: 'for (let i = 0; i < xs.length; i++) total += xs[i];',
      replacementOk: true,
    });
    expect(byLine.get(4)).toMatchObject({ replacement: 'const avg = total / 0;', replacementOk: false });
  });
});
