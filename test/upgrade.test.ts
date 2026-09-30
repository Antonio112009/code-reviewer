import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runUpgrade } from '../src/cli/commands/upgrade';
import { Logger } from '../src/util/logger';
import {
  changelogBetween,
  detectInstall,
  PACKAGE_NAME,
  updateNotice,
  updateNoticeEnabled,
  upgradeCommand,
} from '../src/util/upgrade';

const scratch = mkdtempSync(path.join(tmpdir(), 'cr-upgrade-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function pkgDir(...parts: string[]): string {
  const dir = path.join(scratch, `t${n++}`, ...parts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '0.5.0' }));
  return dir;
}

const CHANGELOG = `# Changelog

## Unreleased

- not released

## 0.6.0 — 2026-10-02

- **Upgrade command.**

## 0.5.1 — 2026-09-30

- Bundled ast-grep.

## 0.5.0 — 2026-09-29

- Older.
`;

describe('install detection', () => {
  it('tells source checkouts, npx, global installs of each manager and project dependencies apart', () => {
    const source = pkgDir('code-reviewer');
    mkdirSync(path.join(source, '.git'));
    expect(detectInstall(source).kind).toBe('source');
    expect(detectInstall(pkgDir('.npm', '_npx', 'abc', 'node_modules', PACKAGE_NAME)).kind).toBe('npx');
    const npmGlobal = pkgDir('lib', 'node_modules', PACKAGE_NAME);
    expect(detectInstall(npmGlobal, path.resolve(npmGlobal, '..', '..')).kind).toBe('npm-global');
    expect(detectInstall(npmGlobal).kind).toBe('project'); // npm not available: nothing to compare with
    // npm masks UUID-like path parts in what it prints
    const uuid = pkgDir('fef63a7a-3cae-4c2d-9389-401aba307ec4', 'lib', 'node_modules', PACKAGE_NAME);
    const masked = path.resolve(uuid, '..', '..').replace('fef63a7a-3cae-4c2d-9389-401aba307ec4', '***');
    expect(detectInstall(uuid, masked).kind).toBe('npm-global');
    expect(detectInstall(npmGlobal, masked).kind).toBe('project');
    expect(detectInstall(pkgDir('.bun', 'install', 'global', 'node_modules', PACKAGE_NAME)).kind).toBe(
      'bun-global',
    );
    expect(detectInstall(pkgDir('Library', 'pnpm', 'global', '5', 'node_modules', PACKAGE_NAME)).kind).toBe(
      'pnpm-global',
    );
    expect(detectInstall(pkgDir('.config', 'yarn', 'global', 'node_modules', PACKAGE_NAME)).kind).toBe(
      'yarn-global',
    );
    expect(
      detectInstall(pkgDir('app', 'node_modules', '.pnpm', 'x', 'node_modules', PACKAGE_NAME)).kind,
    ).toBe('project');
  });

  it('builds the install command of each kind', () => {
    expect(upgradeCommand('npm-global', '0.6.0')).toEqual([
      'npm',
      'install',
      '--global',
      `${PACKAGE_NAME}@0.6.0`,
      '--prefer-online',
    ]);
    expect(upgradeCommand('pnpm-global', '0.6.0')?.join(' ')).toBe(`pnpm add --global ${PACKAGE_NAME}@0.6.0`);
    expect(upgradeCommand('source', '0.6.0')).toBeUndefined();
  });
});

describe('changelog between versions', () => {
  it('keeps the sections after the old version up to the new one', () => {
    const notes = changelogBetween(CHANGELOG, '0.5.0', '0.6.0');
    expect(notes).toContain('## 0.6.0');
    expect(notes).toContain('Bundled ast-grep.');
    expect(notes).not.toContain('Older.');
    expect(notes).not.toContain('not released');
    expect(changelogBetween(CHANGELOG, '0.5.1', '0.5.1')).toBe('');
  });
});

describe('update notice', () => {
  const answer = (version: string) =>
    (async () => new Response(JSON.stringify({ version }), { status: 200 })) as unknown as typeof fetch;

  it('asks the registry once a day and says when a newer version exists', async () => {
    const file = path.join(scratch, `notice${n++}`, 'update-check.json');
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ version: '0.6.0' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await updateNotice('0.5.0', file, {}, fetchImpl)).toContain('0.5.0 → 0.6.0');
    expect(calls).toEqual(['https://registry.npmjs.org/@antonio112009%2Fcode-reviewer/latest']);
    // cached for a day: no second request, same answer
    expect(await updateNotice('0.5.0', file, {}, fetchImpl)).toContain('0.6.0');
    expect(calls).toHaveLength(1);
    expect(await updateNotice('0.6.0', file, {}, fetchImpl)).toBeUndefined();
  });

  it('uses the configured registry and stays silent when it fails', async () => {
    const file = path.join(scratch, `notice${n++}`, 'update-check.json');
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await updateNotice('0.5.0', file, {}, failing)).toBeUndefined();
    const urls: string[] = [];
    const recording = (async (url: string, init: RequestInit) => {
      urls.push(url);
      return answer('0.5.0')(url, init);
    }) as unknown as typeof fetch;
    await updateNotice('0.5.0', file, { npm_config_registry: 'https://npm.example.com/r' }, recording);
    expect(urls).toEqual(['https://npm.example.com/r/@antonio112009%2Fcode-reviewer/latest']);
  });

  it('runs only in an interactive terminal outside CI, unless turned off', () => {
    expect(updateNoticeEnabled({}, true, false)).toBe(true);
    expect(updateNoticeEnabled({}, false, false)).toBe(false);
    expect(updateNoticeEnabled({}, true, true)).toBe(false);
    expect(updateNoticeEnabled({ CODE_REVIEWER_NO_UPDATE_CHECK: '1' }, true, false)).toBe(false);
    expect(updateNoticeEnabled({ NO_UPDATE_NOTIFIER: 'true' }, true, false)).toBe(false);
  });
});

// A fake npm on PATH: `root -g`, `view` and `install` against a throw-away global prefix.
const FAKE_NPM = `
case "$1" in
  root) echo "$FAKE_GLOBAL_ROOT" ;;
  view) echo "$FAKE_LATEST" ;;
  install)
    echo "$@" >> "$FAKE_LOG"
    if [ -n "$FAKE_ETARGET" ] && [ ! -f "$FAKE_LOG.lag" ]; then
      touch "$FAKE_LOG.lag"; echo "npm error code ETARGET" >&2; exit 1
    fi
    if [ -n "$FAKE_EACCES" ]; then echo "npm error code EACCES" >&2; exit 243; fi
    printf '{"name":"${PACKAGE_NAME}","version":"%s"}' "$FAKE_LATEST" > "$FAKE_PKG/package.json"
    printf '%s' "$FAKE_CHANGELOG" > "$FAKE_PKG/CHANGELOG.md"
    ;;
esac
`;

describe.skipIf(process.platform === 'win32')('code-reviewer upgrade', () => {
  let bin: string;
  let pkg: string;
  let env: NodeJS.ProcessEnv;
  let out: string;
  const logs: string[] = [];
  const logger = new Logger('debug');
  logger.setSink((line) => logs.push(line));

  beforeEach(() => {
    bin = path.join(scratch, `bin${n++}`);
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\n${FAKE_NPM}`);
    chmodSync(path.join(bin, 'npm'), 0o755);
    pkg = pkgDir('lib', 'node_modules', PACKAGE_NAME);
    env = {
      PATH: [bin, '/usr/bin', '/bin'].join(path.delimiter),
      FAKE_GLOBAL_ROOT: path.resolve(pkg, '..', '..'),
      FAKE_LATEST: '0.6.0',
      FAKE_LOG: path.join(bin, 'install.log'),
      FAKE_PKG: pkg,
      FAKE_CHANGELOG: CHANGELOG,
    };
    out = '';
    logs.length = 0;
  });

  const upgrade = (opts: Parameters<typeof runUpgrade>[0] = {}, root = pkg) =>
    runUpgrade(opts, { root, env, logger, write: (t) => (out += t), sleep: async () => {} });

  it('reports without installing with --check and --json', async () => {
    expect(await upgrade({ check: true })).toBe(0);
    expect(out).toBe('0.5.0 → 0.6.0 available. Run: code-reviewer upgrade\n');
    out = '';
    await upgrade({ json: true });
    expect(JSON.parse(out)).toMatchObject({
      current: '0.5.0',
      latest: '0.6.0',
      updateAvailable: true,
      install: 'npm-global',
      command: `npm install --global ${PACKAGE_NAME}@0.6.0 --prefer-online`,
    });
    expect(existsSync(env.FAKE_LOG!)).toBe(false);
  });

  it('installs the latest version with npm, retrying while the registry lags, and shows what changed', async () => {
    env.FAKE_ETARGET = '1';
    expect(await upgrade()).toBe(0);
    expect(readFileSync(env.FAKE_LOG!, 'utf8').trim().split('\n')).toEqual([
      `install --global ${PACKAGE_NAME}@0.6.0 --prefer-online`,
      `install --global ${PACKAGE_NAME}@0.6.0 --prefer-online`,
    ]);
    expect(JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version).toBe('0.6.0');
    expect(out).toContain('## 0.6.0');
    expect(out).toContain('Bundled ast-grep.');
    expect(out).not.toContain('Older.');
    expect(out).toContain('Release notes: https://github.com/Antonio112009/code-reviewer/releases');
  });

  it('does nothing when already on the latest version', async () => {
    env.FAKE_LATEST = '0.5.0';
    expect(await upgrade()).toBe(0);
    expect(existsSync(env.FAKE_LOG!)).toBe(false);
    expect(logs.join('\n')).toContain('Already on 0.5.0');
  });

  it('explains a permission error instead of retrying', async () => {
    env.FAKE_EACCES = '1';
    await expect(upgrade()).rejects.toThrow(/may not write to its global directory/);
    expect(readFileSync(env.FAKE_LOG!, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('prints the command for installs it does not manage', async () => {
    const project = pkgDir('app', 'node_modules', PACKAGE_NAME);
    expect(await upgrade({}, project)).toBe(0);
    expect(logs.join('\n')).toContain(`npm install ${PACKAGE_NAME}@0.6.0`);
    expect(existsSync(env.FAKE_LOG!)).toBe(false);
  });

  it('fails clearly when the version does not exist', async () => {
    env.FAKE_LATEST = '';
    await expect(upgrade({ to: '9.9.9' })).rejects.toThrow(/no version 9\.9\.9/);
  });
});
