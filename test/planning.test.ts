import { describe, expect, it } from 'vitest';
import { chunkStackLine, fileCodeOf, techVersionsForChunk } from '../src/review/planning';
import { reviewPrompt } from '../src/review/prompts';
import type { Chunk, ReviewUnit, StackProfile, TechHit } from '../src/types';

const hit = (id: string, over: Partial<TechHit> = {}): TechHit => ({
  id,
  name: id,
  category: 'framework',
  score: 0.9,
  reasons: [],
  packages: ['.'],
  ...over,
});

const stack = (techs: TechHit[], packages: StackProfile['packages'] = []): StackProfile => ({
  techs,
  packages,
  languages: [],
  filesScanned: 0,
  durationMs: 0,
});

describe('techVersionsForChunk', () => {
  const profile = stack(
    [
      hit('framework.nextjs', {
        version: '14.2.0',
        versions: { 'apps/web': '15.1.0', 'apps/admin': '14.2.0' },
        packages: ['apps/web', 'apps/admin'],
      }),
      hit('framework.react', { version: '19.0.0' }),
      hit('lang.go', { category: 'language', version: '1.21' }),
      hit('db.postgresql', { category: 'database' }),
    ],
    [
      { dir: '.', manifests: ['package.json'], techs: ['framework.react', 'lang.go', 'db.postgresql'] },
      { dir: 'apps/web', manifests: ['apps/web/package.json'], techs: ['framework.nextjs'] },
      { dir: 'apps/admin', manifests: ['apps/admin/package.json'], techs: ['framework.nextjs'] },
    ],
  );

  it('takes the nearest package version of every file; techs that do not apply are absent', () => {
    const v = techVersionsForChunk(profile, ['apps/web/app/page.tsx'], undefined);
    expect(Object.fromEntries(v)).toEqual({
      'framework.nextjs': '15.1.0',
      'framework.react': '19.0.0',
      'lang.go': '1.21',
    });
    expect(techVersionsForChunk(profile, ['apps/admin/x.ts'], undefined).get('framework.nextjs')).toBe(
      '14.2.0',
    );
    // Next.js does not apply outside its packages
    expect(techVersionsForChunk(profile, ['scripts/x.ts'], undefined).has('framework.nextjs')).toBe(false);
  });

  it('leaves the version out only when files that use the tech disagree', () => {
    const v = techVersionsForChunk(
      profile,
      ['apps/web/a.tsx', 'apps/admin/b.tsx'],
      new Set(['framework.nextjs', 'framework.react']),
    );
    expect(Object.fromEntries(v)).toEqual({ 'framework.react': '19.0.0' });
    // a file that does not use Next.js does not make its version unknown
    expect(
      techVersionsForChunk(profile, ['apps/web/a.tsx', 'tools/gen.go'], undefined).get('framework.nextjs'),
    ).toBe('15.1.0');
    expect(techVersionsForChunk(undefined, ['a.ts'], undefined).size).toBe(0);
    // repository-wide: only techs whose packages agree
    expect(Object.fromEntries(techVersionsForChunk(profile, [], undefined))).toEqual({
      'framework.react': '19.0.0',
      'lang.go': '1.21',
    });
  });
});

describe('chunkStackLine', () => {
  it('lists frameworks first with versions; languages only when versioned', () => {
    const techs = new Set([
      'lang.typescript',
      'framework.react',
      'db.postgresql',
      'lang.go',
      'framework.nextjs',
    ]);
    const versions = new Map([
      ['framework.nextjs', '15.1.0'],
      ['framework.react', '19.0.0'],
      ['lang.go', '1.21'],
    ]);
    expect(chunkStackLine(techs, versions)).toBe('Next.js 15.1.0 · React 19.0.0 · PostgreSQL · Go 1.21');
    expect(chunkStackLine(new Set(['lang.typescript']), new Map())).toBeUndefined();
    expect(chunkStackLine(undefined, new Map())).toBeUndefined();
  });

  it('is shown in the review prompt', () => {
    const chunk: Chunk = {
      id: 'c1',
      index: 0,
      parts: [],
      files: ['src/app.ts'],
      mentions: [],
      tokens: 10,
    } as unknown as Chunk;
    const prompt = reviewPrompt({
      target: { kind: 'files', paths: ['src'] } as never,
      chunk,
      totalChunks: 1,
      otherFiles: [],
      stack: 'Next.js 15.1.0 · React 19.0.0',
    });
    expect(prompt).toContain('Stack of these files');
    expect(prompt).toContain('Next.js 15.1.0 · React 19.0.0');
  });
});

describe('fileCodeOf', () => {
  it('uses the full content, falling back to the new side of the hunks', () => {
    const units = [
      {
        path: 'a.ts',
        status: 'modified',
        language: 'typescript',
        content: 'import React from "react";\nx',
        hunks: [],
        focusRanges: [],
      },
      {
        path: 'b.ts',
        status: 'modified',
        language: 'typescript',
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            header: '',
            lines: [
              { type: 'del', text: 'old', oldLine: 1 },
              { type: 'add', text: 'new', newLine: 1 },
              { type: 'ctx', text: 'same', oldLine: 2, newLine: 2 },
            ],
          },
        ],
        focusRanges: [],
      },
    ] as unknown as ReviewUnit[];
    expect(fileCodeOf(units)).toBe('import React from "react";\nx\nnew\nsame');
  });
});
