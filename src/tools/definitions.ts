import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { declaredName, enclosingDeclaration } from '../chunking/expand';
import { parseBlamePorcelain } from '../git/blame';
import { GitRepo } from '../git/repo';
import { hasNestedQuantifier } from '../skills/activation';
import { SubmitFindingsSchema, SubmitVerdictsSchema } from '../types';
import { unsafeGlobReason, untrustedGlobMatcher } from '../util/globs';
import { resolveInside, toPosix } from '../util/paths';
import { resolveDependencyPath } from './dependencies';
import type { SubmissionCollector } from './submission';

export interface ToolContext {
  /** Review root (snapshot or working tree). Every path is resolved inside it. */
  root: string;
  /** Whether `root` is inside a git work tree (enables git-based tools). */
  git: boolean;
  collector?: SubmissionCollector;
  /** Installed dependency sources `read_file` also reads by absolute path (see `tools/dependencies.ts`). */
  dependencyRoots?: string[];
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

const MAX_LOGGED_ARGS = 200;

/**
 * Runs a tool for a model: errors become a message the model can act on (never an aborted run), and read-tool
 * calls are logged to the task's collector (name, clipped arguments, result size, error, duration).
 */
export async function runTool(
  def: AnyToolDef,
  input: unknown,
  ctx: ToolContext,
): Promise<{ text: string; isError: boolean }> {
  const started = Date.now();
  let text: string;
  let isError = false;
  try {
    text = await def.execute(input, ctx);
  } catch (err) {
    text = `Error: ${(err as Error).message}`;
    isError = true;
  }
  if (!def.name.startsWith('submit_')) {
    const args = JSON.stringify(input) ?? '';
    ctx.collector?.noteCall({
      name: def.name,
      args: args.length > MAX_LOGGED_ARGS ? `${args.slice(0, MAX_LOGGED_ARGS)}…` : args,
      chars: text.length,
      lines: text ? text.split('\n').length : 0,
      ...(isError ? { error: true } : {}),
      ms: Date.now() - started,
    });
  }
  return { text, isError };
}

const readFileTool = defineTool({
  name: 'read_file',
  description:
    'Read a file from the reviewed revision with line numbers. Use it to inspect callers, definitions or surrounding code. Max 400 lines per call. An absolute path reads an installed dependency (the instructions list where they are).',
  inputSchema: z.object({
    path: z
      .string()
      .describe('Repository-relative path, or an absolute path inside the installed dependencies'),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  }),
  async execute({ path: rel, startLine, endLine }, ctx) {
    // An absolute path into installed dependencies (read-only, real path checked), else the review root.
    const dependency = path.isAbsolute(rel)
      ? resolveDependencyPath(ctx.dependencyRoots ?? [], rel)
      : undefined;
    const abs = dependency ?? resolveInside(ctx.root, rel);
    const lines = (await readFile(abs, 'utf8')).split('\n');
    if (!dependency) ctx.collector?.noteRead(toPosix(path.relative(ctx.root, abs)));
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

/** A search running longer than this is stopped (the model gets an error, not a partial answer). */
const GREP_TIMEOUT_MS = 20_000;
/** Regular-expression metacharacters: a pattern without any is searched as plain text. */
const REGEX_META = /[\\^$.|?*+()[\]{}]/;
/** Set once git says it was built without PCRE: patterns are then translated to POSIX ERE. */
let gitLacksPcre = false;

/**
 * PCRE → POSIX ERE, roughly, for git built without PCRE: shorthand classes become bracket classes and
 * `(?:` a plain group; `\b` has no ERE form and is dropped (more matches, never fewer).
 */
export function pcreToEre(pattern: string): string {
  return stripLookarounds(pattern)
    .replace(/\(\?:/g, '(')
    .replace(/\\d/g, '[0-9]')
    .replace(/\\D/g, '[^0-9]')
    .replace(/\\w/g, '[[:alnum:]_]')
    .replace(/\\W/g, '[^[:alnum:]_]')
    .replace(/\\s/g, '[[:space:]]')
    .replace(/\\S/g, '[^[:space:]]')
    .replace(/\\b/g, '');
}

/** The glob of the no-git fallback (model output: vetted like other untrusted globs). */
function fallbackGlob(glob: string): (file: string) => boolean {
  const g = glob.trim().replace(/^\.\//, '');
  const full = g.includes('/') ? g : `**/${g}`;
  const reason = unsafeGlobReason(full);
  if (reason) throw new Error(`unsupported glob "${glob}": ${reason}`);
  return untrustedGlobMatcher(full);
}

/** Removes lookaround groups (`(?!…)`, `(?=…)`, `(?<!…)`, `(?<=…)`), which ERE lacks. */
function stripLookarounds(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      out += pattern.slice(i, i + 2);
      i++;
      continue;
    }
    if (/^\(\?<?[!=]/.test(pattern.slice(i, i + 4))) {
      let depth = 0;
      for (; i < pattern.length; i++) {
        if (pattern[i] === '\\') i++;
        else if (pattern[i] === '(') depth++;
        else if (pattern[i] === ')' && --depth === 0) break;
      }
      continue;
    }
    out += pattern[i];
  }
  return out;
}

/** A glob without a directory (`*.java`) matches in every directory, as a model expects. */
export function globPathspec(glob: string): string {
  const g = glob.trim().replace(/^\.\//, '');
  return `:(glob)${g.includes('/') ? g : `**/${g}`}`;
}

interface GitGrepOptions {
  pattern: string;
  /** `fixed`: plain text; `regex`: PCRE (ERE when git lacks PCRE). */
  mode: 'fixed' | 'regex';
  ignoreCase?: boolean;
  /** Whole words only (`git grep -w`). */
  word?: boolean;
  pathspecs?: string[];
}

/**
 * `git grep` over the review root. Exit 1 is "no match"; anything else (an invalid pattern, PCRE's backtracking
 * limit, a timeout) is an error the model sees, never an empty result it could take as evidence.
 */
async function gitGrep(ctx: ToolContext, opts: GitGrepOptions): Promise<string[]> {
  const repo = new GitRepo(ctx.root);
  const run = (flag: '-F' | '-P' | '-E', pattern: string) => {
    const args = ['grep', '-n', '-I', flag, '--untracked', '--no-color'];
    if (opts.ignoreCase) args.push('-i');
    if (opts.word) args.push('-w');
    args.push('-e', pattern, '--', ...(opts.pathspecs ?? []));
    return repo.runStatus(args, { timeoutMs: GREP_TIMEOUT_MS });
  };
  let res =
    opts.mode === 'fixed'
      ? await run('-F', opts.pattern)
      : gitLacksPcre
        ? await run('-E', pcreToEre(opts.pattern))
        : await run('-P', opts.pattern);
  if (opts.mode === 'regex' && !gitLacksPcre && res.code > 1 && /pcre|perl/i.test(res.stderr)) {
    if (/not compiled|without|USE_LIBPCRE|not supported/i.test(res.stderr)) {
      gitLacksPcre = true;
      res = await run('-E', pcreToEre(opts.pattern));
    }
  }
  if (res.timedOut) {
    throw new Error(
      `the search took longer than ${GREP_TIMEOUT_MS / 1000}s: narrow the pattern or add a glob`,
    );
  }
  if (res.code > 1) {
    const reason = (res.stderr.split('\n').find((l) => l.trim()) ?? `git grep exited with ${res.code}`)
      .replace(/^fatal:\s*/, '')
      .slice(0, 200);
    throw new GrepError(reason, opts.mode === 'regex' && !/limit/i.test(reason));
  }
  return res.stdout.split('\n').filter(Boolean);
}

/** A failed search; `badPattern` when the regular expression did not compile. */
class GrepError extends Error {
  constructor(
    readonly reason: string,
    readonly badPattern: boolean,
  ) {
    super(
      `invalid search (${reason}). Escape regex characters such as ( [ { with a backslash, or pass literal: true.`,
    );
  }
}

const grepTool = defineTool({
  name: 'grep',
  description:
    'Search the reviewed revision. `pattern` is a Perl-compatible regular expression (\\b, \\w, \\d, (?:…) work); a pattern without regex characters, or literal: true, is searched as plain text. Returns "path:line:text" matches; an invalid pattern returns an error, never an empty result. Use it to find usages, callers and definitions before claiming something is unused, undefined or unhandled.',
  inputSchema: z.object({
    pattern: z
      .string()
      .min(1)
      .describe('Perl-compatible regular expression, or plain text with literal: true'),
    literal: z.boolean().optional().describe('Search the pattern as plain text'),
    glob: z
      .string()
      .optional()
      .describe('Optional file glob: "*.ts" matches in every directory, "src/**/*.ts" under src'),
    ignoreCase: z.boolean().optional(),
    maxResults: z.number().int().positive().max(200).optional(),
  }),
  async execute({ pattern, literal, glob, ignoreCase, maxResults }, ctx) {
    const limit = maxResults ?? 60;
    const fixed = literal ?? !REGEX_META.test(pattern);
    if (ctx.git) {
      const search = { pattern, ignoreCase, pathspecs: glob ? [globPathspec(glob)] : [] };
      let lines: string[];
      let note = '';
      try {
        lines = await gitGrep(ctx, { ...search, mode: fixed ? 'fixed' : 'regex' });
      } catch (err) {
        // `foo(` or `a[i`: the model almost always meant the text itself.
        if (!(err instanceof GrepError) || !err.badPattern) throw err;
        lines = await gitGrep(ctx, { ...search, mode: 'fixed' });
        note = `(not a valid regular expression: ${err.reason}; searched as plain text)\n`;
      }
      noteMatchedFiles(lines.slice(0, limit), ctx);
      return clip(note + formatMatches(lines, limit));
    }
    // No git: JS regexes backtrack, and both the pattern (model output) and the files are untrusted.
    if (
      !fixed &&
      (pattern.length > MAX_FALLBACK_PATTERN || hasNestedQuantifier(pattern) || /\\[1-9]/.test(pattern))
    ) {
      throw new Error(
        'Pattern too complex for this repository (no git): use a simpler regex without nested quantifiers or backreferences.',
      );
    }
    const literalRe = () =>
      new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'i' : undefined);
    if (fixed) return jsGrep(ctx, literalRe(), limit, glob);
    let re: RegExp;
    try {
      re = new RegExp(posixToJs(pattern), ignoreCase ? 'i' : undefined);
    } catch (err) {
      const note = `(not a valid regular expression: ${(err as Error).message}; searched as plain text)\n`;
      return note + (await jsGrep(ctx, literalRe(), limit, glob));
    }
    return jsGrep(ctx, re, limit, glob);
  },
});

/** Searches the files of a review root without git (bounded time, files and line length). */
async function jsGrep(ctx: ToolContext, re: RegExp, limit: number, glob?: string): Promise<string> {
  const inGlob = glob ? fallbackGlob(glob) : undefined;
  const matches: string[] = [];
  const deadline = Date.now() + FALLBACK_BUDGET_MS;
  let partial = false;
  for (const file of await walkFiles(ctx.root)) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    if (inGlob && !inGlob(file)) continue;
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
}

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

/** Words that can start a line before `name(` without declaring anything (`return foo(`, `else bar(`). */
const NOT_A_TYPE =
  'return|else|new|throw|case|await|yield|delete|goto|co_return|co_await|if|while|for|switch|sizeof|typeof|assert|echo|print';

/**
 * Definition patterns (PCRE) for `name`: declaration keywords (JS/TS, Python, Go, Rust, Kotlin, Swift, …),
 * bindings, and C-family definitions — a return type and modifiers before `name(` on a line without `;`, so
 * calls (`foo(x);`) and prototypes are left out.
 */
export function definitionPattern(name: string): string {
  // The tool accepts identifiers only; escape every metacharacter anyway (the pattern goes to PCRE).
  const n = name.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return [
    `\\b(?:function|class|interface|type|enum|struct|union|trait|impl|def|fn|func|fun|module|record|object|protocol|extension|namespace|typealias)\\s+${n}(?![\\w$])`,
    `\\b(?:const|let|var|val)\\s+${n}\\s*[:=]`,
    `\\bfunc\\s+\\([^)]*\\)\\s+${n}\\s*[(\\[]`,
    `^\\s*(?:(?:export|default|public|private|protected|internal|static|async|override|abstract|readonly|final|open|suspend)\\s+)*(?:get\\s+|set\\s+|\\*\\s*)?${n}\\s*(?:<[^>]*>)?\\s*\\([^;]*$`,
    `^\\s*(?!(?:${NOT_A_TYPE})\\b)(?:[\\w:<>,*&\\[\\]~.?]+\\s+)+[*&\\s]*(?:[\\w<>]+::)*~?${n}\\s*\\([^;]*$`,
    `^\\s*#\\s*define\\s+${n}\\b`,
  ].join('|');
}

/** Files that hold no definitions: documentation and data. */
const NON_CODE_EXTENSIONS = ['md', 'markdown', 'rst', 'txt', 'adoc', 'json', 'lock', 'csv', 'svg'];
const NON_CODE = NON_CODE_EXTENSIONS.map((ext) => `:(exclude,glob)**/*.${ext}`);
const NON_CODE_FILE = new RegExp(`\\.(?:${NON_CODE_EXTENSIONS.join('|')}):\\d+:`, 'i');

const findSymbolTool = defineTool({
  name: 'find_symbol',
  description:
    'Find the definitions of a function, method, class, type or variable by name across the reviewed revision (heuristics for JS/TS, Python, Go, Rust, Java, Kotlin, C#, C and C++; call sites are left out, use grep for those).',
  inputSchema: z.object({ name: z.string().regex(/^[\w$]+$/, 'identifier expected') }),
  async execute({ name }, ctx) {
    // Our own pattern: no complexity check (lines stay bounded by the fallback's limits).
    if (!ctx.git) return jsGrep(ctx, new RegExp(definitionPattern(name)), 40);
    const lines = await gitGrep(ctx, {
      pattern: definitionPattern(name),
      mode: 'regex',
      pathspecs: NON_CODE,
    });
    noteMatchedFiles(lines.slice(0, 40), ctx);
    return clip(formatMatches(lines, 40));
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

/** Most files and references `find_references` lists. */
const MAX_REFERENCE_FILES = 30;
const MAX_REFERENCES = 80;

const findReferencesTool = defineTool({
  name: 'find_references',
  description:
    'Every place a function, method, class, type, field or variable is used in the reviewed revision (whole-word matches in code files), grouped by file and by the enclosing function; definitions are marked. Use it to check each caller of a changed function or each reader of a changed field before reporting a cross-file defect or claiming nothing is affected.',
  inputSchema: z.object({
    name: z.string().regex(/^[\w$]+$/, 'identifier expected'),
    glob: z.string().optional().describe('Optional file glob: "*.ts" matches in every directory'),
  }),
  async execute({ name, glob }, ctx) {
    let lines: string[];
    if (ctx.git) {
      lines = await gitGrep(ctx, {
        pattern: name,
        mode: 'fixed',
        word: true,
        pathspecs: [...(glob ? [globPathspec(glob)] : []), ...NON_CODE],
      });
    } else {
      const escaped = name.replace(/\$/g, '\\$');
      const out = await jsGrep(ctx, new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`), MAX_REFERENCES + 1, glob);
      lines = out.split('\n').filter((l) => /^.+?:\d+:/.test(l) && !NON_CODE_FILE.test(l));
    }
    return clip(await groupReferences(ctx, name, lines));
  },
});

/** `path:line:text` matches grouped by file, then by the enclosing declaration of each line. */
async function groupReferences(ctx: ToolContext, name: string, lines: string[]): Promise<string> {
  const byFile = new Map<string, Array<{ line: number; text: string }>>();
  for (const l of lines) {
    const m = /^(.+?):(\d+):(.*)$/.exec(l);
    if (!m) continue;
    const list = byFile.get(m[1]!) ?? [];
    list.push({ line: Number(m[2]), text: m[3]! });
    byFile.set(m[1]!, list);
  }
  if (byFile.size === 0) return `No references to ${name} in code files.`;
  const files = [...byFile.keys()].slice(0, MAX_REFERENCE_FILES);
  noteMatchedFiles(
    files.map((f) => `${f}:1:`),
    ctx,
  );
  const out: string[] = [];
  let shown = 0;
  let definitions = 0;
  for (const file of files) {
    const refs = byFile.get(file)!;
    const source = await readFile(resolveInside(ctx.root, file), 'utf8')
      .then((t) => t.split('\n'))
      .catch(() => undefined);
    out.push(file);
    const groups = new Map<string, string[]>();
    for (const r of refs) {
      if (shown >= MAX_REFERENCES) break;
      shown++;
      const text = r.text.trim().slice(0, 200);
      if (declaredName(r.text) === name) {
        definitions++;
        out.push(`  ${r.line}  [definition] ${text}`);
        continue;
      }
      const at = source ? enclosingDeclaration(source, r.line) : undefined;
      const key = at && at.line !== r.line ? `in ${at.name} (line ${at.line}):` : 'top level:';
      groups.set(key, [...(groups.get(key) ?? []), `    ${r.line}  ${text}`]);
    }
    for (const [key, items] of groups) out.push(`  ${key}`, ...items);
  }
  const total = lines.length;
  const head = `${total} reference${total === 1 ? '' : 's'} to ${name} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}${definitions ? ` (${definitions} definition${definitions === 1 ? '' : 's'})` : ''}`;
  const more =
    total > shown || byFile.size > files.length
      ? `\n…(${total - shown} more in ${Math.max(0, byFile.size - files.length)} more files; narrow with glob)`
      : '';
  return `${head}\n${out.join('\n')}${more}`;
}

export const READ_TOOLS: AnyToolDef[] = [
  readFileTool,
  grepTool,
  listDirTool,
  findSymbolTool,
  findReferencesTool,
  gitLogTool,
  gitBlameTool,
];

export type SubmitKind = 'findings' | 'verdicts';

export const SUBMIT_TOOLS: Record<SubmitKind, AnyToolDef> = {
  findings: submitFindingsTool,
  verdicts: submitVerdictsTool,
};

/** Tools exposed for a task: optional read-only helpers and the submit tool. */
export function toolsFor(kind: SubmitKind, withReadTools: boolean): AnyToolDef[] {
  return withReadTools ? [...READ_TOOLS, SUBMIT_TOOLS[kind]] : [SUBMIT_TOOLS[kind]];
}

/** Names of every tool we can expose (used to recognise our own MCP tools in agent permission requests). */
export const TOOL_NAMES: ReadonlySet<string> = new Set([
  ...READ_TOOLS.map((t) => t.name),
  ...Object.values(SUBMIT_TOOLS).map((t) => t.name),
]);
