import { describe, expect, it } from 'vitest';
import { skillUsage, skillUsageAcross } from '../src/report/common';
import { toFinding } from '../src/review/findings';
import { reviewInstructions } from '../src/review/prompts';
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
  });

  it('keeps a checklist only when the chunk had it', () => {
    expect(toFinding(reported({ checklist: 'go/core/json' }), ctx).checklist).toBe('go/core/json');
    expect(toFinding(reported({ checklist: 'python/core/strings' }), ctx).checklist).toBeUndefined();
    expect('checklist' in toFinding(reported(), ctx)).toBe(false);
  });

  it('counts the findings each skill led to, per run and across runs', () => {
    const finding = (checklist?: string) => ({ ...toFinding(reported({ checklist }), ctx) }) as Finding;
    const run = {
      chunks: [chunk(['practice/general-bugs', 'go/core/json']), chunk(['practice/general-bugs'])],
      findings: [finding('go/core/json'), finding('go/core/json'), finding()],
    };
    expect(skillUsage(run)).toEqual([
      { id: 'go/core/json', chunks: 1, findings: 2 },
      { id: 'practice/general-bugs', chunks: 2, findings: 0 },
    ]);
    expect(skillUsageAcross([run, { chunks: [chunk(['go/core/json'])], findings: [] }])).toEqual([
      { id: 'go/core/json', chunks: 2, findings: 2 },
      { id: 'practice/general-bugs', chunks: 2, findings: 0 },
    ]);
  });
});
