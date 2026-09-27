import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Category, Severity } from '../types';
import { compareVersions, findExecutable } from './env';
import { AnalyzerError, execTool, parseJsonOutput } from './exec';
import { toolArg, toRepoPath } from './sandbox';
import { parseSarif, sarifToRawHits } from './sarif';
import type { AnalyzerDef, LocateContext, LocatedBinary, RawHit, SourceFile } from './types';

/*
 * Safe external analyzers: third-party binaries found on PATH (outside the repository) that only read
 * files. They run on sandbox copies of the reviewed files, from the sandbox directory, with explicit
 * flags that disable config discovery, so nothing in the PR can configure, suppress or extend them.
 */

/** Tool configuration / ignore files that are never copied into a sandbox. */
const TOOL_CONFIG_FILES = new Set([
  '.gitleaks.toml',
  'gitleaks.toml',
  '.gitleaksignore',
  '.shellcheckrc',
  'shellcheckrc',
  '.hadolint.yaml',
  '.hadolint.yml',
  'hadolint.yaml',
  'pyproject.toml',
  'ruff.toml',
  '.ruff.toml',
  'setup.cfg',
  'tox.ini',
  '.editorconfig',
  '.semgrepignore',
  'cppcheck.cfg',
]);

const MAX_FILE_CHARS = 2_000_000;

function scannable(file: SourceFile): boolean {
  return (
    file.content.length <= MAX_FILE_CHARS &&
    !file.content.includes('\u0000') &&
    !TOOL_CONFIG_FILES.has(path.posix.basename(file.path))
  );
}

function onPath(name: string) {
  return async (ctx: LocateContext): Promise<LocatedBinary | undefined> => {
    const command = await findExecutable(name, ctx.env, ctx.repoRoot);
    return command ? { command, prefixArgs: [], trusted: true } : undefined;
  };
}

// ---------------------------------------------------------------------------------------------------
// gitleaks
// ---------------------------------------------------------------------------------------------------

const GitleaksReportSchema = z.array(
  z.object({
    RuleID: z.string().optional(),
    Description: z.string().optional(),
    StartLine: z.number().int().optional(),
    EndLine: z.number().int().optional(),
    File: z.string().optional(),
  }),
);

/** Parses a gitleaks JSON report (run with `--redact`); secret values are never read from it. */
export function parseGitleaksReport(json: unknown, baseDir: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = GitleaksReportSchema.safeParse(json ?? []);
  if (!parsed.success) throw new AnalyzerError('failed', 'gitleaks: unexpected report format');
  const hits: RawHit[] = [];
  for (const f of parsed.data) {
    const file = f.File ? toRepoPath(f.File, baseDir, known) : undefined;
    if (!file || !f.StartLine) continue;
    const rule = f.RuleID ?? 'secret';
    const generic = /generic/i.test(rule);
    hits.push({
      ruleId: rule,
      file,
      startLine: f.StartLine,
      endLine: f.EndLine ?? f.StartLine,
      severity: generic ? 'major' : 'critical',
      category: 'security',
      message: `Hard-coded secret: ${f.Description ?? rule} (value redacted)`,
      confidence: generic ? 0.4 : 0.6,
      help: 'Remove the credential from the code, rotate it, and load it from the environment or a secret store.',
      nonRejectable: true,
      dedupeKey: 'secret',
    });
  }
  return hits;
}

const gitleaks: AnalyzerDef = {
  id: 'gitleaks',
  label: 'gitleaks',
  tier: 'external',
  languages: ['*'],
  description:
    'Secret scanner (built-in rules via our own config; repository .gitleaks.toml/.gitleaksignore ignored).',
  select: (files) => files.filter(scannable),
  locate: onPath('gitleaks'),
  versionArgs: ['version'],
  async run(ctx) {
    const box = await ctx.sandbox(ctx.files);
    const config = path.join(box.outDir, 'gitleaks.toml');
    const report = path.join(box.outDir, 'report.json');
    await writeFile(config, '[extend]\nuseDefault = true\n', { mode: 0o600 });
    const modern = !ctx.version || compareVersions(ctx.version, '8.19') >= 0;
    const common = [
      '--config',
      config,
      '--report-format',
      'json',
      '--report-path',
      report,
      '--redact',
      '--no-banner',
      '--exit-code',
      '0',
      '--log-level',
      'error',
    ];
    const args = modern ? ['dir', ...common, '.'] : ['detect', '--no-git', '--source', '.', ...common];
    await execTool(ctx, args, { cwd: box.dir, label: 'gitleaks' });
    const text = await readFile(report, 'utf8').catch(() => '[]');
    return {
      hits: parseGitleaksReport(parseJsonOutput(text || '[]', 'gitleaks'), box.dir, new Set(box.files)),
    };
  },
};

// ---------------------------------------------------------------------------------------------------
// shellcheck
// ---------------------------------------------------------------------------------------------------

const ShellcheckSchema = z.object({
  comments: z.array(
    z.object({
      file: z.string(),
      line: z.number().int(),
      endLine: z.number().int().optional(),
      level: z.string(),
      code: z.number().int(),
      message: z.string(),
    }),
  ),
});

const SHELLCHECK_LEVELS: Record<string, { severity: Severity; confidence: number } | undefined> = {
  error: { severity: 'major', confidence: 0.5 },
  warning: { severity: 'minor', confidence: 0.45 },
  info: { severity: 'info', confidence: 0.3 },
};

/** Parses `shellcheck -f json1` output. Style-level comments are dropped. */
export function parseShellcheck(json: unknown, baseDir: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = ShellcheckSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'shellcheck: unexpected json1 format');
  const hits: RawHit[] = [];
  for (const c of parsed.data.comments) {
    const level = SHELLCHECK_LEVELS[c.level];
    const file = toRepoPath(c.file, baseDir, known);
    if (!level || !file) continue;
    hits.push({
      ruleId: `SC${c.code}`,
      file,
      startLine: c.line,
      endLine: c.endLine ?? c.line,
      severity: level.severity,
      category: 'bug',
      message: c.message,
      confidence: level.confidence,
      help: `https://www.shellcheck.net/wiki/SC${c.code}`,
    });
  }
  return hits;
}

const SHELL_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?(?:\/\S*\/)?(?:ba|da|k)?sh\b/;

/** Files ShellCheck cannot parse although they count as `shell`: zsh and PowerShell scripts. */
const NOT_SHELLCHECK = /\.(?:zsh|ps1|psm1|psd1)$/i;

function isShellScript(file: SourceFile): boolean {
  if (NOT_SHELLCHECK.test(file.path) || /^#!.*\bzsh\b/.test(file.content)) return false;
  if (file.language === 'shell') return true;
  return file.language === 'text' && SHELL_SHEBANG.test(file.content.slice(0, 200));
}

const shellcheck: AnalyzerDef = {
  id: 'shellcheck',
  label: 'ShellCheck',
  tier: 'external',
  languages: ['shell'],
  description: 'Shell script linter (--norc, never follows `source`).',
  select: (files) => files.filter((f) => scannable(f) && isShellScript(f)),
  locate: onPath('shellcheck'),
  async run(ctx) {
    const box = await ctx.sandbox(ctx.files);
    if (box.files.length === 0) return { hits: [] };
    const res = await execTool(
      ctx,
      [
        '--norc',
        '--format=json1',
        '--severity=info',
        '--exclude=SC1090,SC1091,SC2148',
        ...box.files.map(toolArg),
      ],
      { cwd: box.dir, okCodes: [0, 1], label: 'shellcheck' },
    );
    return { hits: parseShellcheck(parseJsonOutput(res.stdout, 'shellcheck'), box.dir, new Set(box.files)) };
  },
};

// ---------------------------------------------------------------------------------------------------
// hadolint
// ---------------------------------------------------------------------------------------------------

const HadolintSchema = z.array(
  z.object({
    code: z.string(),
    file: z.string(),
    line: z.number().int(),
    level: z.string(),
    message: z.string(),
  }),
);

/** Parses `hadolint --format json`. Only error/warning level results are kept. */
export function parseHadolint(json: unknown, baseDir: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = HadolintSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'hadolint: unexpected json format');
  const hits: RawHit[] = [];
  for (const r of parsed.data) {
    const file = toRepoPath(r.file, baseDir, known);
    if (!file || (r.level !== 'error' && r.level !== 'warning')) continue;
    const shell = r.code.startsWith('SC');
    hits.push({
      ruleId: r.code,
      file,
      startLine: r.line,
      severity: r.level === 'error' ? 'minor' : 'info',
      category: /^DL3002$|^DL3004$/.test(r.code) ? 'security' : 'bug',
      message: r.message,
      confidence: r.level === 'error' ? 0.4 : 0.3,
      help: shell
        ? `https://www.shellcheck.net/wiki/${r.code}`
        : `https://github.com/hadolint/hadolint/wiki/${r.code}`,
    });
  }
  return hits;
}

const hadolint: AnalyzerDef = {
  id: 'hadolint',
  label: 'hadolint',
  tier: 'external',
  languages: ['dockerfile'],
  description: 'Dockerfile linter (run from a temp dir with our own config).',
  select: (files) => files.filter((f) => scannable(f) && f.language === 'dockerfile'),
  locate: onPath('hadolint'),
  async run(ctx) {
    const box = await ctx.sandbox(ctx.files);
    if (box.files.length === 0) return { hits: [] };
    const config = path.join(box.outDir, 'hadolint.yaml');
    // `# hadolint ignore=` / `# hadolint global ignore=` pragmas in the PR must not silence the linter.
    // A config key rather than `--disable-ignore-pragma`: releases without it ignore the key, while an
    // unknown flag would make them exit with a usage error and no report.
    await writeFile(config, 'ignored: []\ndisable-ignore-pragma: true\n', { mode: 0o600 });
    const res = await execTool(
      ctx,
      ['--no-color', '--config', config, '--format', 'json', ...box.files.map(toolArg)],
      { cwd: box.dir, okCodes: [0, 1], label: 'hadolint' },
    );
    return {
      hits: parseHadolint(parseJsonOutput(res.stdout || '[]', 'hadolint'), box.dir, new Set(box.files)),
    };
  },
};

// ---------------------------------------------------------------------------------------------------
// ruff
// ---------------------------------------------------------------------------------------------------

const RuffSchema = z.array(
  z.object({
    code: z.string().nullable().optional(),
    message: z.string(),
    filename: z.string(),
    location: z.object({ row: z.number().int() }).nullable().optional(),
    end_location: z.object({ row: z.number().int() }).nullable().optional(),
    url: z.string().nullable().optional(),
  }),
);

/** Rules selected with `--isolated` (repository config ignored): errors, pyflakes, bugbear, bandit, async. */
const RUFF_SELECT = 'E9,F,B,S,PLE,ASYNC';
/** Style-ish or very noisy rules inside the selected groups. */
const RUFF_IGNORE = 'F401,F403,F405,F541,F811,F841,S101,S311,B008,B905,B904,B028';
/** Bandit rules for real injection/deserialization/TLS sinks (major). */
const RUFF_MAJOR_SECURITY = new Set([
  'S102',
  'S301',
  'S302',
  'S307',
  'S501',
  'S502',
  'S503',
  'S504',
  'S506',
  'S602',
  'S604',
  'S605',
  'S608',
  'S611',
  'S701',
]);

function ruffClassify(code: string): { severity: Severity; category: Category; confidence: number } {
  if (code === 'syntax-error' || code.startsWith('E9'))
    return { severity: 'major', category: 'bug', confidence: 0.6 };
  if (code.startsWith('S')) {
    return RUFF_MAJOR_SECURITY.has(code)
      ? { severity: 'major', category: 'security', confidence: 0.5 }
      : { severity: 'minor', category: 'security', confidence: 0.35 };
  }
  if (/^F8(?:21|22|23)$/.test(code) || code.startsWith('PLE')) {
    return { severity: 'major', category: 'bug', confidence: 0.6 };
  }
  if (code.startsWith('ASYNC')) return { severity: 'minor', category: 'concurrency', confidence: 0.45 };
  return { severity: 'minor', category: 'bug', confidence: 0.45 };
}

/** Parses `ruff check --output-format json`. */
export function parseRuff(json: unknown, baseDir: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = RuffSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'ruff: unexpected json format');
  const hits: RawHit[] = [];
  for (const r of parsed.data) {
    const file = toRepoPath(r.filename, baseDir, known);
    if (!file) continue;
    const code = r.code ?? 'syntax-error';
    const cls = ruffClassify(code);
    const startLine = r.location?.row ?? 1;
    hits.push({
      ruleId: code,
      file,
      startLine,
      endLine: Math.max(startLine, r.end_location?.row ?? startLine),
      ...cls,
      message: r.message,
      help: r.url ?? undefined,
    });
  }
  return hits;
}

const ruff: AnalyzerDef = {
  id: 'ruff',
  label: 'Ruff',
  tier: 'external',
  languages: ['python'],
  description: 'Python linter: pyflakes, bugbear and bandit rules (--isolated: repository config ignored).',
  select: (files) => files.filter((f) => scannable(f) && (f.language === 'python' || /\.pyi$/i.test(f.path))),
  locate: onPath('ruff'),
  async run(ctx) {
    const box = await ctx.sandbox(ctx.files);
    if (box.files.length === 0) return { hits: [] };
    const res = await execTool(
      ctx,
      [
        'check',
        '--isolated',
        '--no-cache',
        '--exit-zero',
        '--ignore-noqa',
        '--output-format',
        'json',
        '--select',
        RUFF_SELECT,
        '--ignore',
        RUFF_IGNORE,
        ...box.files.map(toolArg),
      ],
      { cwd: box.dir, okCodes: [0, 1], label: 'ruff' },
    );
    return { hits: parseRuff(parseJsonOutput(res.stdout || '[]', 'ruff'), box.dir, new Set(box.files)) };
  },
};

// ---------------------------------------------------------------------------------------------------
// cppcheck
// ---------------------------------------------------------------------------------------------------

const CPPCHECK_SEVERITY: Record<
  string,
  { severity: Severity; category: Category; confidence: number } | undefined
> = {
  error: { severity: 'major', category: 'bug', confidence: 0.5 },
  warning: { severity: 'minor', category: 'bug', confidence: 0.45 },
  performance: { severity: 'minor', category: 'performance', confidence: 0.35 },
  portability: { severity: 'info', category: 'bug', confidence: 0.3 },
};

/** Ids that only describe cppcheck's own configuration problems. */
const CPPCHECK_NOISE =
  /^(?:missingInclude\w*|unmatchedSuppression|checkersReport|toomanyconfigs|noValidConfiguration|normalCheckLevelMaxBranches|syntaxError|unknownMacro|preprocessorErrorDirective|internalAstError)$/;

function decodeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function xmlAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1] as string] = decodeXml(m[2] ?? '');
  return out;
}

/** Parses `cppcheck --xml` (version 2) output. */
export function parseCppcheckXml(xml: string, baseDir: string, known: ReadonlySet<string>): RawHit[] {
  const hits: RawHit[] = [];
  for (const m of xml.matchAll(/<error\b([^>]*?)(?:\/>|>([\s\S]*?)<\/error>)/g)) {
    const attrs = xmlAttrs(m[1] ?? '');
    const id = attrs.id ?? 'unknown';
    const cls = attrs.severity ? CPPCHECK_SEVERITY[attrs.severity] : undefined;
    if (!cls || CPPCHECK_NOISE.test(id)) continue;
    const loc = /<location\b([^>]*?)\/?>/.exec(m[2] ?? '');
    const locAttrs = loc ? xmlAttrs(loc[1] ?? '') : {};
    const file = locAttrs.file ? toRepoPath(locAttrs.file, baseDir, known) : undefined;
    const line = Number.parseInt(locAttrs.line ?? '', 10);
    if (!file || !Number.isFinite(line) || line < 1) continue;
    hits.push({
      ruleId: id,
      file,
      startLine: line,
      ...cls,
      category:
        attrs.cwe && /^(?:119|120|121|122|125|131|134|190|415|416|476|562|787|788)$/.test(attrs.cwe)
          ? 'security'
          : cls.category,
      message: attrs.msg ?? attrs.verbose ?? id,
      help: attrs.cwe ? `CWE-${attrs.cwe}` : undefined,
    });
  }
  return hits;
}

/** First cppcheck release whose SARIF output we rely on. */
const SARIF_MIN_CPPCHECK = '2.18';

/** Blanks preprocessor includes so cppcheck never opens files outside the sandbox (line numbers kept). */
export function stripIncludes(content: string): string {
  return content.replace(/^[ \t]*#[ \t]*(?:include|include_next|import|embed)\b[^\n]*/gm, '');
}

const cppcheck: AnalyzerDef = {
  id: 'cppcheck',
  label: 'Cppcheck',
  tier: 'external',
  languages: ['c', 'cpp'],
  description: 'C/C++ static analyzer (includes stripped, no project files, inline suppressions off).',
  select: (files) => files.filter((f) => scannable(f) && (f.language === 'c' || f.language === 'cpp')),
  locate: onPath('cppcheck'),
  async run(ctx) {
    const box = await ctx.sandbox(ctx.files, (f) => stripIncludes(f.content));
    if (box.files.length === 0) return { hits: [] };
    // SARIF output is only used on recent releases; XML (version 2) works everywhere.
    const sarif = !!ctx.version && compareVersions(ctx.version, SARIF_MIN_CPPCHECK) >= 0;
    const out = path.join(box.outDir, sarif ? 'cppcheck.sarif' : 'cppcheck.xml');
    await execTool(
      ctx,
      [
        '--enable=warning,performance,portability',
        '--quiet',
        '--max-configs=1',
        '--suppress=missingIncludeSystem',
        '--suppress=missingInclude',
        ...(sarif ? ['--output-format=sarif'] : ['--xml', '--xml-version=2']),
        `--output-file=${out}`,
        ...box.files.map(toolArg),
      ],
      { cwd: box.dir, okCodes: [0, 1], label: 'cppcheck' },
    );
    const text = await readFile(out, 'utf8').catch(() => '');
    const known = new Set(box.files);
    if (!sarif) return { hits: parseCppcheckXml(text, box.dir, known) };
    if (!text.trim()) return { hits: [] };
    const findings = parseSarif(parseJsonOutput(text, 'cppcheck'));
    return {
      hits: sarifToRawHits(
        findings.filter(
          (f) => !CPPCHECK_NOISE.test(f.ruleId) && (f.level === 'error' || f.level === 'warning'),
        ),
        { baseDir: box.dir, known, confidence: 0.45 },
      ),
    };
  },
};

/** External analyzers, in display order. */
export const EXTERNAL_ANALYZERS: AnalyzerDef[] = [gitleaks, shellcheck, hadolint, ruff, cppcheck];
