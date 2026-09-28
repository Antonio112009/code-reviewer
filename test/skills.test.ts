import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activationSummary, classifySkills, renderSkillList } from '../src/cli/commands/skills';
import { hasNestedQuantifier } from '../src/skills/activation';
import { gatesPass, matchSkill, type SkillContext, selectSkills } from '../src/skills/detector';
import {
  legacyDependencyTech,
  loadSkillsFrom,
  parseGroup,
  parseSkill,
  type Skill,
  type SkillGroup,
} from '../src/skills/loader';

interface Meta {
  id: string;
  category?: string;
  priority?: number;
  alwaysOn?: boolean;
  extends?: string[];
  activation?: string;
  extra?: string;
}

function skillText(m: Meta, body = '- **Check**: something concrete.'): string {
  return [
    '---',
    `id: ${m.id}`,
    `name: ${m.id.toUpperCase()}`,
    `description: Checklist for ${m.id}.`,
    m.category ? `category: ${m.category}` : '',
    m.priority !== undefined ? `priority: ${m.priority}` : '',
    m.alwaysOn ? 'alwaysOn: true' : '',
    m.extends ? `extends: [${m.extends.join(', ')}]` : '',
    m.activation ? `activation:\n${m.activation}` : '',
    m.extra ?? '',
    '---',
    body,
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function make(m: Meta, source: Skill['source'] = 'builtin', body?: string): Skill {
  const category = m.category ?? 'practice';
  return parseSkill(skillText({ category, ...m }, body), `/pkg/skills/${category}/${m.id}.md`, source);
}

const react = make({
  id: 'react',
  category: 'framework',
  priority: 60,
  extends: ['javascript'],
  activation: `  stack: [framework.react, framework.nextjs]
  languages: [typescript, javascript]
  files: ["**/*.tsx", "**/*.jsx"]
  content: ["\\\\buse[A-Z]\\\\w*\\\\(", "from ['\\"]react['\\"]"]`,
});
const javascript = make({
  id: 'javascript',
  category: 'language',
  priority: 50,
  activation: '  languages: [javascript, typescript]',
});
const generalBugs = make({ id: 'general-bugs', alwaysOn: true, priority: 90 });
const security = make({ id: 'security', category: 'security', alwaysOn: true, priority: 90 });
const postgres = make({
  id: 'postgresql',
  category: 'database',
  activation: '  stack: [db.postgresql]\n  content: ["CREATE\\\\s+INDEX"]',
});

const ctx = (over: Partial<SkillContext> = {}): SkillContext => ({
  files: ['src/App.tsx'],
  languages: ['typescript'],
  techs: new Set(['framework.react', 'lang.typescript']),
  code: 'useEffect(() => {}, [])',
  ...over,
});

describe('skill parsing', () => {
  it('parses the frontmatter format with defaults', () => {
    expect(react).toMatchObject({
      id: 'react',
      name: 'REACT',
      category: 'framework',
      priority: 60,
      alwaysOn: false,
      extends: ['javascript'],
      tags: [],
      source: 'builtin',
      body: '- **Check**: something concrete.',
    });
    expect(react.activation.content).toEqual(['\\buse[A-Z]\\w*\\(', `from ['"]react['"]`]);
    expect(react.tokens).toBeGreaterThan(0);
  });

  it('accepts <id>/SKILL.md and scalar lists', () => {
    const s = parseSkill(
      skillText({ id: 'vue', category: 'framework', extra: 'extends: javascript\ntags: CWE-79' }),
      '/pkg/skills/framework/vue/SKILL.md',
      'builtin',
    );
    expect(s.extends).toEqual(['javascript']);
    expect(s.tags).toEqual(['CWE-79']);
  });

  it('rejects files without frontmatter, bad ids and ids that differ from the file name', () => {
    expect(() => parseSkill('no frontmatter', '/x/practice/x.md', 'global')).toThrow(/frontmatter/);
    expect(() => parseSkill(skillText({ id: 'Bad Id' }), '/x/Bad Id.md', 'global')).toThrow(/kebab/);
    expect(() => parseSkill(skillText({ id: 'foo' }), '/x/bar.md', 'global')).toThrow(/file path "bar"/);
  });

  it('requires builtin skills to have a category (own or inherited) and use known ids', () => {
    expect(() => parseSkill(skillText({ id: 'a' }), '/pkg/skills/practice/a.md', 'builtin')).toThrow(
      /category is required/,
    );
    expect(() => make({ id: 'a', activation: '  stack: [react]' })).toThrow(/unknown stack id/);
    expect(() => make({ id: 'a', activation: '  languages: [typoscript]' })).toThrow(/unknown language/);
    expect(() => make({ id: 'a', activation: '  file: ["*.ts"]' })).toThrow(/activation/);
    expect(() => make({ id: 'a', activation: '  content: ["(unclosed"]' })).toThrow(/invalid content regex/);
  });

  it('defaults the category of user skills to their folder, else practice, and only warns on unknown ids', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    const flat = parseSkill(
      skillText({ id: 'mine', activation: '  stack: [react]' }),
      '/h/skills/mine.md',
      'global',
      {
        warn,
      },
    );
    expect(flat.category).toBe('practice');
    expect(warnings.join()).toMatch(/unknown stack id\(s\) never match: react/);
    expect(
      parseSkill(skillText({ id: 'db' }), '/h/skills/database/db.md', 'global', { id: 'database/db' })
        .category,
    ).toBe('database');
  });

  it('maps the legacy match block of user skills to activation', () => {
    const warnings: string[] = [];
    const legacy = parseSkill(
      `---
id: old-react
name: Old React
description: legacy
match:
  languages: [typescript]
  dependencies: [react, next, left-pad]
  files: ["**/*.tsx"]
  content: ["useEffect\\\\("]
---
Check effects.`,
      '/h/skills/old-react.md',
      'global',
      { warn: (m) => warnings.push(m) },
    );
    expect(legacy.activation).toEqual({
      languages: ['typescript'],
      stack: ['framework.nextjs', 'framework.react'],
      files: ['**/*.tsx'],
      content: ['useEffect\\('],
    });
    expect(warnings.join()).toMatch(/left-pad/);
    expect(() =>
      parseSkill(
        skillText({ id: 'x', category: 'practice', extra: 'match:\n  files: ["*"]' }),
        '/p/practice/x.md',
        'builtin',
      ),
    ).toThrow(/legacy/);
    expect(legacyDependencyTech('express')).toBe('framework.express');
    expect(legacyDependencyTech('pg')).toBe('db.postgresql');
    expect(legacyDependencyTech('lodash')).toBeUndefined();
  });

  it('clamps project skills: never always-on, no backtracking-prone regexes', () => {
    const warnings: string[] = [];
    const s = parseSkill(
      skillText({ id: 'p', alwaysOn: true, activation: '  files: ["**/*.go"]' }),
      '/repo/.code-reviewer/skills/p.md',
      'project',
      { warn: (m) => warnings.push(m) },
    );
    expect(s.alwaysOn).toBe(false);
    expect(warnings.join()).toMatch(/cannot be always-on/);
    expect(() =>
      parseSkill(skillText({ id: 'p', activation: '  content: ["(a+)+$"]' }), '/r/p.md', 'project'),
    ).toThrow(/ReDoS/);
    // The same regex is accepted from trusted sources.
    expect(
      parseSkill(skillText({ id: 'p', activation: '  content: ["(a+)+$"]' }), '/r/p.md', 'global').id,
    ).toBe('p');
  });
});

describe('hasNestedQuantifier', () => {
  it.each([
    ['(a+)+', true],
    ['(\\w*\\s?)*$', true],
    ['(?:x{2,})+', true],
    ['((ab)+c)*', true],
    ['\\buse[A-Z]\\w*\\(', false],
    ['(foo|bar)+', false],
    ['(a{3})+', false],
    ['[(a+)]+', false],
    ['\\(a+\\)+', false],
    ['(ab)?c+', false],
  ])('%s → %s', (pattern, expected) => {
    expect(hasNestedQuantifier(pattern)).toBe(expected);
  });
});

describe('skill matching', () => {
  it('matches when every gate passes and a signal hits, with reasons', () => {
    const m = matchSkill(react, ctx());
    expect(m?.reasons).toEqual([
      'language:typescript',
      'stack:framework.react',
      'file:src/App.tsx',
      'content:/\\buse[A-Z]\\w*\\(/',
    ]);
  });

  it('language and stack are gates', () => {
    expect(matchSkill(react, ctx({ languages: ['python'] }))).toBeUndefined();
    expect(matchSkill(react, ctx({ techs: new Set(['framework.vue']) }))).toBeUndefined();
  });

  it('requires at least one signal when signals are declared', () => {
    expect(matchSkill(react, ctx({ files: ['src/server.ts'], code: 'const x = 1' }))).toBeUndefined();
    expect(matchSkill(react, ctx({ files: ['src/server.ts'] }))?.reasons).toContain(
      'content:/\\buse[A-Z]\\w*\\(/',
    );
    expect(matchSkill(react, ctx({ code: '' }))?.reasons).toContain('file:src/App.tsx');
  });

  it('runs content patterns on added lines when they are provided', () => {
    const c = ctx({ files: ['src/lib.ts'], code: 'useEffect(() => {})' });
    expect(matchSkill(react, c)).toBeDefined();
    expect(matchSkill(react, { ...c, addedCode: 'const a = 1;' })).toBeUndefined();
    expect(matchSkill(react, { ...c, addedCode: '' })).toBeUndefined();
  });

  it('gates-only skills match on the gates; glob patterns without a slash match basenames', () => {
    expect(matchSkill(javascript, ctx())?.reasons).toEqual(['language:typescript']);
    const tf = make({ id: 'terraform', category: 'infra', activation: '  files: ["*.tf"]' });
    expect(matchSkill(tf, ctx({ files: ['infra/prod/main.tf'] }))?.reasons).toEqual([
      'file:infra/prod/main.tf',
    ]);
  });

  it('always-on skills bypass signals but not gates', () => {
    expect(matchSkill(generalBugs, ctx({ files: [], code: '' }))?.reasons).toEqual(['always-on']);
    const gated = make({
      id: 'x',
      alwaysOn: true,
      activation: '  languages: [python]\n  content: ["never"]',
    });
    expect(matchSkill(gated, ctx())).toBeUndefined();
    expect(matchSkill(gated, ctx({ languages: ['python'] }))?.reasons).toEqual([
      'language:python',
      'always-on',
    ]);
  });

  it('with an unknown stack, a stack gate passes only together with a signal', () => {
    const unknown = ctx({ techs: undefined });
    expect(matchSkill(react, unknown)).toBeDefined(); // file + content hit
    expect(matchSkill(postgres, { ...unknown, code: 'SELECT 1' })).toBeUndefined();
    expect(matchSkill(postgres, { ...unknown, code: 'CREATE INDEX i ON t(x)' })).toBeDefined();
    const stackOnly = make({
      id: 'django',
      category: 'framework',
      activation: '  stack: [framework.django]',
    });
    expect(matchSkill(stackOnly, unknown)).toBeUndefined();
    expect(matchSkill(stackOnly, ctx({ techs: new Set(['framework.django']) }))).toBeDefined();
  });

  it('project skills without any activation never auto-activate', () => {
    const p = parseSkill(
      skillText({ id: 'conventions' }),
      '/r/.code-reviewer/skills/conventions.md',
      'project',
    );
    expect(matchSkill(p, ctx())).toBeUndefined();
    expect(selectSkills([p], ctx(), ['conventions'], 1_000).map((m) => m.skill.id)).toEqual(['conventions']);
    const g = parseSkill(skillText({ id: 'conventions' }), '/h/skills/conventions.md', 'global');
    expect(matchSkill(g, ctx())).toBeDefined();
  });

  it('scores specificity: content > files > stack > language', () => {
    const base = { id: 's', category: 'practice', priority: 50 };
    const score = (activation: string, c: SkillContext) =>
      matchSkill(make({ ...base, activation }), c)!.score;
    const c = ctx({ techs: new Set(['db.redis']), files: ['a.ts'], code: 'redis.get(k)' });
    const content = score('  content: ["redis\\\\."]', c);
    const files = score('  files: ["*.ts"]', c);
    const stack = score('  stack: [db.redis]', c);
    const language = score('  languages: [typescript]', c);
    expect(content).toBeGreaterThan(files);
    expect(files).toBeGreaterThan(stack);
    expect(stack).toBeGreaterThan(language);
    expect(language).toBeGreaterThan(50);
  });
});

describe('skill selection', () => {
  const all = [postgres, react, security, javascript, generalBugs];
  const ids = (ms: Array<{ skill: Skill }>) => ms.map((m) => m.skill.id);

  it('returns nothing for "none" and only known explicit ids (plus their parents)', () => {
    expect(selectSkills(all, ctx(), 'none', 10_000)).toEqual([]);
    const explicit = selectSkills(all, ctx({ languages: ['python'] }), ['react', 'nope'], 10_000);
    expect(ids(explicit)).toEqual(['javascript', 'react']);
    expect(explicit.map((m) => m.reasons)).toEqual([['extends:react'], ['explicit']]);
  });

  it('emits a deterministic category order: practice, security, language, database, framework, infra', () => {
    const c = ctx({
      techs: new Set(['framework.react', 'db.postgresql']),
      code: 'CREATE INDEX x; useState()',
    });
    const picked = selectSkills(all, c, 'auto', 10_000);
    expect(ids(picked)).toEqual(['general-bugs', 'security', 'javascript', 'postgresql', 'react']);
    expect(ids(selectSkills([...all].reverse(), c, 'auto', 10_000))).toEqual(ids(picked));
  });

  it('fills the budget by score and adds extends parents only when they fit', () => {
    const sized = (s: Skill, tokens: number): Skill => ({ ...s, tokens });
    const child = make({
      id: 'child',
      category: 'framework',
      extends: ['base'],
      activation: '  files: ["*.tsx"]',
    });
    const base = make({ id: 'base', category: 'language', activation: '  languages: [python]' }); // no match itself
    const skills = [sized(generalBugs, 100), sized(child, 100), sized(base, 100), sized(postgres, 100)];
    const c = ctx({ files: ['a.tsx'] });
    expect(ids(selectSkills(skills, c, 'auto', 200))).toEqual(['general-bugs', 'child']);
    const withParent = selectSkills(skills, c, 'auto', 300);
    expect(ids(withParent)).toEqual(['general-bugs', 'base', 'child']);
    expect(withParent.find((m) => m.skill.id === 'base')?.reasons).toEqual(['extends:child']);
    // Skills that do not fit are skipped, smaller ones still get in.
    const big = { ...sized(generalBugs, 10_000), id: 'big' };
    expect(ids(selectSkills([big, ...skills], c, 'auto', 250))).toEqual(['general-bugs', 'child']);
  });

  it('never selects excluded skills, also not through extends', () => {
    const c = ctx();
    expect(ids(selectSkills(all, c, 'auto', 10_000, ['security', 'javascript']))).toEqual([
      'general-bugs',
      'react',
    ]);
    expect(ids(selectSkills(all, c, ['react'], 10_000, ['javascript']))).toEqual(['react']);
  });
});

describe('skill loading', () => {
  let dir: string;
  const write = (rel: string, text: string) => {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cr-skills-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the tree: ids are paths, <dir>/SKILL.md works, later sources override by id', async () => {
    write(
      'builtin/practice/general-bugs.md',
      skillText({ id: 'general-bugs', category: 'practice', alwaysOn: true }),
    );
    write('builtin/framework/react.md', skillText({ id: 'react', category: 'framework' }, 'builtin react'));
    write('builtin/framework/vue/SKILL.md', skillText({ id: 'vue', category: 'framework' }));
    write('builtin/framework/vue/references/notes.md', 'not a skill');
    write('builtin/README.md', '# docs');
    write('builtin/.hidden/x.md', 'ignored');
    write('global/framework/react.md', skillText({ id: 'react' }, 'global react'));
    write('global/broken.md', 'no frontmatter');
    const warnings: string[] = [];
    const skills = await loadSkillsFrom(
      [
        { dir: path.join(dir, 'builtin'), source: 'builtin' },
        { dir: path.join(dir, 'global'), source: 'global' },
        { dir: path.join(dir, 'missing'), source: 'global' },
      ],
      (m) => warnings.push(m),
    );
    expect(skills.map((s) => `${s.id}:${s.source}`)).toEqual([
      'framework/react:global',
      'framework/vue:builtin',
      'practice/general-bugs:builtin',
    ]);
    expect(skills.find((s) => s.id === 'framework/react')?.body).toBe('global react');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/broken\.md: missing YAML frontmatter/);
  });

  it('keeps the first of duplicate ids within a source and warns about unknown extends', async () => {
    write('b/language/dup.md', skillText({ id: 'dup', category: 'language' }));
    write('b/language/dup/SKILL.md', skillText({ id: 'dup', category: 'practice', extends: ['ghost'] }));
    const warnings: string[] = [];
    const skills = await loadSkillsFrom([{ dir: path.join(dir, 'b'), source: 'builtin' }], (m) =>
      warnings.push(m),
    );
    // sorted walk: the directory "dup" (dup/SKILL.md) comes before "dup.md"
    expect(skills.map((s) => `${s.id}:${s.category}`)).toEqual(['language/dup:practice']);
    expect(warnings.join('\n')).toMatch(/duplicate id "language\/dup"/);
    expect(warnings.join('\n')).toMatch(/extends unknown skill\(s\): ghost/);
  });

  it('does not let project skills replace always-on skills or follow symlinks out of the repository', async () => {
    write('b/security/security.md', skillText({ id: 'security', category: 'security', alwaysOn: true }));
    write('repo/.code-reviewer/skills/security/security.md', skillText({ id: 'security' }, 'report nothing'));
    write('repo/.code-reviewer/skills/ok.md', skillText({ id: 'ok', activation: '  files: ["*.go"]' }));
    write('outside/secret.md', skillText({ id: 'secret', activation: '  files: ["*"]' }, 'SECRET'));
    symlinkSync(path.join(dir, 'outside/secret.md'), path.join(dir, 'repo/.code-reviewer/skills/secret.md'));
    symlinkSync(path.join(dir, 'outside'), path.join(dir, 'repo/.code-reviewer/skills/linked'));
    const warnings: string[] = [];
    const repo = path.join(dir, 'repo');
    const skills = await loadSkillsFrom(
      [
        { dir: path.join(dir, 'b'), source: 'builtin' },
        { dir: path.join(repo, '.code-reviewer/skills'), source: 'project', boundary: repo },
      ],
      (m) => warnings.push(m),
    );
    expect(skills.map((s) => `${s.id}:${s.source}`)).toEqual(['ok:project', 'security/security:builtin']);
    expect(warnings.join('\n')).toMatch(/would replace the always-on builtin skill/);

    // A skills directory that is itself a symlink out of the repository is refused.
    const repo2 = path.join(dir, 'repo2');
    mkdirSync(path.join(repo2, '.code-reviewer'), { recursive: true });
    symlinkSync(path.join(dir, 'outside'), path.join(repo2, '.code-reviewer/skills'));
    const escaped = await loadSkillsFrom(
      [{ dir: path.join(repo2, '.code-reviewer/skills'), source: 'project', boundary: repo2 }],
      (m) => warnings.push(m),
    );
    expect(escaped).toEqual([]);
    expect(warnings.at(-1)).toMatch(/resolves outside/);
  });
});

describe('skills command helpers', () => {
  it('summarises activation', () => {
    expect(activationSummary(react)).toBe(
      'stack react, nextjs · lang typescript, javascript · files **/*.tsx, **/*.jsx · 2 content patterns · extends javascript',
    );
    expect(activationSummary(generalBugs)).toBe('always on');
  });

  it('classifies skills repo-wide without evaluating content', () => {
    const c: SkillContext = {
      files: ['src/App.tsx', 'db/schema.sql'],
      languages: ['typescript', 'sql'],
      techs: new Set(['framework.react', 'db.postgresql']),
      code: '',
    };
    const rows = classifySkills(
      [react, postgres, generalBugs, javascript, security],
      c,
      new Set(['security']),
    );
    expect(rows.map((r) => `${r.skill.id}:${r.status}`)).toEqual([
      'general-bugs:always-on',
      'security:excluded',
      'javascript:active',
      'postgresql:on-match',
      'react:active',
    ]);
  });

  it('renders the tree with folder headers, detection and counts', () => {
    const group = parseGroup(
      'name: React\ndescription: React apps.\ncategory: framework\ndetect:\n  stack: [framework.react]\n  files: ["**/*.tsx"]',
      '/pkg/skills/javascript/react/_group.yaml',
      'javascript/react',
      'builtin',
    );
    const effects = parseSkill(
      skillText({ id: 'effects' }),
      '/pkg/skills/javascript/react/effects.md',
      'builtin',
      {
        id: 'javascript/react/effects',
        groups: [group],
      },
    );
    const text = renderSkillList([generalBugs, effects], new Set(), 80).replace(/\x1b\[[0-9;]*m/g, '');
    expect(text).toMatch(/^general-bugs/);
    expect(text).toContain('javascript/ (1)');
    expect(text).toContain('  react/ React (1)');
    expect(text).toContain('detect: stack react · files **/*.tsx');
    expect(text).toContain('effects');
    expect(text).toContain('every chunk of this technology');
    expect(text).toContain('2 skills (2 builtin) · 2 essential, 0 full only · always on: general-bugs');
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
  });
});

describe('skill tree (groups, inherited detection, versions)', () => {
  const group = (folder: string, yaml: string): SkillGroup =>
    parseGroup(yaml, `/pkg/skills/${folder}/_group.yaml`, folder, 'builtin');
  const jsGroup = group(
    'javascript',
    'name: JavaScript\ndescription: JS and TS.\ncategory: language\npriority: 55\ndetect:\n  languages: [javascript, typescript]',
  );
  const reactGroup = group(
    'javascript/react',
    [
      'name: React',
      'description: React components.',
      'category: framework',
      'priority: 60',
      'detect:',
      '  stack: [framework.react]',
      '  files: ["**/*.jsx", "**/*.tsx"]',
      `  content: ["from ['\\"]react['\\"]"]`,
    ].join('\n'),
  );
  const treeSkill = (id: string, groups: SkillGroup[], activation?: string, extra?: string): Skill =>
    parseSkill(
      skillText({ id: id.slice(id.lastIndexOf('/') + 1), activation, extra }),
      `/pkg/skills/${id}.md`,
      'builtin',
      {
        id,
        groups,
      },
    );
  const core = treeSkill('javascript/react/core', [jsGroup, reactGroup]);
  const effects = treeSkill(
    'javascript/react/effects',
    [jsGroup, reactGroup],
    '  content: ["\\\\buseEffect\\\\("]',
  );
  const actions = treeSkill(
    'javascript/react/actions',
    [jsGroup, reactGroup],
    '  content: ["\\\\buseActionState\\\\("]\n  versions: { framework.react: ">=19" }',
  );
  const tsx = (over: Partial<SkillContext> = {}): SkillContext =>
    ctx({
      files: ['src/hooks/useThing.ts'],
      fileCode: "import { useEffect } from 'react';\nexport function useThing() { useEffect(() => {}, []); }",
      code: 'useEffect(() => {}, []);',
      addedCode: 'useEffect(() => {}, []);',
      ...over,
    });

  it('inherits category and priority from the nearest group', () => {
    expect(core).toMatchObject({ category: 'framework', priority: 60 });
    expect(treeSkill('javascript/closures', [jsGroup])).toMatchObject({ category: 'language', priority: 55 });
    const own = treeSkill('javascript/x', [jsGroup], undefined, 'category: security\npriority: 70');
    expect(own).toMatchObject({ category: 'security', priority: 70 });
  });

  it('requires every ancestor group to match; group content runs on the full file content', () => {
    // .ts file (no .tsx signal) that imports react → the react group matches through fileCode
    expect(matchSkill(effects, tsx())?.reasons).toEqual([
      'group:javascript',
      'group:javascript/react',
      'content:/\\buseEffect\\(/',
    ]);
    // the import is outside the changed lines: groups still see it, skills see only added code
    expect(matchSkill(effects, tsx({ addedCode: 'setState(1);' }))).toBeUndefined();
    expect(matchSkill(core, tsx({ addedCode: 'setState(1);' }))).toBeDefined();
    // no react import and no .tsx file → not a React chunk
    expect(matchSkill(core, tsx({ fileCode: 'export const x = 1;' }))).toBeUndefined();
    // the language gate of the root group
    expect(matchSkill(core, tsx({ languages: ['python'] }))).toBeUndefined();
    // the stack gate of the react group
    expect(matchSkill(core, tsx({ techs: new Set(['framework.vue']) }))).toBeUndefined();
  });

  it('a core skill without own signals applies to every chunk of its technology', () => {
    const m = matchSkill(core, tsx({ files: ['src/App.tsx'], fileCode: 'export default function App() {}' }));
    expect(m?.reasons).toEqual(['group:javascript', 'group:javascript/react']);
  });

  it('version gates narrow only when the version is known', () => {
    const c = tsx({ addedCode: 'const [s, act] = useActionState(fn, null);' });
    expect(matchSkill(actions, c)).toBeDefined(); // unknown version passes
    expect(
      matchSkill(actions, { ...c, techVersions: new Map([['framework.react', '18.3.1']]) }),
    ).toBeUndefined();
    expect(
      matchSkill(actions, { ...c, techVersions: new Map([['framework.react', '19.1.0']]) })?.reasons,
    ).toContain('version:framework.react@19.1.0');
    // group-level versions gate every skill below
    const go = group('go', 'name: Go\ndescription: Go.\ncategory: language\ndetect:\n  languages: [go]');
    const oldLoops = group(
      'go/legacy-loops',
      'name: Go < 1.22 loop variables\ndescription: Per-loop variables.\ndetect:\n  versions: { lang.go: "<1.22" }',
    );
    const capture = treeSkill('go/legacy-loops/capture', [go, oldLoops], '  content: ["\\\\bgo func\\\\("]');
    const goCtx = ctx({
      files: ['main.go'],
      languages: ['go'],
      code: 'go func() {}()',
      techs: new Set(['lang.go']),
    });
    expect(matchSkill(capture, { ...goCtx, techVersions: new Map([['lang.go', '1.21']]) })).toBeDefined();
    expect(matchSkill(capture, { ...goCtx, techVersions: new Map([['lang.go', '1.22.3']]) })).toBeUndefined();
  });

  it('scores deeper (more specific) skills higher at equal priority and signals', () => {
    const shallow = treeSkill(
      'javascript/effects',
      [jsGroup],
      '  content: ["\\\\buseEffect\\\\("]',
      'priority: 60',
    );
    const deep = matchSkill(effects, tsx())!.score;
    expect(deep).toBeGreaterThan(matchSkill(shallow, tsx())!.score);
  });

  it('gatesPass ignores signals (repo-wide classification)', () => {
    const repoWide = ctx({ files: ['src/a.ts'], code: '', fileCode: undefined });
    expect(gatesPass(effects, repoWide)).toBe(true);
    expect(gatesPass(effects, { ...repoWide, languages: ['python'] })).toBe(false);
    expect(gatesPass(actions, { ...repoWide, techVersions: new Map([['framework.react', '18.2.0']]) })).toBe(
      false,
    );
  });

  describe('loading', () => {
    let dir: string;
    const write = (rel: string, text: string) => {
      const abs = path.join(dir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    };
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'cr-tree-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('builds group chains; user skills inherit builtin groups; invalid groups are reported', async () => {
      write(
        'b/javascript/_group.yaml',
        'name: JavaScript\ndescription: JS.\ncategory: language\ndetect:\n  languages: [javascript, typescript]',
      );
      write(
        'b/javascript/react/_group.yaml',
        'name: React\ndescription: React.\ncategory: framework\ndetect:\n  stack: [framework.react]',
      );
      write('b/javascript/react/effects.md', skillText({ id: 'effects' }));
      write('b/python/_group.yaml', 'name: Python\ndescription: Py.\ndetect:\n  languages: [pyhton]');
      write('b/python/async.md', skillText({ id: 'async', category: 'language' }));
      write('g/javascript/react/team-rules.md', skillText({ id: 'team-rules' }));
      const warnings: string[] = [];
      const skills = await loadSkillsFrom(
        [
          { dir: path.join(dir, 'b'), source: 'builtin' },
          { dir: path.join(dir, 'g'), source: 'global' },
        ],
        (m) => warnings.push(m),
      );
      const byId = new Map(skills.map((s) => [s.id, s]));
      expect(byId.get('javascript/react/effects')?.groups.map((g) => g.path)).toEqual([
        'javascript',
        'javascript/react',
      ]);
      expect(byId.get('javascript/react/effects')?.category).toBe('framework');
      const team = byId.get('javascript/react/team-rules');
      expect(team?.groups.map((g) => `${g.path}:${g.source}`)).toEqual([
        'javascript:builtin',
        'javascript/react:builtin',
      ]);
      expect(team?.category).toBe('framework');
      // the broken python group is skipped with a warning; its skill loads without detection
      expect(warnings.join('\n')).toMatch(/Skipping skill group .*python\/_group\.yaml: .*unknown language/);
      expect(byId.get('python/async')?.groups).toEqual([]);
    });
  });
});
