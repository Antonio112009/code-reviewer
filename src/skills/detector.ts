import { satisfies } from '../util/versions';
import { type CompiledActivation, compiledActivation, compiledFor, type SkillActivation } from './activation';
import { hasActivation, SKILL_CATEGORIES, type Skill, type SkillGroup } from './loader';
import { boundForUntrusted } from './regex-guard';

/** What a chunk (or the whole repository, for `skills detect`) looks like to the skill detector. */
export interface SkillContext {
  /** Repository-relative posix paths. */
  files: string[];
  /** Language ids of `files` (`src/util/language.ts`). */
  languages: string[];
  /**
   * Tech ids (`src/context/stack/techs.ts`) that apply to the chunk's files. `undefined` means the stack
   * is unknown (detection unavailable): a `stack` gate then passes only together with a signal hit.
   */
  techs?: Set<string>;
  /** Detected versions of techs (`framework.nextjs` → `15.1.0`); techs without a version pass version gates. */
  techVersions?: ReadonlyMap<string, string>;
  /** Code of the chunk. */
  code: string;
  /** Added lines only (diff mode). When set, skill `content` regexes run on it instead of `code`. */
  addedCode?: string;
  /** Full content of the chunk's files: group `detect.content` runs on it ("is this a React file?"). */
  fileCode?: string;
  /**
   * The chunk's files one by one. When set, a skill matches the chunk if it matches one of its files on
   * that file's own language, code and added lines (the stack stays the chunk's), so Java lines cannot
   * trigger a C++ skill in a mixed chunk and a Markdown table cannot trigger a crypto skill.
   */
  perFile?: FileSignals[];
}

/** One file of a chunk, for per-file skill matching. */
export interface FileSignals {
  path: string;
  /** Language id (`src/util/language.ts`). */
  language: string;
  /** What skill `content` regexes see: the file's added lines (diff mode), else its code. */
  code: string;
  /** The file's full content: what a group's `detect.content` sees. */
  fileCode: string;
}

export interface SkillMatch {
  skill: Skill;
  score: number;
  /** Why it was selected: `language:ts`, `stack:framework.react`, `file:src/App.tsx`, `content:/re/`, `always-on`, `explicit`, `extends:<id>`. */
  reasons: string[];
}

/** Longest text content signals look at (a chunk renders far less; this bounds crafted inputs). */
const MAX_SIGNAL_TEXT = 512 * 1024;

/**
 * The text skill `content` regexes run on: whitespace-only lines removed and length capped. Patterns
 * like `^\s*require\b` (multiline) restart at every line start, so a long run of blank lines — easy to
 * put in a change — makes them quadratic; without such lines each start only scans one indentation.
 */
export function signalText(text: string): string {
  const collapsed = text.replace(/\n[ \t\r\f\v]*(?=\n)/g, '');
  return collapsed.length > MAX_SIGNAL_TEXT ? collapsed.slice(0, MAX_SIGNAL_TEXT) : collapsed;
}

/** `auto` (detector), `none`, or an explicit list of skill ids. */
export type SkillSelection = 'auto' | 'none' | string[];

/** Specificity weights added to a skill's priority: content > files > stack > language. */
const WEIGHT = { content: 40, files: 30, stack: 20, language: 10, depth: 3 } as const;
/** Prose: content signals never fire on it unless a skill is about that language. */
const PROSE_LANGUAGES = new Set(['markdown', 'text']);
/** Always-on skills are filled into the budget first. */
const ALWAYS_ON_BONUS = 1_000;

interface GateResult {
  reasons: string[];
  score: number;
  /** A stack gate is declared but the chunk's stack is unknown. */
  stackUnknown: boolean;
}

function checkGates(a: SkillActivation, ctx: SkillContext): GateResult | undefined {
  const out: GateResult = { reasons: [], score: 0, stackUnknown: false };
  if (a.languages?.length) {
    const hit = ctx.languages.find((l) => a.languages!.includes(l));
    if (hit === undefined) return undefined;
    out.reasons.push(`language:${hit}`);
    out.score += WEIGHT.language;
  }
  if (a.stack?.length) {
    if (ctx.techs) {
      const techs = ctx.techs;
      const hit = a.stack.find((t) => techs.has(t));
      if (hit === undefined) return undefined;
      out.reasons.push(`stack:${hit}`);
      out.score += WEIGHT.stack;
    } else {
      out.stackUnknown = true;
    }
  }
  for (const [tech, range] of Object.entries(a.versions ?? {})) {
    const version = ctx.techVersions?.get(tech);
    if (version === undefined) continue; // unknown version: cannot exclude
    if (!satisfiesSafe(version, range)) return undefined;
    out.reasons.push(`version:${tech}@${version}`);
  }
  return out;
}

function satisfiesSafe(version: string, range: string): boolean {
  try {
    return satisfies(version, range);
  } catch {
    return false;
  }
}

interface SignalResult {
  declared: boolean;
  hit: boolean;
  score: number;
}

function checkSignals(
  compiled: CompiledActivation,
  ctx: SkillContext,
  rawText: string,
  reasons: string[],
  prefix = '',
  untrusted = false,
): SignalResult {
  // Regexes from the reviewed repository only ever see bounded text (no huge lines).
  const text = untrusted ? boundForUntrusted(rawText) : rawText;
  const out: SignalResult = {
    declared: Boolean(compiled.files) || compiled.content.length > 0,
    hit: false,
    score: 0,
  };
  if (compiled.files) {
    const hit = ctx.files.find((f) => compiled.files!(f));
    if (hit !== undefined) {
      out.hit = true;
      reasons.push(`${prefix}file:${hit}`);
      out.score += WEIGHT.files;
    }
  }
  if (compiled.content.length && text) {
    const hit = compiled.content.find((re) => re.test(text));
    if (hit) {
      out.hit = true;
      reasons.push(`${prefix}content:/${hit.source}/`);
      out.score += WEIGHT.content;
    }
  }
  return out;
}

/** True when every gate (`stack`, `languages`, `versions`) the skill declares passes for `ctx`. */
export function passesGates(skill: Skill, ctx: SkillContext): boolean {
  return checkGates(skill.activation, ctx) !== undefined;
}

/**
 * True when the gates of every ancestor group and of the skill itself pass, ignoring file/content
 * signals — used repo-wide (`skills detect`), where content cannot be evaluated.
 */
export function gatesPass(skill: Skill, ctx: SkillContext): boolean {
  for (const g of skill.groups) if (g.detect && !checkGates(g.detect, ctx)) return false;
  return checkGates(skill.activation, ctx) !== undefined;
}

/** True when the folder group's detection matches the chunk (gates + at least one signal if declared). */
export function groupMatches(group: SkillGroup, ctx: SkillContext, reasons: string[] = []): boolean {
  const detect = group.detect;
  if (!detect) return true;
  const gates = checkGates(detect, ctx);
  if (!gates) return false;
  const signals = checkSignals(
    compiledFor(group, detect),
    ctx,
    ctx.fileCode ?? ctx.code,
    [],
    '',
    group.source === 'project',
  );
  if (signals.declared && !signals.hit) return false;
  if (gates.stackUnknown && !signals.hit) return false;
  reasons.push(`group:${group.path}`);
  return true;
}

/**
 * Scores one skill against a chunk, or returns `undefined` when it does not apply.
 * - Every ancestor folder group's `detect` must match (the technology is present in the chunk).
 * - Gates (`stack`, `languages`, `versions`): every declared gate must pass (always-on skills included).
 * - Signals (`files`, `content` on the added code): if any is declared, at least one must hit — unless
 *   the skill is always on.
 * - Score: priority + specificity of what matched + depth in the tree (more specific skills first).
 * Project skills without any gate or signal (own or inherited) never auto-activate.
 */
export function matchSkill(skill: Skill, ctx: SkillContext): SkillMatch | undefined {
  if (!ctx.perFile?.length) return matchIn(skill, ctx);
  let best: SkillMatch | undefined;
  for (const f of ctx.perFile) {
    const prose = PROSE_LANGUAGES.has(f.language) && !declaresLanguage(skill, f.language);
    const m = matchIn(skill, {
      ...ctx,
      files: [f.path],
      languages: [f.language],
      code: prose ? '' : f.code,
      addedCode: prose ? '' : f.code,
      fileCode: prose ? '' : f.fileCode,
      perFile: undefined,
    });
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

/** Whether the skill or one of its groups gates on `language`. */
function declaresLanguage(skill: Skill, language: string): boolean {
  if (skill.activation.languages?.includes(language)) return true;
  return skill.groups.some((g) => g.detect?.languages?.includes(language));
}

function matchIn(skill: Skill, ctx: SkillContext): SkillMatch | undefined {
  const reasons: string[] = [];
  for (const group of skill.groups) if (!groupMatches(group, ctx, reasons)) return undefined;
  const gates = checkGates(skill.activation, ctx);
  if (!gates) return undefined;
  reasons.push(...gates.reasons);
  let score = skill.priority + gates.score + skill.groups.length * WEIGHT.depth;
  const signals = checkSignals(
    compiledActivation(skill),
    ctx,
    ctx.addedCode ?? ctx.code,
    reasons,
    '',
    skill.source === 'project',
  );
  score += signals.score;

  if (skill.alwaysOn) {
    reasons.push('always-on');
    score += ALWAYS_ON_BONUS;
  } else {
    if (signals.declared && !signals.hit) return undefined;
    if (gates.stackUnknown && !signals.hit) return undefined;
    const inherited = skill.groups.some((g) => g.detect && hasActivation(g.detect));
    if (skill.source === 'project' && !hasActivation(skill.activation) && !inherited) return undefined;
  }
  return { skill, score, reasons };
}

/**
 * Repository-wide: every ancestor group's gates pass and its file signals match some repository file.
 * Content signals cannot be evaluated repo-wide and count as "maybe" (a group with content signals passes).
 */
export function groupsMatchRepo(skill: Skill, ctx: SkillContext): boolean {
  for (const group of skill.groups) {
    const detect = group.detect;
    if (!detect) continue;
    const gates = checkGates(detect, ctx);
    if (!gates) return false;
    const compiled = compiledFor(group, detect);
    const fileHit = compiled.files ? ctx.files.some((f) => compiled.files!(f)) : false;
    const contentUnknown = compiled.content.length > 0;
    if (compiled.files && !fileHit && !contentUnknown) return false;
    if (gates.stackUnknown && !fileHit) return false;
  }
  return true;
}

/** Repository-wide status of a skill (`skills detect`, `init`). */
export type RepoSkillStatus = 'always-on' | 'active' | 'on-match' | 'excluded' | 'inactive';

export interface RepoSkillRow {
  skill: Skill;
  status: RepoSkillStatus;
  reasons: string[];
}

/**
 * Classifies skills for a whole repository (`ctx.files` = every file, `ctx.code` empty):
 * - `active` — applies to every chunk of a technology the repository uses (no own signals, or a file
 *   signal matches a repository file);
 * - `on-match` — the technology is present, but the skill activates only for chunks whose changed code
 *   matches its content patterns;
 * - `inactive` — the technology (or a gate: language, stack, version) is absent.
 */
export function classifySkills(
  skills: Skill[],
  ctx: SkillContext,
  excluded: ReadonlySet<string>,
): RepoSkillRow[] {
  return [...skills].sort(compareSkills).map((skill): RepoSkillRow => {
    if (excluded.has(skill.id)) return { skill, status: 'excluded', reasons: [] };
    const match = matchSkill(skill, ctx);
    if (match) {
      const reasons = match.reasons.filter((r) => r !== 'always-on');
      return { skill, status: skill.alwaysOn ? 'always-on' : 'active', reasons };
    }
    if (gatesPass(skill, ctx) && groupsMatchRepo(skill, ctx))
      return { skill, status: 'on-match', reasons: [] };
    return { skill, status: 'inactive', reasons: [] };
  });
}

/** The technology a skill belongs to: its deepest ancestor group that declares detection (else the deepest group). */
export function technologyGroup(skill: Skill): SkillGroup | undefined {
  for (let i = skill.groups.length - 1; i >= 0; i--) if (skill.groups[i]!.detect) return skill.groups[i];
  return skill.groups.at(-1);
}

/**
 * The skills a review depth uses: `full` → all of them; `essential` → essential-tier skills only, with
 * their `[full]` bullets left out (`body`/`tokens` of the returned copies are the essential ones).
 */
export function skillsForDepth(skills: Skill[], depth: 'essential' | 'full'): Skill[] {
  if (depth === 'full') return skills;
  const out: Skill[] = [];
  for (const skill of skills) {
    if (skill.tier !== 'essential' || !skill.essentialBody) continue;
    out.push(
      skill.essentialBody === skill.body
        ? skill
        : { ...skill, body: skill.essentialBody, tokens: skill.essentialTokens },
    );
  }
  return out;
}

const CATEGORY_RANK = new Map<string, number>(SKILL_CATEGORIES.map((c, i) => [c, i]));

/** Prompt order: category (practice, security, language, web, database, framework, infra), then id. */
export function compareSkills(a: Skill, b: Skill): number {
  const ca = CATEGORY_RANK.get(a.category) ?? SKILL_CATEGORIES.length;
  const cb = CATEGORY_RANK.get(b.category) ?? SKILL_CATEGORIES.length;
  if (ca !== cb) return ca - cb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Picks the skills for one chunk within `budget` tokens:
 * 1. candidates — `auto`: every matching skill; explicit list: those ids; `none`: nothing;
 * 2. greedy fill by score (ties: id), skipping skills that do not fit;
 * 3. `extends` closure: parents of picked skills are added while the budget allows (`extends:<id>`).
 * Skills in `exclude` are never picked. The result is in a deterministic, cache-friendly order
 * (see {@link compareSkills}), independent of scores.
 */
export function selectSkills(
  skills: Skill[],
  ctx: SkillContext,
  selection: SkillSelection,
  budget: number,
  exclude: string[] = [],
): SkillMatch[] {
  if (selection === 'none') return [];
  const excluded = new Set(exclude);
  const byId = new Map<string, Skill>();
  for (const s of skills) if (!excluded.has(s.id) && !byId.has(s.id)) byId.set(s.id, s);

  let candidates: SkillMatch[];
  if (Array.isArray(selection)) {
    candidates = [...new Set(selection)]
      .map((id) => byId.get(id))
      .filter((s): s is Skill => s !== undefined)
      .map((s) => ({ skill: s, score: s.priority, reasons: ['explicit'] }));
  } else {
    candidates = [...byId.values()]
      .map((s) => matchSkill(s, ctx))
      .filter((m): m is SkillMatch => m !== undefined);
  }
  candidates.sort((a, b) => b.score - a.score || (a.skill.id < b.skill.id ? -1 : 1));

  const picked = new Map<string, SkillMatch>();
  let used = 0;
  for (const c of candidates) {
    if (used + c.skill.tokens > budget) continue;
    picked.set(c.skill.id, c);
    used += c.skill.tokens;
  }

  const queue = [...picked.values()];
  for (let i = 0; i < queue.length; i++) {
    const child = queue[i]!;
    for (const parentId of child.skill.extends) {
      const parent = byId.get(parentId);
      if (!parent || picked.has(parentId) || used + parent.tokens > budget) continue;
      const match: SkillMatch = {
        skill: parent,
        score: parent.priority,
        reasons: [`extends:${child.skill.id}`],
      };
      picked.set(parentId, match);
      used += parent.tokens;
      queue.push(match);
    }
  }

  return [...picked.values()].sort((a, b) => compareSkills(a.skill, b.skill));
}
