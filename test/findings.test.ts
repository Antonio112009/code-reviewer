import { describe, expect, it } from 'vitest';
import { commitUrl, lineUrl, parseRemote } from '../src/git/remote';
import { renderInlineComment } from '../src/publish/render';
import { dedupeFindings } from '../src/review/dedupe';
import { completePath, normalizePath, resolveFindings, toFinding } from '../src/review/findings';
import { critiqueFindingIdentity, reviewInstructions } from '../src/review/prompts';
import { requireFailurePath } from '../src/review/validate';
import type { Finding } from '../src/types';
import { extractJson } from '../src/util/json';

const base = {
  severity: 'major' as const,
  category: 'bug' as const,
  description: 'A concrete failure scenario description',
  confidence: 0.8,
};

function finding(over: Partial<Finding>): Finding {
  return {
    ...base,
    file: 'a.ts',
    startLine: 10,
    endLine: 10,
    title: 'Off-by-one in loop bound',
    id: Math.random().toString(36),
    skills: [],
    source: { chunkIds: ['c001'], provider: 'mock' },
    ...over,
  };
}

describe('extractJson', () => {
  it('prefers the last fenced block and tolerates trailing commas', () => {
    const text = 'Thinking...\n```json\n{"a": 1}\n```\nFinal:\n```json\n{"findings": [{"x": 1},]}\n```';
    expect(extractJson(text)).toEqual({ findings: [{ x: 1 }] });
  });
  it('finds bare JSON inside prose, ignoring braces in strings', () => {
    expect(extractJson('Result: {"s": "a } b", "n": [1, 2]} done')).toEqual({ s: 'a } b', n: [1, 2] });
  });
  it('returns undefined when nothing parses', () => {
    expect(extractJson('no json here {oops')).toBeUndefined();
  });
});

describe('resolveFindings', () => {
  const result = (over: object) => ({
    submission: { calls: 0 },
    text: '',
    toolCalls: 0,
    warnings: [],
    ...over,
  });
  it('uses the submit tool payload first', () => {
    const r = resolveFindings(
      result({
        submission: {
          calls: 1,
          findings: [{ ...base, file: 'a', startLine: 1, endLine: 1, title: 'Bug here' }],
        },
      }),
    );
    expect(r.via).toBe('tool');
    expect(r.items).toHaveLength(1);
  });
  it('falls back to JSON in text and drops malformed entries', () => {
    const text = `\`\`\`json\n${JSON.stringify({ findings: [{ ...base, file: 'a', startLine: 1, endLine: 2, title: 'Bug here' }, { file: 'b' }] })}\n\`\`\``;
    const r = resolveFindings(result({ text }));
    expect(r.via).toBe('text');
    expect(r.items).toHaveLength(1);
    expect(r.invalid).toBe(1);
  });
});

describe('toFinding', () => {
  it('normalises paths and line order', () => {
    const f = toFinding(
      { ...base, file: '/repo/src/x.ts', startLine: 9, endLine: 3, title: 'Something wrong' },
      {
        root: '/repo',
        chunkId: 'c001',
        provider: 'mock',
        skills: [],
      },
    );
    expect([f.file, f.startLine, f.endLine]).toEqual(['src/x.ts', 3, 9]);
    expect(normalizePath('./b/src/y.ts', '/repo')).toBe('src/y.ts');
  });

  it('completes a shortened path when exactly one file under review ends that way', () => {
    const files = [
      'src/main/java/com/acme/billing/Batches.java',
      'src/main/java/com/acme/billing/ReminderJob.java',
      'src/lib/util.ts',
      'src/app/util.ts',
    ];
    const at = (file: string) =>
      toFinding(
        { ...base, file, startLine: 15, endLine: 15, title: 'subList end not clamped' },
        {
          root: '/repo',
          chunkId: 'c001',
          provider: 'mock',
          skills: [],
          files,
        },
      ).file;
    expect(at('Batches.java')).toBe('src/main/java/com/acme/billing/Batches.java');
    expect(at('billing/Batches.java')).toBe('src/main/java/com/acme/billing/Batches.java');
    expect(at('util.ts')).toBe('util.ts'); // ambiguous: left for validation to reject
    expect(at('app/util.ts')).toBe('src/app/util.ts');
    expect(at('atches.java')).toBe('atches.java'); // whole path segments only
    expect(completePath('src/lib/util.ts', files)).toBe('src/lib/util.ts');
  });
});

describe('dedupeFindings', () => {
  it('merges similar findings on overlapping lines, keeping the most confident', () => {
    const { unique, merged } = dedupeFindings([
      finding({ confidence: 0.6, source: { chunkIds: ['c001'], provider: 'mock' } }),
      finding({
        startLine: 11,
        endLine: 11,
        confidence: 0.9,
        title: 'Off-by-one in the loop bound',
        source: { chunkIds: ['c002'], provider: 'mock' },
      }),
    ]);
    expect(merged).toBe(1);
    expect(unique[0]!.confidence).toBe(0.9);
    expect(unique[0]!.source.chunkIds.sort()).toEqual(['c001', 'c002']);
  });
  it('keeps different bugs on adjacent lines', () => {
    const { unique } = dedupeFindings([
      finding({}),
      finding({ startLine: 11, endLine: 11, title: 'Division by zero for empty input' }),
    ]);
    expect(unique).toHaveLength(2);
  });
});

describe('remote links', () => {
  it('builds GitHub and GitLab links from ssh and https remotes', () => {
    const gh = parseRemote('git@github.com:acme/app.git');
    expect(gh).toEqual({ platform: 'github', webUrl: 'https://github.com/acme/app' });
    expect(lineUrl(gh, 'abc', 'src/a b.ts', 3, 5)).toBe(
      'https://github.com/acme/app/blob/abc/src/a%20b.ts#L3-L5',
    );
    const gl = parseRemote('https://gitlab.example.com/group/sub/app.git');
    expect(gl?.platform).toBe('gitlab');
    expect(commitUrl(gl, 'def')).toBe('https://gitlab.example.com/group/sub/app/-/commit/def');
    expect(lineUrl(gl, 'def', 'x.ts', 7, 7)).toBe(
      'https://gitlab.example.com/group/sub/app/-/blob/def/x.ts#L7',
    );
    expect(commitUrl(parseRemote('https://bitbucket.org/a/b'), 'x')).toBeUndefined();
  });
});

describe('failure paths', () => {
  const path = 'empty cart from POST /checkout → total() divides by items.length → NaN is charged';

  it('lowers critical and major findings without a failure path one level', () => {
    const { findings, lowered } = requireFailurePath([
      finding({ id: 'a', severity: 'critical' }),
      finding({ id: 'b', severity: 'major', failurePath: 'too short' }),
      finding({ id: 'c', severity: 'major', failurePath: path }),
      finding({ id: 'd', severity: 'minor' }),
      finding({ id: 'e', severity: 'critical', origin: 'static' }),
    ]);
    expect(lowered).toBe(2);
    expect(findings.map((f) => [f.id, f.severity, f.lowered?.from])).toEqual([
      ['a', 'major', 'critical'],
      ['b', 'minor', 'major'],
      ['c', 'major', undefined],
      ['d', 'minor', undefined],
      ['e', 'critical', undefined],
    ]);
  });

  it('asks the model for it and shows it to the critic and in comments', () => {
    expect(reviewInstructions({ mode: 'diff', skills: [], readTools: true })).toContain('"failurePath"');
    expect(critiqueFindingIdentity(finding({ failurePath: path }))).toMatchObject({ failurePath: path });
    expect(renderInlineComment(finding({ failurePath: path }), 'a'.repeat(32))).toContain(
      `**Failure path:** ${path}`,
    );
  });
});
