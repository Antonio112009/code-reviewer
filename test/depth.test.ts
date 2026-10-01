import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flagsToOverrides } from '../src/cli/commands/review';
import { loadConfig } from '../src/config/load';
import { DEFAULT_CONFIG, DEPTH_PRESETS } from '../src/config/schema';
import { critiqueInstructions, notesInstructions, reviewInstructions } from '../src/review/prompts';
import { matchSkill, selectSkills, skillsForDepth } from '../src/skills/detector';
import { parseGroup, parseSkill, splitTiers } from '../src/skills/loader';

describe('review depth config', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cr-depth-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const project = (yaml: string) => {
    mkdirSync(path.join(dir, '.code-reviewer'), { recursive: true });
    writeFileSync(path.join(dir, '.code-reviewer/config.yaml'), yaml);
  };
  const load = (overrides = {}) => loadConfig({ cwd: dir, stopDir: dir, ignoreGlobal: true, overrides });

  it('defaults to full with its preset', async () => {
    const { config } = await load();
    expect(config.review).toMatchObject({ depth: 'full', ...DEPTH_PRESETS.full.review });
    expect(DEFAULT_CONFIG.review).toMatchObject(DEPTH_PRESETS.full.review);
    // each preset names every depth-dependent setting: switching never keeps the other depth's values
    expect(Object.keys(DEPTH_PRESETS.essential.review).sort()).toEqual(
      Object.keys(DEPTH_PRESETS.full.review).sort(),
    );
  });

  it('switches every preset value with the depth, but explicit values win', async () => {
    project('review:\n  depth: essential\n');
    expect((await load()).config.review).toMatchObject({
      depth: 'essential',
      ...DEPTH_PRESETS.essential.review,
    });
    project('review:\n  depth: full\n');
    expect((await load()).config.review).toMatchObject({ depth: 'full', ...DEPTH_PRESETS.full.review });
    project('review:\n  depth: full\n  skillTokenBudget: 8000\n  minSeverity: minor\n');
    expect((await load()).config.review).toMatchObject({
      depth: 'full',
      skillTokenBudget: 8_000,
      minSeverity: 'minor',
      maxSteps: DEPTH_PRESETS.full.review.maxSteps,
    });
  });

  it('flags override the configured depth (and pick that preset)', async () => {
    project('review:\n  depth: full\n');
    const { config } = await load(flagsToOverrides({ essential: true }));
    expect(config.review).toMatchObject({ depth: 'essential', ...DEPTH_PRESETS.essential.review });
    expect(flagsToOverrides({ depth: 'full' }).review).toEqual({ depth: 'full' });
    expect(flagsToOverrides({ full: true, minSeverity: 'minor' }).review).toEqual({
      depth: 'full',
      minSeverity: 'minor',
    });
    expect(() => flagsToOverrides({ essential: true, full: true })).toThrow(/either --essential or --full/);
    expect(() => flagsToOverrides({ depth: 'deep' })).toThrow(/--depth must be one of/);
  });
});

describe('skill tiers', () => {
  const text = (tier: string | undefined, body: string) =>
    `---\nname: T\ndescription: d.\n${tier ? `tier: ${tier}\n` : ''}activation:\n  content: ["x"]\n---\n${body}\n`;
  const body = [
    '- **Leak**: listener never removed → memory grows. Fix: remove it.',
    '- [full] **Label**: missing aria-label → screen readers. Fix: add one.',
    '  continuation of the full bullet',
    '  - nested detail of the full bullet',
    '- **Race**: two writers → lost update. Fix: transaction.',
    '- [full]**Naming of events**: inconsistent → confusion.',
  ].join('\n');

  it('splits [full] bullets (with continuation and nested lines) out of the essential body', () => {
    const { body: full, essentialBody } = splitTiers(body);
    expect(full).not.toContain('[full]');
    expect(full).toContain('- **Label**: missing aria-label');
    expect(full).toContain('- **Naming of events**');
    expect(essentialBody.split('\n')).toEqual([
      '- **Leak**: listener never removed → memory grows. Fix: remove it.',
      '- **Race**: two writers → lost update. Fix: transaction.',
    ]);
    expect(splitTiers('- **a**: b')).toEqual({ body: '- **a**: b', essentialBody: '- **a**: b' });
  });

  it('inherits the tier from the nearest group; defaults to essential', () => {
    const group = parseGroup(
      'name: A11y\ndescription: x.\ncategory: web\ntier: full',
      '/p/web/a11y/_group.yaml',
      'web/a11y',
      'builtin',
    );
    const inherited = parseSkill(text(undefined, body), '/p/web/a11y/labels.md', 'builtin', {
      id: 'web/a11y/labels',
      groups: [group],
    });
    expect(inherited.tier).toBe('full');
    const own = parseSkill(text('essential', body), '/p/web/a11y/x.md', 'builtin', {
      id: 'web/a11y/x',
      groups: [group],
    });
    expect(own.tier).toBe('essential');
    expect(own.essentialTokens).toBeLessThan(own.tokens);
    const plain = parseSkill(text(undefined, '- **a**: b'), '/h/skills/y.md', 'global');
    expect(plain.tier).toBe('essential');
  });

  it('skillsForDepth: essential drops full-tier skills and [full] bullets; full keeps everything', () => {
    const mk = (id: string, tier: string, b = body) =>
      parseSkill(text(tier, b), `/p/practice/${id}.md`, 'builtin', {
        id: `practice/${id}`,
        folder: 'practice',
      });
    const skills = [mk('leaks', 'essential'), mk('a11y', 'full'), mk('plain', 'essential', '- **x**: y')];
    expect(skillsForDepth(skills, 'full')).toBe(skills);
    const essential = skillsForDepth(skills, 'essential');
    expect(essential.map((s) => s.id)).toEqual(['practice/leaks', 'practice/plain']);
    expect(essential[0]!.body).not.toContain('aria-label');
    expect(essential[0]!.tokens).toBe(skills[0]!.essentialTokens);
    expect(essential[1]).toBe(skills[2]); // unchanged skills are not copied
    // the copy still matches (compiled activation is shared through the activation object)
    const ctx = { files: ['a.ts'], languages: ['typescript'], code: 'x = 1' };
    expect(matchSkill(essential[0]!, ctx)).toBeDefined();
    expect(selectSkills(essential, ctx, 'auto', 10_000).map((m) => m.skill.id)).toEqual([
      'practice/leaks',
      'practice/plain',
    ]);
  });
});

describe('depth prompts', () => {
  it('tells the reviewer and the critic what each depth covers', () => {
    const essential = reviewInstructions({ mode: 'diff', depth: 'essential', skills: [] });
    expect(essential).toContain('Depth: ESSENTIAL');
    expect(essential).toMatch(/memory and resource leaks/);
    expect(essential).toMatch(/only the severities critical and major/);
    const full = reviewInstructions({ mode: 'diff', depth: 'full', skills: [] });
    expect(full).toContain('Depth: FULL');
    expect(full).toMatch(/accessibility failures/);
    // maintainability notes are asked for only when review.notes is on (the full-depth default)
    expect(full).not.toMatch(/Maintainability notes\./);
    const withNotes = reviewInstructions({ mode: 'diff', depth: 'full', skills: [], notes: true });
    expect(withNotes).toMatch(/Maintainability notes\. Besides defects/);
    expect(withNotes).toMatch(/category "maintainability", severity "info"/);
    expect(notesInstructions('diff')).toMatch(/you do not judge them as defects/);
    expect(notesInstructions('diff')).toMatch(/"\+" in the excerpts marks the changed lines/);
    expect(notesInstructions('files')).not.toMatch(/did not touch/);
    expect(critiqueInstructions('diff', 'essential')).toMatch(/ESSENTIAL-depth review: also reject/);
    expect(critiqueInstructions('diff', 'full')).not.toMatch(/ESSENTIAL/);
  });

  it('tells the critic how findings that are only partly true or not reachable are judged', () => {
    for (const depth of ['essential', 'full'] as const) {
      const text = critiqueInstructions('diff', depth);
      expect(text).toMatch(/by its headline claim/);
      expect(text).toMatch(/corrected "title"/);
      expect(text).toMatch(/probably false, the verdict is "rejected", not "uncertain"/);
      expect(text).toMatch(/open the function called/);
      expect(text).toMatch(/confidence at most 0.4/);
      expect(text).toMatch(/formally undefined/);
      expect(text).toMatch(/reject it as pre-existing/);
    }
    // full depth keeps a true observation without a failure path as "worth a look"; essential drops it
    expect(critiqueInstructions('diff', 'full')).toMatch(/severity "info" and a confidence of at most 0\.5/);
    expect(critiqueInstructions('diff', 'full')).toMatch(
      /Not worth listing at all \(reject\): test-only hygiene/,
    );
    expect(critiqueInstructions('diff', 'essential')).toMatch(
      /Not defects: behaviour that is only formally undefined/,
    );
    expect(critiqueInstructions('diff', 'essential')).not.toMatch(/worth a look/);
    // whole files: nothing is pre-existing
    expect(critiqueInstructions('files', 'full')).not.toMatch(/reject it as pre-existing/);
  });
});
