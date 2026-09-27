import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AnalyzeFile,
  detectAnalyzers,
  listAnalyzers,
  runAnalyzers,
  skillsForHits,
} from '../src/analyzers';
import { findExecutable, isInside, scrubEnv } from '../src/analyzers/env';
import { createSandbox, safeRelativePath, toRepoPath } from '../src/analyzers/sandbox';
import { scanSecrets } from '../src/analyzers/secrets';
import { type AnalyzerSettings, DEFAULT_CONFIG } from '../src/config/schema';
import { detectLanguage } from '../src/util/language';
import { ProcessRegistry } from '../src/util/processes';

const POSIX = process.platform !== 'win32';

function settings(overrides: Partial<AnalyzerSettings> = {}): AnalyzerSettings {
  return { ...structuredClone(DEFAULT_CONFIG.analyzers), ...overrides };
}

function af(p: string, content: string, changedRanges: Array<[number, number]> = []): AnalyzeFile {
  return { path: p, content, language: detectLanguage(p), changedRanges };
}

/** A GitHub-classic-token-shaped string assembled at runtime (the repository never contains one). */
function fakeGithubToken(): string {
  const alphabet = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5kL7';
  const body = Array.from({ length: 36 }, (_, i) => alphabet[(i * 7) % alphabet.length]).join('');
  return ['gh', 'p_', body].join('');
}

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'cr-analyzers-test-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function dir(name: string): string {
  const d = path.join(scratch, name);
  mkdirSync(d, { recursive: true });
  return d;
}

function script(binDir: string, name: string, body: string): string {
  const p = path.join(binDir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

/** Env for tests: only our fake bin dir (plus an empty dir) on PATH, so real tools are never picked up. */
function envWith(binDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: [binDir, dir('empty-path')].join(path.delimiter), HOME: scratch, LANG: 'C', ...extra };
}

const FAKE_SHELLCHECK = `
if [ "$1" = "--version" ]; then
  echo "ShellCheck - shell script analysis tool"
  echo "version: 0.11.0"
  exit 0
fi
log="$CR_FAKE_LOG"
printf '%s\\n' "$@" > "$log/args"
/bin/pwd > "$log/cwd"
/usr/bin/env > "$log/env"
for last; do :; done
/bin/cat "$last" > "$log/content"
printf '{"comments":[{"file":"%s","line":2,"endLine":2,"column":6,"endColumn":10,"level":"warning","code":2086,"message":"Double quote to prevent globbing and word splitting.","fix":null}]}' "$last"
exit 1`;

describe('built-in secrets analyzer', () => {
  it('finds a token, redacts it everywhere and ignores inline secretlint-disable comments', async () => {
    const token = fakeGithubToken();
    const content = `const a = 1;\n// secretlint-disable-next-line\nconst token = "${token}";\n`;
    const hits = await scanSecrets(af('src/config.ts', content));
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(hit).toMatchObject({ ruleId: 'github', startLine: 3, severity: 'critical', nonRejectable: true });
    const serialized = JSON.stringify(hits);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(token.slice(4, 16));
    expect(hit?.message).toMatch(/^Hard-coded secret: .*\[REDACTED\]/);
  });

  it('reports through runAnalyzers with a non-rejectable critical hit and a suppression hint', async () => {
    const token = fakeGithubToken();
    const content = `const a = 1;\n// secretlint-disable-next-line\nconst token = "${token}";\n`;
    const { hits, runs } = await runAnalyzers({
      files: [af('src/config.ts', content, [[2, 3]])],
      settings: settings({ external: 'off' }),
      mode: 'diff',
    });
    expect(runs.map((r) => [r.id, r.status])).toEqual([
      ['secrets', 'ok'],
      ['patterns', 'ok'],
      ['suppressions', 'ok'],
    ]);
    expect(hits.find((h) => h.analyzer === 'secrets')).toMatchObject({
      severity: 'critical',
      nonRejectable: true,
    });
    expect(hits.find((h) => h.analyzer === 'suppressions')).toMatchObject({
      ruleId: 'secretlint-disable',
      severity: 'info',
      startLine: 2,
    });
    expect(JSON.stringify(hits)).not.toContain(token);
  });
});

describe('suppression hints', () => {
  const code = [
    'const x = 1; // eslint-disable-line no-eval', // 1 (unchanged)
    '// eslint-disable-next-line no-eval', // 2
    'const y = eval(s);', // 3
    'value = compute()  # noqa: E501', // 4
    'run(cmd) // @ts-ignore', // 5
    'ok();', // 6
  ].join('\n');

  it('flags suppressions on changed lines only (diff mode)', async () => {
    const { hits } = await runAnalyzers({
      files: [af('src/a.ts', code, [[2, 5]])],
      settings: settings({ external: 'off' }),
      mode: 'diff',
    });
    const sup = hits.filter((h) => h.analyzer === 'suppressions');
    expect(sup.map((h) => [h.ruleId, h.startLine])).toEqual([
      ['eslint-disable', 2],
      ['noqa', 4],
      ['ts-ignore', 5],
    ]);
    expect(sup.every((h) => h.severity === 'info')).toBe(true);
    expect(hits.find((h) => h.ruleId === 'js-eval')?.startLine).toBe(3);
  });

  it('does not run in files mode', async () => {
    const { hits, runs } = await runAnalyzers({
      files: [af('src/a.ts', code)],
      settings: settings({ external: 'off' }),
      mode: 'files',
    });
    expect(runs.some((r) => r.id === 'suppressions')).toBe(false);
    expect(hits.some((h) => h.analyzer === 'suppressions')).toBe(false);
  });
});

describe('diff-line filtering and ids', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`);
  lines[1] = 'const a = eval(x);'; // line 2
  lines[14] = 'const b = eval(y);'; // line 15
  const content = lines.join('\n');

  it('keeps only hits on/near changed lines', async () => {
    const { hits } = await runAnalyzers({
      files: [af('src/a.ts', content, [[15, 15]])],
      settings: settings({ external: 'off' }),
      mode: 'diff',
    });
    expect(hits.map((h) => [h.ruleId, h.startLine])).toEqual([['js-eval', 15]]);
  });

  it('assigns deterministic ids ordered by file, line, analyzer and rule', async () => {
    const files = [
      af('src/b.py', 'subprocess.run(cmd, shell=True)\nobj = pickle.loads(blob)\n'),
      af('src/a.ts', content),
      af('Dockerfile', 'FROM node:latest\nUSER root\n'),
    ];
    const first = await runAnalyzers({ files, settings: settings({ external: 'off' }), mode: 'files' });
    const second = await runAnalyzers({
      files: [...files].reverse(),
      settings: settings({ external: 'off' }),
      mode: 'files',
    });
    expect(second.hits).toEqual(first.hits);
    expect(first.hits.map((h) => h.id)).toEqual(first.hits.map((_, i) => `H${i + 1}`));
    expect(first.hits.map((h) => `${h.file}:${h.startLine}:${h.ruleId}`)).toEqual([
      'Dockerfile:1:docker-unpinned-image',
      'Dockerfile:2:docker-user-root',
      'src/a.ts:2:js-eval',
      'src/a.ts:15:js-eval',
      'src/b.py:1:py-shell-true',
      'src/b.py:2:py-pickle-load',
    ]);
    expect(skillsForHits(first.hits)).toEqual([
      'infra/docker/core',
      'javascript/security/code-execution',
      'python/security/deserialization',
      'python/security/injection',
    ]);
  });

  it('honours settings.builtin and settings.disabled', async () => {
    const files = [af('src/a.ts', content)];
    const off = await runAnalyzers({
      files,
      settings: settings({ builtin: false, external: 'off' }),
      mode: 'files',
    });
    expect(off).toEqual({ hits: [], runs: [] });
    const disabled = await runAnalyzers({
      files,
      settings: settings({ external: 'off', disabled: ['patterns'] }),
      mode: 'files',
    });
    expect(disabled.runs.map((r) => r.id)).toEqual(['secrets']);
    expect(disabled.hits).toEqual([]);
  });

  it('never throws on odd input (unsafe paths, duplicates, NUL bytes)', async () => {
    const { hits } = await runAnalyzers({
      files: [
        af('../escape.ts', 'eval(x);'),
        af('/abs.ts', 'eval(x);'),
        af('src/bin.ts', 'eval(x);\u0000'),
        af('src/a.ts', 'eval(x);'),
        af('src/a.ts', 'ok();'),
      ],
      settings: settings({ external: 'off' }),
      mode: 'files',
    });
    expect(hits.map((h) => h.file)).toEqual(['src/a.ts']);
  });
});

describe.skipIf(!POSIX)('external analyzers (fake executables)', () => {
  it('runs a PATH tool in a scrubbed sandbox and parses its output', async () => {
    const bin = dir('bin-ok');
    const log = dir('log-ok');
    const repo = dir('repo-ok');
    script(bin, 'shellcheck', FAKE_SHELLCHECK);
    const content = '#!/bin/sh\nrm -rf $TARGET/\n';
    const runs: string[] = [];
    const registry = new ProcessRegistry();
    const { hits, runs: records } = await runAnalyzers({
      files: [af('scripts/deploy.sh', content, [[2, 2]]), af('.shellcheckrc', 'external-sources=true\n')],
      settings: settings({ builtin: false }),
      mode: 'diff',
      repoRoot: repo,
      registry,
      env: envWith(bin, {
        CR_FAKE_LOG: log,
        GITHUB_TOKEN: 'gh-test-value',
        AWS_SECRET_ACCESS_KEY: 'aws-test-value',
        DB_PASSWORD: 'pw-test-value',
        SAFE_VARIABLE: 'kept',
      }),
      onRun: (r) => runs.push(`${r.id}:${r.status}`),
    });
    expect(runs).toEqual(['shellcheck:ok']);
    expect(records).toEqual([
      expect.objectContaining({
        id: 'shellcheck',
        tier: 'external',
        status: 'ok',
        hits: 1,
        version: '0.11.0',
      }),
    ]);
    expect(hits).toEqual([
      expect.objectContaining({
        id: 'H1',
        analyzer: 'shellcheck',
        ruleId: 'SC2086',
        file: 'scripts/deploy.sh',
        startLine: 2,
        severity: 'minor',
      }),
    ]);
    const args = readFileSync(path.join(log, 'args'), 'utf8').trim().split('\n');
    expect(args).toContain('--norc');
    expect(args).not.toContain('-x');
    expect(args.at(-1)).toBe('./scripts/deploy.sh');
    expect(readFileSync(path.join(log, 'content'), 'utf8')).toBe(content);
    const cwd = readFileSync(path.join(log, 'cwd'), 'utf8').trim();
    expect(isInside(repo, cwd)).toBe(false);
    expect(existsSync(cwd)).toBe(false); // sandbox removed afterwards
    const env = readFileSync(path.join(log, 'env'), 'utf8');
    expect(env).toContain('SAFE_VARIABLE=kept');
    expect(env).not.toMatch(/GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|DB_PASSWORD/);
    expect(registry.size).toBe(0);
  });

  it('ignores PATH entries inside the repository', async () => {
    const repo = dir('repo-path');
    const repoBin = path.join(repo, 'tools', 'bin');
    mkdirSync(repoBin, { recursive: true });
    const marker = path.join(scratch, 'repo-shellcheck-ran');
    script(repoBin, 'shellcheck', `echo ran > "${marker}"\necho "version: 9.9.9"`);
    const { hits, runs } = await runAnalyzers({
      files: [af('a.sh', 'echo $x\n')],
      settings: settings({ builtin: false }),
      mode: 'files',
      repoRoot: repo,
      env: envWith(repoBin),
    });
    // Tools that are not installed are simply not part of the run.
    expect(runs).toEqual([]);
    expect(hits).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    expect(await findExecutable('shellcheck', envWith(repoBin), repo)).toBeUndefined();
    expect(await findExecutable('shellcheck', envWith(repoBin))).toBe(path.join(repoBin, 'shellcheck'));
  });

  it('ignores node_modules/.bin and relative PATH entries', async () => {
    const nm = path.join(dir('outside-pkg'), 'node_modules', '.bin');
    mkdirSync(nm, { recursive: true });
    script(nm, 'hadolint', 'echo 2.0.0');
    const env = { PATH: [nm, 'relative/bin', ''].join(path.delimiter) };
    expect(await findExecutable('hadolint', env)).toBeUndefined();
  });

  it('kills the tool when it exceeds the timeout', async () => {
    const bin = dir('bin-slow');
    const log = dir('log-slow');
    script(
      bin,
      'shellcheck',
      `if [ "$1" = "--version" ]; then echo "version: 0.11.0"; exit 0; fi\necho $$ > "$CR_FAKE_LOG/pid"\nexec /bin/sleep 30`,
    );
    const registry = new ProcessRegistry();
    const started = Date.now();
    const { hits, runs } = await runAnalyzers({
      files: [af('a.sh', 'echo $x\n')],
      settings: settings({ builtin: false, timeoutMs: 700 }),
      mode: 'files',
      registry,
      env: envWith(bin, { CR_FAKE_LOG: log }),
    });
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(runs).toEqual([expect.objectContaining({ id: 'shellcheck', status: 'timeout' })]);
    expect(runs[0]?.reason).toMatch(/timed out after 700 ms/);
    expect(hits).toEqual([]);
    const pid = Number(readFileSync(path.join(log, 'pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(registry.size).toBe(0);
  });

  it('stops promptly when the review is interrupted', async () => {
    const bin = dir('bin-abort');
    script(
      bin,
      'shellcheck',
      `if [ "$1" = "--version" ]; then echo "version: 0.11.0"; exit 0; fi\nexec /bin/sleep 30`,
    );
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 300);
    const { runs } = await runAnalyzers({
      files: [af('a.sh', 'echo $x\n')],
      settings: settings({ builtin: false, timeoutMs: 20_000 }),
      mode: 'files',
      signal: controller.signal,
      env: envWith(bin),
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(runs).toEqual([
      expect.objectContaining({ id: 'shellcheck', status: 'failed', reason: 'interrupted' }),
    ]);
  });

  it('turns unparsable output into a failed run instead of throwing', async () => {
    const bin = dir('bin-garbage');
    script(
      bin,
      'shellcheck',
      'if [ "$1" = "--version" ]; then echo "version: 0.11.0"; exit 0; fi\necho "not json"; exit 1',
    );
    const { hits, runs } = await runAnalyzers({
      files: [af('a.sh', 'echo $x\n')],
      settings: settings({ builtin: false }),
      mode: 'files',
      env: envWith(bin),
    });
    expect(hits).toEqual([]);
    expect(runs[0]).toMatchObject({ id: 'shellcheck', status: 'failed' });
    expect(runs[0]?.reason).toMatch(/not JSON/);
  });

  it('runs gitleaks with our own config, never copies repository tool configs, and dedupes with secretlint', async () => {
    const bin = dir('bin-gitleaks');
    const log = dir('log-gitleaks');
    script(
      bin,
      'gitleaks',
      `if [ "$1" = "version" ]; then echo "8.30.1"; exit 0; fi
printf '%s\\n' "$@" > "$CR_FAKE_LOG/args"
/bin/ls -A . > "$CR_FAKE_LOG/listing"
report=""; config=""
while [ $# -gt 0 ]; do
  case "$1" in
    --report-path) report="$2"; shift ;;
    --config) config="$2"; shift ;;
  esac
  shift
done
/bin/cat "$config" > "$CR_FAKE_LOG/config"
printf '[{"RuleID":"generic-api-key","Description":"Detected a Generic API Key","StartLine":2,"EndLine":2,"File":"src/app.ts","Match":"REDACTED","Secret":"REDACTED"}]' > "$report"`,
    );
    const token = fakeGithubToken();
    const { hits, runs } = await runAnalyzers({
      files: [
        af('src/app.ts', `const a = 1;\nconst key = "${token}";\n`),
        af('.gitleaks.toml', '[allowlist]\npaths = ["src/.*"]\n'),
        af('.gitleaksignore', 'src/app.ts:generic-api-key:2\n'),
      ],
      settings: settings({ disabled: ['patterns'] }),
      mode: 'files',
      env: envWith(bin, { CR_FAKE_LOG: log }),
    });
    expect(runs.map((r) => [r.id, r.status, r.version])).toEqual([
      ['secrets', 'ok', undefined],
      ['gitleaks', 'ok', '8.30.1'],
    ]);
    const args = readFileSync(path.join(log, 'args'), 'utf8').trim().split('\n');
    expect(args[0]).toBe('dir');
    expect(args).toEqual(expect.arrayContaining(['--redact', '--report-format', 'json', '--no-banner']));
    const listing = readFileSync(path.join(log, 'listing'), 'utf8').trim().split('\n');
    expect(listing).toEqual(['src']);
    expect(readFileSync(path.join(log, 'config'), 'utf8')).toContain('useDefault = true');
    // secretlint (critical) and gitleaks (major, generic rule) found the same line: one hint survives.
    expect(hits).toEqual([
      expect.objectContaining({
        id: 'H1',
        analyzer: 'secrets',
        startLine: 2,
        severity: 'critical',
        nonRejectable: true,
      }),
    ]);
    expect(JSON.stringify(hits)).not.toContain(token);
  });

  it('does not run external tools when settings.external is off', async () => {
    const bin = dir('bin-off');
    const marker = path.join(scratch, 'off-ran');
    script(bin, 'shellcheck', `echo ran > "${marker}"`);
    const { runs } = await runAnalyzers({
      files: [af('a.sh', 'echo $x\n')],
      settings: settings({ builtin: false, external: 'off' }),
      mode: 'files',
      env: envWith(bin),
    });
    expect(runs).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });
});

describe.skipIf(!POSIX)('project analyzers (opt-in only)', () => {
  const FAKE_SEMGREP = `
echo call >> "$CR_FAKE_LOG/calls"
if [ "$1" = "--version" ]; then echo "1.178.0"; exit 0; fi
printf '%s\\n' "$@" > "$CR_FAKE_LOG/args"
/bin/pwd > "$CR_FAKE_LOG/cwd"
printf '{"results":[{"check_id":"python.lang.security.dangerous-subprocess-use","path":"app/main.py","start":{"line":2,"col":1},"end":{"line":2,"col":30},"extra":{"message":"Detected subprocess call with shell=True","severity":"ERROR","metadata":{"category":"security","confidence":"HIGH","cwe":["CWE-78"]}}}],"errors":[]}'`;
  const content = 'import subprocess\nsubprocess.call(cmd, shell=True)\n';

  function setup(name: string) {
    const bin = dir(`bin-${name}`);
    const log = dir(`log-${name}`);
    const repo = dir(`repo-${name}`);
    mkdirSync(path.join(repo, 'app'), { recursive: true });
    writeFileSync(path.join(repo, 'app', 'main.py'), content);
    script(bin, 'semgrep', FAKE_SEMGREP);
    return { bin, log, repo };
  }

  it('never runs (or even probes) a project analyzer without opt-in', async () => {
    const { bin, log, repo } = setup('no-optin');
    const { runs } = await runAnalyzers({
      files: [af('app/main.py', content)],
      settings: settings({ builtin: false, external: 'off' }),
      mode: 'files',
      repoRoot: repo,
      env: envWith(bin, { CR_FAKE_LOG: log }),
    });
    expect(runs).toEqual([]);
    expect(existsSync(path.join(log, 'calls'))).toBe(false);
  });

  it('runs in the repository root when opted in on the command line', async () => {
    const { bin, log, repo } = setup('optin');
    const { hits, runs } = await runAnalyzers({
      files: [af('app/main.py', content)],
      settings: settings({ builtin: false, external: 'off' }),
      mode: 'files',
      repoRoot: repo,
      projectOptIn: ['semgrep', 'no-such-tool'],
      env: envWith(bin, { CR_FAKE_LOG: log }),
    });
    expect(runs.map((r) => [r.id, r.status, r.reason])).toEqual([
      ['semgrep', 'ok', undefined],
      ['no-such-tool', 'skipped', 'unknown analyzer'],
    ]);
    expect(hits).toEqual([
      expect.objectContaining({
        analyzer: 'semgrep',
        file: 'app/main.py',
        startLine: 2,
        severity: 'major',
        category: 'security',
      }),
    ]);
    const args = readFileSync(path.join(log, 'args'), 'utf8').trim().split('\n');
    expect(args).toEqual(expect.arrayContaining(['--metrics=off', '--json', 'p/default', './app/main.py']));
    expect(readFileSync(path.join(log, 'cwd'), 'utf8').trim()).toBe(realpathSync(repo));
  });

  it('skips files whose working-tree content differs from the reviewed revision', async () => {
    const { bin, log, repo } = setup('stale');
    const { runs } = await runAnalyzers({
      files: [af('app/main.py', `${content}# changed in the reviewed revision\n`)],
      settings: settings({ builtin: false, external: 'off', project: ['semgrep'] }),
      mode: 'files',
      repoRoot: repo,
      env: envWith(bin, { CR_FAKE_LOG: log }),
    });
    expect(runs).toEqual([expect.objectContaining({ id: 'semgrep', status: 'skipped' })]);
    expect(runs[0]?.reason).toMatch(/working tree does not match/);
    expect(existsSync(path.join(log, 'args'))).toBe(false);
  });
});

describe('listing and detection', () => {
  it('lists every tier', () => {
    const list = listAnalyzers();
    const ids = list.map((a) => a.id);
    expect(ids.slice(0, 3)).toEqual(['secrets', 'patterns', 'suppressions']);
    expect(ids).toEqual(
      expect.arrayContaining([
        'gitleaks',
        'shellcheck',
        'hadolint',
        'ruff',
        'cppcheck',
        'eslint',
        'tsc',
        'semgrep',
        'osv-scanner',
      ]),
    );
    expect(new Set(list.map((a) => a.tier))).toEqual(new Set(['builtin', 'external', 'project']));
  });

  it.skipIf(!POSIX)('detects PATH tools without executing repository-local ones', async () => {
    const bin = dir('bin-detect');
    script(bin, 'shellcheck', 'echo "version: 0.10.0"');
    const repo = dir('repo-detect');
    const eslintDir = path.join(repo, 'node_modules', 'eslint');
    mkdirSync(path.join(eslintDir, 'bin'), { recursive: true });
    writeFileSync(
      path.join(eslintDir, 'package.json'),
      JSON.stringify({ name: 'eslint', bin: { eslint: 'bin/eslint.js' } }),
    );
    const marker = path.join(scratch, 'eslint-ran');
    writeFileSync(
      path.join(eslintDir, 'bin', 'eslint.js'),
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`,
    );
    const detected = await detectAnalyzers(settings(), { repoRoot: repo, env: envWith(bin) });
    const by = new Map(detected.map((d) => [d.id, d]));
    expect(by.get('patterns')).toMatchObject({ available: true, enabled: true });
    expect(by.get('shellcheck')).toMatchObject({ available: true, enabled: true, version: '0.10.0' });
    expect(by.get('gitleaks')).toMatchObject({
      available: false,
      enabled: false,
      reason: 'not found on PATH',
    });
    expect(by.get('eslint')).toMatchObject({ available: true, enabled: false });
    expect(by.get('eslint')?.version).toBeUndefined();
    expect(by.get('eslint')?.reason).toMatch(/opt-in/);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('sandbox and environment helpers', () => {
  it('scrubs credentials from the environment', () => {
    const env = scrubEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      LANG: 'C',
      AWS_ACCESS_KEY_ID: 'a',
      AWS_PROFILE: 'p',
      GITHUB_TOKEN: 'b',
      GH_HOST: 'c',
      NPM_TOKEN: 'd',
      MY_SECRET: 'e',
      DB_PASSWORD: 'f',
      STRIPE_KEY: 'g',
      ANTHROPIC_API_KEY: 'h',
      FORCE_COLOR: '1',
    });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u', LANG: 'C', NO_COLOR: '1' });
  });

  it('validates relative paths', () => {
    for (const bad of ['', '../x', 'a/../b', '/etc/passwd', 'a//b', './a', 'C:/x', 'a\\b', 'a\u0000b']) {
      expect(safeRelativePath(bad), bad).toBeUndefined();
    }
    expect(safeRelativePath('src/-rf.sh')).toBe('src/-rf.sh');
  });

  it('writes regular files only into a temp dir outside the repo and removes it', async () => {
    const repo = dir('repo-sandbox');
    const box = await createSandbox('test', [af('a/b.sh', 'x'), af('../evil', 'y')], { repoRoot: repo });
    expect(isInside(repo, box.dir)).toBe(false);
    expect(box.files).toContain('a/b.sh');
    expect(box.files).not.toContain('../evil');
    expect(readFileSync(path.join(box.dir, 'a', 'b.sh'), 'utf8')).toBe('x');
    expect(isInside(box.dir, box.outDir)).toBe(false);
    await box.remove();
    expect(existsSync(box.dir)).toBe(false);
  });

  it('maps tool paths back to repository paths', () => {
    const known = new Set(['src/a.sh']);
    expect(toRepoPath('./src/a.sh', '/box', known)).toBe('src/a.sh');
    expect(toRepoPath('/box/src/a.sh', '/box', known)).toBe('src/a.sh');
    expect(toRepoPath('file:///box/src/a.sh', '/box', known)).toBe('src/a.sh');
    expect(toRepoPath('/private/box/src/a.sh', '/box', known)).toBe('src/a.sh');
    expect(toRepoPath('/elsewhere/src/a.sh', '/box', known)).toBeUndefined();
    expect(toRepoPath('src/b.sh', '/box', known)).toBeUndefined();
  });
});
