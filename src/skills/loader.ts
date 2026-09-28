import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { MAX_CHECKS_PER_SKILL, type StructuralCheck, StructuralCheckSchema } from '../analyzers/ast-grep';
import { estimateTokens } from '../chunking/tokens';
import { isTechId, TECH_IDS } from '../context/stack/techs';
import { unsafeGlobReason } from '../util/globs';
import { globalConfigDir, PROJECT_DIR, packageRoot } from '../util/paths';
import { compileRange } from '../util/versions';
import { compileActivation, hasNestedQuantifier, primeActivation, type SkillActivation } from './activation';
import { unsafeRegexes } from './regex-guard';

export type { SkillActivation } from './activation';

/** Skill categories, in the order skills are emitted into prompts (stable prefix for prompt caching). */
export const SKILL_CATEGORIES = [
  'practice',
  'security',
  'language',
  'web',
  'database',
  'framework',
  'infra',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/**
 * Review depth a skill belongs to: `essential` — defects that can seriously hurt production (security,
 * data loss, crashes, leaks/OOM, overload, costly performance); `full` — everything else worth checking
 * (edge cases with limited impact, accessibility, best practices with a concrete consequence).
 * Essential skills may mark single bullets `[full]`; the essential depth leaves those out.
 */
export const SKILL_TIERS = ['essential', 'full'] as const;
export type SkillTier = (typeof SKILL_TIERS)[number];

/** Language ids a skill may gate on (`src/util/language.ts` ids). */
export const KNOWN_LANGUAGES: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'python',
  'php',
  'java',
  'kotlin',
  'csharp',
  'go',
  'rust',
  'c',
  'cpp',
  'ruby',
  'swift',
  'scala',
  'dart',
  'elixir',
  'shell',
  'sql',
  'yaml',
  'json',
  'dockerfile',
  'terraform',
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
  'graphql',
  'groovy',
  'makefile',
  'protobuf',
  'objective-c',
  'markdown',
  'toml',
  'text',
]);

/** Markdown files in skill directories that are documentation, not skills. */
const IGNORED_FILES = new Set(['readme.md', 'license.md', 'contributing.md', 'changelog.md']);
/** Folder metadata file: technology description + detection inherited by every skill below it. */
export const GROUP_FILES = ['_group.yaml', '_group.yml'];
const MAX_SKILL_BYTES = 256 * 1024;
/** Project skills come from the reviewed repository: smaller files, fewer of them. */
const MAX_PROJECT_SKILL_BYTES = 32 * 1024;
const MAX_PROJECT_FILES = 200;
const MAX_DEPTH = 6;
const MAX_FILES = 2_000;
/** Limits for regexes from the reviewed repository (they run on every chunk). */
const MAX_PROJECT_PATTERNS = 20;
const MAX_PROJECT_PATTERN_LENGTH = 300;

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** Skill ids are kebab-case paths below the skills root: `javascript/react/effects`, `practice/general-bugs`. */
export const SKILL_ID_RE = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`);
const SkillId = z.string().regex(SKILL_ID_RE, 'must be a kebab-case path like javascript/react/effects');
/** A list that also accepts a single scalar (`extends: javascript`). */
const list = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(item));
const Strings = list(z.string().min(1));

const ActivationSchema = z.strictObject({
  stack: Strings.optional(),
  languages: Strings.optional(),
  files: Strings.optional(),
  content: Strings.optional(),
  /** Tech id → version range (`framework.nextjs: ">=13"`); unknown versions pass. */
  versions: z.record(z.string(), z.string().min(1)).optional(),
  /**
   * Code the `content` regexes must fire on (a changed line or two each). Checked by the library test;
   * never used for matching.
   */
  examples: Strings.optional(),
});

/** `_group.yaml`: what the technology is and how it is detected; inherited by every skill below. */
export const GroupSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(SKILL_CATEGORIES).optional(),
  priority: z.number().min(0).max(100).optional(),
  /** Default tier of the skills below. */
  tier: z.enum(SKILL_TIERS).optional(),
  detect: ActivationSchema.optional(),
});

/** Iteration-1 `match` block, still accepted in user (global / project) skills. */
const LegacyMatchSchema = z.strictObject({
  languages: Strings.optional(),
  dependencies: Strings.optional(),
  files: Strings.optional(),
  content: Strings.optional(),
});

/** Frontmatter of a skill file. Unknown top-level keys (Agent Skills fields such as `license`) are ignored. */
export const SkillMetaSchema = z.object({
  /** Optional: the id is the file path; when given it must match. */
  id: SkillId.optional(),
  /** Injected into prompts: kept short. */
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  /** Inherited from the nearest `_group.yaml` when omitted. */
  category: z.enum(SKILL_CATEGORIES).optional(),
  /** 0-100; higher wins when the per-chunk skill budget is tight. Inherited when omitted (default 50). */
  priority: z.number().min(0).max(100).optional(),
  /** `essential` or `full`; inherited from the nearest group when omitted (default `essential`). */
  tier: z.enum(SKILL_TIERS).optional(),
  /** Injected into every chunk (still subject to gates and the budget). Builtin/global skills only. */
  alwaysOn: z.boolean().default(false),
  /** Activating this skill also activates these ids (budget permitting). */
  extends: list(SkillId).default([]),
  /** CWE / OWASP references. */
  tags: Strings.default([]),
  /** Documentation the checks are based on (official docs, changelogs, advisories). Not sent to models. */
  sources: Strings.default([]),
  activation: ActivationSchema.optional(),
  match: LegacyMatchSchema.optional(),
  /** Structural checks (ast-grep rules) run before the review; their matches become hints. */
  checks: z.array(StructuralCheckSchema).max(MAX_CHECKS_PER_SKILL).optional(),
});

export type SkillSource = 'builtin' | 'global' | 'project';

export interface SkillGroup {
  /** Folder path below the skills root, e.g. `javascript/react`. */
  path: string;
  name: string;
  description: string;
  category?: SkillCategory;
  priority?: number;
  tier?: SkillTier;
  /** Detection every skill below must pass (gates + signals on the chunk's files and full content). */
  detect?: SkillActivation;
  source: SkillSource;
  file: string;
}

export interface Skill {
  /** Path below the skills root without `.md`: `javascript/react/effects`. */
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  priority: number;
  tier: SkillTier;
  alwaysOn: boolean;
  extends: string[];
  tags: string[];
  activation: SkillActivation;
  /** Structural checks (`analyzers/ast-grep.ts`), tagged with this skill's id. */
  checks?: StructuralCheck[];
  /** Ancestor folder groups, root first (their `detect` blocks gate this skill). */
  groups: SkillGroup[];
  /** The checklist (markdown), `[full]` markers removed. */
  body: string;
  /** `body` without the bullets marked `[full]` (what the essential depth injects). */
  essentialBody: string;
  source: SkillSource;
  /** Absolute path of the skill file. */
  file: string;
  /** Estimated tokens of `body`. */
  tokens: number;
  /** Estimated tokens of `essentialBody`. */
  essentialTokens: number;
}

export interface SkillDir {
  dir: string;
  source: SkillSource;
  /** Directory the skills must stay inside (project skills: the repository root). Symlinks are not followed. */
  boundary?: string;
}

export interface ParseSkillOptions {
  /** Expected id (path below the skills root without `.md`); the file's base name when omitted. */
  id?: string;
  /**
   * Top-level folder of the skill below its source root (legacy category folders such as
   * `framework`), `null` at the root; derived from `id` / `file` when omitted.
   */
  folder?: string | null;
  /** Ancestor groups (root first); category and priority are inherited from the nearest one. */
  groups?: SkillGroup[];
  warn?: (msg: string) => void;
}

export function isSkillCategory(value: unknown): value is SkillCategory {
  return (SKILL_CATEGORIES as readonly unknown[]).includes(value);
}

/** Skill sources in override order: builtin (package `skills/`), global, project. */
export function skillDirs(projectRoot?: string): SkillDir[] {
  const dirs: SkillDir[] = [
    { dir: path.join(packageRoot(), 'skills'), source: 'builtin' },
    { dir: path.join(globalConfigDir(), 'skills'), source: 'global' },
  ];
  if (projectRoot) {
    dirs.push({
      dir: path.join(projectRoot, PROJECT_DIR, 'skills'),
      source: 'project',
      boundary: projectRoot,
    });
  }
  return dirs;
}

/** Loads builtin, global and project skills; later sources override earlier ones with the same id. */
export async function loadSkills(projectRoot?: string, warn?: (msg: string) => void): Promise<Skill[]> {
  return loadSkillsFrom(skillDirs(projectRoot), warn);
}

/** Loads skills from explicit directories (in override order). Invalid files are skipped with a warning. */
export async function loadSkillsFrom(dirs: SkillDir[], warn?: (msg: string) => void): Promise<Skill[]> {
  const listings = await Promise.all(dirs.map((d) => listDir(d, warn)));
  // Groups first: skills of later sources inherit builtin groups for folders they do not define.
  const groupMaps = await Promise.all(dirs.map((d, i) => loadGroups(d, listings[i]!.groups, warn)));
  const builtinGroups = new Map<string, SkillGroup>();
  dirs.forEach((d, i) => {
    if (d.source === 'builtin') for (const [k, g] of groupMaps[i]!) builtinGroups.set(k, g);
  });
  const loaded = await Promise.all(
    dirs.map((d, i) => loadDirSkills(d, listings[i]!.skills, groupMaps[i]!, builtinGroups, warn)),
  );
  // Regexes from the reviewed repository are run against adversarial input (in a worker, with a time
  // limit) before they may run on its code; skills using a refused pattern — directly or through a
  // project _group.yaml — are dropped.
  const untrusted = new Set<string>();
  dirs.forEach((d, i) => {
    if (d.source !== 'project') return;
    for (const s of loaded[i]!) for (const p of s.activation.content ?? []) untrusted.add(p);
    for (const g of groupMaps[i]!.values()) for (const p of g.detect?.content ?? []) untrusted.add(p);
  });
  if (untrusted.size) {
    const unsafe = await unsafeRegexes([...untrusted]);
    if (unsafe.size) {
      dirs.forEach((d, i) => {
        if (d.source !== 'project') return;
        loaded[i] = loaded[i]!.filter((s) => {
          const patterns = [
            ...(s.activation.content ?? []),
            ...s.groups.filter((g) => g.source === 'project').flatMap((g) => g.detect?.content ?? []),
          ];
          const bad = patterns.find((p) => unsafe.has(p));
          if (bad !== undefined) {
            warn?.(`Skipping project skill ${s.file}: regex /${bad.slice(0, 60)}/ ${unsafe.get(bad)}.`);
            return false;
          }
          return true;
        });
      });
    }
  }
  const byId = new Map<string, Skill>();
  for (const skills of loaded) {
    for (const skill of skills) {
      const previous = byId.get(skill.id);
      if (previous && skill.source === 'project' && previous.alwaysOn) {
        warn?.(
          `Ignoring project skill "${skill.id}" (${skill.file}): it would replace the always-on ${previous.source} skill.`,
        );
        continue;
      }
      byId.set(skill.id, skill);
    }
  }
  const skills = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const skill of skills) {
    const missing = skill.extends.filter((id) => !byId.has(id));
    if (missing.length) warn?.(`Skill "${skill.id}" extends unknown skill(s): ${missing.join(', ')}`);
  }
  return skills;
}

/** Folder paths from the root to `folder`: `a/b/c` → [`a`, `a/b`, `a/b/c`]. */
function ancestors(folder: string): string[] {
  if (!folder) return [];
  const parts = folder.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

async function readSmallFile(file: string, follow: boolean, source: SkillSource): Promise<string> {
  const max = source === 'project' ? MAX_PROJECT_SKILL_BYTES : MAX_SKILL_BYTES;
  const size = (await (follow ? stat : lstat)(file)).size;
  if (size > max) throw new Error(`file is larger than ${max / 1024} KiB`);
  return readFile(file, 'utf8');
}

async function loadGroups(
  { source, boundary }: SkillDir,
  refs: GroupFileRef[],
  warn?: (msg: string) => void,
): Promise<Map<string, SkillGroup>> {
  const out = new Map<string, SkillGroup>();
  for (const ref of refs) {
    try {
      const text = await readSmallFile(ref.file, boundary === undefined, source);
      out.set(ref.path, parseGroup(text, ref.file, ref.path, source, warn));
    } catch (err) {
      warn?.(`Skipping skill group ${ref.file}: ${(err as Error).message}`);
    }
  }
  return out;
}

async function loadDirSkills(
  { source, boundary }: SkillDir,
  refs: SkillFileRef[],
  groups: Map<string, SkillGroup>,
  builtinGroups: Map<string, SkillGroup>,
  warn?: (msg: string) => void,
): Promise<Skill[]> {
  const parsed = await Promise.all(
    refs.map(async (ref): Promise<Skill | undefined> => {
      try {
        const text = await readSmallFile(ref.file, boundary === undefined, source);
        const chain = ancestors(ref.folder)
          .map((p) => groups.get(p) ?? builtinGroups.get(p))
          .filter((g): g is SkillGroup => g !== undefined);
        const top = ref.folder.split('/')[0] || null;
        return parseSkill(text, ref.file, source, { id: ref.id, folder: top, groups: chain, warn });
      } catch (err) {
        warn?.(`Skipping skill ${ref.file}: ${(err as Error).message}`);
        return undefined;
      }
    }),
  );
  const out: Skill[] = [];
  const seen = new Map<string, string>();
  for (const skill of parsed) {
    if (!skill) continue;
    const first = seen.get(skill.id);
    if (first) {
      warn?.(`Skipping skill ${skill.file}: duplicate id "${skill.id}" (already defined in ${first}).`);
      continue;
    }
    seen.set(skill.id, skill.file);
    out.push(skill);
  }
  return out;
}

async function isInsideBoundary(dir: string, boundary: string | undefined): Promise<boolean> {
  if (boundary === undefined) return true;
  try {
    const [realDir, realRoot] = await Promise.all([realpath(dir), realpath(boundary)]);
    const rel = path.relative(realRoot, realDir);
    return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  } catch {
    return true; // missing directory: nothing to load, nothing to escape to
  }
}

interface SkillFileRef {
  file: string;
  /** Path id: `javascript/react/effects` (for `<dir>/SKILL.md`: the directory path). */
  id: string;
  /** Folder of the skill below the source root ('' at the root). */
  folder: string;
}

interface GroupFileRef {
  file: string;
  /** Folder the group describes ('' = root). */
  path: string;
}

async function listDir(
  { dir, source, boundary }: SkillDir,
  warn?: (msg: string) => void,
): Promise<{ skills: SkillFileRef[]; groups: GroupFileRef[] }> {
  if (!(await isInsideBoundary(dir, boundary))) {
    warn?.(`Ignoring ${source} skills directory ${dir}: it resolves outside ${boundary}.`);
    return { skills: [], groups: [] };
  }
  return listSkillFiles(
    dir,
    boundary === undefined,
    warn,
    source === 'project' ? MAX_PROJECT_FILES : MAX_FILES,
  );
}

/**
 * Lists skill files (`*.md`, `<dir>/SKILL.md`) and group files (`_group.yaml`) recursively, sorted,
 * skipping dot-entries and docs. Symlinks are followed only for trusted (builtin/global) sources.
 */
async function listSkillFiles(
  root: string,
  followLinks: boolean,
  warn?: (msg: string) => void,
  maxFiles = MAX_FILES,
): Promise<{ skills: SkillFileRef[]; groups: GroupFileRef[] }> {
  const skills: SkillFileRef[] = [];
  const groups: GroupFileRef[] = [];
  let truncated = false;
  const kindOf = async (entry: Dirent, abs: string): Promise<'file' | 'dir' | undefined> => {
    if (entry.isSymbolicLink()) {
      if (!followLinks) return undefined;
      const st = await stat(abs).catch(() => undefined);
      return st?.isFile() ? 'file' : st?.isDirectory() ? 'dir' : undefined;
    }
    return entry.isFile() ? 'file' : entry.isDirectory() ? 'dir' : undefined;
  };
  const isRegularFile = async (abs: string): Promise<boolean> => {
    const st = await (followLinks ? stat : lstat)(abs).catch(() => undefined);
    return st?.isFile() ?? false;
  };
  const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

  const visit = async (dir: string, folder: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (skills.length >= maxFiles) {
        if (!truncated) warn?.(`Only the first ${maxFiles} skill files under ${root} are loaded.`);
        truncated = true;
        return;
      }
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const kind = await kindOf(entry, abs);
      if (kind === 'dir') {
        const skillMd = path.join(abs, 'SKILL.md');
        if (await isRegularFile(skillMd)) {
          skills.push({ file: skillMd, id: join(folder, entry.name), folder });
        } else if (depth < MAX_DEPTH) await visit(abs, join(folder, entry.name), depth + 1);
      } else if (kind === 'file' && GROUP_FILES.includes(entry.name)) {
        groups.push({ file: abs, path: folder });
      } else if (
        kind === 'file' &&
        entry.name.endsWith('.md') &&
        entry.name !== 'SKILL.md' &&
        !IGNORED_FILES.has(entry.name.toLowerCase())
      ) {
        skills.push({ file: abs, id: join(folder, entry.name.slice(0, -3)), folder });
      }
    }
  };
  await visit(root, '', 0);
  return { skills, groups };
}

/** Base-name id of a skill file (used when no path id is supplied, e.g. in tests). */
function baseId(file: string): string {
  const parts = file.split(/[\\/]/).filter(Boolean);
  const isSkillMd = parts.at(-1) === 'SKILL.md';
  return isSkillMd ? (parts.at(-2) ?? '') : (parts.at(-1) ?? '').replace(/\.md$/, '');
}

/** Validates an activation / detect block: known tech ids and languages, compilable regexes and ranges. */
function checkActivation(
  a: SkillActivation,
  source: SkillSource,
  note: (msg: string) => void,
  what: string,
): void {
  const versionTechs = Object.keys(a.versions ?? {});
  const unknownTechs = [...(a.stack ?? []), ...versionTechs].filter((t) => !isTechId(t));
  const unknownLangs = (a.languages ?? []).filter((l) => !KNOWN_LANGUAGES.has(l));
  if (source === 'builtin' && unknownTechs.length)
    throw new Error(`${what}: unknown stack id(s): ${unknownTechs.join(', ')}`);
  if (source === 'builtin' && unknownLangs.length)
    throw new Error(`${what}: unknown language(s): ${unknownLangs.join(', ')}`);
  if (unknownTechs.length) note(`${what}: unknown stack id(s) never match: ${unknownTechs.join(', ')}`);
  if (unknownLangs.length) note(`${what}: unknown language(s) never match: ${unknownLangs.join(', ')}`);
  for (const [tech, range] of Object.entries(a.versions ?? {})) {
    try {
      compileRange(range);
    } catch (err) {
      throw new Error(`${what}: versions.${tech}: ${(err as Error).message}`);
    }
  }
  if (source === 'project') {
    for (const glob of a.files ?? []) {
      const reason = unsafeGlobReason(glob);
      if (reason)
        throw new Error(`${what}: files glob ${JSON.stringify(glob.slice(0, 80))} is not allowed: ${reason}`);
    }
    const patterns = a.content ?? [];
    if (patterns.length > MAX_PROJECT_PATTERNS) {
      throw new Error(`${what}: project skills may declare at most ${MAX_PROJECT_PATTERNS} content patterns`);
    }
    const unsafe = patterns.find((p) => p.length > MAX_PROJECT_PATTERN_LENGTH || hasNestedQuantifier(p));
    if (unsafe !== undefined) {
      throw new Error(
        `${what}: content regex /${unsafe.slice(0, 60)}/ is too long or has nested quantifiers (ReDoS risk)`,
      );
    }
  }
}

/** Parses a `_group.yaml`. Throws with a readable message when invalid. */
export function parseGroup(
  text: string,
  file: string,
  folder: string,
  source: SkillSource,
  warn?: (msg: string) => void,
): SkillGroup {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new Error(`invalid YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  const result = GroupSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new Error(
      result.error.issues.map((i) => `${i.path.join('.') || 'group'}: ${i.message}`).join('; '),
    );
  }
  const g = result.data;
  if (g.detect) {
    checkActivation(g.detect, source, (m) => warn?.(`Skill group ${file}: ${m}`), 'detect');
    const compiled = compileActivation(g.detect); // throws on an invalid regex
    const group: SkillGroup = { path: folder, source, file, ...g };
    primeActivation(group, compiled);
    return group;
  }
  return { path: folder, source, file, ...g };
}

/**
 * Parses and validates one skill file. Throws with a readable message when the file is invalid.
 * Project skills (from the reviewed repository) are clamped: never always-on, bounded and
 * backtracking-safe content regexes.
 */
export function parseSkill(
  text: string,
  file: string,
  source: SkillSource,
  opts: ParseSkillOptions = {},
): Skill {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(text);
  if (!m) throw new Error('missing YAML frontmatter');
  let raw: unknown;
  try {
    raw = YAML.parse(m[1]!);
  } catch (err) {
    throw new Error(`invalid YAML frontmatter: ${(err as Error).message.split('\n')[0]}`);
  }
  const result = SkillMetaSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new Error(
      result.error.issues.map((i) => `${i.path.join('.') || 'frontmatter'}: ${i.message}`).join('; '),
    );
  }
  const meta = result.data;
  const id = opts.id ?? baseId(file);
  if (!SKILL_ID_RE.test(id))
    throw new Error(`file path "${id}" is not a valid skill id (kebab-case segments)`);
  const note = (msg: string) => opts.warn?.(`Skill "${id}" (${file}): ${msg}`);
  if (meta.id !== undefined && meta.id !== id && meta.id !== id.slice(id.lastIndexOf('/') + 1)) {
    throw new Error(`id "${meta.id}" must equal the file path "${id}"`);
  }

  const groups = opts.groups ?? [];
  const nearest = <K extends 'category' | 'priority' | 'tier'>(key: K) =>
    [...groups].reverse().find((g) => g[key] !== undefined)?.[key];
  const top =
    opts.folder === undefined ? (id.includes('/') ? id.slice(0, id.indexOf('/')) : null) : opts.folder;
  const folderCategory = isSkillCategory(top) ? top : undefined;
  const category = meta.category ?? nearest('category') ?? folderCategory;
  if (source === 'builtin' && !category) {
    throw new Error('category is required (in the frontmatter or an ancestor _group.yaml)');
  }

  let activation: SkillActivation;
  if (meta.match) {
    if (source === 'builtin') throw new Error('builtin skills must use "activation", not the legacy "match"');
    if (meta.activation) throw new Error('declare either "activation" or the legacy "match" block, not both');
    activation = fromLegacyMatch(meta.match, note);
  } else {
    activation = meta.activation ?? {};
  }
  checkActivation(activation, source, note, 'activation');

  let alwaysOn = meta.alwaysOn;
  if (source === 'project') {
    if (alwaysOn) {
      note('project skills cannot be always-on; treating it as a regular skill.');
      alwaysOn = false;
    }
    if (!hasActivation(activation) && !groups.some((g) => g.detect && hasActivation(g.detect))) {
      note('declares no activation; it is used only when selected explicitly (--skills).');
    }
  }

  const compiled = compileActivation(activation); // throws on an invalid regex → skill skipped
  const { body, essentialBody } = splitTiers((m[2] ?? '').trim());
  const skill: Skill = {
    id,
    name: meta.name,
    description: meta.description,
    category: category ?? 'practice',
    priority: meta.priority ?? nearest('priority') ?? 50,
    tier: meta.tier ?? nearest('tier') ?? 'essential',
    alwaysOn,
    extends: [...new Set(meta.extends)].filter((e) => e !== id),
    tags: meta.tags,
    activation,
    ...(meta.checks?.length ? { checks: meta.checks.map((c) => ({ ...c, skill: id })) } : {}),
    groups,
    body,
    essentialBody,
    source,
    file,
    tokens: estimateTokens(body),
    essentialTokens: essentialBody === body ? estimateTokens(body) : estimateTokens(essentialBody),
  };
  primeActivation(activation, compiled);
  return skill;
}

/** A bullet marked for the full depth only: `- [full] **Name**: …`. */
const FULL_BULLET = /^(\s*[-*]\s+)\[full\]\s*/;

/**
 * Splits a skill body into the full text (markers removed) and the essential text (without `[full]`
 * bullets, their continuation lines and nested bullets).
 */
export function splitTiers(text: string): { body: string; essentialBody: string } {
  if (!text.includes('[full]')) return { body: text, essentialBody: text };
  const full: string[] = [];
  const essential: string[] = [];
  /** Indentation of the `[full]` bullet being skipped, or -1. */
  let skipIndent = -1;
  for (const line of text.split('\n')) {
    const bullet = /^(\s*)[-*]\s+/.exec(line);
    const indent = bullet ? bullet[1]!.length : (/^\s*/.exec(line)?.[0].length ?? 0);
    if (skipIndent >= 0) {
      const continues = line.trim() !== '' && indent > skipIndent;
      if (!continues) skipIndent = -1;
    }
    const marked = FULL_BULLET.exec(line);
    const clean = marked ? line.replace(FULL_BULLET, '$1') : line;
    full.push(clean);
    if (marked && skipIndent < 0) skipIndent = indent;
    if (skipIndent < 0) essential.push(clean);
  }
  const trim = (lines: string[]) =>
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  return { body: trim(full), essentialBody: trim(essential) };
}

/** True when the activation block declares at least one gate or signal. */
export function hasActivation(a: SkillActivation): boolean {
  return Boolean(a.stack?.length || a.languages?.length || a.files?.length || a.content?.length);
}

/** Package names of iteration-1 `match.dependencies` whose tech id is not simply the name. */
const LEGACY_DEPENDENCY_TECHS: Record<string, string> = {
  next: 'framework.nextjs',
  'react-dom': 'framework.react',
  preact: 'framework.react',
  '@nestjs/core': 'framework.nestjs',
  '@angular/core': 'framework.angular',
  '@sveltejs/kit': 'framework.svelte',
  '@remix-run/react': 'framework.remix',
  '@trpc/server': 'framework.trpc',
  pg: 'db.postgresql',
  postgres: 'db.postgresql',
  psycopg: 'db.postgresql',
  psycopg2: 'db.postgresql',
  mysql2: 'db.mysql',
  'better-sqlite3': 'db.sqlite',
  sqlite3: 'db.sqlite',
  pymongo: 'db.mongodb',
  ioredis: 'db.redis',
  '@prisma/client': 'orm.prisma',
  'drizzle-orm': 'orm.drizzle',
  kafkajs: 'tool.kafka',
  amqplib: 'tool.rabbitmq',
  openai: 'tool.llm-sdk',
  '@anthropic-ai/sdk': 'tool.llm-sdk',
};

/** Maps an iteration-1 dependency name to a tech id (`react` → `framework.react`), if any. */
export function legacyDependencyTech(dep: string): string | undefined {
  if (isTechId(dep)) return dep;
  const name = dep.toLowerCase();
  return LEGACY_DEPENDENCY_TECHS[name] ?? TECH_IDS.find((id) => id.slice(id.indexOf('.') + 1) === name);
}

function fromLegacyMatch(
  match: z.infer<typeof LegacyMatchSchema>,
  note: (msg: string) => void,
): SkillActivation {
  const activation: SkillActivation = {};
  if (match.languages?.length) activation.languages = match.languages;
  if (match.files?.length) activation.files = match.files;
  if (match.content?.length) activation.content = match.content;
  if (match.dependencies?.length) {
    const techs = new Set<string>();
    const unmapped: string[] = [];
    for (const dep of match.dependencies) {
      const tech = legacyDependencyTech(dep);
      if (tech) techs.add(tech);
      else unmapped.push(dep);
    }
    if (unmapped.length) note(`legacy match.dependencies without a tech id ignored: ${unmapped.join(', ')}`);
    if (techs.size) activation.stack = [...techs].sort();
  }
  return activation;
}
