import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scrubEnv } from '../src/analyzers/env';
import { ConfigError, findProjectConfig, loadConfig } from '../src/config/load';
import { parseUnifiedDiff } from '../src/git/diff-parser';
import { parseRemote } from '../src/git/remote';
import { modelStatus } from '../src/models/catalog';
import { detectReplyError } from '../src/models/classify';
import { decidePermission } from '../src/providers/acp/permissions';
import { isUnconfined } from '../src/providers/acp/presets';
import { profileRegion } from '../src/providers/aws';
import { signalText } from '../src/skills/detector';
import { unsafeRegexes } from '../src/skills/regex-guard';
import { buildDiffUnits } from '../src/sources/diff-source';
import {
  distrustDirectory,
  findTrustedExecutable,
  rejectPathEntry,
  spawnPlan,
} from '../src/util/executables';
import { unsafeGlobReason, untrustedGlobMatcher } from '../src/util/globs';
import { globalConfigDir } from '../src/util/paths';
import { satisfies } from '../src/util/versions';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-sec-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const exe = (rel: string) => {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, '#!/bin/sh\necho hi\n');
  chmodSync(abs, 0o755);
  return abs;
};

describe('program resolution', () => {
  it('never resolves programs from the reviewed checkout, node_modules/.bin or relative PATH entries', () => {
    const repo = path.join(dir, 'repo');
    exe('repo/bin/mytool');
    exe('repo/node_modules/.bin/mytool');
    const trusted = exe('trusted/mytool');
    distrustDirectory(repo);
    const env = {
      PATH: [
        path.join(repo, 'bin'),
        path.join(repo, 'node_modules/.bin'),
        'relative',
        path.join(dir, 'trusted'),
      ].join(path.delimiter),
    };
    expect(findTrustedExecutable('mytool', env)).toBe(trusted);
    expect(rejectPathEntry(path.join(repo, 'bin'))).toBe('inside the reviewed code');
    expect(rejectPathEntry('bin')).toBe('relative');
    expect(rejectPathEntry('/opt/x/node_modules/.bin')).toBe('node_modules/.bin');
    if (process.platform === 'darwin') {
      // case-insensitive file system: a differently cased PATH entry is still the checkout
      expect(rejectPathEntry(path.join(repo.toUpperCase(), 'bin'))).toBe('inside the reviewed code');
    }
  });

  it('starts Windows .cmd shims through cmd.exe with escaped arguments', () => {
    const plan = spawnPlan('C:\\\\npm\\\\claude-agent-acp.cmd', ['--model', 'a&b'], 'win32', {
      SystemRoot: 'C:\\\\Windows',
    });
    expect(plan.command).toBe(path.win32.join('C:\\\\Windows', 'System32', 'cmd.exe'));
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(plan.args[3]).toContain('^&');
    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(spawnPlan('/usr/bin/git', ['status'], 'linux')).toEqual({
      command: '/usr/bin/git',
      args: ['status'],
    });
  });

  it('ignores an empty or relative CODE_REVIEWER_HOME', () => {
    const saved = process.env.CODE_REVIEWER_HOME;
    try {
      for (const value of ['', 'config', './x']) {
        process.env.CODE_REVIEWER_HOME = value;
        expect(path.isAbsolute(globalConfigDir())).toBe(true);
      }
      process.env.CODE_REVIEWER_HOME = dir;
      expect(globalConfigDir()).toBe(dir);
    } finally {
      if (saved === undefined) delete process.env.CODE_REVIEWER_HOME;
      else process.env.CODE_REVIEWER_HOME = saved;
    }
  });

  it('keeps Go privacy settings when scrubbing credentials', () => {
    const env = scrubEnv({ GOPRIVATE: 'github.com/acme/*', GITHUB_TOKEN: 'x', PATH: '/bin' });
    expect(env.GOPRIVATE).toBe('github.com/acme/*');
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe('agents', () => {
  const read = (over: object) =>
    ({
      sessionId: 's',
      toolCall: { toolCallId: '1', kind: 'read', title: 'Read', ...over },
      options: [
        { optionId: 'a', kind: 'allow_once', name: 'Allow' },
        { optionId: 'r', kind: 'reject_once', name: 'Reject' },
      ],
    }) as never;

  it('allows reads only inside the review root', () => {
    const root = path.join(dir, 'snap');
    expect(decidePermission(read({ locations: [{ path: path.join(root, 'src/a.ts') }] }), root).allowed).toBe(
      true,
    );
    expect(decidePermission(read({ locations: [{ path: '/home/u/.aws/credentials' }] }), root).allowed).toBe(
      false,
    );
    expect(decidePermission(read({ rawInput: { file_path: '../outside.env' } }), root).allowed).toBe(false);
    expect(decidePermission(read({}), root).allowed).toBe(false);
    expect(
      decidePermission(read({ kind: 'other', title: 'mcp__code-reviewer__read_file' }), root).allowed,
    ).toBe(true);
  });

  it('flags agents that cannot be confined to read-only', () => {
    expect(isUnconfined({ type: 'acp', preset: 'codex' })).toBe(true);
    expect(isUnconfined({ type: 'acp', preset: 'claude' })).toBe(false);
    expect(isUnconfined({ type: 'bedrock' })).toBe(false);
  });

  it('reads JSON answers as answers, not as credential errors', () => {
    expect(
      detectReplyError('{"findings":[],"notes":"unauthenticated requests get 401 Unauthorized"}'),
    ).toBeUndefined();
    expect(detectReplyError('API Error: 401 {"type":"error"}')).toBeDefined();
  });

  it('treats Bedrock ids the listing cannot show as unverified', () => {
    const listing = {
      provider: 'bedrock',
      models: ['us.anthropic.claude-sonnet-5'],
      source: 'bedrock-api' as const,
    };
    expect(modelStatus(listing, 'arn:aws:bedrock:us-east-1:1:application-inference-profile/x')).toBe(
      'unverified',
    );
    expect(modelStatus(listing, 'amazon.nova-pro-v1:0')).toBe('unverified');
    expect(modelStatus(listing, 'eu.anthropic.claude-sonnet-5')).toBe('unavailable');
  });

  it('reads the region of an AWS profile', () => {
    const file = path.join(dir, 'aws-config');
    writeFileSync(file, '[default]\nregion = eu-west-1\n[profile work]\nregion = eu-central-1\n');
    expect(profileRegion(undefined, { AWS_CONFIG_FILE: file })).toBe('eu-west-1');
    expect(profileRegion('work', { AWS_CONFIG_FILE: file })).toBe('eu-central-1');
    expect(profileRegion('none', { AWS_CONFIG_FILE: file })).toBeUndefined();
  });
});

describe('untrusted configuration', () => {
  it('refuses globs that compile to backtracking regexes, and matching stays fast', () => {
    expect(unsafeGlobReason('**/*.ts')).toBeUndefined();
    expect(unsafeGlobReason('feature/**')).toBeUndefined();
    expect(unsafeGlobReason('+(*)+(*)Z')).toMatch(/extglob/);
    expect(unsafeGlobReason('*a*a*a*b')).toMatch(/more than one/);
    expect(unsafeGlobReason('**/**/**/x')).toMatch(/"\*\*"/);
    const refused: string[] = [];
    const m = untrustedGlobMatcher(['*a*a*a*b', 'src/**'], (g) => refused.push(g));
    expect(refused).toEqual(['*a*a*a*b']);
    const started = performance.now();
    expect(m(`src/${'a'.repeat(900)}`)).toBe(true);
    expect(m('a'.repeat(5_000))).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('rejects unsafe globs and misspelled keys in a project config', async () => {
    const project = path.join(dir, 'proj');
    mkdirSync(path.join(project, '.code-reviewer'), { recursive: true });
    const write = (yaml: string) => writeFileSync(path.join(project, '.code-reviewer/config.yaml'), yaml);
    write('git:\n  base:\n    rules:\n      - { match: "+(*)+(*)Z", base: [main] }\n');
    await expect(loadConfig({ cwd: project, stopDir: project, ignoreGlobal: true })).rejects.toThrow(
      ConfigError,
    );
    write('review:\n  minConfidance: 0.95\n');
    await expect(loadConfig({ cwd: project, stopDir: project, ignoreGlobal: true })).rejects.toThrow(
      /minConfidance/,
    );
  });

  it('does not walk above the directory without a repository', () => {
    const outer = path.join(dir, 'outer');
    mkdirSync(path.join(outer, '.code-reviewer'), { recursive: true });
    writeFileSync(path.join(outer, '.code-reviewer/config.yaml'), 'review: {}\n');
    mkdirSync(path.join(outer, 'inner'), { recursive: true });
    expect(findProjectConfig(path.join(outer, 'inner'))).toBeUndefined();
    expect(findProjectConfig(path.join(outer, 'inner'), outer)).toBe(
      path.join(outer, '.code-reviewer/config.yaml'),
    );
  });
});

describe('skills and versions', () => {
  it('refuses project regexes that backtrack on adversarial input', async () => {
    // overlapping alternation and chained quantifiers pass the static nested-quantifier check
    const unsafe = await unsafeRegexes(['\\buseEffect\\(', '(a|aa)+$', 'a*a*a*a*b']);
    expect([...unsafe.keys()].sort()).toEqual(['(a|aa)+$', 'a*a*a*a*b']);
  }, 20_000);

  it('long runs of blank lines do not make multiline content regexes quadratic', () => {
    const text = signalText(`${'\n'.repeat(400_000)}require x\n`);
    const started = performance.now();
    expect(/^\s*require\b/m.test(text)).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
    expect(signalText('a\n  \n\t\nb')).toBe('a\nb');
    expect(signalText('x'.repeat(600_000)).length).toBe(512 * 1024);
  });

  it('partial versions stand for all their releases', () => {
    expect(satisfies('1.21.5', '>1.21')).toBe(false);
    expect(satisfies('1.22.0', '>1.21')).toBe(true);
    expect(satisfies('1.21.9', '<=1.21')).toBe(true);
    expect(satisfies('1.22.0', '<=1.21')).toBe(false);
    expect(satisfies('1.21.4', '>1.21.3')).toBe(true);
  });
});

describe('git data', () => {
  it('skips submodule bumps', async () => {
    const diff = [
      'diff --git a/vendor/lib b/vendor/lib',
      'index 1111111..2222222 160000',
      '--- a/vendor/lib',
      '+++ b/vendor/lib',
      '@@ -1 +1 @@',
      '-Subproject commit 1111111111111111111111111111111111111111',
      '+Subproject commit 2222222222222222222222222222222222222222',
      '',
    ].join('\n');
    const diffs = parseUnifiedDiff(diff);
    expect(diffs[0]!.submodule).toBe(true);
    const { units, skipped } = await buildDiffUnits(diffs, [], async () => undefined);
    expect(units).toEqual([]);
    expect(skipped).toEqual([{ path: 'vendor/lib', reason: 'submodule' }]);
  });

  it('keeps the scheme and port of http(s) forge remotes', () => {
    expect(parseRemote('https://gitlab.example.com:8443/group/proj.git')?.webUrl).toBe(
      'https://gitlab.example.com:8443/group/proj',
    );
    expect(parseRemote('http://gitlab.internal/group/proj.git')?.webUrl).toBe(
      'http://gitlab.internal/group/proj',
    );
    expect(parseRemote('git@github.com:acme/app.git')?.webUrl).toBe('https://github.com/acme/app');
  });
});
