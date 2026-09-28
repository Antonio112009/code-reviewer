import { existsSync } from 'node:fs';
import { appendFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import * as p from '@clack/prompts';
import type { Command } from 'commander';
import pc from 'picocolors';
import { parse as parseToml } from 'smol-toml';
import { detectAnalyzers } from '../../analyzers';
import { GLOBAL_CONFIG_FILES, loadConfig, PROJECT_CONFIG_FILES } from '../../config/load';
import {
  type Config,
  DEFAULT_CONFIG,
  type PartialConfig,
  REPORT_FORMATS,
  type ReportFormat,
  type ReviewDepth,
} from '../../config/schema';
import { type ConfigScope, renderConfigTemplate, validateRenderedConfig } from '../../config/template';
import { detectStack, isTechId, techCategory, techName } from '../../context/stack';
import { GitRepo } from '../../git/repo';
import { detectProviders, type ProviderStatus, providerNeedsModel } from '../../providers/detect';
import { techVersionsForChunk } from '../../review/planning';
import { classifySkills, type RepoSkillRow, technologyGroup } from '../../skills/detector';
import { loadSkills, type Skill } from '../../skills/loader';
import { REASONING_LEVELS, type ReasoningLevel, type StackProfile } from '../../types';
import { detectLanguage } from '../../util/language';
import { Logger } from '../../util/logger';
import { globalConfigDir, PROJECT_DIR, resolveInside, toPosix } from '../../util/paths';
import { EXIT, type GlobalOptions, makeLogger } from '../context';

/** Exit code when the wizard is cancelled with Ctrl+C / Esc (128 + SIGINT). */
const EXIT_CANCELLED = EXIT.interrupted;
const PROJECT_TARGET = `${PROJECT_DIR}/config.yaml`;
const STACK_TIMEOUT_MS = 15_000;
const ANALYZER_TIMEOUT_MS = 4_000;
const MAX_MANIFEST_BYTES = 1_000_000;
const CUSTOM_BRANCH = '\0custom';

/** Focus areas offered by the wizard (stored verbatim in `project.focus`). */
export const FOCUS_AREAS = [
  { value: 'security', hint: 'injection, access control, secrets, unsafe deserialization' },
  { value: 'correctness', hint: 'logic errors, edge cases, error handling' },
  { value: 'performance', hint: 'N+1 queries, quadratic loops, blocking I/O' },
  { value: 'concurrency', hint: 'races, deadlocks, missing awaits' },
  { value: 'data integrity', hint: 'transactions, migrations, lost updates' },
  { value: 'API contracts', hint: 'breaking changes, validation, status codes' },
  { value: 'tests', hint: 'tests that cannot fail, changed logic without tests' },
] as const;

const DEFAULT_FOCUS = ['security', 'correctness'];
const CONFIDENCE_CHOICES = [
  { value: 0.5, hint: 'more findings, more noise' },
  { value: 0.6, hint: '' },
  { value: 0.7, hint: 'balanced, the default' },
  { value: 0.8, hint: 'only findings the reviewer is sure about' },
];
const PROVIDER_PREFERENCE = ['claude', 'codex', 'copilot', 'gemini', 'anthropic', 'bedrock'];
const BASE_CANDIDATES = ['main', 'master', 'develop'];
/** Languages not worth listing as "the stack" (they still gate skills). */
/** Width of values in the detection note (the box is ~80 columns). */
const LINE_WIDTH = 60;
const DATA_LANGUAGES = new Set(['json', 'yaml', 'toml', 'markdown', 'text']);

export interface RoleChoice {
  provider: string;
  /** Empty / undefined = the provider's default model. */
  model?: string;
  reasoning: ReasoningLevel;
}

/** Everything the wizard asks. `--yes` accepts the detected defaults. */
export interface InitChoices {
  name: string;
  /** Empty = none. */
  description: string;
  focus: string[];
  /** Empty = none. */
  instructions: string;
  ignore: string[];
  /** `auto` or a branch name. */
  base: string;
  review: RoleChoice;
  /** `same` = the review model with high reasoning, `off` = no self-critique, or an explicit role. */
  critique: 'same' | 'off' | RoleChoice;
  /** `essential` (serious production issues, fewer tokens) or `full` (every real defect). */
  depth: ReviewDepth;
  minConfidence: number;
  analyzersBuiltin: boolean;
  analyzersExternal: 'auto' | 'off';
  formats: ReportFormat[];
  /** Written as `providers.bedrock` when a role uses Bedrock. */
  bedrock?: { region?: string; profile?: string };
}

/** Pre-supplied answers: the wizard skips these questions (tests, scripted setups). */
export type InitAnswers = Partial<InitChoices> & {
  /** Add the runs directory to .gitignore (default: yes). */
  gitignore?: boolean;
};

export interface InitOptions {
  cwd: string;
  /** Accept detected defaults without prompting. */
  yes?: boolean;
  /** Write the global config (`$CODE_REVIEWER_HOME` or ~/.code-reviewer) instead of the project one. */
  global?: boolean;
  /** Overwrite an existing config file. */
  force?: boolean;
  answers?: InitAnswers;
  /** Run the wizard. Default: stdin and stdout are terminals and `yes` is not set. */
  interactive?: boolean;
  logger?: Logger;
  /** Streams for the wizard (tests); default: process.stdin / process.stdout. */
  io?: PromptIo;
}

export interface PromptIo {
  input?: Readable;
  output?: Writable;
}

export interface ProjectInfo {
  name: string;
  description?: string;
  /** Manifest the name came from (`package.json`, …), undefined = folder name. */
  source?: string;
}

export interface SkillGroup {
  /** `always on` or the technology name of a skills folder (`React`, `PostgreSQL`, …). */
  group: string;
  skills: string[];
}

export interface InitDetection {
  root: string;
  gitRepo: boolean;
  project: ProjectInfo;
  stack?: StackProfile;
  /** Why stack detection is unavailable. */
  stackError?: string;
  /** Tech ids that apply repository-wide. */
  techs: string[];
  /** Language ids, most files first. */
  languages: string[];
  /** Skills whose stack/language gates pass for this repository, grouped for display. */
  skillGroups: SkillGroup[];
  providers: ProviderStatus[];
  currentBranch?: string;
  /** `GitRepo.defaultBaseBranch()` (e.g. `origin/main`). */
  defaultBase?: string;
  /** Which of main / master / develop exist (locally or on origin). */
  branches: string[];
}

export interface InitResult {
  /** `exists`: refused to overwrite; `declined`: the user kept the existing file; `cancelled`: Ctrl+C / Esc. */
  status: 'written' | 'exists' | 'declined' | 'cancelled';
  scope: ConfigScope;
  /** The config file written, or the existing one. */
  file: string;
  config?: PartialConfig;
  /** The YAML written. */
  text?: string;
  gitignoreUpdated: boolean;
  detection?: InitDetection;
  message?: string;
  warnings: string[];
}

/** Invalid options or an unsafe target (not used for "file exists", which is a normal result). */
export class InitError extends Error {}

class InitCancelled extends Error {}

/**
 * Programmatic `code-reviewer init`: detects the project, asks the wizard questions (or takes defaults /
 * `answers`), and writes a commented YAML config that `loadConfig` accepts.
 */
export async function runInit(opts: InitOptions): Promise<InitResult> {
  const logger = opts.logger ?? new Logger('info');
  const scope: ConfigScope = opts.global ? 'global' : 'project';
  const interactive = !opts.yes && (opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!opts.yes && !interactive) {
    throw new InitError(
      '`init` asks a few questions and needs a terminal; pass --yes to accept the detected defaults.',
    );
  }
  const cwd = path.resolve(opts.cwd);
  if (!existsSync(cwd)) throw new InitError(`Directory not found: ${cwd}`);

  const repo = scope === 'project' ? await GitRepo.find(cwd) : undefined;
  const root = repo?.root ?? cwd;
  const target = scope === 'global' ? globalTarget() : projectTarget(root);
  const warnings: string[] = [...target.warnings];
  const base = { scope, file: target.file, gitignoreUpdated: false, warnings };

  const io: PromptIo = opts.io ?? {};
  const ui = interactive ? clackUi(io) : plainUi(logger);
  try {
    if (interactive)
      p.intro(pc.inverse(scope === 'global' ? ' code-reviewer init --global ' : ' code-reviewer init '), io);
    if (target.existing && !opts.force) {
      const rel = displayPath(target.existing, root, scope);
      if (!interactive) {
        return { ...base, status: 'exists', message: `${rel} already exists; pass --force to overwrite it.` };
      }
      const overwrite = unwrap(
        await p.confirm({ ...io, message: `${rel} already exists. Overwrite it?`, initialValue: false }),
      );
      if (!overwrite) {
        p.outro(`Kept ${rel}.`, io);
        return { ...base, status: 'declined', message: `Kept ${rel}.` };
      }
    }

    const current = await loadCurrentConfig(scope, root, repo, warnings);
    const detection = await detect({ scope, root, repo, current });
    ui.detected(detection, scope);

    const defaults = defaultChoices(detection, current, scope);
    const answers = opts.answers ?? {};
    const choices = interactive
      ? await askChoices(defaults, answers, detection, current, scope, io)
      : resolveChoices(defaults, answers);
    validateChoices(choices, current);

    const config = buildInitConfig(choices, scope, current);
    const text = renderConfigTemplate(config, { scope });
    validateRenderedConfig(text, scope, current);
    await writeConfigFile(target.file, text, scope === 'global' ? 0o600 : 0o644);

    let gitignoreUpdated = false;
    if (scope === 'project' && repo) {
      const entry = runsIgnoreEntry(current.output.dir);
      if (entry && !(await isIgnored(repo, entry))) {
        let add = answers.gitignore ?? !interactive;
        if (answers.gitignore === undefined && interactive) {
          const answer = await p.confirm({
            ...io,
            message: `Add ${entry} to .gitignore? (run reports contain code excerpts)`,
            initialValue: true,
          });
          add = answer === true; // the config is already written: Ctrl+C here only skips this step
        }
        if (add) gitignoreUpdated = await addToGitignore(root, entry, warnings);
      }
      const rel = toPosix(path.relative(root, target.file));
      if (await isIgnored(repo, rel)) {
        warnings.push(`${rel} is git-ignored, so teammates will not get it (git add -f ${rel} to share it).`);
      }
    }

    ui.written({
      file: displayPath(target.file, root, scope),
      choices,
      detection,
      scope,
      gitignoreUpdated,
      warnings,
    });
    return { ...base, status: 'written', config, text, gitignoreUpdated, detection };
  } catch (err) {
    if (err instanceof InitCancelled) {
      p.cancel('Setup cancelled; nothing was written.', io);
      return { ...base, status: 'cancelled', message: 'Cancelled.' };
    }
    throw err;
  }
}

/** Adds the `init` flags to a command (shared by `init` and `config init`). */
export function addInitOptions(cmd: Command): Command {
  return cmd
    .option('-y, --yes', 'accept the detected defaults without asking')
    .option('--global', 'write the global config (~/.code-reviewer/config.yaml or $CODE_REVIEWER_HOME)')
    .option('-f, --force', 'overwrite an existing config file');
}

/** Commander action for `init` / `config init`. */
export async function initCommandAction(
  opts: { yes?: boolean; global?: boolean; force?: boolean },
  cmd: Command,
): Promise<void> {
  const globals = cmd.optsWithGlobals<GlobalOptions>();
  const logger = makeLogger(globals);
  const result = await runInit({
    cwd: path.resolve(globals.cwd ?? process.cwd()),
    yes: opts.yes,
    global: opts.global,
    force: opts.force,
    logger,
  });
  if (result.status === 'exists') {
    logger.error(result.message ?? `${result.file} already exists.`);
    process.exitCode = EXIT.error;
  } else if (result.status === 'cancelled') {
    process.exitCode = EXIT_CANCELLED;
  }
}

/** `code-reviewer init` — interactive project setup that writes a commented YAML config. */
export function registerInitCommand(program: Command): void {
  addInitOptions(
    program
      .command('init')
      .description(
        'set up code-reviewer for this repository (writes a commented .code-reviewer/config.yaml)',
      ),
  ).action(initCommandAction);
}

// ---------------------------------------------------------------------------------------------------------
// Targets

interface Target {
  file: string;
  /** An existing config file that would be replaced (or shadowed). */
  existing?: string;
  warnings: string[];
}

/**
 * The project config to write: an existing YAML-capable config file keeps its name; otherwise
 * `.code-reviewer/config.yaml`. A JSON rc file that takes precedence must be removed first.
 */
function projectTarget(root: string): Target {
  const existingRel = PROJECT_CONFIG_FILES.find((f) => existsSync(path.join(root, f)));
  const preferredIdx = PROJECT_CONFIG_FILES.indexOf(PROJECT_TARGET);
  let rel = PROJECT_TARGET;
  const warnings: string[] = [];
  if (existingRel && !existingRel.endsWith('.json')) rel = existingRel;
  else if (existingRel && PROJECT_CONFIG_FILES.indexOf(existingRel) < preferredIdx) {
    throw new InitError(
      `${existingRel} takes precedence over ${PROJECT_TARGET}; remove or rename it, then run init again.`,
    );
  } else if (existingRel) {
    warnings.push(`${existingRel} will be ignored: ${PROJECT_TARGET} takes precedence over it.`);
  }
  let file: string;
  try {
    file = resolveInside(root, rel);
  } catch (err) {
    throw new InitError(`Refusing to write ${rel}: ${(err as Error).message}`);
  }
  return { file, existing: existingRel ? path.join(root, existingRel) : undefined, warnings };
}

function globalTarget(): Target {
  const dir = globalConfigDir();
  const existingName = GLOBAL_CONFIG_FILES.find((f) => existsSync(path.join(dir, f)));
  const name = existingName && !existingName.endsWith('.json') ? existingName : 'config.yaml';
  const warnings =
    existingName?.endsWith('.json') === true
      ? [`${path.join(dir, existingName)} will be ignored: config.yaml takes precedence over it.`]
      : [];
  return {
    file: path.join(dir, name),
    existing: existingName ? path.join(dir, existingName) : undefined,
    warnings,
  };
}

function displayPath(file: string, root: string, scope: ConfigScope): string {
  return scope === 'project' ? toPosix(path.relative(root, file)) : file;
}

/** Writes via a temporary file + rename, so an interrupted run never leaves a half-written config. */
async function writeConfigFile(file: string, text: string, mode: number): Promise<void> {
  const st = await lstat(file).catch(() => undefined);
  if (st && !st.isFile() && !st.isSymbolicLink()) throw new InitError(`${file} is not a regular file.`);
  await mkdir(path.dirname(file), { recursive: true, mode: mode === 0o600 ? 0o700 : 0o755 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, text, { mode, flag: 'wx' });
    await rename(tmp, file); // replaces a symlink itself, never writes through it
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------
// .gitignore

/** `.code-reviewer/runs/` for the configured runs dir; undefined when it is outside the repository. */
function runsIgnoreEntry(dir: string): string | undefined {
  const rel = toPosix(dir)
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  // output.dir may come from the checkout's config: only plain relative paths become a .gitignore line.
  if (!/^[\w.@+-]+(\/[\w.@+-]+)*$/.test(rel) || rel.split('/').includes('..')) return undefined;
  return `${rel}/`;
}

async function isIgnored(repo: GitRepo, rel: string): Promise<boolean> {
  return (await repo.tryRun(['check-ignore', '-q', '--', rel])).ok;
}

async function addToGitignore(root: string, entry: string, warnings: string[]): Promise<boolean> {
  let file: string;
  try {
    file = resolveInside(root, '.gitignore');
  } catch (err) {
    warnings.push(`Not updating .gitignore: ${(err as Error).message}`);
    return false;
  }
  const st = await lstat(file).catch(() => undefined);
  if (st && !st.isFile()) {
    warnings.push('Not updating .gitignore: it is not a regular file.');
    return false;
  }
  const content = st ? await readFile(file, 'utf8') : '';
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  const bare = entry.replace(/\/$/, '');
  if ([entry, bare, `/${entry}`, `/${bare}`].some((variant) => lines.includes(variant))) return false;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  await appendFile(file, `${content && !content.endsWith('\n') ? eol : ''}${entry}${eol}`);
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Detection

async function loadCurrentConfig(
  scope: ConfigScope,
  root: string,
  repo: GitRepo | undefined,
  warnings: string[],
): Promise<Config> {
  try {
    // For the global scope, search for a project config where there is none, so only defaults + global apply.
    const cwd = scope === 'global' ? globalConfigDir() : root;
    const { config } = await loadConfig({ cwd, stopDir: scope === 'global' ? cwd : (repo?.root ?? root) });
    return config;
  } catch (err) {
    warnings.push(`Ignoring the current configuration: ${(err as Error).message.split('\n')[0]}`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

async function detect(args: {
  scope: ConfigScope;
  root: string;
  repo?: GitRepo;
  current: Config;
}): Promise<InitDetection> {
  const { scope, root, repo, current } = args;
  const providers = detectProviders(current).filter((s) => s.type !== 'mock');
  const base: InitDetection = {
    root,
    gitRepo: repo !== undefined,
    project: { name: path.basename(root) },
    techs: [],
    languages: [],
    skillGroups: [],
    providers,
    branches: [],
  };
  if (scope === 'global') return base;

  const files = repo ? await repo.listFiles(['.']).catch(() => undefined) : undefined;
  const [project, stackResult, git, skills] = await Promise.all([
    detectProjectInfo(root),
    detectStackSafe(root, files),
    repo ? detectBranches(repo) : Promise.resolve({ branches: [] as string[] }),
    loadSkills(root).catch(() => [] as Skill[]),
  ]);
  const techs = stackResult.profile ? activeTechs(stackResult.profile) : [];
  const languages = stackResult.profile
    ? stackResult.profile.languages.map((l) => l.id).filter((id) => id !== 'text')
    : countLanguages(files ?? []);
  return {
    ...base,
    project,
    stack: stackResult.profile,
    stackError: stackResult.error,
    techs,
    languages,
    skillGroups: applicableSkillGroups(
      classifySkills(
        skills,
        {
          files: files ?? [],
          languages,
          techs: stackResult.profile ? new Set(techs) : undefined,
          techVersions: techVersionsForChunk(stackResult.profile, [], new Set(techs)),
          code: '',
        },
        new Set(current.review.skillsExclude),
      ),
    ),
    ...git,
  };
}

async function detectStackSafe(
  root: string,
  files: string[] | undefined,
): Promise<{ profile?: StackProfile; error?: string }> {
  const signal = AbortSignal.timeout(STACK_TIMEOUT_MS);
  try {
    const timeout = new Promise<never>((_, reject) =>
      signal.addEventListener('abort', () => reject(new Error('stack detection timed out')), { once: true }),
    );
    const profile = await Promise.race([detectStack({ root, files, signal }), timeout]);
    return { profile };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Tech ids at or above the activation threshold (as recorded per package root). */
function activeTechs(profile: StackProfile): string[] {
  const ids = new Set(profile.packages.flatMap((pkg) => pkg.techs));
  if (!ids.size) for (const t of profile.techs) if (t.score >= 0.5) ids.add(t.id);
  return [...ids].sort();
}

function countLanguages(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const lang = detectLanguage(f);
    if (lang !== 'text') counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

async function detectBranches(
  repo: GitRepo,
): Promise<{ branches: string[]; currentBranch?: string; defaultBase?: string }> {
  const [currentBranch, defaultBase, exists] = await Promise.all([
    repo.currentBranch().catch(() => undefined),
    repo.defaultBaseBranch().catch(() => undefined),
    Promise.all(
      BASE_CANDIDATES.map(
        async (b) =>
          (await repo.refExists(`refs/heads/${b}`)) || (await repo.refExists(`refs/remotes/origin/${b}`)),
      ),
    ),
  ]);
  return { branches: BASE_CANDIDATES.filter((_, i) => exists[i]), currentBranch, defaultBase };
}

/**
 * Project name and description from the first manifest that has a name (package.json, pyproject.toml,
 * Cargo.toml, composer.json, go.mod), else the folder name. Manifests are parsed as data only; symlinks
 * out of the repository and oversized files are ignored.
 */
export async function detectProjectInfo(root: string): Promise<ProjectInfo> {
  const readers: Array<[string, (text: string) => { name?: unknown; description?: unknown } | undefined]> = [
    ['package.json', (t) => JSON.parse(t)],
    [
      'pyproject.toml',
      (t) => {
        const doc = parseToml(t) as { project?: object; tool?: { poetry?: object } };
        return (doc.project ?? doc.tool?.poetry) as { name?: unknown; description?: unknown } | undefined;
      },
    ],
    ['Cargo.toml', (t) => (parseToml(t) as { package?: { name?: unknown; description?: unknown } }).package],
    ['composer.json', (t) => JSON.parse(t)],
    ['go.mod', (t) => ({ name: /^module\s+(\S+)/m.exec(t)?.[1]?.split('/').pop() })],
  ];
  for (const [file, read] of readers) {
    const text = await readManifest(root, file);
    if (text === undefined) continue;
    try {
      const meta = read(text);
      const name = cleanText(meta?.name, 100);
      if (!name) continue;
      const description = cleanText(meta?.description, 300);
      return { name, source: file, ...(description ? { description } : {}) };
    } catch {
      // malformed manifest: try the next one
    }
  }
  return { name: cleanText(path.basename(root), 100) || 'project' };
}

async function readManifest(root: string, rel: string): Promise<string | undefined> {
  try {
    const abs = resolveInside(root, rel);
    const st = await lstat(abs);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return undefined;
    return await readFile(abs, 'utf8');
  } catch {
    return undefined;
  }
}

/** Single-line, control-character-free, length-capped text (manifest strings are untrusted). */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Technologies the builtin skills cover for this repository, e.g. `React` → its skill ids. Skills are
 * grouped by the folder of their technology (`javascript/react`); always-on skills come first. Skills
 * that only trigger on code patterns of a technology the repository uses are included (they are decided
 * per chunk); cross-cutting skills without any detection (practice/, security/) are omitted.
 */
export function applicableSkillGroups(rows: readonly RepoSkillRow[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup & { path: string }>();
  for (const { skill, status } of rows) {
    if (status !== 'always-on' && status !== 'active' && status !== 'on-match') continue;
    const tech = status === 'always-on' ? undefined : technologyGroup(skill);
    if (status !== 'always-on' && !tech?.detect) continue;
    const key = tech ? tech.path : ' always on';
    const entry = groups.get(key) ?? { group: tech ? tech.name : 'always on', path: key, skills: [] };
    entry.skills.push(skill.id);
    groups.set(key, entry);
  }
  return [...groups.values()]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ group, skills }) => ({ group, skills: skills.sort() }));
}

// ---------------------------------------------------------------------------------------------------------
// Choices

function defaultChoices(det: InitDetection, current: Config, scope: ConfigScope): InitChoices {
  const reviewRole = current.roles.review;
  const provider = pickDefaultProvider(det.providers, current);
  const sameProvider = reviewRole?.provider === provider;
  const critiqueRole = current.roles.critique;
  const project: Config['project'] = scope === 'project' ? current.project : {};
  return {
    name: project.name ?? det.project.name,
    description: project.description ?? det.project.description ?? '',
    focus: project.focus ?? DEFAULT_FOCUS,
    instructions: project.instructions ?? '',
    ignore: project.ignore ?? [],
    base: current.git.base.default,
    review: {
      provider,
      model: sameProvider ? reviewRole?.model : undefined,
      reasoning: reviewRole?.reasoning ?? 'medium',
    },
    critique: !current.review.selfCritique
      ? 'off'
      : critiqueRole
        ? {
            provider: critiqueRole.provider,
            model: critiqueRole.model,
            reasoning: critiqueRole.reasoning ?? 'high',
          }
        : 'same',
    depth: current.review.depth,
    minConfidence: current.review.minConfidence,
    analyzersBuiltin: current.analyzers.builtin,
    analyzersExternal: current.analyzers.external,
    formats: current.output.formats,
  };
}

/**
 * The configured review provider when it is available here, else the first available one (stable agents
 * before experimental ones; Bedrock and OpenAI-compatible APIs only when a model is known, since they have no
 * default model).
 */
function pickDefaultProvider(statuses: ProviderStatus[], current: Config): string {
  const configured = current.roles.review?.provider;
  const available = statuses.filter((s) => s.available);
  if (configured && available.some((s) => s.id === configured)) return configured;
  const usable = available.filter((s) => modelKnown(current, s.id));
  const rank = (id: string) => {
    const i = PROVIDER_PREFERENCE.indexOf(id);
    return i < 0 ? PROVIDER_PREFERENCE.length : i;
  };
  usable.sort(
    (a, b) =>
      Number(a.experimental) - Number(b.experimental) || rank(a.id) - rank(b.id) || a.id.localeCompare(b.id),
  );
  return usable[0]?.id ?? configured ?? 'claude';
}

function modelKnown(current: Config, id: string): boolean {
  return !providerNeedsModel(current.providers[id]) || Boolean(current.roles.review?.model);
}

function resolveChoices(defaults: InitChoices, answers: InitAnswers): InitChoices {
  const { gitignore: _gitignore, ...given } = answers;
  const merged: InitChoices = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function validateChoices(c: InitChoices, current: Config): void {
  if (!c.name.trim()) throw new InitError('Project name must not be empty.');
  if (c.base !== 'auto' && !isValidBranchName(c.base))
    throw new InitError(`Invalid base branch name: ${c.base}`);
  if (!Number.isFinite(c.minConfidence) || c.minConfidence < 0 || c.minConfidence > 1) {
    throw new InitError(`minConfidence must be between 0 and 1 (got ${c.minConfidence}).`);
  }
  const bad = c.formats.filter((f) => !(REPORT_FORMATS as readonly string[]).includes(f));
  if (bad.length) throw new InitError(`Unknown report format(s): ${bad.join(', ')}`);
  const roles: Array<[string, RoleChoice]> = [['review', c.review]];
  if (typeof c.critique === 'object') roles.push(['critique', c.critique]);
  for (const [role, rc] of roles) {
    if (!current.providers[rc.provider]) {
      throw new InitError(
        `Unknown provider "${rc.provider}" for the ${role} role. Known: ${Object.keys(current.providers).join(', ')}`,
      );
    }
    if (!(REASONING_LEVELS as readonly string[]).includes(rc.reasoning)) {
      throw new InitError(`Invalid reasoning level "${rc.reasoning}" for the ${role} role.`);
    }
  }
}

/** Conservative subset of `git check-ref-format --branch` (also rules out option-like names). */
export function isValidBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.split('/').some((part) => part.startsWith('.'))
  );
}

/** The config `init` writes for these choices (only what the user decided; everything else stays default). */
export function buildInitConfig(
  c: InitChoices,
  scope: ConfigScope,
  current: Config = DEFAULT_CONFIG,
): PartialConfig {
  const role = (r: RoleChoice) => ({
    provider: r.provider,
    ...(r.model?.trim() ? { model: r.model.trim() } : {}),
    reasoning: r.reasoning,
  });
  const out: PartialConfig = {};
  if (scope === 'project') {
    const description = c.description.trim();
    const instructions = c.instructions.trim();
    const ignore = [...new Set(c.ignore.map((g) => g.trim()).filter(Boolean))];
    out.project = {
      name: c.name.trim(),
      ...(description ? { description } : {}),
      ...(c.focus.length ? { focus: [...c.focus] } : {}),
      ...(instructions ? { instructions } : {}),
      ...(ignore.length ? { ignore } : {}),
    };
  }
  const usesBedrock = [c.review, typeof c.critique === 'object' ? c.critique : undefined].some(
    (r) => r && current.providers[r.provider]?.type === 'bedrock',
  );
  const region = c.bedrock?.region?.trim();
  const profile = c.bedrock?.profile?.trim();
  if (usesBedrock && (region || profile)) {
    out.providers = {
      bedrock: { type: 'bedrock', ...(region ? { region } : {}), ...(profile ? { profile } : {}) },
    };
  }
  out.roles = { review: role(c.review) };
  if (typeof c.critique === 'object') out.roles.critique = role(c.critique);
  // `same` normally means "no critique role"; pin it only when another layer (global config) sets a critic.
  else if (c.critique === 'same' && current.roles.critique)
    out.roles.critique = { ...role(c.review), reasoning: 'high' };
  out.review = { depth: c.depth, selfCritique: c.critique !== 'off', minConfidence: c.minConfidence };
  if (scope === 'project' || c.base !== 'auto') out.git = { base: { default: c.base } };
  out.analyzers = { builtin: c.analyzersBuiltin, external: c.analyzersExternal };
  out.output = { formats: [...c.formats] };
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Wizard

/** The prompt's value, or throws `InitCancelled` on Ctrl+C / Esc. */
function unwrap<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) throw new InitCancelled();
  return value as Exclude<T, symbol>;
}

async function askChoices(
  d: InitChoices,
  answers: InitAnswers,
  det: InitDetection,
  current: Config,
  scope: ConfigScope,
  io: PromptIo,
): Promise<InitChoices> {
  const c: InitChoices = resolveChoices(d, answers);
  const has = (key: keyof InitChoices) => answers[key] !== undefined;

  if (scope === 'project') {
    if (!has('name')) {
      c.name = unwrap(
        await p.text({
          ...io,
          message: 'Project name',
          initialValue: d.name,
          validate: (v) => (v?.trim() ? undefined : 'Required'),
        }),
      ).trim();
    }
    if (!has('description')) {
      c.description = unwrap(
        await p.text({
          ...io,
          message: 'What does the project do? Reviewers get this as context (optional)',
          placeholder: 'e.g. Payments API on PostgreSQL; refunds and ledger code are critical',
          initialValue: d.description,
        }),
      ).trim();
    }
    if (!has('focus')) {
      const known = new Set<string>(FOCUS_AREAS.map((f) => f.value));
      const custom = d.focus.filter((f) => !known.has(f));
      c.focus = unwrap(
        await p.multiselect<string>({
          ...io,
          message: 'Focus areas (space to toggle)',
          options: [
            ...FOCUS_AREAS.map((f) => ({ value: f.value as string, label: f.value, hint: f.hint })),
            ...custom.map((f) => ({ value: f, label: f, hint: 'from the current config' })),
          ],
          initialValues: d.focus,
          required: false,
        }),
      );
      const order = [...FOCUS_AREAS.map((f) => f.value as string), ...custom];
      c.focus.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    if (!has('instructions')) {
      c.instructions = unwrap(
        await p.multiline({
          ...io,
          message: 'Extra instructions for reviewers (optional; press Enter twice to finish)',
          placeholder: 'e.g. Amounts are integer cents; never use floats for money.',
          initialValue: d.instructions,
        }),
      ).trim();
    }
    if (!has('ignore')) {
      const raw = unwrap(
        await p.text({
          ...io,
          message: 'Extra paths never to review (globs, comma-separated, optional)',
          placeholder: 'e.g. **/fixtures/**, legacy/**',
          initialValue: d.ignore.join(', '),
        }),
      );
      c.ignore = splitList(raw);
    }
    if (!has('base')) c.base = await askBase(d.base, det, io);
  }

  if (!has('review')) c.review = await askRole('review', d.review, det.providers, current, io);
  if (!has('critique')) {
    const initial = typeof d.critique === 'object' ? 'other' : d.critique;
    const mode = unwrap(
      await p.select({
        ...io,
        message: 'Self-critique (a second pass that drops false positives)',
        options: [
          {
            value: 'same',
            label: 'Same provider, its critique model (Claude: Opus), high reasoning',
            hint: 'recommended',
          },
          { value: 'other', label: 'A different provider or model' },
          { value: 'off', label: 'Off', hint: 'faster, noisier' },
        ],
        initialValue: initial,
      }),
    );
    c.critique =
      mode === 'other'
        ? await askRole(
            'critique',
            typeof d.critique === 'object' ? d.critique : { ...c.review, reasoning: 'high' },
            det.providers,
            current,
            io,
          )
        : (mode as 'same' | 'off');
  }
  if (!has('depth')) {
    c.depth = unwrap(
      await p.select({
        ...io,
        message: 'Review depth',
        options: [
          {
            value: 'essential' as const,
            label: 'Essential',
            hint: 'security, data loss, crashes, leaks/OOM, overload, costly performance — fewer tokens',
          },
          {
            value: 'full' as const,
            label: 'Full',
            hint: 'every real defect, incl. edge cases, accessibility, best practices',
          },
        ],
        initialValue: d.depth,
      }),
    );
  }
  if (!has('minConfidence')) {
    const options = CONFIDENCE_CHOICES.map((o) => ({ value: o.value, label: String(o.value), hint: o.hint }));
    if (!options.some((o) => o.value === d.minConfidence)) {
      options.unshift({ value: d.minConfidence, label: String(d.minConfidence), hint: 'current' });
    }
    c.minConfidence = unwrap(
      await p.select({
        ...io,
        message: 'Report findings with confidence of at least',
        options,
        initialValue: d.minConfidence,
      }),
    );
  }
  if (!has('analyzersBuiltin')) {
    c.analyzersBuiltin = unwrap(
      await p.confirm({
        ...io,
        message: 'Enable the built-in analyzers (secret scanning, bug patterns)?',
        initialValue: d.analyzersBuiltin,
      }),
    );
  }
  if (!has('analyzersExternal')) {
    const found = await availableExternalAnalyzers(current);
    c.analyzersExternal = unwrap(
      await p.select<'auto' | 'off'>({
        ...io,
        message: 'External analyzers found on PATH (safe mode, no repository code is run)',
        options: [
          {
            value: 'auto',
            label: 'auto',
            hint: found.length ? `found: ${found.join(', ')}` : 'use them when installed',
          },
          { value: 'off', label: 'off' },
        ],
        initialValue: d.analyzersExternal,
      }),
    );
  }
  if (!has('formats')) {
    const hints: Record<ReportFormat, string> = {
      md: 'Markdown, e.g. for PR comments',
      json: 'machine-readable',
      html: 'interactive report',
      sarif: 'GitHub code scanning / SARIF viewers',
      codequality: 'GitLab Code Quality',
    };
    c.formats = unwrap(
      await p.multiselect<ReportFormat>({
        ...io,
        message: 'Report formats',
        options: REPORT_FORMATS.map((f) => ({ value: f, label: f, hint: hints[f] })),
        initialValues: d.formats,
        required: true,
      }),
    );
  }
  const bedrockRoles = [c.review, typeof c.critique === 'object' ? c.critique : undefined].filter(
    (r) => r && current.providers[r.provider]?.type === 'bedrock',
  );
  if (bedrockRoles.length && !has('bedrock')) {
    const cfg = current.providers.bedrock;
    const currentRegion = cfg?.type === 'bedrock' ? cfg.region : undefined;
    const region = unwrap(
      await p.text({
        ...io,
        message: 'AWS region for Bedrock',
        initialValue:
          currentRegion ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
        validate: (v) => (/^[a-z]{2}(-[a-z]+)+-\d+$/.test(v?.trim() ?? '') ? undefined : 'e.g. us-east-1'),
      }),
    ).trim();
    // An AWS profile is personal, so it is only asked for the global config.
    const profile =
      scope === 'global'
        ? unwrap(
            await p.text({
              ...io,
              message: 'AWS profile (empty = default credential chain)',
              placeholder: 'default',
            }),
          ).trim()
        : '';
    c.bedrock = { region, ...(profile ? { profile } : {}) };
  }
  return c;
}

async function askBase(initial: string, det: InitDetection, io: PromptIo): Promise<string> {
  const detected = det.defaultBase ? `default branch: ${det.defaultBase}` : 'default branch';
  const options: Array<{ value: string; label: string; hint?: string }> = [
    { value: 'auto', label: 'auto', hint: `CI variables, open PR/MR, branch rules, then ${detected}` },
    ...det.branches.map((b) => ({ value: b, label: b })),
    { value: CUSTOM_BRANCH, label: 'custom…' },
  ];
  const known = options.some((o) => o.value === initial);
  const choice = unwrap(
    await p.select({
      ...io,
      message: 'Base branch to compare your changes with',
      options,
      initialValue: known ? initial : CUSTOM_BRANCH,
    }),
  );
  if (choice !== CUSTOM_BRANCH) return choice;
  return unwrap(
    await p.text({
      ...io,
      message: 'Base branch name',
      initialValue: known ? '' : initial,
      validate: (v) => (isValidBranchName(v?.trim() ?? '') ? undefined : 'Not a valid branch name'),
    }),
  ).trim();
}

async function askRole(
  role: 'review' | 'critique',
  d: RoleChoice,
  statuses: ProviderStatus[],
  current: Config,
  io: PromptIo,
): Promise<RoleChoice> {
  const options = statuses.map((s) => ({
    value: s.id,
    label: s.available ? s.id : `${s.id} ${pc.dim('(not detected)')}`,
    hint: `${s.label.replace(/\s*\((.*)\)$/, ', $1')}${s.experimental ? ', experimental' : ''}`,
  }));
  const provider = unwrap(
    await p.select({
      ...io,
      message: `Provider for the ${role} role`,
      options,
      initialValue: options.some((o) => o.value === d.provider) ? d.provider : options[0]?.value,
    }),
  );
  const cfg = current.providers[provider];
  const needsModel = providerNeedsModel(cfg);
  const model = unwrap(
    await p.text({
      ...io,
      message: `Model for the ${role} role`,
      placeholder: !needsModel
        ? "empty = the agent's default (e.g. opus, sonnet, gpt-5-codex)"
        : cfg?.type === 'bedrock'
          ? 'Bedrock model or inference profile id, e.g. us.anthropic.claude-…'
          : 'a model id the API serves (with tool calling), e.g. qwen3-coder:30b',
      initialValue: provider === d.provider ? (d.model ?? '') : '',
      validate: (v) => {
        const value = v?.trim() ?? '';
        if (needsModel && !value) return `${provider} needs a model id`;
        return /\s/.test(value) ? 'Model ids contain no spaces' : undefined;
      },
    }),
  ).trim();
  const reasoningHints: Record<ReasoningLevel, string> = {
    none: 'fastest',
    low: '',
    medium: 'balanced',
    high: 'most thorough, slower',
  };
  const reasoning = unwrap(
    await p.select<ReasoningLevel>({
      ...io,
      message: `Reasoning effort for the ${role} role`,
      options: REASONING_LEVELS.map((r) => ({ value: r, label: r, hint: reasoningHints[r] })),
      initialValue: d.reasoning,
    }),
  );
  return { provider, ...(model ? { model } : {}), reasoning };
}

async function availableExternalAnalyzers(current: Config): Promise<string[]> {
  try {
    const list = await Promise.race([
      detectAnalyzers(current.analyzers),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ANALYZER_TIMEOUT_MS).unref(),
      ),
    ]);
    return list
      .filter((a) => a.tier === 'external' && a.available)
      .map((a) => a.id)
      .sort();
  } catch {
    return [];
  }
}

function splitList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------------
// Output

interface WrittenInfo {
  file: string;
  choices: InitChoices;
  detection: InitDetection;
  scope: ConfigScope;
  gitignoreUpdated: boolean;
  warnings: string[];
}

interface InitUi {
  detected(det: InitDetection, scope: ConfigScope): void;
  written(info: WrittenInfo): void;
}

function clackUi(io: PromptIo): InitUi {
  return {
    detected(det, scope) {
      p.note(detectionLines(det, scope, true).join('\n'), 'Detected', io);
    },
    written(info) {
      for (const w of info.warnings) p.log.warn(w, io);
      p.note(summaryLines(info, true).join('\n'), `Wrote ${info.file}`, io);
      p.outro(
        `Next: ${pc.cyan('code-reviewer review --dry-run')} to preview chunks and skills without calling a model.`,
        io,
      );
    },
  };
}

function plainUi(logger: Logger): InitUi {
  return {
    detected(det, scope) {
      for (const line of detectionLines(det, scope, false)) logger.step(line);
    },
    written(info) {
      for (const w of info.warnings) logger.warn(w);
      logger.success(`Wrote ${info.file}`);
      for (const line of summaryLines(info, false)) logger.info(`  ${line}`);
      logger.info('Next: code-reviewer review --dry-run');
    },
  };
}

function detectionLines(det: InitDetection, scope: ConfigScope, color: boolean): string[] {
  const c = color ? pc : { dim: (s: string) => s, green: (s: string) => s, bold: (s: string) => s };
  const lines: string[] = [];
  const row = (label: string, value: string) => lines.push(`${c.bold(label.padEnd(10))} ${value}`);
  /** Several values: one per line in the note box (it wraps without indenting), else joined. */
  const rows = (label: string, values: string[]) => {
    if (!color) return row(label, values.join(' · '));
    row(label, values[0] ?? '');
    for (const v of values.slice(1)) lines.push(`${' '.repeat(11)}${v}`);
  };
  if (scope === 'project') {
    row('Project', `${det.project.name}${det.project.source ? c.dim(` (${det.project.source})`) : ''}`);
    if (det.gitRepo) {
      const branch = det.currentBranch ? `on ${det.currentBranch}` : 'detached HEAD';
      row('Git', `${branch}${det.defaultBase ? `, default branch ${det.defaultBase}` : ''}`);
    } else {
      row('Git', c.dim('not a git repository (files mode only)'));
    }
    const stack = stackParts(det);
    if (stack.length) rows('Stack', packLines(stack, ' · ', LINE_WIDTH));
    else row('Stack', c.dim(det.stackError ? 'detection unavailable' : 'nothing detected'));
    const code = det.languages.filter((l) => !DATA_LANGUAGES.has(l));
    if (code.length) row('Languages', fitList('', code, LINE_WIDTH));
    const groups = det.skillGroups.map((g) => `${g.group} (${g.skills.length})`);
    if (groups.length) rows('Skills', packLines(groups, ' · ', LINE_WIDTH));
    else row('Skills', c.dim('none yet (skills are also picked per chunk from file names and code)'));
  }
  const providers = det.providers.map((s) => (s.available ? c.green(`✓ ${s.id}`) : c.dim(`✗ ${s.id}`)));
  row('Providers', providers.join('  ') || c.dim('none configured'));
  return lines;
}

function summaryLines(info: WrittenInfo, color: boolean): string[] {
  const { choices: c, scope } = info;
  const bold = color ? pc.bold : (s: string) => s;
  const row = (label: string, value: string) => `${bold(label.padEnd(10))} ${value}`;
  const role = (r: RoleChoice) => `${r.provider} · ${r.model || 'default model'} · reasoning ${r.reasoning}`;
  const critique =
    c.critique === 'off'
      ? 'off'
      : c.critique === 'same'
        ? 'same provider, its critique model, reasoning high'
        : role(c.critique);
  const lines = [row('Review', role(c.review)), row('Critique', critique)];
  if (scope === 'project') {
    lines.push(row('Base', c.base));
    if (c.focus.length) lines.push(row('Focus', c.focus.join(', ')));
  }
  lines.push(
    row('Confidence', `>= ${c.minConfidence}`),
    row('Analyzers', `builtin ${c.analyzersBuiltin ? 'on' : 'off'} · external ${c.analyzersExternal}`),
    row('Reports', c.formats.join(', ') || 'none'),
  );
  if (scope === 'project' && info.detection.skillGroups.length) {
    lines.push(row('Skills', info.detection.skillGroups.map((g) => g.group).join(', ')));
  }
  if (info.gitignoreUpdated) lines.push(row('.gitignore', 'added the runs directory'));
  return lines;
}

/** Detected tech names grouped by category, e.g. ["TypeScript, JavaScript", "React", "PostgreSQL"]. */
function stackParts(det: InitDetection): string[] {
  const groups = new Map<string, string[]>();
  for (const id of det.techs) {
    if (!isTechId(id)) continue;
    const category = techCategory(id);
    groups.set(category, [...(groups.get(category) ?? []), techName(id)]);
  }
  return [...groups.values()].map((names) => fitList('', names, LINE_WIDTH));
}

/** Greedily packs `parts` into lines of at most `width` characters. */
function packLines(parts: string[], separator: string, width: number): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const last = out.at(-1);
    if (last !== undefined && last.length + separator.length + part.length <= width) {
      out[out.length - 1] = `${last}${separator}${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

/** `prefix` + as many items as fit in `width` characters, then "+N". */
function fitList(prefix: string, items: string[], width: number): string {
  let out = prefix;
  for (let i = 0; i < items.length; i++) {
    const next = `${i ? ', ' : ''}${items[i]}`;
    const rest = items.length - i - 1;
    if (i > 0 && out.length + next.length + (rest ? ` +${rest}`.length : 0) > width) {
      return `${out} +${items.length - i}`;
    }
    out += next;
  }
  return out;
}
