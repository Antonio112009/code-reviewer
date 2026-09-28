import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseBlamePorcelain } from '../git/blame';
import { GitRepo } from '../git/repo';
import { hasNestedQuantifier } from '../skills/activation';
import type { SkillCatalog } from '../skills/catalog';
import { SKILL_CATEGORIES } from '../skills/loader';
import { SubmitFindingsSchema, SubmitVerdictsSchema } from '../types';
import { resolveInside, toPosix } from '../util/paths';
import type { SubmissionCollector } from './submission';

export interface ToolContext {
  /** Review root (snapshot or working tree). Every path is resolved inside it. */
  root: string;
  /** Whether `root` is inside a git work tree (enables git-based tools). */
  git: boolean;
  collector?: SubmissionCollector;
  /** Loaded review skills; when set, `list_skills` / `get_skill` are exposed with the read tools. */
  skills?: SkillCatalog;
}

export interface ToolDef<I = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: ToolContext): Promise<string>;
}

const MAX_OUTPUT_CHARS = 24_000;
const MAX_READ_LINES = 400;

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(output truncated)` : text;
}

function defineTool<I>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

const readFileTool = defineTool({
  name: 'read_file',
  description:
    'Read a file from the reviewed revision with line numbers. Use it to inspect callers, definitions or surrounding code. Max 400 lines per call.',
  inputSchema: z.object({
    path: z.string().describe('Repository-relative path'),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }),
  async execute({ path: rel, startLine, endLine }, ctx) {
    const abs = resolveInside(ctx.root, rel);
    const lines = (await readFile(abs, 'utf8')).split('\n');
    ctx.collector?.noteRead(toPosix(path.relative(ctx.root, abs)));
    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(lines.length, endLine ?? start + MAX_READ_LINES - 1, start + MAX_READ_LINES - 1);
    const body = lines
      .slice(start - 1, end)
      .map((l, i) => `${start + i}\t${l}`)
      .join('\n');
    const more =
      end < lines.length ? `\n…(${lines.length - end} more lines; call again with startLine=${end + 1})` : '';
    return clip(`${rel} (lines ${start}-${end} of ${lines.length})\n${body}${more}`);
  },
});

const grepTool = defineTool({
  name: 'grep',
  description:
    'Search the reviewed revision with an extended regular expression. Returns "path:line:text" matches. Use it to find usages, callers and definitions before claiming something is unused, undefined or unhandled.',
  inputSchema: z.object({
    pattern: z.string().min(1).describe('Extended (POSIX ERE) regular expression'),
    glob: z.string().optional().describe('Optional pathspec glob, e.g. "src/**/*.ts"'),
    ignoreCase: z.boolean().optional(),
    maxResults: z.number().int().positive().max(200).optional(),
  }),
  async execute({ pattern, glob, ignoreCase, maxResults }, ctx) {
    const limit = maxResults ?? 60;
    if (ctx.git) {
      const args = ['grep', '-n', '-I', '-E', '--untracked', '--no-color'];
      if (ignoreCase) args.push('-i');
      args.push('-e', pattern, '--');
      if (glob) args.push(`:(glob)${glob}`);
      const { ok, stdout } = await new GitRepo(ctx.root).tryRun(args);
      if (!ok && !stdout) return 'No matches.';
      const lines = stdout.split('\n').filter(Boolean);
      noteMatchedFiles(lines.slice(0, limit), ctx);
      return clip(formatMatches(lines, limit));
    }
    // No git: JS regexes backtrack, and both the pattern (model output) and the files are untrusted.
    if (pattern.length > MAX_FALLBACK_PATTERN || hasNestedQuantifier(pattern) || /\\[1-9]/.test(pattern)) {
      throw new Error(
        'Pattern too complex for this repository (no git): use a simpler regex without nested quantifiers or backreferences.',
      );
    }
    const re = new RegExp(posixToJs(pattern), ignoreCase ? 'i' : undefined);
    const matches: string[] = [];
    const deadline = Date.now() + FALLBACK_BUDGET_MS;
    let partial = false;
    for (const file of await walkFiles(ctx.root)) {
      if (Date.now() > deadline) {
        partial = true;
        break;
      }
      const text = await readFile(path.join(ctx.root, file), 'utf8').catch(() => '');
      text.split('\n').forEach((l, i) => {
        if (matches.length <= limit && l.length <= MAX_FALLBACK_LINE && re.test(l))
          matches.push(`${file}:${i + 1}:${l}`);
      });
      if (matches.length > limit) break;
    }
    noteMatchedFiles(matches.slice(0, limit), ctx);
    const out = formatMatches(matches, limit);
    return clip(
      partial ? `${out}\n(search stopped after ${FALLBACK_BUDGET_MS / 1000}s; narrow the pattern)` : out,
    );
  },
});

/** Limits of the plain-JS grep used without git (backtracking regex engine, untrusted input). */
const MAX_FALLBACK_PATTERN = 300;
const MAX_FALLBACK_LINE = 2_000;
const FALLBACK_BUDGET_MS = 5_000;

const POSIX_CLASSES: Record<string, string> = {
  space: '\\s',
  alnum: 'A-Za-z0-9',
  alpha: 'A-Za-z',
  digit: '0-9',
  upper: 'A-Z',
  lower: 'a-z',
  xdigit: '0-9A-Fa-f',
  punct: '!-\\/:-@\\[-`{-~',
};

/** Translates POSIX bracket classes ([[:space:]]) used with git grep into JS regex syntax. */
export function posixToJs(pattern: string): string {
  return pattern.replace(/\[:(\w+):\]/g, (m, name: string) => POSIX_CLASSES[name] ?? m);
}

/** The files behind `path:line:text` matches the model is shown count as read. */
function noteMatchedFiles(lines: string[], ctx: ToolContext): void {
  if (!ctx.collector) return;
  for (const file of new Set(lines.map((l) => /^(.+?):\d+:/.exec(l)?.[1]).filter(Boolean))) {
    ctx.collector.noteRead(file!);
  }
}

function formatMatches(lines: string[], limit: number): string {
  if (lines.length === 0) return 'No matches.';
  const shown = lines.slice(0, limit).map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l));
  const extra = lines.length > limit ? `\n…(${lines.length - limit} more matches, refine the pattern)` : '';
  return shown.join('\n') + extra;
}

async function walkFiles(root: string, rel = '.', out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'build', '.code-reviewer'].includes(entry.name)) continue;
    const child = rel === '.' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) await walkFiles(root, child, out);
    else if (entry.isFile()) out.push(child);
    if (out.length > 20_000) break;
  }
  return out;
}

const listDirTool = defineTool({
  name: 'list_dir',
  description: 'List entries of a directory in the reviewed revision (directories end with "/").',
  inputSchema: z.object({ path: z.string().default('.').describe('Repository-relative directory') }),
  async execute({ path: rel }, ctx) {
    const abs = resolveInside(ctx.root, rel || '.');
    const st = await stat(abs);
    if (!st.isDirectory()) return `${rel} is not a directory`;
    const entries = await readdir(abs, { withFileTypes: true });
    const names = entries
      .filter((e) => e.name !== '.git')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return clip(
      names.slice(0, 300).join('\n') + (names.length > 300 ? `\n…(${names.length - 300} more)` : ''),
    );
  },
});

const gitLogTool = defineTool({
  name: 'git_log',
  description:
    'Recent commits touching a file (hash, author, date, subject). Useful to understand intent of a change.',
  inputSchema: z.object({
    path: z.string(),
    maxCount: z.number().int().positive().max(50).optional(),
  }),
  async execute({ path: rel, maxCount }, ctx) {
    if (!ctx.git) return 'git history is not available for this review.';
    resolveInside(ctx.root, rel);
    const out = await new GitRepo(ctx.root).run([
      'log',
      `-n${maxCount ?? 10}`,
      '--format=%h %an <%ae> %ad %s',
      '--date=short',
      '--',
      rel,
    ]);
    return clip(out.trim() || 'No commits.');
  },
});

const gitBlameTool = defineTool({
  name: 'git_blame',
  description: 'Who last changed each line in a range (commit, author, summary).',
  inputSchema: z.object({
    path: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }),
  async execute({ path: rel, startLine, endLine }, ctx) {
    if (!ctx.git) return 'git blame is not available for this review.';
    resolveInside(ctx.root, rel);
    const end = Math.min(endLine, startLine + 200);
    const out = await new GitRepo(ctx.root).run([
      'blame',
      '--porcelain',
      '-L',
      `${startLine},${end}`,
      'HEAD',
      '--',
      rel,
    ]);
    const lines = parseBlamePorcelain(out);
    return clip(
      lines.map((l) => `${l.line}\t${l.commit.slice(0, 10)}\t${l.author}\t${l.summary ?? ''}`).join('\n') ||
        'No blame info.',
    );
  },
});

const findSymbolTool = defineTool({
  name: 'find_symbol',
  description:
    'Find likely definitions of a function/class/type/variable by name across the reviewed revision (regex heuristics for common languages).',
  inputSchema: z.object({ name: z.string().regex(/^[\w$]+$/, 'identifier expected') }),
  async execute({ name }, ctx) {
    const n = name.replace(/\$/g, '\\$');
    const pattern = [
      `(function|class|interface|type|enum|struct|trait|def|fn|func|module|record|object)[[:space:]]+${n}([^[:alnum:]_$]|$)`,
      `(const|let|var|val)[[:space:]]+${n}[[:space:]]*[:=]`,
      `^[[:space:]]*(export[[:space:]]+)?(async[[:space:]]+)?${n}[[:space:]]*\\(`,
      `func[[:space:]]+\\([^)]*\\)[[:space:]]+${n}\\(`,
    ].join('|');
    return grepTool.execute({ pattern, maxResults: 40 }, ctx);
  },
});

const listSkillsTool = defineTool({
  name: 'list_skills',
  description:
    'List review checklists (skills) you can fetch with get_skill. Skills form a tree by technology (e.g. javascript/react/..., python/django/..., databases/postgresql/..., security/...). Filter with `prefix` (a folder such as "javascript/nextjs") and/or `query` (words to search in names and descriptions). Checklists selected for this chunk are already in your instructions; use this when the code touches a technology or risk they do not cover.',
  inputSchema: z.object({
    prefix: z.string().max(100).optional().describe('Folder prefix, e.g. "javascript/react" or "databases"'),
    query: z.string().max(100).optional().describe('Words to look for in skill names and descriptions'),
    category: z.enum(SKILL_CATEGORIES).optional().describe('Only list skills of this category'),
  }),
  async execute({ prefix, query, category }, ctx) {
    if (!ctx.skills) return 'Skills are not available for this review.';
    const pre = prefix
      ?.trim()
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase();
    const words = (query ?? '')
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 1);
    const skills = ctx.skills.list().filter((s) => {
      if (category && s.category !== category) return false;
      if (pre && s.id !== pre && !s.id.startsWith(`${pre}/`)) return false;
      if (words.length) {
        const hay = `${s.id} ${s.name} ${s.description}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }
      return true;
    });
    if (skills.length === 0) return 'No matching skills. Try a shorter prefix or fewer words.';
    const lines: string[] = [];
    let current = '';
    for (const s of skills) {
      const folder = s.id.includes('/') ? s.id.slice(0, s.id.lastIndexOf('/')) : '(root)';
      if (folder !== current) {
        current = folder;
        lines.push(`${lines.length ? '\n' : ''}${current}/`);
      }
      lines.push(`- ${s.id}: ${s.name} — ${s.description}`);
    }
    return clip(lines.join('\n'));
  },
});

const getSkillTool = defineTool({
  name: 'get_skill',
  description:
    'Fetch the full checklist of a skill by id (see list_skills), e.g. when the chunk uses a framework, database or risky API whose checklist is not already in your instructions. Findings still need evidence in the code.',
  inputSchema: z.object({
    id: z
      .string()
      .min(1)
      .max(200)
      .describe('Skill id (path) from list_skills, e.g. javascript/react/effects'),
  }),
  async execute({ id }, ctx) {
    if (!ctx.skills) return 'Skills are not available for this review.';
    const wanted = id.trim().toLowerCase();
    const body = ctx.skills.get(wanted);
    const summary = ctx.skills.list().find((s) => s.id === wanted);
    if (body === undefined || !summary) {
      const similar = ctx.skills
        .list()
        .map((s) => s.id)
        .filter((s) => s.includes(wanted) || wanted.includes(s))
        .slice(0, 5);
      throw new Error(
        `Unknown skill "${id}".${similar.length ? ` Did you mean: ${similar.join(', ')}?` : ''} Call list_skills for the available ids.`,
      );
    }
    return clip(`# ${summary.name} (${summary.id}, ${summary.category})\n\n${body}`);
  },
});

const submitFindingsTool = defineTool({
  name: 'submit_findings',
  description:
    'Record defects you have verified. Each call adds to your review: submit findings as you confirm them instead of keeping them for the end, and call it at least once (an empty array if there are none). Lines refer to the NEW version of the file.',
  inputSchema: SubmitFindingsSchema,
  async execute(input, ctx) {
    ctx.collector?.add('findings', input);
    const total = ctx.collector?.submission.findings?.length ?? input.findings.length;
    return `Recorded ${input.findings.length} finding(s), ${total} in total. Continue with the rest of the change and submit further defects as you verify them; when you have covered everything, reply with a one-line summary.`;
  },
});

const submitVerdictsTool = defineTool({
  name: 'submit_verdicts',
  description: 'Submit your verdict for every finding id you were given. Call it once at the end.',
  inputSchema: SubmitVerdictsSchema,
  async execute(input, ctx) {
    ctx.collector?.add('verdicts', input);
    return `Received ${input.verdicts.length} verdict(s). You are done — reply with a one-line confirmation.`;
  },
});

/** A tool of any input type (tool lists are heterogeneous; `execute` is contravariant in its input). */
// biome-ignore lint/suspicious/noExplicitAny: required for heterogeneous tool lists
export type AnyToolDef = ToolDef<any>;

export const READ_TOOLS: AnyToolDef[] = [
  readFileTool,
  grepTool,
  listDirTool,
  findSymbolTool,
  gitLogTool,
  gitBlameTool,
];

/** On-demand skill tools, exposed with the read tools when the task has a skill catalog. */
export const SKILL_TOOLS: AnyToolDef[] = [listSkillsTool, getSkillTool];

export type SubmitKind = 'findings' | 'verdicts';

export const SUBMIT_TOOLS: Record<SubmitKind, AnyToolDef> = {
  findings: submitFindingsTool,
  verdicts: submitVerdictsTool,
};

/**
 * Tools exposed for a task: optional read-only helpers (plus `list_skills` / `get_skill` when `ctx.skills`
 * is set) and the submit tool.
 */
export function toolsFor(
  kind: SubmitKind,
  withReadTools: boolean,
  ctx?: Pick<ToolContext, 'skills'>,
): AnyToolDef[] {
  if (!withReadTools) return [SUBMIT_TOOLS[kind]];
  return [...READ_TOOLS, ...(ctx?.skills ? SKILL_TOOLS : []), SUBMIT_TOOLS[kind]];
}

/** Names of every tool we can expose (used to recognise our own MCP tools in agent permission requests). */
export const TOOL_NAMES: ReadonlySet<string> = new Set([
  ...READ_TOOLS.map((t) => t.name),
  ...SKILL_TOOLS.map((t) => t.name),
  ...Object.values(SUBMIT_TOOLS).map((t) => t.name),
]);
