import { existsSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Category, Severity } from '../types';
import { resolveInside } from '../util/paths';
import { compareVersions, findExecutable, parseVersion } from './env';
import { AnalyzerError, execTool, firstLine, parseJsonOutput } from './exec';
import { changedLineNumbers } from './lines';
import { repoRelativePath, toolArg, toRepoPath } from './sandbox';
import { severityFromScore } from './sarif';
import type { AnalyzerContext, AnalyzerDef, LocatedBinary, RawHit, SourceFile } from './types';

/*
 * Project analyzers run the repository's own toolchain/config (ESLint configs are JavaScript, tsc and
 * golangci-lint build the code, PHPStan loads bootstrap files, …) or send data over the network. They
 * execute repository code, so they only ever run when the user opted in (`--analyzers <id>` or
 * `analyzers.project` in the global config). They run in the repository root, on the files whose
 * working-tree content equals the reviewed revision.
 */

const JS_LANGS = new Set(['javascript', 'typescript', 'vue', 'svelte']);

function realRoot(ctx: { repoRoot?: string }): string {
  if (!ctx.repoRoot) throw new AnalyzerError('skipped', 'no repository root');
  return ctx.repoRoot;
}

/** Repo-local file that stays inside the root (symlinks included) and is a regular file. */
function repoFile(root: string, rel: string): string | undefined {
  try {
    const abs = resolveInside(root, rel);
    if (!existsSync(abs)) return undefined;
    const st = lstatSync(abs);
    return st.isFile() || st.isSymbolicLink() ? abs : undefined;
  } catch {
    return undefined;
  }
}

/** Finds a package's bin script under `<root>/node_modules/<pkg>` (run with the current Node binary). */
async function nodePackageBin(root: string, pkg: string, bin: string): Promise<LocatedBinary | undefined> {
  const manifest = repoFile(root, `node_modules/${pkg}/package.json`);
  if (!manifest) return undefined;
  try {
    const json = JSON.parse(await readFile(manifest, 'utf8')) as { bin?: string | Record<string, string> };
    const rel = typeof json.bin === 'string' ? json.bin : json.bin?.[bin];
    if (!rel) return undefined;
    const script = repoFile(root, path.posix.join('node_modules', pkg, rel));
    return script ? { command: process.execPath, prefixArgs: [script], trusted: false } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Files of `ctx.files` whose working-tree content equals the reviewed revision (so reported line
 * numbers match); throws `skipped` when none do.
 */
async function matchingFiles(ctx: AnalyzerContext): Promise<SourceFile[]> {
  const root = realRoot(ctx);
  const out: SourceFile[] = [];
  for (const f of ctx.files) {
    const abs = repoFile(root, f.path);
    if (!abs || lstatSync(abs).isSymbolicLink()) continue;
    const disk = await readFile(abs, 'utf8').catch(() => undefined);
    if (disk === f.content) out.push(f);
  }
  if (out.length === 0) {
    throw new AnalyzerError(
      'skipped',
      'the working tree does not match the reviewed revision for any target file',
    );
  }
  return out;
}

async function toolVersion(ctx: AnalyzerContext, cwd: string): Promise<string | undefined> {
  if (ctx.version) return ctx.version;
  try {
    const res = await execTool(ctx, ['--version'], { cwd, label: 'version', okCodes: [0, 1] });
    return parseVersion(`${res.stdout}\n${res.stderr}`);
  } catch (err) {
    if (err instanceof AnalyzerError && err.status === 'timeout') throw err;
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------
// ESLint
// ---------------------------------------------------------------------------------------------------

const EslintSchema = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(
      z.object({
        ruleId: z.string().nullable().optional(),
        severity: z.number(),
        message: z.string(),
        line: z.number().int().optional(),
        endLine: z.number().int().optional(),
        fatal: z.boolean().optional(),
      }),
    ),
  }),
);

/** Formatting / ordering / naming rules: not defects. */
const ESLINT_STYLE =
  /prettier|stylistic|(?:^|\/)(?:indent|quotes|semi|comma-\w+|max-len|eol-last|no-trailing-spaces|padding-\w+|space-\w+|\w+-spacing|sort-\w+|import\/order|simple-import-sort|naming-convention|camelcase|func-style|arrow-body-style|prefer-template|object-shorthand|curly|brace-style|quote-props|lines-between-class-members|no-multiple-empty-lines|newline-\w+)$/;

/** Parses `eslint --format json`. */
export function parseEslint(json: unknown, root: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = EslintSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'eslint: unexpected json format');
  const hits: RawHit[] = [];
  for (const result of parsed.data) {
    const file = toRepoPath(result.filePath, root, known);
    if (!file) continue;
    for (const m of result.messages) {
      const ruleId = m.ruleId ?? (m.fatal ? 'parse-error' : 'eslint');
      if (ESLINT_STYLE.test(ruleId) || !m.line) continue;
      const severity: Severity = m.fatal ? 'major' : m.severity >= 2 ? 'minor' : 'info';
      const category: Category =
        /security|xss|injection|unsanitized|no-eval|no-implied-eval|no-new-func/i.test(ruleId)
          ? 'security'
          : /promise|await|async|floating|misused/i.test(ruleId)
            ? 'concurrency'
            : 'bug';
      hits.push({
        ruleId,
        file,
        startLine: m.line,
        endLine: m.endLine ?? m.line,
        severity,
        category,
        message: m.message,
        confidence: m.fatal ? 0.5 : m.severity >= 2 ? 0.4 : 0.3,
      });
    }
  }
  return hits;
}

const eslint: AnalyzerDef = {
  id: 'eslint',
  label: 'ESLint (repository config)',
  tier: 'project',
  languages: ['javascript', 'typescript', 'vue', 'svelte'],
  description: "The repository's own ESLint with its own config (executes the config and plugins).",
  select: (files) => files.filter((f) => JS_LANGS.has(f.language)),
  locate: async (ctx) => (ctx.repoRoot ? nodePackageBin(ctx.repoRoot, 'eslint', 'eslint') : undefined),
  async run(ctx) {
    const root = realRoot(ctx);
    const files = await matchingFiles(ctx);
    const version = await toolVersion(ctx, root);
    const modern = !version || compareVersions(version, '9') >= 0;
    const res = await execTool(
      ctx,
      [
        '--format',
        'json',
        '--no-color',
        ...(modern ? ['--no-warn-ignored'] : []),
        ...files.map((f) => toolArg(f.path)),
      ],
      { cwd: root, okCodes: [0, 1], label: 'eslint' },
    );
    return {
      hits: parseEslint(parseJsonOutput(res.stdout, 'eslint'), root, new Set(files.map((f) => f.path))),
      version,
    };
  },
};

// ---------------------------------------------------------------------------------------------------
// tsc
// ---------------------------------------------------------------------------------------------------

/** Parses `tsc --pretty false` diagnostics (`file(line,col): error TSxxxx: message`). */
export function parseTsc(output: string, root: string, known: ReadonlySet<string>): RawHit[] {
  const hits: RawHit[] = [];
  let last: RawHit | undefined;
  for (const line of output.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line);
    if (m) {
      last = undefined;
      const file = toRepoPath(m[1] as string, root, known);
      if (!file) continue;
      last = {
        ruleId: m[5] as string,
        file,
        startLine: Number(m[2]),
        severity: m[4] === 'error' ? 'major' : 'minor',
        category: 'bug',
        message: m[6] as string,
        confidence: 0.55,
      };
      hits.push(last);
    } else if (last && /^\s+\S/.test(line) && last.message.length < 400) {
      last.message += ` ${line.trim()}`;
    }
  }
  return hits;
}

const tsc: AnalyzerDef = {
  id: 'tsc',
  label: 'TypeScript compiler',
  tier: 'project',
  languages: ['typescript', 'javascript', 'vue'],
  description: "Type check with the repository's own TypeScript and tsconfig.json (tsc --noEmit -p).",
  select: (files) => files.filter((f) => JS_LANGS.has(f.language)),
  locate: async (ctx) => (ctx.repoRoot ? nodePackageBin(ctx.repoRoot, 'typescript', 'tsc') : undefined),
  async run(ctx) {
    const root = realRoot(ctx);
    if (!repoFile(root, 'tsconfig.json'))
      throw new AnalyzerError('skipped', 'no tsconfig.json in the repository root');
    const files = await matchingFiles(ctx);
    const res = await execTool(ctx, ['--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'], {
      cwd: root,
      okCodes: [0, 1, 2],
      label: 'tsc',
    });
    return { hits: parseTsc(`${res.stdout}\n${res.stderr}`, root, new Set(files.map((f) => f.path))) };
  },
};

// ---------------------------------------------------------------------------------------------------
// golangci-lint
// ---------------------------------------------------------------------------------------------------

const GolangciSchema = z.object({
  Issues: z
    .array(
      z.object({
        FromLinter: z.string(),
        Text: z.string(),
        Pos: z.object({ Filename: z.string(), Line: z.number().int() }),
      }),
    )
    .nullable()
    .optional(),
});

const GO_STYLE_LINTERS = new Set([
  'gofmt',
  'gofumpt',
  'goimports',
  'gci',
  'lll',
  'misspell',
  'whitespace',
  'wsl',
  'godot',
  'stylecheck',
  'revive',
  'dupword',
  'nlreturn',
  'varnamelen',
  'tagliatelle',
  'mnd',
  'funlen',
  'gocognit',
  'cyclop',
  'gocyclo',
  'nestif',
  'dupl',
]);

/** Parses golangci-lint JSON output (v1 and v2 share the `Issues` shape). */
export function parseGolangci(json: unknown, root: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = GolangciSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'golangci-lint: unexpected json format');
  const hits: RawHit[] = [];
  for (const issue of parsed.data.Issues ?? []) {
    if (GO_STYLE_LINTERS.has(issue.FromLinter)) continue;
    const file = toRepoPath(issue.Pos.Filename, root, known);
    if (!file) continue;
    const security = issue.FromLinter === 'gosec';
    hits.push({
      ruleId: issue.FromLinter,
      file,
      startLine: issue.Pos.Line,
      severity: security ? 'major' : 'minor',
      category: security ? 'security' : issue.FromLinter === 'errcheck' ? 'error-handling' : 'bug',
      message: issue.Text,
      confidence: 0.45,
    });
  }
  return hits;
}

const golangci: AnalyzerDef = {
  id: 'golangci-lint',
  label: 'golangci-lint',
  tier: 'project',
  languages: ['go'],
  description: "golangci-lint with the repository's config (builds packages via the Go toolchain).",
  select: (files) => files.filter((f) => f.language === 'go'),
  locate: async (ctx) => {
    const command = await findExecutable('golangci-lint', ctx.env, ctx.repoRoot);
    return command ? { command, prefixArgs: [], trusted: true } : undefined;
  },
  async run(ctx) {
    const root = realRoot(ctx);
    const files = await matchingFiles(ctx);
    const dirs = [...new Set(files.map((f) => path.posix.dirname(f.path)))].sort();
    const targets = dirs.map((d) => (d === '.' ? '.' : toolArg(d)));
    const v2 = !ctx.version || compareVersions(ctx.version, '2') >= 0;
    const box = await ctx.sandbox([]);
    const report = path.join(box.outDir, 'golangci.json');
    const args = v2
      ? ['run', `--output.json.path=${report}`, '--issues-exit-code=0', '--show-stats=false', ...targets]
      : ['run', '--out-format=json', '--issues-exit-code=0', ...targets];
    // Never let a `toolchain` directive download and run another Go toolchain.
    const goCtx: AnalyzerContext = { ...ctx, env: { ...ctx.env, GOTOOLCHAIN: 'local' } };
    const res = await execTool(goCtx, args, { cwd: root, okCodes: [0], label: 'golangci-lint' });
    const text = v2 ? await readFile(report, 'utf8').catch(() => '') : res.stdout;
    return {
      hits: parseGolangci(
        parseJsonOutput(text || '{}', 'golangci-lint'),
        root,
        new Set(files.map((f) => f.path)),
      ),
    };
  },
};

// ---------------------------------------------------------------------------------------------------
// PHPStan
// ---------------------------------------------------------------------------------------------------

const PhpstanSchema = z.object({
  files: z
    .union([
      z.record(
        z.string(),
        z.object({
          messages: z.array(z.object({ message: z.string(), line: z.number().int().nullable().optional() })),
        }),
      ),
      z.array(z.unknown()),
    ])
    .optional(),
});

/** Parses `phpstan analyse --error-format=json`. */
export function parsePhpstan(json: unknown, root: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = PhpstanSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'phpstan: unexpected json format');
  const hits: RawHit[] = [];
  const files = parsed.data.files;
  if (!files || Array.isArray(files)) return hits; // PHP encodes an empty map as []
  for (const [reported, entry] of Object.entries(files)) {
    const file = toRepoPath(reported, root, known);
    if (!file) continue;
    for (const m of entry.messages) {
      if (!m.line) continue;
      hits.push({
        ruleId: 'phpstan',
        file,
        startLine: m.line,
        severity: 'major',
        category: 'bug',
        message: m.message,
        confidence: 0.45,
      });
    }
  }
  return hits;
}

const phpstan: AnalyzerDef = {
  id: 'phpstan',
  label: 'PHPStan',
  tier: 'project',
  languages: ['php'],
  description: "PHPStan with the repository's phpstan.neon (loads bootstrap files and extensions).",
  select: (files) => files.filter((f) => f.language === 'php'),
  locate: async (ctx) => {
    if (ctx.repoRoot) {
      const local = repoFile(ctx.repoRoot, 'vendor/bin/phpstan');
      const php = local ? await findExecutable('php', ctx.env, ctx.repoRoot) : undefined;
      if (local && php) return { command: php, prefixArgs: [local], trusted: false };
    }
    const global = await findExecutable('phpstan', ctx.env, ctx.repoRoot);
    return global ? { command: global, prefixArgs: [], trusted: true } : undefined;
  },
  async run(ctx) {
    const root = realRoot(ctx);
    const files = await matchingFiles(ctx);
    const res = await execTool(
      ctx,
      [
        'analyse',
        '--error-format=json',
        '--no-progress',
        '--no-interaction',
        ...files.map((f) => toolArg(f.path)),
      ],
      { cwd: root, okCodes: [0, 1], label: 'phpstan' },
    );
    return {
      hits: parsePhpstan(parseJsonOutput(res.stdout, 'phpstan'), root, new Set(files.map((f) => f.path))),
    };
  },
};

// ---------------------------------------------------------------------------------------------------
// Semgrep / Opengrep
// ---------------------------------------------------------------------------------------------------

const SemgrepSchema = z.object({
  results: z.array(
    z.object({
      check_id: z.string(),
      path: z.string(),
      start: z.object({ line: z.number().int() }),
      end: z.object({ line: z.number().int() }).optional(),
      extra: z
        .object({
          message: z.string().optional(),
          severity: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    }),
  ),
});

const SEMGREP_CONFIDENCE: Record<string, number> = { HIGH: 0.6, MEDIUM: 0.45, LOW: 0.3 };

/** Parses `semgrep/opengrep scan --json`. */
export function parseSemgrep(json: unknown, root: string, known: ReadonlySet<string>): RawHit[] {
  const parsed = SemgrepSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'semgrep: unexpected json format');
  const hits: RawHit[] = [];
  for (const r of parsed.data.results) {
    const file = toRepoPath(r.path, root, known);
    if (!file) continue;
    const meta = r.extra?.metadata ?? {};
    const sev = (r.extra?.severity ?? '').toUpperCase();
    const severity: Severity = sev === 'ERROR' ? 'major' : sev === 'WARNING' ? 'minor' : 'info';
    const metaCategory = typeof meta.category === 'string' ? meta.category : '';
    const category: Category =
      metaCategory === 'security' || meta.cwe !== undefined
        ? 'security'
        : metaCategory === 'performance'
          ? 'performance'
          : 'bug';
    const confidence =
      typeof meta.confidence === 'string' ? SEMGREP_CONFIDENCE[meta.confidence.toUpperCase()] : undefined;
    const refs = Array.isArray(meta.references) ? meta.references.filter((x) => typeof x === 'string') : [];
    hits.push({
      ruleId: r.check_id,
      file,
      startLine: r.start.line,
      endLine: r.end?.line ?? r.start.line,
      severity,
      category,
      message: r.extra?.message ?? r.check_id,
      confidence: confidence ?? 0.45,
      help: (refs[0] as string | undefined) ?? (typeof meta.source === 'string' ? meta.source : undefined),
    });
  }
  return hits;
}

function semgrepLike(id: 'semgrep' | 'opengrep', label: string): AnalyzerDef {
  return {
    id,
    label,
    tier: 'project',
    network: true,
    languages: ['*'],
    description: `${label} with the p/default registry ruleset (downloads rules; --metrics=off; nosem comments ignored).`,
    select: (files) => files.filter((f) => f.content.length <= 2_000_000 && !f.content.includes('\u0000')),
    locate: async (ctx) => {
      const command = await findExecutable(id, ctx.env, ctx.repoRoot);
      return command ? { command, prefixArgs: [], trusted: true } : undefined;
    },
    async run(ctx) {
      const root = realRoot(ctx);
      const files = await matchingFiles(ctx);
      const res = await execTool(
        ctx,
        [
          'scan',
          '--config',
          'p/default',
          '--json',
          '--metrics=off',
          '--disable-version-check',
          '--disable-nosem',
          '--quiet',
          ...files.map((f) => toolArg(f.path)),
        ],
        { cwd: root, okCodes: [0, 1], label: id },
      );
      return { hits: parseSemgrep(parseJsonOutput(res.stdout, id), root, new Set(files.map((f) => f.path))) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// osv-scanner
// ---------------------------------------------------------------------------------------------------

/** Dependency manifests and lockfiles (by file name), per ecosystem. */
const MANIFEST_ECOSYSTEMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['npm', /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock)$/],
  ['pypi', /^(?:requirements[\w.-]*\.txt|Pipfile(?:\.lock)?|poetry\.lock|pyproject\.toml|uv\.lock)$/],
  ['go', /^go\.(?:mod|sum)$/],
  ['cargo', /^Cargo\.(?:toml|lock)$/],
  ['composer', /^composer\.(?:json|lock)$/],
  ['rubygems', /^Gemfile(?:\.lock)?$/],
  ['maven', /^(?:pom\.xml|build\.gradle(?:\.kts)?|gradle\.lockfile)$/],
  ['nuget', /^(?:packages\.lock\.json|[\w.-]+\.csproj)$/],
  ['hex', /^mix\.lock$/],
  ['pub', /^pubspec\.(?:yaml|lock)$/],
];

/**
 * `<directory>:<ecosystem>` of a manifest or lockfile (undefined for other files). A vulnerable package
 * found in one file of a group concerns the others too (package-lock.json ↔ package.json).
 */
function manifestGroup(file: string): string | undefined {
  const name = path.posix.basename(file);
  const ecosystem = MANIFEST_ECOSYSTEMS.find(([, re]) => re.test(name))?.[0];
  return ecosystem ? `${path.posix.dirname(file)}:${ecosystem}` : undefined;
}

const OsvSchema = z.object({
  results: z
    .array(
      z.object({
        source: z.object({ path: z.string() }).optional(),
        packages: z
          .array(
            z.object({
              package: z.object({ name: z.string(), version: z.string().optional() }),
              vulnerabilities: z
                .array(
                  z.object({
                    id: z.string(),
                    summary: z.string().optional(),
                    database_specific: z.object({ severity: z.string().optional() }).optional(),
                  }),
                )
                .optional(),
              groups: z
                .array(z.object({ ids: z.array(z.string()), max_severity: z.string().optional() }))
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .nullable()
    .optional(),
});

const TEXT_SEVERITY: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'major',
  MODERATE: 'minor',
  MEDIUM: 'minor',
  LOW: 'info',
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Maps osv-scanner results onto changed manifest lines that mention the vulnerable package, so only
 * dependencies touched by the change are reported (non-rejectable: known CVEs are facts, not guesses).
 * A result only lands on `manifests` of its own group (the file it was found in — `source.path`,
 * relative to `root` or absolute — and same-ecosystem files in that directory). Results without a
 * source, or found in a `stale` manifest (whose working tree is not the reviewed revision), are dropped.
 */
export function parseOsv(
  json: unknown,
  manifests: SourceFile[],
  opts: { root?: string; stale?: ReadonlySet<string> } = {},
): RawHit[] {
  const parsed = OsvSchema.safeParse(json);
  if (!parsed.success) throw new AnalyzerError('failed', 'osv-scanner: unexpected json format');
  const hits: RawHit[] = [];
  const groups = new Map<string, Array<{ file: SourceFile; lines: string[] }>>();
  for (const file of manifests) {
    const group = manifestGroup(file.path);
    if (!group) continue;
    const members = groups.get(group) ?? [];
    members.push({ file, lines: file.content.split(/\r?\n/) });
    groups.set(group, members);
  }
  for (const result of parsed.data.results ?? []) {
    const source = result.source && repoRelativePath(result.source.path, opts.root ?? '.');
    if (!source || opts.stale?.has(source)) continue;
    const targets = groups.get(manifestGroup(source) ?? '');
    if (!targets) continue;
    for (const pkg of result.packages ?? []) {
      const vulns = pkg.vulnerabilities ?? [];
      if (vulns.length === 0) continue;
      const scores = (pkg.groups ?? [])
        .map((g) => Number.parseFloat(g.max_severity ?? ''))
        .filter(Number.isFinite);
      const textSev = vulns
        .map((v) => TEXT_SEVERITY[(v.database_specific?.severity ?? '').toUpperCase()])
        .filter((s): s is Severity => !!s);
      const order: Severity[] = ['critical', 'major', 'minor', 'info'];
      const severity: Severity = scores.length
        ? severityFromScore(Math.max(...scores))
        : (order.find((s) => textSev.includes(s)) ?? 'major');
      const ids = vulns.map((v) => v.id).sort();
      const name = pkg.package.name;
      const needle = new RegExp(String.raw`(?:^|[\s"'/:=@])${escapeRegex(name)}(?:$|[\s"'@=:<>~^!,\]])`);
      for (const { file, lines } of targets) {
        for (const n of changedLineNumbers(file, lines.length)) {
          if (!needle.test(lines[n - 1] ?? '')) continue;
          hits.push({
            ruleId: ids[0] ?? 'osv',
            file: file.path,
            startLine: n,
            severity,
            category: 'security',
            message: `Dependency ${name}${pkg.package.version ? `@${pkg.package.version}` : ''} has known vulnerabilities: ${ids.slice(0, 5).join(', ')}${vulns[0]?.summary ? ` — ${vulns[0].summary}` : ''}`,
            confidence: 0.7,
            help: ids[0] ? `https://osv.dev/vulnerability/${ids[0]}` : undefined,
            nonRejectable: true,
          });
          break;
        }
      }
    }
  }
  return hits;
}

const osvScanner: AnalyzerDef = {
  id: 'osv-scanner',
  label: 'OSV-Scanner',
  tier: 'project',
  network: true,
  languages: ['*'],
  description:
    'Known-vulnerable dependencies in changed manifests/lockfiles (sends package lists to osv.dev).',
  select: (files) => files.filter((f) => manifestGroup(f.path) !== undefined),
  locate: async (ctx) => {
    const command = await findExecutable('osv-scanner', ctx.env, ctx.repoRoot);
    return command ? { command, prefixArgs: [], trusted: true } : undefined;
  },
  async run(ctx) {
    const root = realRoot(ctx);
    // The scan reads the working tree: report only on manifests whose content there is the reviewed one.
    const files = await matchingFiles(ctx);
    const stale = new Set(ctx.files.filter((f) => !files.includes(f)).map((f) => f.path));
    const v2 = !ctx.version || compareVersions(ctx.version, '2') >= 0;
    const args = v2
      ? ['scan', 'source', '--format', 'json', '--recursive', '.']
      : ['--format', 'json', '--recursive', '.'];
    const res = await execTool(ctx, args, { cwd: root, okCodes: [0, 1, 128], label: 'osv-scanner' });
    if (res.exitCode === 128 || !res.stdout.trim()) return { hits: [] };
    try {
      return { hits: parseOsv(JSON.parse(res.stdout), files, { root, stale }) };
    } catch (err) {
      if (err instanceof AnalyzerError) throw err;
      throw new AnalyzerError('failed', `osv-scanner: output is not JSON (${firstLine(res.stdout)})`);
    }
  },
};

/** Opt-in project analyzers, in display order. */
export const PROJECT_ANALYZERS: AnalyzerDef[] = [
  eslint,
  tsc,
  golangci,
  phpstan,
  semgrepLike('semgrep', 'Semgrep'),
  semgrepLike('opengrep', 'Opengrep'),
  osvScanner,
];
