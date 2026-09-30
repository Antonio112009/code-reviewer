import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import YAML from 'yaml';
import { z } from 'zod';
import { SEVERITIES } from '../types';
import { isInsideDir } from '../util/executables';
import { PROJECT_DIR, packageRoot, toPosix } from '../util/paths';
import { defectRanges } from './metrics';
import type { CaseSource, EvalCase, ExpectedDefect } from './types';

export class CaseError extends Error {}

export const CASE_EXTENSIONS = ['.yaml', '.yml'];
/** Commit shas only: a branch or tag moves, and the expected lines with it. */
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TAG_RE = /^[a-z0-9][a-z0-9.+#-]*$/;
const MAX_CASE_BYTES = 1024 * 1024;

/** The corpus shipped with the package (`evals/`). */
export function builtinCorpusDir(): string {
  return path.join(packageRoot(), 'evals');
}

const LinesSchema = z.union([
  z.number().int().positive(),
  z.tuple([z.number().int().positive(), z.number().int().positive()]),
]);

/** Another place where reporting the same defect counts: lines of the same file, or of another file. */
const AlsoSchema = z.union([LinesSchema, z.strictObject({ file: z.string().min(1), lines: LinesSchema })]);

const ExpectSchema = z.strictObject({
  file: z.string().min(1),
  lines: LinesSchema,
  also: z.array(AlsoSchema).optional(),
  severity: z.enum(SEVERITIES).optional(),
  note: z.string().optional(),
  /** A real but lesser defect: finding it is right, missing it is not counted. */
  optional: z.boolean().optional(),
});

const CaseSchema = z.strictObject({
  title: z.string().min(3).max(200),
  tags: z.array(z.string().regex(TAG_RE, 'lowercase letters, digits and . + # -')).optional(),
  base: z.record(z.string(), z.string()).optional(),
  head: z.record(z.string(), z.string().nullable()).optional(),
  repo: z.string().min(1).optional(),
  baseRef: z.string().regex(SHA_RE, 'must be a full commit sha').optional(),
  headRef: z.string().regex(SHA_RE, 'must be a full commit sha').optional(),
  expect: z.array(ExpectSchema),
});

/**
 * Why a case file path is not acceptable, or undefined. Paths are canonical repository-relative posix
 * paths; `.git/` and `.code-reviewer/` are refused: a case must not configure its own review.
 */
export function casePathProblem(p: string): string | undefined {
  if (p.length > 512) return 'is too long';
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return 'contains a backslash or a control character';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'must be relative';
  const segments = p.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return 'must be a canonical relative path';
  if (segments.some((s) => s.toLowerCase() === '.git')) return 'must not be inside .git';
  if (segments[0]!.toLowerCase() === PROJECT_DIR) return `must not be inside ${PROJECT_DIR}/`;
  return undefined;
}

/** Number of lines of a file (a trailing newline does not start another line). */
export function lineCount(content: string): number {
  if (content === '') return 0;
  const lines = content.split('\n').length;
  return content.endsWith('\n') ? lines - 1 : lines;
}

/** The head tree of an inline case: base files with the change applied. */
export function headFiles(source: Extract<CaseSource, { kind: 'inline' }>): Map<string, string> {
  const files = new Map(Object.entries(source.base));
  for (const [file, content] of Object.entries(source.head)) {
    if (content === null) files.delete(file);
    else files.set(file, content);
  }
  return files;
}

/** Checks that expected defects point at existing lines of the head version (`content` → undefined = missing). */
export function expectationProblems(
  expect: readonly ExpectedDefect[],
  content: (file: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const [i, d] of expect.entries()) {
    // `lines` and every `also` range, each in its own file
    for (const r of defectRanges(d)) {
      const text = content(r.file);
      if (text === undefined) {
        problems.push(`expect[${i}]: ${r.file} does not exist in the head version`);
        continue;
      }
      const count = lineCount(text);
      if (r.endLine > count) {
        problems.push(
          `expect[${i}]: lines ${r.startLine}-${r.endLine} are outside ${r.file} (${count} lines)`,
        );
      }
    }
  }
  return problems;
}

/** `12` or `[12, 14]` → a range; undefined when reversed. */
function toRange(lines: z.infer<typeof LinesSchema>): { startLine: number; endLine: number } | undefined {
  const [startLine, endLine] = typeof lines === 'number' ? [lines, lines] : lines;
  return endLine < startLine ? undefined : { startLine, endLine };
}

/**
 * Parses and validates one case file. `id` is the case id; `file` its absolute path (relative `repo:`
 * paths resolve against its directory).
 */
export function parseCase(text: string, opts: { id: string; file: string }): EvalCase {
  const where = opts.file;
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new CaseError(`${where}: invalid YAML: ${(err as Error).message}`);
  }
  const parsed = CaseSchema.safeParse(raw);
  if (!parsed.success) throw new CaseError(`${where}: invalid case:\n${z.prettifyError(parsed.error)}`);
  const c = parsed.data;
  const fail = (message: string): never => {
    throw new CaseError(`${where}: ${message}`);
  };

  const expect: ExpectedDefect[] = c.expect.map((e, i) => {
    const range = (lines: z.infer<typeof LinesSchema>, where: string) =>
      toRange(lines) ?? fail(`expect[${i}].${where}: ${JSON.stringify(lines)} ends before it starts`);
    const problem = casePathProblem(e.file);
    if (problem) fail(`expect[${i}].file ${JSON.stringify(e.file)} ${problem}`);
    const also = (e.also ?? []).map((a, j) => {
      if (typeof a === 'number' || Array.isArray(a)) return range(a, `also[${j}]`);
      const fileProblem = casePathProblem(a.file);
      if (fileProblem) fail(`expect[${i}].also[${j}].file ${JSON.stringify(a.file)} ${fileProblem}`);
      return { file: a.file, ...range(a.lines, `also[${j}].lines`) };
    });
    return {
      file: e.file,
      ...range(e.lines, 'lines'),
      ...(also.length ? { also } : {}),
      ...(e.severity ? { severity: e.severity } : {}),
      ...(e.note ? { note: e.note } : {}),
      ...(e.optional ? { optional: true } : {}),
    };
  });

  const inline = c.base !== undefined || c.head !== undefined;
  const repo = c.repo !== undefined || c.baseRef !== undefined || c.headRef !== undefined;
  let source: CaseSource;
  if (inline && repo) fail('use either base/head or repo/baseRef/headRef, not both');
  if (inline) {
    const base = c.base ?? {};
    const head = c.head ?? {};
    if (Object.keys(head).length === 0) fail('head must change at least one file');
    for (const [key, map] of [
      ['base', base],
      ['head', head],
    ] as const) {
      for (const file of Object.keys(map)) {
        const problem = casePathProblem(file);
        if (problem) fail(`${key}: ${JSON.stringify(file)} ${problem}`);
      }
    }
    for (const [file, content] of Object.entries(head)) {
      if (content === null && base[file] === undefined) fail(`head: ${file} is deleted but not in base`);
    }
    if (Object.entries(head).every(([file, content]) => content === base[file])) {
      fail('head does not change anything');
    }
    source = { kind: 'inline', base, head };
    const files = headFiles(source);
    const problems = expectationProblems(expect, (f) => files.get(f));
    if (problems.length) fail(problems.join('; '));
  } else if (repo) {
    if (!c.repo || !c.baseRef || !c.headRef) return fail('repo, baseRef and headRef are all required');
    if (c.baseRef === c.headRef) fail('baseRef and headRef are the same commit');
    const repoSource = resolveRepoSource(c.repo, path.dirname(opts.file), fail);
    source = { kind: 'repo', repo: repoSource, baseRef: c.baseRef, headRef: c.headRef };
  } else {
    return fail('needs base/head files or repo/baseRef/headRef');
  }
  return { id: opts.id, file: opts.file, title: c.title, tags: c.tags ?? [], source, expect };
}

/** An https URL (no credentials) as given, or a local path resolved against the case file's directory. */
function resolveRepoSource(repo: string, dir: string, fail: (m: string) => never): string {
  const unsupported = 'repo: only https URLs and local paths are supported';
  // Other transports (`ext::`, `ssh://`, `user@host:path`, `file://`) are refused, `ext::` runs commands.
  if (/^[a-z][a-z0-9+.-]*::/i.test(repo) || /^[\w.-]+@[\w.-]+:/.test(repo)) return fail(unsupported);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo)) {
    let url: URL;
    try {
      url = new URL(repo);
    } catch {
      return fail(`repo: invalid URL ${JSON.stringify(repo)}`);
    }
    if (url.protocol !== 'https:') fail(unsupported);
    if (url.username || url.password) fail('repo: the URL must not contain credentials');
    return url.href;
  }
  return path.resolve(dir, repo);
}

/** Case id of `file` relative to `root`: posix path without the extension. */
export function caseId(root: string, file: string): string {
  const rel = toPosix(path.relative(root, file));
  return rel.slice(0, rel.length - path.extname(rel).length);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    // Symbolic links are skipped (no loops, nothing outside the corpus).
    if (entry.isDirectory()) out.push(...(await walk(abs)));
    else if (entry.isFile() && CASE_EXTENSIONS.includes(path.extname(entry.name))) out.push(abs);
  }
  return out;
}

/**
 * Loads the cases under `paths` (case files or directories, searched recursively for *.yaml / *.yml),
 * relative to `cwd`; no path = the built-in corpus. Ids are relative to the directory given; a file given
 * directly gets its name as id, or its id in the built-in corpus when it lies there.
 */
export async function loadCases(paths: readonly string[], cwd: string): Promise<EvalCase[]> {
  const builtin = builtinCorpusDir();
  const roots = paths.length ? paths.map((p) => path.resolve(cwd, p)) : [builtin];
  const entries: Array<{ id: string; file: string }> = [];
  for (const root of roots) {
    if (!existsSync(root)) throw new CaseError(`${root}: no such file or directory`);
    if (statSync(root).isDirectory()) {
      for (const file of await walk(root)) entries.push({ id: caseId(root, file), file });
    } else {
      const base = isInsideDir(builtin, root) ? builtin : path.dirname(root);
      entries.push({ id: caseId(base, root), file: root });
    }
  }
  const seen = new Map<string, string>();
  const cases: EvalCase[] = [];
  for (const { id, file } of entries) {
    const previous = seen.get(id);
    if (previous === file) continue;
    if (previous) throw new CaseError(`Duplicate case id "${id}": ${previous} and ${file}`);
    seen.set(id, file);
    const text = await readFile(file, 'utf8');
    if (text.length > MAX_CASE_BYTES) throw new CaseError(`${file}: larger than ${MAX_CASE_BYTES} bytes`);
    cases.push(parseCase(text, { id, file }));
  }
  return cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Keeps the cases matching any of `filters` (OR): a tag, a glob on the id (`python/**`, `*sql*`) or an id
 * prefix (`python` → `python/…`).
 */
/**
 * Cases matching any term (tag, id glob or id prefix) and none of the `!`-prefixed ones: `hard,!real` is the
 * hard subset without the cases that clone real repositories.
 */
export function filterCases(cases: readonly EvalCase[], filters: readonly string[]): EvalCase[] {
  const terms = filters.map((f) => f.trim()).filter(Boolean);
  const matcher = (term: string) => {
    const glob = picomatch(term);
    const prefix = `${term.replace(/\/+$/, '')}/`;
    return (c: EvalCase) => c.tags.includes(term) || glob(c.id) || c.id.startsWith(prefix);
  };
  const include = terms.filter((t) => !t.startsWith('!')).map(matcher);
  const exclude = terms.filter((t) => t.startsWith('!') && t.length > 1).map((t) => matcher(t.slice(1)));
  return cases.filter(
    (c) => (include.length === 0 || include.some((t) => t(c))) && !exclude.some((t) => t(c)),
  );
}
