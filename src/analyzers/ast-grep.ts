import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CATEGORIES, SEVERITIES } from '../types';
import { findExecutable } from './env';
import { AnalyzerError, execTool } from './exec';
import { toRepoPath } from './sandbox';
import type { AnalyzerDef, RawHit, SourceFile } from './types';

/*
 * Structural checks bundled with skills: ast-grep rules (`checks:` in a skill's frontmatter) run on sandbox
 * copies of the changed files before the review, and their matches become hints. Rules are declarative data
 * (patterns, node kinds, relations; ast-grep's regexes are linear), so a project skill may declare them too;
 * `fix`, `transform` and custom languages are not accepted, and the repository's sgconfig.yml and ignore
 * files are never used.
 */

/** ast-grep language → extensions it parses (only files of these are scanned). */
export const AST_GREP_LANGUAGES = {
  TypeScript: ['.ts', '.mts', '.cts'],
  Tsx: ['.tsx'],
  JavaScript: ['.js', '.mjs', '.cjs', '.jsx'],
  Python: ['.py'],
  Go: ['.go'],
  Rust: ['.rs'],
  Java: ['.java'],
  Kotlin: ['.kt', '.kts'],
  CSharp: ['.cs'],
  C: ['.c', '.h'],
  Cpp: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'],
  Ruby: ['.rb'],
  Php: ['.php'],
  Swift: ['.swift'],
} as const;
type AstGrepLanguage = keyof typeof AST_GREP_LANGUAGES;
const LANGUAGE_NAMES = Object.keys(AST_GREP_LANGUAGES) as [AstGrepLanguage, ...AstGrepLanguage[]];

/** Largest rule (rule + constraints + utils as JSON) a check may carry. */
const MAX_RULE_CHARS = 4_000;
/** Most checks one skill may declare. */
export const MAX_CHECKS_PER_SKILL = 10;

const RuleObject = z.record(z.string(), z.unknown());

/** One structural check in a skill's frontmatter. */
export const StructuralCheckSchema = z
  .strictObject({
    id: z
      .string()
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case id expected'),
    /** One ast-grep language or several (`[TypeScript, Tsx, JavaScript]`): the rule runs for each. */
    language: z.preprocess(
      (v) => (typeof v === 'string' ? [v] : v),
      z.array(z.enum(LANGUAGE_NAMES)).min(1).max(6),
    ),
    /** An ast-grep rule object: `pattern`, `kind`, `inside`, `has`, `all`, `any`, `not`, … */
    rule: RuleObject,
    constraints: RuleObject.optional(),
    utils: RuleObject.optional(),
    /** Shown to the model as the hint (what is wrong and why). */
    message: z.string().min(5).max(300),
    severity: z.enum(SEVERITIES).optional(),
    category: z.enum(CATEGORIES).optional(),
    /** Prior confidence of a match (default 0.5). */
    confidence: z.number().min(0).max(1).optional(),
    /** Code the rule must match (checked by the library test when ast-grep is installed). */
    examples: z.array(z.string().min(1)).min(1).max(10),
  })
  .refine(
    (c) => JSON.stringify([c.rule, c.constraints ?? {}, c.utils ?? {}]).length <= MAX_RULE_CHARS,
    `rule too large (over ${MAX_RULE_CHARS} characters)`,
  );
export type StructuralCheckSpec = z.infer<typeof StructuralCheckSchema>;

/** A check with the skill that declared it. */
export interface StructuralCheck extends StructuralCheckSpec {
  skill: string;
}

function languageOfFile(file: string): AstGrepLanguage | undefined {
  const ext = path.posix.extname(file).toLowerCase();
  return LANGUAGE_NAMES.find((l) => (AST_GREP_LANGUAGES[l] as readonly string[]).includes(ext));
}

/** The ast-grep rule documents of a check, one per language; their ids index back into the check list. */
export function ruleDocuments(check: StructuralCheck, index: number): string[] {
  return check.language.map((language) =>
    JSON.stringify({
      id: `c${index}-${language.toLowerCase()}`,
      language,
      severity: 'hint',
      message: check.message,
      rule: check.rule,
      ...(check.constraints ? { constraints: check.constraints } : {}),
      ...(check.utils ? { utils: check.utils } : {}),
    }),
  );
}

const MatchSchema = z.object({
  file: z.string(),
  ruleId: z.string(),
  range: z.object({
    start: z.object({ line: z.number().int() }),
    end: z.object({ line: z.number().int() }),
  }),
});

/** Parses `ast-grep scan --json=stream` output (one JSON object per line). */
export function parseAstGrep(
  stdout: string,
  checks: readonly StructuralCheck[],
  baseDir: string,
  known: ReadonlySet<string>,
): RawHit[] {
  const hits: RawHit[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new AnalyzerError('failed', 'ast-grep: unexpected output');
    }
    const m = MatchSchema.safeParse(json);
    if (!m.success) continue;
    const index = /^c(\d+)-/.exec(m.data.ruleId)?.[1];
    const check = index === undefined ? undefined : checks[Number(index)];
    const file = toRepoPath(m.data.file, baseDir, known);
    if (!check || !file) continue;
    hits.push({
      ruleId: `${check.skill}#${check.id}`,
      file,
      startLine: m.data.range.start.line + 1,
      endLine: m.data.range.end.line + 1,
      severity: check.severity ?? 'minor',
      category: check.category ?? 'bug',
      message: check.message,
      confidence: check.confidence ?? 0.5,
      help: `skill ${check.skill}`,
    });
  }
  return hits;
}

/** The checks that apply to some of `files`. */
function applicable(checks: readonly StructuralCheck[], files: readonly SourceFile[]): StructuralCheck[] {
  const languages = new Set(files.map((f) => languageOfFile(f.path)));
  return checks.filter((c) => c.language.some((l) => languages.has(l)));
}

export const astGrepAnalyzer: AnalyzerDef = {
  id: 'ast-grep',
  label: 'ast-grep (skill checks)',
  tier: 'external',
  languages: ['*'],
  description:
    'Structural checks bundled with skills (ast-grep rules); the repository sgconfig.yml and ignore files are not used.',
  select: (files, _mode, checks = []) => {
    const langs = new Set(checks.flatMap((c) => c.language));
    return files.filter((f) => {
      const l = languageOfFile(f.path);
      return l !== undefined && langs.has(l) && !f.content.includes('\u0000');
    });
  },
  locate: async (ctx) => {
    const command = await findExecutable('ast-grep', ctx.env, ctx.repoRoot);
    return command ? { command, prefixArgs: [], trusted: true } : undefined;
  },
  async run(ctx) {
    const checks = applicable(ctx.checks ?? [], ctx.files);
    if (!checks.length) return { hits: [] };
    const box = await ctx.sandbox(ctx.files);
    if (box.files.length === 0) return { hits: [] };
    const rules = path.join(box.outDir, 'rules.yml');
    await writeFile(rules, checks.flatMap(ruleDocuments).join('\n---\n'), { mode: 0o600 });
    const res = await execTool(
      ctx,
      [
        'scan',
        '--rule',
        rules,
        '--json=stream',
        '--no-ignore',
        'hidden',
        '--no-ignore',
        'dot',
        '--no-ignore',
        'vcs',
        '--no-ignore',
        'parent',
        '--no-ignore',
        'global',
        '.',
      ],
      { cwd: box.dir, okCodes: [0, 1], label: 'ast-grep' },
    );
    return { hits: parseAstGrep(res.stdout, checks, box.dir, new Set(box.files)) };
  },
};
