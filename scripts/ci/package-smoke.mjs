// Installs the packed package the way a user does (a global install into a fresh prefix) and runs a dry-run
// review of a throw-away repository with a planted `items.forEach(async …)`. Expects a built dist/.
//
//   node scripts/ci/package-smoke.mjs --expect-ast-grep   # the bundled ast-grep must run and flag it
//   node scripts/ci/package-smoke.mjs                     # no build for this platform (musl): the review
//                                                         # must still work, with ast-grep left out
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const expectAstGrep = process.argv.includes('--expect-ast-grep');
const root = path.resolve(import.meta.dirname, '..', '..');
const work = mkdtempSync(path.join(tmpdir(), 'cr-package-'));
const win = process.platform === 'win32';

function run(cmd, args, cwd) {
  // npm is a .cmd shim on Windows: it needs a shell there.
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: win && cmd === 'npm',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

try {
  const [packed] = JSON.parse(
    run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], root),
  );
  const tarball = path.join(work, packed.filename);
  const prefix = path.join(work, 'prefix');
  run('npm', ['install', '--global', '--prefix', prefix, tarball], work);
  const pkg = win
    ? path.join(prefix, 'node_modules', '@antonio112009', 'code-reviewer')
    : path.join(prefix, 'lib', 'node_modules', '@antonio112009', 'code-reviewer');
  const cli = path.join(pkg, 'dist', 'cli.js');

  const repo = path.join(work, 'repo');
  const git = (...args) =>
    run('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.com', ...args], repo);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  git('checkout', '-qb', 'feature');
  writeFileSync(
    path.join(repo, 'a.ts'),
    'export async function saveAll(items: string[]) {\n  items.forEach(async (x) => {\n    await save(x);\n  });\n}\n',
  );
  git('commit', '-qam', 'change');

  const plan = JSON.parse(
    run(
      process.execPath,
      [cli, '-C', repo, 'review', '--base', 'main', '--provider', 'mock', '--dry-run', '--json'],
      repo,
    ),
  );
  const astGrep = (plan.plan ?? plan).analyzers?.find((a) => a.id === 'ast-grep');
  console.log(
    `ast-grep: ${astGrep ? `${astGrep.status}, ${astGrep.hits} hit(s), ${astGrep.version ?? '?'}` : 'not run'}`,
  );
  if (expectAstGrep && !(astGrep?.status === 'ok' && astGrep.hits >= 1)) {
    throw new Error('the bundled ast-grep did not run or did not flag the planted forEach(async …)');
  }
  if (!expectAstGrep && astGrep && astGrep.status !== 'skipped') {
    throw new Error(`ast-grep was expected to be left out here, got status ${astGrep.status}`);
  }
  console.log('package install OK');
} finally {
  rmSync(work, { recursive: true, force: true });
}
