// biome-ignore-all lint/suspicious/noTemplateCurlyInString: test inputs are source code containing `${…}`
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseCppcheckXml,
  parseGitleaksReport,
  parseHadolint,
  parseRuff,
  parseShellcheck,
  stripIncludes,
} from '../src/analyzers/external';
import { finalizeHits, redactSecrets } from '../src/analyzers/hits';
import { isCommentLine, PATTERN_RULES, scanPatterns } from '../src/analyzers/patterns';
import { parseEslint, parseOsv, parseSemgrep, parseTsc } from '../src/analyzers/project';
import { parseSarif, sarifToRawHits, severityFromScore } from '../src/analyzers/sarif';
import type { SourceFile } from '../src/analyzers/types';
import { detectLanguage } from '../src/util/language';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'analyzers');

function file(p: string, content: string, changedRanges: Array<[number, number]> = []): SourceFile {
  return { path: p, content, language: detectLanguage(p), changedRanges };
}

function ruleIds(p: string, content: string): string[] {
  return scanPatterns(file(p, content)).map((h) => h.ruleId);
}

describe('pattern rules — metadata', () => {
  it('has 60+ well-formed rules with unique ids and bounded priors', () => {
    expect(PATTERN_RULES.length).toBeGreaterThanOrEqual(60);
    const ids = new Set<string>();
    for (const r of PATTERN_RULES) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      expect(r.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(r.confidence, r.id).toBeGreaterThanOrEqual(0.3);
      expect(r.confidence, r.id).toBeLessThanOrEqual(0.8);
      expect(r.regex.global || r.regex.sticky, r.id).toBe(false);
      expect(r.notIf?.global || r.notIf?.sticky || false, r.id).toBe(false);
      expect((r.languages?.length ?? 0) + (r.paths?.length ?? 0), r.id).toBeGreaterThan(0);
      expect(r.skill, r.id).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);
      expect(r.message.length, r.id).toBeGreaterThan(20);
    }
  });

  it('points every rule at an existing review skill', () => {
    const skillsDir = path.join(import.meta.dirname, '..', 'skills');
    // skill ids are paths below skills/ (`javascript/security/code-execution`)
    const ids = new Set(
      readdirSync(skillsDir, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.md'))
        .map((f) =>
          f
            .split(path.sep)
            .join('/')
            .replace(/(?:\/SKILL)?\.md$/, ''),
        ),
    );
    const missing = [...new Set(PATTERN_RULES.map((r) => r.skill))].filter((s) => !ids.has(s));
    expect(missing).toEqual([]);
  });

  it('covers every language family the task lists', () => {
    const langs = new Set(PATTERN_RULES.flatMap((r) => [...(r.languages ?? [])]));
    for (const l of [
      'typescript',
      'python',
      'php',
      'java',
      'kotlin',
      'csharp',
      'go',
      'ruby',
      'rust',
      'c',
      'cpp',
      'shell',
      'sql',
      'dockerfile',
      'yaml',
    ]) {
      expect(langs.has(l), l).toBe(true);
    }
    expect(PATTERN_RULES.some((r) => r.paths?.some((p) => p.includes('.github/workflows')))).toBe(true);
  });
});

describe('pattern rules — per language', () => {
  const cases: Array<{ path: string; code: string; rule: string; hit: boolean }> = [
    // JavaScript / TypeScript
    { path: 'src/a.ts', code: 'const v = eval(input);', rule: 'js-eval', hit: true },
    { path: 'src/a.ts', code: 'await redis.eval(script, 0);', rule: 'js-eval', hit: false },
    { path: 'src/a.ts', code: '// eval(input) is forbidden', rule: 'js-eval', hit: false },
    { path: 'src/a.js', code: 'el.innerHTML = html;', rule: 'js-inner-html', hit: true },
    { path: 'src/a.js', code: "el.innerHTML = '<b>static</b>';", rule: 'js-inner-html', hit: false },
    { path: 'src/a.js', code: 'el.innerHTML = DOMPurify.sanitize(html);', rule: 'js-inner-html', hit: false },
    {
      path: 'src/a.tsx',
      code: '<div dangerouslySetInnerHTML={{ __html: body }} />',
      rule: 'js-dangerously-set-inner-html',
      hit: true,
    },
    { path: 'src/a.vue', code: '<div v-html="comment.body"></div>', rule: 'js-v-html', hit: true },
    { path: 'src/a.ts', code: 'exec(`git log ${branch}`, cb);', rule: 'js-exec-interpolation', hit: true },
    {
      path: 'src/a.ts',
      code: "child_process.execSync('rm -rf ' + dir);",
      rule: 'js-exec-interpolation',
      hit: true,
    },
    { path: 'src/a.ts', code: 'const m = re.exec(`${prefix}x`);', rule: 'js-exec-interpolation', hit: false },
    {
      path: 'src/a.ts',
      code: 'db.query(`SELECT * FROM users WHERE id = ${id}`);',
      rule: 'js-sql-template',
      hit: true,
    },
    {
      path: 'src/a.ts',
      code: 'db.query(sql`SELECT * FROM users WHERE id = ${id}`);',
      rule: 'js-sql-template',
      hit: false,
    },
    { path: 'src/a.ts', code: 'items.forEach(async (i) => save(i));', rule: 'js-foreach-async', hit: true },
    { path: 'src/a.ts', code: 'if (x === NaN) return;', rule: 'js-nan-comparison', hit: true },
    {
      path: 'src/a.ts',
      code: 'const agent = new https.Agent({ rejectUnauthorized: false });',
      rule: 'js-tls-reject-unauthorized',
      hit: true,
    },
    {
      path: 'src/a.ts',
      code: 'const token = Math.random().toString(36).slice(2);',
      rule: 'insecure-random-token',
      hit: true,
    },
    {
      path: 'src/a.ts',
      code: "const token = crypto.randomBytes(32).toString('hex');",
      rule: 'insecure-random-token',
      hit: false,
    },
    { path: 'src/a.ts', code: 'try { run(); } catch (e) {}', rule: 'empty-catch', hit: true },
    {
      path: 'src/a.ts',
      code: "const q = 'SELECT * FROM t WHERE name = \\'' + name + \"'\";",
      rule: 'sql-concatenation',
      hit: true,
    },
    { path: 'src/a.ts', code: 'res.redirect(req.query.next);', rule: 'js-open-redirect', hit: true },
    // Python
    { path: 'app/x.py', code: 'subprocess.run(cmd, shell=True)', rule: 'py-shell-true', hit: true },
    { path: 'app/x.py', code: 'subprocess.run("ls -la", shell=True)', rule: 'py-shell-true', hit: false },
    { path: 'app/x.py', code: 'cfg = yaml.load(data)', rule: 'py-yaml-load', hit: true },
    {
      path: 'app/x.py',
      code: 'cfg = yaml.load(data, Loader=yaml.SafeLoader)',
      rule: 'py-yaml-load',
      hit: false,
    },
    {
      path: 'app/x.py',
      code: 'r = requests.get(url, verify=False, timeout=5)',
      rule: 'py-verify-false',
      hit: true,
    },
    { path: 'app/x.py', code: 'obj = pickle.loads(blob)', rule: 'py-pickle-load', hit: true },
    {
      path: 'app/x.py',
      code: 'cur.execute("SELECT * FROM t WHERE id = %s" % uid)',
      rule: 'py-sql-format',
      hit: true,
    },
    {
      path: 'app/x.py',
      code: 'cur.execute(f"DELETE FROM t WHERE id = {uid}")',
      rule: 'py-sql-fstring-execute',
      hit: true,
    },
    { path: 'app/x.py', code: 'def add(item, bucket=[]):', rule: 'py-mutable-default', hit: true },
    { path: 'app/x.py', code: 'if kind is "admin":', rule: 'py-is-literal', hit: true },
    { path: 'app/x.py', code: 'if kind is None:', rule: 'py-is-literal', hit: false },
    {
      path: 'app/x.py',
      code: 'hashed = hashlib.md5(password.encode()).hexdigest()',
      rule: 'weak-password-hash',
      hit: true,
    },
    { path: 'app/settings.py', code: 'DEBUG = True', rule: 'py-django-debug', hit: true },
    { path: 'app/x.py', code: '# DEBUG = True', rule: 'py-django-debug', hit: false },
    // PHP
    { path: 'web/x.php', code: '$o = unserialize($_COOKIE["state"]);', rule: 'php-unserialize', hit: true },
    {
      path: 'web/x.php',
      code: "$o = unserialize($s, ['allowed_classes' => false]);",
      rule: 'php-unserialize',
      hit: false,
    },
    { path: 'web/x.php', code: 'echo "Hello " . $_GET["name"];', rule: 'php-echo-request', hit: true },
    {
      path: 'web/x.php',
      code: 'echo htmlspecialchars($_GET["name"]);',
      rule: 'php-echo-request',
      hit: false,
    },
    {
      path: 'web/x.php',
      code: '$r = $db->query("SELECT * FROM users WHERE id = $id");',
      rule: 'php-sql-interpolation',
      hit: true,
    },
    // JVM
    {
      path: 'src/A.java',
      code: 'ObjectInputStream in = new ObjectInputStream(socket.getInputStream());',
      rule: 'java-deserialization',
      hit: true,
    },
    { path: 'src/A.java', code: 'if (role == "admin") {', rule: 'java-string-reference-equality', hit: true },
    {
      path: 'src/A.java',
      code: 'Cipher c = Cipher.getInstance("AES");',
      rule: 'java-weak-cipher',
      hit: true,
    },
    {
      path: 'src/A.java',
      code: 'Cipher c = Cipher.getInstance("AES/GCM/NoPadding");',
      rule: 'java-weak-cipher',
      hit: false,
    },
    {
      path: 'src/A.kt',
      code: 'val q = "SELECT * FROM users WHERE name = \'${name}\'"',
      rule: 'jvm-sql-template',
      hit: true,
    },
    // C#
    { path: 'src/A.cs', code: 'var f = new BinaryFormatter();', rule: 'cs-insecure-deserializer', hit: true },
    { path: 'src/A.cs', code: 'public async void Save() {', rule: 'cs-async-void', hit: true },
    {
      path: 'src/A.cs',
      code: 'private async void OnClick(object sender, EventArgs e) {',
      rule: 'cs-async-void',
      hit: false,
    },
    // Go
    {
      path: 'cmd/x.go',
      code: 'tls.Config{InsecureSkipVerify: true}',
      rule: 'go-insecure-skip-verify',
      hit: true,
    },
    {
      path: 'cmd/x.go',
      code: 'q := fmt.Sprintf("SELECT * FROM users WHERE id = %s", id)',
      rule: 'go-sql-sprintf',
      hit: true,
    },
    // Ruby
    { path: 'app/x.rb', code: 'system("tar czf #{name}.tgz")', rule: 'rb-command-interpolation', hit: true },
    {
      path: 'app/x.rb',
      code: 'User.where("name = \'#{params[:name]}\'")',
      rule: 'rb-sql-interpolation',
      hit: true,
    },
    { path: 'app/x.rb', code: 'data = Marshal.load(blob)', rule: 'rb-unsafe-deserialization', hit: true },
    // Rust
    {
      path: 'src/main.rs',
      code: 'let port: u16 = std::env::var("PORT").unwrap().parse().unwrap();',
      rule: 'rs-unwrap-input',
      hit: true,
    },
    {
      path: 'src/main.rs',
      code: 'let v: u8 = unsafe { std::mem::transmute(x) };',
      rule: 'rs-unsafe-memory',
      hit: true,
    },
    // C / C++
    { path: 'src/x.c', code: 'gets(buf);', rule: 'c-gets', hit: true },
    { path: 'src/x.c', code: 'fgets(buf, sizeof buf, stdin);', rule: 'c-gets', hit: false },
    { path: 'src/x.cpp', code: 'strcpy(dst, src);', rule: 'c-unbounded-copy', hit: true },
    { path: 'src/x.c', code: 'printf(msg);', rule: 'c-format-string', hit: true },
    { path: 'src/x.c', code: 'printf("%s", msg);', rule: 'c-format-string', hit: false },
    { path: 'src/x.c', code: 'buf = realloc(buf, n);', rule: 'c-realloc-leak', hit: true },
    // Shell
    {
      path: 'scripts/i.sh',
      code: 'curl -fsSL https://get.example.com | sudo bash',
      rule: 'sh-curl-pipe-shell',
      hit: true,
    },
    { path: 'scripts/i.sh', code: 'rm -rf "$BUILD_DIR/"', rule: 'sh-rm-rf-variable', hit: true },
    { path: 'scripts/i.sh', code: 'rm -rf "${BUILD_DIR:?}/"', rule: 'sh-rm-rf-variable', hit: false },
    {
      path: 'scripts/i.sh',
      code: 'curl -sSLk https://example.com/x.tgz -o x.tgz',
      rule: 'insecure-tls-cli',
      hit: true,
    },
    // SQL
    { path: 'db/m.sql', code: 'DELETE FROM users;', rule: 'sql-unbounded-write', hit: true },
    { path: 'db/m.sql', code: 'DELETE FROM users WHERE id = 1;', rule: 'sql-unbounded-write', hit: false },
    {
      path: 'db/m.sql',
      code: 'ALTER TABLE users ADD COLUMN age integer NOT NULL;',
      rule: 'sql-not-null-without-default',
      hit: true,
    },
    {
      path: 'db/m.sql',
      code: 'ALTER TABLE users ADD COLUMN age integer NOT NULL DEFAULT 0;',
      rule: 'sql-not-null-without-default',
      hit: false,
    },
    // Dockerfile
    { path: 'Dockerfile', code: 'FROM node:latest', rule: 'docker-unpinned-image', hit: true },
    { path: 'Dockerfile', code: 'FROM node:22-alpine', rule: 'docker-unpinned-image', hit: false },
    { path: 'Dockerfile', code: 'ENV API_TOKEN=abc123', rule: 'docker-secret-in-env', hit: true },
    // Config
    { path: 'infra/sg.tf', code: '  cidr_blocks = ["0.0.0.0/0"]', rule: 'open-cidr', hit: true },
    { path: 'k8s/pod.yaml', code: '    privileged: true', rule: 'k8s-privileged', hit: true },
  ];

  for (const c of cases) {
    it(`${c.hit ? 'flags' : 'ignores'} ${c.rule}: ${c.code}`, () => {
      expect(ruleIds(c.path, c.code).includes(c.rule)).toBe(c.hit);
    });
  }

  it('matches multi-line constructs through a window (python except/pass)', () => {
    const hits = scanPatterns(file('app/x.py', 'try:\n    run()\nexcept Exception:\n    pass\n'));
    expect(hits.find((h) => h.ruleId === 'py-except-pass')).toMatchObject({ startLine: 3, endLine: 4 });
  });

  it('respects file-level conditions (CORS wildcard only with credentials)', () => {
    expect(ruleIds('src/a.ts', 'app.use(cors({ origin: true }));')).not.toContain(
      'cors-wildcard-credentials',
    );
    expect(ruleIds('src/a.ts', 'app.use(cors({ origin: true, credentials: true }));')).toContain(
      'cors-wildcard-credentials',
    );
  });

  it('does not flag a FROM that references an earlier build stage', () => {
    const df = 'FROM golang:1.23 AS builder\nRUN go build\nFROM builder\nUSER root\nUSER app\n';
    const ids = ruleIds('Dockerfile', df);
    expect(ids).not.toContain('docker-unpinned-image');
    expect(ids).not.toContain('docker-user-root');
    expect(ruleIds('Dockerfile', 'FROM alpine\nUSER root\n')).toEqual(
      expect.arrayContaining(['docker-unpinned-image', 'docker-user-root']),
    );
  });

  it('understands GitHub Actions run blocks and pull_request_target checkouts', () => {
    const wf = readFileSync(path.join(FIXTURES, 'workflow-pr-target.yml'), 'utf8');
    const hits = scanPatterns(file('.github/workflows/preview.yml', wf));
    const at = (rule: string) =>
      hits
        .filter((h) => h.ruleId === rule)
        .map((h) => h.startLine)
        .sort((a, b) => a - b);
    expect(at('gha-pr-target-checkout')).toEqual([12]);
    // Line 15 is a `with:` input (not a script) → not an injection; 18 and 20 are run scripts.
    expect(at('gha-script-injection')).toEqual([18, 20]);
    expect(at('gha-unpinned-action')).toEqual([13]);
    expect(at('gha-write-all')).toEqual([5]);
    expect(at('sh-curl-pipe-shell')).toEqual([19]);
    expect(hits.find((h) => h.ruleId === 'gha-pr-target-checkout')?.severity).toBe('critical');
    // The same file outside .github/workflows is plain YAML.
    expect(scanPatterns(file('docs/example.yml', wf)).some((h) => h.ruleId.startsWith('gha-'))).toBe(false);
  });

  it('only scans changed lines when ranges are given', () => {
    const content = ['eval(a);', 'ok();', 'eval(b);'].join('\n');
    expect(scanPatterns(file('src/a.js', content, [[3, 3]])).map((h) => h.startLine)).toEqual([3]);
    expect(scanPatterns(file('src/a.js', content)).map((h) => h.startLine)).toEqual([1, 3]);
  });

  it('recognises comment lines per language', () => {
    expect(isCommentLine('typescript', '  // eval(x)')).toBe(true);
    expect(isCommentLine('python', '# os.system(x)')).toBe(true);
    expect(isCommentLine('c', '#include <stdio.h>')).toBe(false);
    expect(isCommentLine('rust', '#[allow(unused)]')).toBe(false);
    expect(isCommentLine('sql', '-- DROP TABLE x')).toBe(true);
  });

  it('stays fast on pathological (attacker-crafted) lines', () => {
    const nasty = [
      'a'.repeat(5_000),
      '('.repeat(2_000),
      `"SELECT ${' '.repeat(1_500)}`,
      `\`SELECT ${'${'.repeat(800)}`,
      `password = "${'x'.repeat(3_000)}`,
      `curl ${'-k '.repeat(900)}`,
      `rm -rf ${'$'.repeat(900)}`,
      `${'${{ github.event.'.repeat(300)}`,
      `exec(${'"a" + '.repeat(500)}`,
      `catch (${'a'.repeat(2_000)}`,
      `def f(${'a=[], '.repeat(400)}`,
      `FROM ${'a:'.repeat(900)}`,
      `.lookup(${'x'.repeat(2_000)}`,
    ].join('\n');
    const paths = [
      'a.ts',
      'a.py',
      'a.php',
      'A.java',
      'A.kt',
      'A.cs',
      'a.go',
      'a.rb',
      'a.rs',
      'a.c',
      'a.sh',
      'a.sql',
      'Dockerfile',
      '.github/workflows/ci.yml',
      'main.tf',
      'a.vue',
    ];
    const started = performance.now();
    for (const p of paths) scanPatterns(file(p, nasty));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('processes a PR-sized file well under a second', () => {
    const lines: string[] = [];
    for (let i = 0; i < 3_000; i++)
      lines.push(`export function f${i}(a: number, b: string) { return call(a, b) + ${i}; }`);
    const started = performance.now();
    scanPatterns(file('src/big.ts', lines.join('\n')));
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('hit post-processing', () => {
  const src = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
  const base = { severity: 'major' as const, category: 'bug' as const, message: 'm', confidence: 0.5 };

  it('keeps hits within ±3 lines of a change in diff mode', () => {
    const f = file('src/a.ts', src(30), [[10, 12]]);
    const raw = [6, 7, 12, 15, 16].map((line) => ({
      ...base,
      analyzer: 'x',
      ruleId: 'r',
      file: f.path,
      startLine: line,
    }));
    expect(finalizeHits(raw, [f], 'diff').map((h) => h.startLine)).toEqual([7, 12, 15]);
    expect(finalizeHits(raw, [f], 'files').map((h) => h.startLine)).toEqual([6, 7, 12, 15, 16]);
  });

  it('drops hits on unknown files or lines past the end, and clamps ranges', () => {
    const f = file('src/a.ts', src(5));
    const raw = [
      { ...base, analyzer: 'x', ruleId: 'r', file: 'other.ts', startLine: 1 },
      { ...base, analyzer: 'x', ruleId: 'r', file: f.path, startLine: 9 },
      { ...base, analyzer: 'x', ruleId: 'r', file: f.path, startLine: 4, endLine: 99 },
    ];
    expect(finalizeHits(raw, [f], 'files').map((h) => [h.startLine, h.endLine])).toEqual([[4, 5]]);
  });

  it('dedupes by file+line+rule and by shared key (keeping the strongest), with deterministic ids', () => {
    const f = file('src/a.ts', src(10));
    const raw = [
      {
        ...base,
        analyzer: 'patterns',
        ruleId: 'hardcoded-credential',
        file: f.path,
        startLine: 2,
        dedupeKey: 'secret',
      },
      {
        ...base,
        analyzer: 'secrets',
        ruleId: 'github',
        file: f.path,
        startLine: 2,
        severity: 'critical' as const,
        dedupeKey: 'secret',
      },
      { ...base, analyzer: 'z', ruleId: 'r', file: f.path, startLine: 1 },
      { ...base, analyzer: 'z', ruleId: 'r', file: f.path, startLine: 1, confidence: 0.9 },
      { ...base, analyzer: 'a', ruleId: 'r', file: f.path, startLine: 1 },
    ];
    const hits = finalizeHits(raw, [f], 'files');
    expect(hits.map((h) => [h.id, h.analyzer, h.startLine])).toEqual([
      ['H1', 'a', 1],
      ['H2', 'z', 1],
      ['H3', 'secrets', 2],
    ]);
    expect(hits[1]?.confidence).toBe(0.9);
  });

  it('lowers confidence in test code', () => {
    const f = file('test/fixtures/a.ts', src(3));
    const [h] = finalizeHits(
      [{ ...base, category: 'security', analyzer: 'x', ruleId: 'r', file: f.path, startLine: 1 }],
      [f],
      'files',
    );
    expect(h?.confidence).toBe(0.25);
  });

  it('redacts token-like strings in analyzer text', () => {
    const token = ['ghp', '_', 'Zq8Xw3Lm0Pv7Rt2Yn5Ks9Hd4Fg6Jc1Bx8Nw2Qe'].join('');
    const out = redactSecrets(`found ${token} and https://github.com/hadolint/hadolint/wiki/DL3006`);
    expect(out).not.toContain(token);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('https://github.com/hadolint/hadolint/wiki/DL3006');
  });
});

describe('tool output parsers', () => {
  it('parses SARIF leniently (security-severity, style-only rules, ruleIndex, file URIs, bad entries)', () => {
    const findings = parseSarif(readFileSync(path.join(FIXTURES, 'sample.sarif.json'), 'utf8'));
    expect(findings.map((f) => f.ruleId)).toEqual(['sql-injection', 'long-line', 'null-deref', 'outside']);
    const hits = sarifToRawHits(findings, {
      baseDir: '/tmp/sarif-base',
      known: new Set(['src/db.ts', 'src/util.ts']),
    });
    expect(hits).toEqual([
      expect.objectContaining({
        ruleId: 'sql-injection',
        file: 'src/db.ts',
        startLine: 4,
        endLine: 5,
        severity: 'critical',
        category: 'security',
      }),
      expect.objectContaining({
        ruleId: 'null-deref',
        file: 'src/util.ts',
        severity: 'major',
        confidence: 0.6,
      }),
    ]);
    expect(severityFromScore(7)).toBe('major');
    expect(severityFromScore(4)).toBe('minor');
    expect(severityFromScore(3.9)).toBe('info');
  });

  it('parses cppcheck XML and strips includes before analysis', () => {
    const xml = readFileSync(path.join(FIXTURES, 'cppcheck.xml'), 'utf8');
    const hits = parseCppcheckXml(xml, '/sandbox/src', new Set(['src/a.c']));
    expect(hits.map((h) => [h.ruleId, h.startLine, h.severity, h.category])).toEqual([
      ['nullPointer', 7, 'major', 'security'],
      ['uninitvar', 12, 'major', 'bug'],
    ]);
    expect(hits[1]?.message).toBe('Uninitialized variable: "n" & more');
    expect(stripIncludes('#include "../../../etc/passwd"\n  # include <x>\nint x;\n')).toBe('\n\nint x;\n');
  });

  it('parses shellcheck json1, hadolint, ruff and gitleaks output', () => {
    const known = new Set(['a.sh', 'Dockerfile', 'app/x.py', 'cfg.env']);
    const sc = parseShellcheck(
      {
        comments: [
          { file: './a.sh', line: 3, level: 'warning', code: 2086, message: 'Double quote' },
          { file: 'a.sh', line: 4, level: 'style', code: 2006, message: 'Use $(...)' },
        ],
      },
      '/box',
      known,
    );
    expect(sc).toEqual([
      expect.objectContaining({
        ruleId: 'SC2086',
        file: 'a.sh',
        severity: 'minor',
        help: 'https://www.shellcheck.net/wiki/SC2086',
      }),
    ]);

    const hl = parseHadolint(
      [
        { code: 'DL3006', file: 'Dockerfile', line: 1, level: 'warning', message: 'Always tag the version' },
        { code: 'DL3059', file: 'Dockerfile', line: 2, level: 'info', message: 'Consolidate RUN' },
      ],
      '/box',
      known,
    );
    expect(hl.map((h) => h.ruleId)).toEqual(['DL3006']);

    const rf = parseRuff(
      [
        {
          code: 'S602',
          message: 'subprocess call with shell=True',
          filename: '/box/app/x.py',
          location: { row: 3 },
          end_location: { row: 3 },
          url: 'https://docs.astral.sh/ruff/rules/x',
        },
        { code: null, message: 'SyntaxError: bad', filename: '/box/app/x.py', location: { row: 9 } },
        { code: 'F821', message: 'Undefined name `x`', filename: '/elsewhere/y.py', location: { row: 1 } },
      ],
      '/box',
      known,
    );
    expect(rf.map((h) => [h.ruleId, h.severity, h.category])).toEqual([
      ['S602', 'major', 'security'],
      ['syntax-error', 'major', 'bug'],
    ]);

    const gl = parseGitleaksReport(
      [
        {
          RuleID: 'aws-access-token',
          Description: 'AWS',
          StartLine: 2,
          EndLine: 2,
          File: 'cfg.env',
          Match: 'REDACTED',
          Secret: 'REDACTED',
        },
      ],
      '/box',
      known,
    );
    expect(gl).toEqual([
      expect.objectContaining({ severity: 'critical', nonRejectable: true, dedupeKey: 'secret' }),
    ]);
    expect(JSON.stringify(gl)).not.toContain('Match');
  });

  it('parses project tool output (eslint, tsc, semgrep, osv)', () => {
    const known = new Set(['src/a.ts', 'package.json']);
    const es = parseEslint(
      [
        {
          filePath: '/repo/src/a.ts',
          messages: [
            { ruleId: 'no-undef', severity: 2, message: "'x' is not defined.", line: 3 },
            { ruleId: '@stylistic/indent', severity: 2, message: 'Expected indentation', line: 4 },
            { ruleId: null, severity: 2, message: 'Parsing error', line: 5, fatal: true },
          ],
        },
      ],
      '/repo',
      known,
    );
    expect(es.map((h) => [h.ruleId, h.severity])).toEqual([
      ['no-undef', 'minor'],
      ['parse-error', 'major'],
    ]);

    const ts = parseTsc(
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n  Details follow.\nother/b.ts(1,1): error TS1000: x\n",
      '/repo',
      known,
    );
    expect(ts).toEqual([expect.objectContaining({ ruleId: 'TS2322', startLine: 3, severity: 'major' })]);
    expect(ts[0]?.message).toContain('Details follow.');

    const sg = parseSemgrep(
      {
        results: [
          {
            check_id: 'js.xss',
            path: 'src/a.ts',
            start: { line: 2 },
            end: { line: 2 },
            extra: {
              message: 'XSS',
              severity: 'ERROR',
              metadata: { category: 'security', confidence: 'HIGH' },
            },
          },
        ],
      },
      '/repo',
      known,
    );
    expect(sg).toEqual([
      expect.objectContaining({ severity: 'major', category: 'security', confidence: 0.6 }),
    ]);

    const manifest = file(
      'package.json',
      '{\n  "dependencies": {\n    "lodash": "4.17.15",\n    "left-pad": "1.0.0"\n  }\n}\n',
      [[3, 3]],
    );
    const osv = parseOsv(
      {
        results: [
          {
            source: { path: '/repo/package-lock.json' },
            packages: [
              {
                package: { name: 'lodash', version: '4.17.15' },
                vulnerabilities: [{ id: 'GHSA-p6mc-m468-83gw', summary: 'Prototype pollution' }],
                groups: [{ ids: ['GHSA-p6mc-m468-83gw'], max_severity: '7.4' }],
              },
              {
                package: { name: 'left-pad', version: '1.0.0' },
                vulnerabilities: [{ id: 'GHSA-xxxx', database_specific: { severity: 'LOW' } }],
              },
            ],
          },
        ],
      },
      [manifest],
      { root: '/repo' },
    );
    // left-pad is vulnerable too, but its line was not changed by the review.
    expect(osv).toEqual([
      expect.objectContaining({
        ruleId: 'GHSA-p6mc-m468-83gw',
        file: 'package.json',
        startLine: 3,
        severity: 'major',
        nonRejectable: true,
      }),
    ]);
    // Results are attributed to their own manifest group only: another directory, no source, or a
    // manifest whose working tree differs from the reviewed revision never get them.
    const result = (source?: string) => ({
      results: [
        {
          ...(source ? { source: { path: source } } : {}),
          packages: [
            {
              package: { name: 'lodash', version: '4.17.15' },
              vulnerabilities: [{ id: 'GHSA-p6mc-m468-83gw', summary: 'Prototype pollution' }],
            },
          ],
        },
      ],
    });
    expect(parseOsv(result('/repo/tools/package-lock.json'), [manifest], { root: '/repo' })).toEqual([]);
    expect(parseOsv(result(), [manifest], { root: '/repo' })).toEqual([]);
    expect(
      parseOsv(result('/repo/package.json'), [manifest], { root: '/repo', stale: new Set(['package.json']) }),
    ).toEqual([]);
  });
});
