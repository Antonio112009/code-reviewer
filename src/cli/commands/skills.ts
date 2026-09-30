import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { detectStack } from '../../context/stack';
import type { GitRepo } from '../../git/repo';
import { skillUsageAcross } from '../../report/common';
import { chunkStackLine, techVersionsForChunk } from '../../review/planning';
import { RunStore } from '../../runs/store';
import type { SkillActivation } from '../../skills/activation';
import {
  classifySkills,
  type RepoSkillRow,
  type RepoSkillStatus,
  type SkillContext,
} from '../../skills/detector';
import {
  hasActivation,
  loadSkills,
  loadSkillsFrom,
  type Skill,
  type SkillDir,
  type SkillGroup,
  skillDirs,
} from '../../skills/loader';
import type { StackProfile } from '../../types';
import { detectLanguage } from '../../util/language';
import { type GlobalOptions, loadCliConfig, makeLogger } from '../context';

export function registerSkillCommands(program: Command): void {
  const skills = program
    .command('skills')
    .description('list, inspect and detect review skills (technology checklists)');

  skills
    .command('list', { isDefault: true })
    .description(
      'list skills as a tree by technology (builtin, ~/.code-reviewer/skills, .code-reviewer/skills)',
    )
    .argument('[prefix]', 'only this subtree, e.g. javascript/react')
    .option('--json', 'machine-readable output')
    .action(async (prefix: string | undefined, opts: { json?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const { repo, cwd, config } = await loadCliConfig(globals);
      const pre = prefix?.replace(/^\/+|\/+$/g, '');
      const list = (await loadSkills(repo?.root ?? cwd, (m) => logger.warn(m)))
        .filter((s) => !pre || s.id === pre || s.id.startsWith(`${pre}/`))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(list.map(withoutBody), null, 2)}\n`);
        return;
      }
      process.stdout.write(renderSkillList(list, new Set(config.review.skillsExclude), terminalWidth()));
      process.stdout.write(
        pc.dim(
          `\nPer chunk, skills are picked by score within review.skillTokenBudget = ${config.review.skillTokenBudget} tokens. ` +
            'Run "code-reviewer skills detect" to see which apply to this repository.\n',
        ),
      );
    });

  skills
    .command('show')
    .description('print a skill: metadata, activation and checklist')
    .argument('<id>')
    .option('--json', 'machine-readable output')
    .action(async (id: string, opts: { json?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const { repo, cwd } = await loadCliConfig(globals);
      const all = await loadSkills(repo?.root ?? cwd, (m) => logger.warn(m));
      const skill = all.find((s) => s.id === id);
      if (!skill) {
        const similar = all.map((s) => s.id).filter((s) => s.includes(id) || id.includes(s));
        throw new Error(
          `Unknown skill "${id}"${similar.length ? ` — did you mean ${similar.slice(0, 5).join(', ')}?` : ''}. Run "code-reviewer skills list".`,
        );
      }
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(skill, null, 2)}\n`);
        return;
      }
      process.stdout.write(renderSkill(skill));
    });

  skills
    .command('detect')
    .description('detect the repository stack and show which skills would activate')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const { repo, cwd, config } = await loadCliConfig(globals);
      const root = repo?.root ?? cwd;
      const [list, files] = await Promise.all([
        loadSkills(root, (m) => logger.warn(m)),
        listRepoFiles(root, repo),
      ]);

      let profile: StackProfile | undefined;
      let notice: string | undefined;
      try {
        profile = await detectStack({ root, files });
      } catch (err) {
        const msg = (err as Error).message;
        notice = /not implemented/i.test(msg)
          ? 'Stack detection is not available in this build; stack-gated skills are matched by file and content signals only.'
          : `Stack detection failed (${msg}); stack-gated skills are matched by file and content signals only.`;
      }
      const techs = profile ? profileTechs(profile) : undefined;
      const languages = profile?.languages.length ? profile.languages : countLanguages(files);
      const techVersions = techVersionsForChunk(profile, [], techs);
      const ctx: SkillContext = {
        files,
        languages: languages.map((l) => l.id),
        techs,
        techVersions,
        code: '',
      };
      const rows = classifySkills(list, ctx, new Set(config.review.skillsExclude));

      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              root,
              files: files.length,
              languages,
              stack: profile ?? null,
              notice: notice ?? null,
              skills: rows.map((r) => ({
                id: r.skill.id,
                category: r.skill.category,
                source: r.skill.source,
                status: r.status,
                reasons: r.reasons,
              })),
            },
            null,
            2,
          )}\n`,
        );
        return;
      }
      if (notice) logger.warn(notice);
      process.stdout.write(renderDetection({ techs, techVersions, languages, files: files.length, rows }));
      process.stdout.write(
        pc.dim(
          `\nPer chunk, only skills matching that chunk's files, languages and code are used, within review.skillTokenBudget = ${config.review.skillTokenBudget} tokens.\n`,
        ),
      );
    });

  skills
    .command('usage')
    .description('which skills the saved runs loaded and how many findings each led to (the checklist field)')
    .option('--runs <n>', 'how many recent runs to read', '50')
    .option('--json', 'machine-readable output')
    .action(async (opts: { runs: string; json?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { repo, cwd, config } = await loadCliConfig(globals);
      const limit = Number.parseInt(opts.runs, 10);
      const runs = await new RunStore(path.resolve(repo?.root ?? cwd, config.output.dir)).recent(
        Number.isFinite(limit) && limit > 0 ? limit : 50,
      );
      const rows = skillUsageAcross(runs);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ runs: runs.length, skills: rows }, null, 2)}\n`);
        return;
      }
      if (!rows.length) {
        process.stdout.write(`No skills in ${runs.length} saved run(s).\n`);
        return;
      }
      const width = Math.max(...rows.map((r) => r.id.length));
      process.stdout.write(
        `${pc.bold(`${'skill'.padEnd(width)}  chunks  findings  per chunk  over budget`)}\n${rows
          .map(
            (r) =>
              `${r.id.padEnd(width)}  ${String(r.chunks).padStart(6)}  ${String(r.findings).padStart(8)}  ${r.chunks ? (r.findings / r.chunks).toFixed(2).padStart(9) : '        -'}  ${String(r.dropped).padStart(11)}`,
          )
          .join('\n')}\n`,
      );
      const idle = rows.filter((r) => r.chunks > 0 && r.findings === 0).length;
      process.stdout.write(
        pc.dim(
          `\n${runs.length} run(s). ${idle} skill(s) were loaded but led to no finding; runs before this version carry no attribution.\n`,
        ),
      );
    });

  skills
    .command('lint')
    .description('validate a skills directory (frontmatter, _group.yaml, ids, regexes, version ranges)')
    .argument('[dir]', 'skills directory (default: .code-reviewer/skills of this repository)')
    .action(async (dir: string | undefined, _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { repo, cwd } = await loadCliConfig(globals);
      const root = repo?.root ?? cwd;
      const target = path.resolve(cwd, dir ?? path.join(root, '.code-reviewer', 'skills'));
      // Loaded the way a review loads it: after the builtin library (its folders' _group.yaml detection is
      // inherited), with the restrictions of a project source when it lives in this repository.
      const inRepo = target === root || target.startsWith(`${root}${path.sep}`);
      const source: SkillDir = inRepo
        ? { dir: target, source: 'project', boundary: root }
        : { dir: target, source: 'global' };
      const problems: string[] = [];
      const all = await loadSkillsFrom([builtinSkillDir(), source], (m) => {
        if (m.includes(target)) problems.push(m);
      });
      const loaded = all.filter((s) => s.source === source.source);
      for (const p of problems) process.stderr.write(`${pc.red('✖')} ${p}\n`);
      process.stdout.write(
        `${loaded.length} ${source.source} skill${loaded.length === 1 ? '' : 's'} OK in ${target}${problems.length ? `, ${problems.length} problem(s)` : ''}\n`,
      );
      if (problems.length) process.exitCode = 1;
    });
}

/** The builtin library directory (first entry of the skill sources). */
function builtinSkillDir(): SkillDir {
  return skillDirs()[0]!;
}

// ---------------------------------------------------------------------------------------------------
// list / show rendering
// ---------------------------------------------------------------------------------------------------

function withoutBody({ body: _body, ...rest }: Skill): Omit<Skill, 'body'> {
  return rest;
}

function terminalWidth(): number | undefined {
  return process.stdout.isTTY ? process.stdout.columns : undefined;
}

function truncate(text: string, width: number | undefined): string {
  if (!width || text.length <= width) return text;
  return width > 1 ? `${text.slice(0, width - 1)}…` : '';
}

function abbreviate(values: string[], max: number): string {
  const shown = values.slice(0, max).join(', ');
  return values.length > max ? `${shown} +${values.length - max}` : shown;
}

/** `framework.react` → `react`. */
function shortTech(id: string): string {
  return id.slice(id.indexOf('.') + 1);
}

/** One-line description of an activation / detect block. */
export function describeActivation(a: SkillActivation): string[] {
  const parts: string[] = [];
  if (a.stack?.length) parts.push(`stack ${abbreviate(a.stack.map(shortTech), 3)}`);
  if (a.languages?.length) parts.push(`lang ${abbreviate(a.languages, 3)}`);
  if (a.versions && Object.keys(a.versions).length) {
    parts.push(
      `versions ${Object.entries(a.versions)
        .map(([t, r]) => `${shortTech(t)} ${r}`)
        .join(', ')}`,
    );
  }
  if (a.files?.length) parts.push(`files ${abbreviate(a.files, 2)}`);
  if (a.content?.length)
    parts.push(`${a.content.length} content pattern${a.content.length === 1 ? '' : 's'}`);
  return parts;
}

/** One-line description of when a skill activates (its own conditions; the folder's detection is shown on the folder). */
export function activationSummary(skill: Skill): string {
  const parts: string[] = [];
  if (skill.alwaysOn) parts.push('always on');
  parts.push(...describeActivation(skill.activation));
  if (skill.extends.length) parts.push(`extends ${skill.extends.join(', ')}`);
  const inherited = skill.groups.some((g) => g.detect && hasActivation(g.detect));
  if (!skill.alwaysOn && !hasActivation(skill.activation)) {
    parts.push(
      inherited
        ? 'every chunk of this technology'
        : skill.source === 'project'
          ? 'explicit selection only'
          : 'every chunk',
    );
  }
  return parts.join(' · ');
}

const BADGE_COLOR: Record<string, (s: string) => string> = {
  full: pc.magenta,
  project: pc.yellow,
  global: pc.cyan,
  excluded: pc.red,
};

/** Skills as a tree by folder: each folder shows its technology name and detection, then its skills. */
export function renderSkillList(skills: Skill[], excluded: ReadonlySet<string>, width?: number): string {
  if (skills.length === 0) return 'No skills found.\n';
  const groups = new Map<string, SkillGroup>();
  for (const s of skills) for (const g of s.groups) groups.set(g.path, g);
  const byFolder = new Map<string, Skill[]>();
  for (const s of skills) {
    const folder = s.id.includes('/') ? s.id.slice(0, s.id.lastIndexOf('/')) : '';
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), s]);
  }
  const countUnder = (folder: string) =>
    skills.filter((s) => (folder ? s.id.startsWith(`${folder}/`) : true)).length;
  // every ancestor folder of a skill gets a header
  const folders = new Set<string>();
  for (const f of byFolder.keys()) {
    const parts = f ? f.split('/') : [];
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  const out: string[] = [];
  const renderSkills = (folder: string, depth: number) => {
    const list = byFolder.get(folder) ?? [];
    const indent = '  '.repeat(depth);
    const nameWidth = Math.max(0, ...list.map((s) => s.id.slice(folder ? folder.length + 1 : 0).length));
    for (const s of list) {
      const name = s.id.slice(folder ? folder.length + 1 : 0);
      const tokens = `${String(s.tokens).padStart(4)} tok`;
      const badges = [
        s.tier === 'full' ? 'full' : '',
        s.source === 'builtin' ? '' : s.source,
        excluded.has(s.id) ? 'excluded' : '',
      ].filter(Boolean);
      const badgeText = badges.map((b) => ` ${BADGE_COLOR[b]!(b)}`).join('');
      const badgeWidth = badges.reduce((n, b) => n + b.length + 1, 0);
      const lead = `${indent}${name.padEnd(nameWidth)} ${tokens}`;
      const room = width ? width - lead.length - badgeWidth - 2 : undefined;
      out.push(
        `${indent}${pc.bold(name.padEnd(nameWidth))} ${pc.dim(tokens)}${badgeText}  ${truncate(s.description, room)}`,
      );
      const summary = activationSummary(s);
      if (summary) {
        const sub = `${indent}${' '.repeat(nameWidth + 1)}`;
        out.push(`${sub}${pc.dim(truncate(summary, width ? width - sub.length : undefined))}`);
      }
    }
  };
  renderSkills('', 0);
  for (const folder of [...folders].sort()) {
    const depth = folder.split('/').length - 1;
    const indent = '  '.repeat(depth);
    const g = groups.get(folder);
    const title = `${indent}${pc.bold(`${folder.slice(folder.lastIndexOf('/') + 1)}/`)}${g ? ` ${g.name}` : ''} ${pc.dim(`(${countUnder(folder)})`)}`;
    out.push(title);
    if (g?.detect) {
      const detect = describeActivation(g.detect).join(' · ');
      if (detect)
        out.push(
          `${indent}  ${pc.dim(truncate(`detect: ${detect}`, width ? width - indent.length - 2 : undefined))}`,
        );
    }
    renderSkills(folder, depth + 1);
  }
  const counts = (['builtin', 'global', 'project'] as const)
    .map((src) => [src, skills.filter((x) => x.source === src).length] as const)
    .filter(([, n]) => n > 0)
    .map(([src, n]) => `${n} ${src}`)
    .join(', ');
  const alwaysOn = skills.filter((x) => x.alwaysOn).map((x) => x.id);
  const essential = skills.filter((x) => x.tier === 'essential').length;
  out.push(
    '',
    `${skills.length} skill${skills.length === 1 ? '' : 's'} (${counts}) · ${essential} essential, ${skills.length - essential} full only${alwaysOn.length ? ` · always on: ${alwaysOn.join(', ')}` : ''}`,
  );
  return `${out.join('\n')}\n`;
}

/** Full skill: metadata, activation details and the checklist body. */
export function renderSkill(skill: Skill): string {
  const a = skill.activation;
  const row = (label: string, value: string) => `  ${pc.dim(label.padEnd(10))} ${value}`;
  const lines = [
    `${pc.bold(skill.name)} ${pc.dim(`(${skill.id})`)}`,
    skill.description,
    '',
    row('category', skill.category),
    row(
      'depth',
      skill.tier === 'full'
        ? 'full only'
        : skill.essentialTokens < skill.tokens
          ? `essential (${skill.essentialTokens} tokens; bullets marked [full] only at full depth)`
          : 'essential and full',
    ),
    row('source', `${skill.source} — ${skill.file}`),
    row('priority', String(skill.priority)),
    row('size', `${skill.tokens} tokens`),
  ];
  if (skill.alwaysOn) lines.push(row('always on', 'yes'));
  if (skill.extends.length) lines.push(row('extends', skill.extends.join(', ')));
  if (skill.tags.length) lines.push(row('tags', skill.tags.join(', ')));
  if (a.stack?.length) lines.push(row('stack', a.stack.join(', ')));
  if (a.languages?.length) lines.push(row('languages', a.languages.join(', ')));
  if (a.files?.length) lines.push(row('files', a.files.join(', ')));
  for (const [i, re] of (a.content ?? []).entries()) lines.push(row(i === 0 ? 'content' : '', `/${re}/`));
  for (const [t, r] of Object.entries(a.versions ?? {})) lines.push(row('version', `${t} ${r}`));
  for (const g of skill.groups) {
    const detect = g.detect ? describeActivation(g.detect).join(' · ') : '';
    lines.push(row('in', `${g.path}/ ${g.name}${detect ? pc.dim(` — ${detect}`) : ''}`));
  }
  if (!skill.alwaysOn && !hasActivation(a)) lines.push(row('activation', activationSummary(skill)));
  return `${lines.join('\n')}\n\n${skill.body}\n`;
}

// ---------------------------------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------------------------------

export type DetectStatus = RepoSkillStatus;
export type DetectRow = RepoSkillRow;
export { classifySkills };

function profileTechs(profile: StackProfile): Set<string> {
  const fromPackages = profile.packages.flatMap((p) => p.techs);
  return new Set(fromPackages.length ? fromPackages : profile.techs.map((t) => t.id));
}

function countLanguages(files: string[]): Array<{ id: string; files: number }> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const lang = detectLanguage(f);
    if (lang !== 'text') counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts]
    .map(([id, n]) => ({ id, files: n }))
    .sort((a, b) => b.files - a.files || (a.id < b.id ? -1 : 1));
}

function renderDetection(d: {
  techs?: Set<string>;
  techVersions: ReadonlyMap<string, string>;
  languages: Array<{ id: string; files: number }>;
  files: number;
  rows: DetectRow[];
}): string {
  const label = (s: string) => pc.dim(s.padEnd(10));
  const width = Math.max(60, Math.min(process.stdout.columns || 100, 120));
  const out: string[] = [];
  if (d.techs) {
    const stack = chunkStackLine(d.techs, d.techVersions);
    out.push(`${label('Stack')} ${stack ?? pc.dim('nothing specific detected')}`);
  }
  const langs = d.languages.slice(0, 8).map((l) => `${l.id} ${pc.dim(String(l.files))}`);
  out.push(`${label('Languages')} ${langs.length ? langs.join(' · ') : pc.dim('none')}`);
  out.push(`${label('Files')} ${d.files}`, '');

  /** One line per folder: `javascript/react/  core · effects · keys …` (wrapped). */
  const byFolder = (rows: DetectRow[]) => {
    const folders = new Map<string, string[]>();
    for (const r of rows) {
      const cut = r.skill.id.lastIndexOf('/');
      const folder = cut < 0 ? '' : r.skill.id.slice(0, cut + 1);
      folders.set(folder, [...(folders.get(folder) ?? []), r.skill.id.slice(cut + 1)]);
    }
    const pad = Math.min(28, Math.max(...[...folders.keys()].map((f) => f.length)));
    for (const [folder, leaves] of [...folders].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const head = `  ${(folder || '(root)').padEnd(pad)}  `;
      let line = head;
      for (const leaf of leaves.sort()) {
        const piece = line === head ? leaf : ` · ${leaf}`;
        if (line.length + piece.length > width && line !== head) {
          out.push(line);
          line = `${' '.repeat(head.length)}${leaf}`;
        } else line += piece;
      }
      out.push(line);
    }
  };
  const section = (status: DetectStatus, title: string, hint?: string) => {
    const rows = d.rows.filter((r) => r.status === status);
    if (rows.length === 0) return;
    out.push(`${pc.bold(title)} ${pc.dim(`(${rows.length})`)}${hint ? pc.dim(` — ${hint}`) : ''}`);
    byFolder(rows);
    out.push('');
  };
  section('always-on', 'Always on');
  section('active', 'Active for every chunk of these technologies');
  section('on-match', 'When the changed code matches', 'activate per chunk on their content patterns');
  section('excluded', 'Excluded', 'review.skillsExclude');
  const inactive = d.rows.filter((r) => r.status === 'inactive').length;
  if (inactive) out.push(pc.dim(`${inactive} other skill${inactive === 1 ? '' : 's'} do not apply here.`));
  return `${out.join('\n')}\n`;
}

const WALK_SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', '__pycache__']);
const MAX_WALK_FILES = 50_000;

/** Tracked + untracked files (git), or a bounded walk that skips dot-dirs, build output and symlinks. */
async function listRepoFiles(root: string, repo?: GitRepo): Promise<string[]> {
  if (repo) return (await repo.listFiles([])).sort();
  const out: string[] = [];
  const visit = async (rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_WALK_FILES) return;
      if (e.name.startsWith('.') || WALK_SKIP.has(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await visit(child);
      else if (e.isFile()) out.push(child);
    }
  };
  await visit('');
  return out.sort();
}
