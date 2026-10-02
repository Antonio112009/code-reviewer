import { describe, expect, it } from 'vitest';
import { skillUsage, skillUsageAcross } from '../src/report/common';
import { toFinding } from '../src/review/findings';
import { reviewInstructions, skillSummaries } from '../src/review/prompts';
import type { SkillMatch } from '../src/skills/detector';
import type { ChunkRecord, Finding, ReportedFinding } from '../src/types';

const reported = (over: Partial<ReportedFinding> = {}): ReportedFinding => ({
  file: 'src/a.ts',
  startLine: 1,
  endLine: 1,
  severity: 'major',
  category: 'bug',
  title: 'Flag enabled by "false"',
  description: 'Any non-empty header value enables it.',
  confidence: 0.8,
  ...over,
});
const ctx = {
  root: '/r',
  chunkId: 'c001',
  provider: 'mock',
  skills: ['practice/general-bugs', 'go/core/json'],
};
const chunk = (skills: string[]): ChunkRecord => ({
  id: 'c001',
  files: ['src/a.ts'],
  tokens: 10,
  skills,
  status: 'done',
  findings: 1,
});

describe('skill attribution', () => {
  it('shows each checklist with its id and asks for it on findings', () => {
    const skill = { id: 'go/core/json', name: 'JSON', body: '- bullet' } as SkillMatch['skill'];
    const text = reviewInstructions({ mode: 'diff', skills: [{ skill, score: 1, reasons: [] }] });
    expect(text).toContain('### JSON [go/core/json]');
    expect(text).toContain('"checklist" field');
    expect(text).toContain('without the brackets (e.g. `go/core/json`)');
  });

  it('lists the skills over the budget by their topics, within a token cap', () => {
    const skill = { id: 'go/core/json', name: 'JSON', body: '- bullet' } as SkillMatch['skill'];
    const over = (n: number) =>
      ({
        id: `python/core/s${n}`,
        name: `Topic ${n}`,
        description: `hash() per process,\n  key collisions ${n}`,
        body: '- never shown',
      }) as SkillMatch['skill'];
    const text = reviewInstructions({
      mode: 'diff',
      skills: [{ skill, score: 1, reasons: [] }],
      skillsOverBudget: [over(1), over(2)],
    });
    expect(text).toContain('### JSON [go/core/json]');
    expect(text).toContain('### Other topics that apply here');
    expect(text).toContain('- Topic 1: hash() per process, key collisions 1\n- Topic 2:');
    expect(text).not.toContain('never shown');
    expect(reviewInstructions({ mode: 'diff', skills: [] })).not.toContain('Technology checklists');
    // only topics: no id to cite
    const onlyOver = reviewInstructions({ mode: 'diff', skills: [], skillsOverBudget: [over(1)] });
    expect(onlyOver).toContain('- Topic 1:');
    expect(onlyOver).not.toContain('"checklist" field');

    const many = Array.from({ length: 200 }, (_, i) => over(i));
    const lines = skillSummaries(many, 100);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(200);
    expect(lines[0]).toBe('- Topic 0: hash() per process, key collisions 0');
  });

  it('keeps a checklist only when the chunk had it', () => {
    expect(toFinding(reported({ checklist: 'go/core/json' }), ctx).checklist).toBe('go/core/json');
    expect(toFinding(reported({ checklist: 'python/core/strings' }), ctx).checklist).toBeUndefined();
    expect('checklist' in toFinding(reported(), ctx)).toBe(false);
    // the prompt shows ids in brackets; models copy them
    expect(toFinding(reported({ checklist: ' [go/core/json] ' }), ctx).checklist).toBe('go/core/json');
  });

  it('counts the findings each skill led to, per run and across runs', () => {
    const finding = (checklist?: string) => ({ ...toFinding(reported({ checklist }), ctx) }) as Finding;
    const run = {
      chunks: [chunk(['practice/general-bugs', 'go/core/json']), chunk(['practice/general-bugs'])],
      findings: [finding('go/core/json'), finding('go/core/json'), finding()],
    };
    expect(skillUsage(run)).toEqual([
      { id: 'go/core/json', chunks: 1, findings: 2, dropped: 0 },
      { id: 'practice/general-bugs', chunks: 2, findings: 0, dropped: 0 },
    ]);
    expect(skillUsageAcross([run, { chunks: [chunk(['go/core/json'])], findings: [] }])).toEqual([
      { id: 'go/core/json', chunks: 2, findings: 2, dropped: 0 },
      { id: 'practice/general-bugs', chunks: 2, findings: 0, dropped: 0 },
    ]);
  });
});
