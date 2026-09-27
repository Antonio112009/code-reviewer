/**
 * Validates the builtin skills library (skills/). Authors can check one subtree while others are being
 * written: `SKILLS_SUBTREE=javascript/react npx vitest run test/skills-library.test.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { isTechId } from '../src/context/stack/techs';
import { compileGlobs } from '../src/skills/activation';
import { signalText } from '../src/skills/detector';
import {
  GROUP_FILES,
  KNOWN_LANGUAGES,
  loadSkillsFrom,
  parseGroup,
  parseSkill,
  SKILL_ID_RE,
} from '../src/skills/loader';
import { packageRoot } from '../src/util/paths';
import { compileRange } from '../src/util/versions';

const ROOT = path.join(packageRoot(), 'skills');
const SUBTREE = (process.env.SKILLS_SUBTREE ?? '').replace(/^\/+|\/+$/g, '');

/** Top-level folders of the library (languages / ecosystems, then cross-cutting areas). */
const ECOSYSTEMS = [
  'practice',
  'security',
  'web',
  'javascript',
  'python',
  'php',
  'java',
  'kotlin',
  'csharp',
  'go',
  'rust',
  'c-cpp',
  'ruby',
  'swift',
  'dart',
  'scala',
  'shell',
  'sql',
  'databases',
  'infra',
  'cloud',
];
const ALWAYS_ON = new Set(['practice/general-bugs', 'security/core']);
/** Focused skills stay far below this (typically 150-350 tokens); broad core checklists may use it all. */
const MAX_BODY_TOKENS = 650;
const MAX_BULLETS = 12;
const MIN_BULLETS = 3;

interface Entry {
  id: string;
  file: string;
  folder: string;
}

function walk(dir: string, rel = ''): { skills: Entry[]; groups: Entry[] } {
  const out = { skills: [] as Entry[], groups: [] as Entry[] };
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (statSync(abs).isDirectory()) {
      const sub = walk(abs, relPath);
      out.skills.push(...sub.skills);
      out.groups.push(...sub.groups);
    } else if (GROUP_FILES.includes(name)) {
      out.groups.push({ id: rel, file: abs, folder: rel });
    } else if (name.endsWith('.md') && name.toLowerCase() !== 'readme.md') {
      out.skills.push({ id: relPath.slice(0, -3), file: abs, folder: rel });
    }
  }
  return out;
}

const all = walk(ROOT);
const inScope = (p: string) => !SUBTREE || p === SUBTREE || p.startsWith(`${SUBTREE}/`);
const skills = all.skills.filter((e) => inScope(e.id));
const groups = all.groups.filter((e) => inScope(e.folder) || SUBTREE.startsWith(`${e.folder}/`));
const groupFolders = new Set(all.groups.map((g) => g.folder));

/** A concrete path a glob should match (`**` → nested dirs, `*`/`?` → letters, `{a,b}` → a). */
function exampleFor(glob: string): string | undefined {
  if (/[!@+]\(/.test(glob)) return undefined;
  let out = glob.replace(/\{([^{}]*)\}/g, (_m, alts: string) => alts.split(',')[0] ?? '');
  out = out.replace(/\[(!|\^)?([^\]]+)\]/g, (_m, neg: string | undefined, cls: string) =>
    neg ? 'q' : cls[0] === '\\' ? cls[1]! : cls[0]!,
  );
  out = out
    .replace(/\*\*\//g, 'deep/dir/')
    .replace(/\/\*\*$/, '/deep/file.x')
    .replace(/\*\*/g, 'deep');
  return out.replace(/\*/g, 'x').replace(/\?/g, 'x');
}

/** Worst-case inputs for backtracking regexes. */
const ADVERSARIAL = [
  ' '.repeat(20_000),
  'a'.repeat(20_000),
  `${'('.repeat(5_000)}${')'.repeat(5_000)}`,
  `${'a '.repeat(10_000)}!`,
  `${'<a '.repeat(5_000)}`,
  `${'"'.repeat(5_000)}x`,
  `${'.'.repeat(10_000)}`,
  `${'\n'.repeat(10_000)}x`,
];

/**
 * Catastrophic backtracking takes seconds or more on these inputs; linear patterns take a few ms locally and
 * a few hundred at most on slow CI machines.
 */
const MAX_REGEX_MS = 500;

function checkRegexes(sources: string[], where: string): void {
  for (const source of sources) {
    const re = new RegExp(source, 'm');
    expect(re.test(''), `${where}: /${source}/ matches the empty string`).toBe(false);
    for (const input of ADVERSARIAL) {
      const text = signalText(input); // what the detector hands to content regexes
      const started = performance.now();
      re.test(text);
      const ms = performance.now() - started;
      expect(ms, `${where}: /${source}/ took ${ms.toFixed(0)}ms on adversarial input (ReDoS)`).toBeLessThan(
        MAX_REGEX_MS,
      );
    }
  }
}

function checkGlobs(globs: string[], where: string): void {
  const matcher = compileGlobs(globs);
  for (const glob of globs) {
    expect(glob.startsWith('/'), `${where}: glob ${glob} must be repository-relative`).toBe(false);
    const example = exampleFor(glob);
    if (example !== undefined) {
      expect(compileGlobs([glob])(example), `${where}: glob ${glob} should match ${example}`).toBe(true);
    }
  }
  expect(matcher('zz-unrelated/qq-nothing.zzz'), `${where}: file globs must not match every path`).toBe(
    false,
  );
}

function checkActivationBlock(a: Record<string, unknown> | undefined, where: string): void {
  if (!a) return;
  for (const t of (a.stack as string[] | undefined) ?? [])
    expect(isTechId(t), `${where}: stack id ${t}`).toBe(true);
  for (const l of (a.languages as string[] | undefined) ?? [])
    expect(KNOWN_LANGUAGES.has(l), `${where}: language ${l}`).toBe(true);
  for (const [t, r] of Object.entries((a.versions as Record<string, string> | undefined) ?? {})) {
    expect(isTechId(t), `${where}: versions key ${t}`).toBe(true);
    expect(() => compileRange(r), `${where}: versions.${t} "${r}"`).not.toThrow();
  }
  checkRegexes((a.content as string[] | undefined) ?? [], where);
  if ((a.files as string[] | undefined)?.length) checkGlobs(a.files as string[], where);
}

describe(`skills library${SUBTREE ? ` (${SUBTREE})` : ''}`, () => {
  it('has skills', () => {
    expect(skills.length, `no skills under ${SUBTREE || 'skills/'}`).toBeGreaterThan(0);
  });

  it('uses only the known top-level folders', () => {
    for (const e of [...skills, ...groups]) {
      const top = (e.id || e.folder).split('/')[0]!;
      if (top) expect(ECOSYSTEMS, `top-level folder "${top}" (${e.file})`).toContain(top);
    }
  });

  it('loads through the loader without warnings', async () => {
    const warnings: string[] = [];
    const loaded = await loadSkillsFrom([{ dir: ROOT, source: 'builtin' }], (m) => warnings.push(m));
    const relevant = warnings.filter(
      (w) => !SUBTREE || w.includes(`/skills/${SUBTREE}`) || w.includes(`"${SUBTREE}`),
    );
    expect(relevant).toEqual([]);
    const ids = new Set(loaded.map((s) => s.id));
    for (const e of skills) expect(ids.has(e.id), `${e.id} was not loaded`).toBe(true);
    // extends targets exist, alwaysOn is reserved
    for (const s of loaded.filter((x) => inScope(x.id))) {
      for (const parent of s.extends) expect(ids.has(parent), `${s.id} extends unknown ${parent}`).toBe(true);
      if (s.alwaysOn) expect(ALWAYS_ON.has(s.id), `${s.id} must not be alwaysOn`).toBe(true);
    }
  });

  for (const g of groups) {
    it(`group ${g.folder || '(root)'}`, () => {
      const group = parseGroup(readFileSync(g.file, 'utf8'), g.file, g.folder, 'builtin');
      expect(group.description.length, 'description should be at most two sentences').toBeLessThanOrEqual(
        400,
      );
      const raw = YAML.parse(readFileSync(g.file, 'utf8')) as { detect?: Record<string, unknown> };
      checkActivationBlock(raw.detect, `${g.folder}/_group.yaml`);
    });
  }

  for (const e of skills) {
    it(e.id, () => {
      expect(SKILL_ID_RE.test(e.id), `path ${e.id} must be kebab-case segments`).toBe(true);
      expect(groupFolders.has(e.folder), `folder ${e.folder} needs a _group.yaml`).toBe(true);
      const text = readFileSync(e.file, 'utf8');
      const chainFolders = e.folder.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'));
      const chain = chainFolders
        .filter((f) => groupFolders.has(f))
        .map((f) => {
          const file = GROUP_FILES.map((n) => path.join(ROOT, f, n)).find((p) => existsSync(p))!;
          return parseGroup(readFileSync(file, 'utf8'), file, f, 'builtin');
        });
      const skill = parseSkill(text, e.file, 'builtin', { id: e.id, groups: chain });
      expect(skill.description.length, 'description should be one sentence').toBeLessThanOrEqual(300);
      expect(skill.tokens, `body is ${skill.tokens} tokens (max ${MAX_BODY_TOKENS})`).toBeLessThanOrEqual(
        MAX_BODY_TOKENS,
      );
      const bullets = skill.body.split('\n').filter((l) => /^\s*[-*] /.test(l)).length;
      expect(bullets, 'bullet count').toBeGreaterThanOrEqual(MIN_BULLETS);
      expect(bullets, 'bullet count').toBeLessThanOrEqual(MAX_BULLETS);
      const fm = YAML.parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)![1]!) as {
        activation?: Record<string, unknown>;
        sources?: string[];
      };
      checkActivationBlock(fm.activation, e.id);
      for (const src of fm.sources ?? [])
        expect(src, `${e.id}: sources must be URLs`).toMatch(/^https?:\/\//);
      // Something must decide when the skill applies: its own activation or an inherited group detect.
      const inherited = chain.some((g) => g.detect && Object.keys(g.detect).length > 0);
      const own = Object.keys(fm.activation ?? {}).length > 0;
      if (!ALWAYS_ON.has(e.id)) expect(own || inherited, `${e.id} has no activation at all`).toBe(true);
    });
  }
});
