import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  applicableSkillGroups,
  buildInitConfig,
  detectProjectInfo,
  type InitChoices,
  InitError,
  isValidBranchName,
  runInit,
} from '../src/cli/commands/init';
import { ConfigError, loadConfig } from '../src/config/load';
import { DEFAULT_CONFIG, type PartialConfig } from '../src/config/schema';
import {
  projectConfigViolations,
  renderConfigTemplate,
  templateExamples,
  validateRenderedConfig,
} from '../src/config/template';
import { classifySkills } from '../src/skills/detector';
import { parseGroup, parseSkill } from '../src/skills/loader';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo } from './helpers';

let dir: string;
let home: string;
const repos: TempRepo[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-init-'));
  home = mkdtempSync(path.join(tmpdir(), 'cr-init-home-'));
  process.env.CODE_REVIEWER_HOME = home;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  for (const r of repos.splice(0)) r.cleanup();
  delete process.env.CODE_REVIEWER_HOME;
});

function repo(): TempRepo {
  const r = makeRepo();
  repos.push(r);
  return r;
}

function writeProjectConfig(root: string, text: string): string {
  mkdirSync(path.join(root, '.code-reviewer'), { recursive: true });
  const file = path.join(root, '.code-reviewer', 'config.yaml');
  writeFileSync(file, text);
  return file;
}

/** True when the line right above `key:` (at column `indent`) is a comment. */
function commentedAbove(text: string, key: string, indent = ''): boolean {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${indent}${key}:`));
  return i > 0 && lines[i - 1]!.trimStart().startsWith('#');
}

const SAMPLE: PartialConfig = {
  project: {
    name: 'payments',
    description: 'Payments API: refunds and ledger are critical.',
    focus: ['security', 'data integrity'],
    instructions: 'Money is integer cents.\nIgnore TODO comments: they are tracked elsewhere.',
    ignore: ['**/fixtures/**', 'legacy/**'],
  },
  providers: { bedrock: { type: 'bedrock', region: 'eu-central-1' } },
  roles: {
    review: { provider: 'claude', model: 'opus', reasoning: 'medium' },
    critique: { provider: 'codex', reasoning: 'high' },
  },
  review: { selfCritique: true, minConfidence: 0.6 },
  git: { base: { default: 'develop' } },
  analyzers: { builtin: true, external: 'off' },
  ui: { mode: 'plain' },
  output: { formats: ['md', 'json'] },
  profiles: { strict: { review: { minConfidence: 0.9 } } },
};

describe('config template', () => {
  it('renders a commented document that round-trips and loads through loadConfig', async () => {
    const text = renderConfigTemplate(SAMPLE);
    expect(YAML.parse(text)).toEqual(SAMPLE);

    for (const section of ['project', 'git', 'roles', 'review', 'analyzers', 'ui', 'output']) {
      expect(commentedAbove(text, section), `comment above ${section}`).toBe(true);
    }
    expect(commentedAbove(text, 'minConfidence', '  ')).toBe(true);
    expect(commentedAbove(text, 'default', '    ')).toBe(true); // git.base.default
    expect(text).toMatch(/^# code-reviewer project configuration/);
    expect(text).toContain('~/.code-reviewer/config.yaml'); // pointer for launch settings / models
    expect(text).toMatch(/^ {2}# concurrency: 3$/m); // commented-out example of an unset key
    expect(text).not.toMatch(/^models:/m);
    expect(text).not.toContain('my-agent'); // global-only example
    expect(text).toContain("external: 'off'"); // YAML 1.1-ambiguous scalar quoted
    expect(text).toContain('focus: [security, data integrity]');
    expect(text).toContain('instructions: |-');

    writeProjectConfig(dir, text);
    const { config, sources } = await loadConfig({ cwd: dir, stopDir: dir });
    expect(sources).toHaveLength(1);
    expect(config.project.instructions).toBe(SAMPLE.project!.instructions);
    expect(config.roles.critique).toMatchObject({ provider: 'codex', reasoning: 'high' });
    expect(config.git.base.default).toBe('develop');
    expect(config.git.base.rules).toEqual(DEFAULT_CONFIG.git.base.rules);
    expect(config.analyzers.external).toBe('off');
    expect(config.providers.bedrock).toMatchObject({ type: 'bedrock', region: 'eu-central-1' });
  });

  it('shows unset sections as commented-out examples; an empty config is still valid', async () => {
    const text = renderConfigTemplate({ roles: { review: { provider: 'claude' } } });
    expect(YAML.parse(text)).toEqual({ roles: { review: { provider: 'claude' } } });
    expect(text).toMatch(/^# ui:\n# {3}mode: auto$/m);
    expect(text).toMatch(/^# project:$/m);
    expect(text).toMatch(/^# profiles:$/m);
    expect(text).not.toMatch(/^# models:/m);

    const empty = renderConfigTemplate({});
    expect(YAML.parse(empty)).toEqual({});
    writeProjectConfig(dir, empty);
    await expect(loadConfig({ cwd: dir, stopDir: dir })).resolves.toBeDefined();
  });

  it('global scope allows launch settings, models and project analyzers; project scope refuses them', async () => {
    const global: PartialConfig = {
      providers: { mine: { type: 'acp', preset: 'custom', command: 'my-agent', args: ['--acp'] } },
      roles: { review: { provider: 'mine' } },
      analyzers: { project: ['eslint'] },
      models: { onUnavailable: 'fallback', fallbacks: { 'claude:opus': ['claude:sonnet'] } },
    };
    const text = renderConfigTemplate(global, { scope: 'global' });
    expect(text).toMatch(/^# code-reviewer global configuration/);
    expect(commentedAbove(text, 'models')).toBe(true);
    expect(text).toContain('# my-agent:');
    writeFileSync(path.join(home, 'config.yaml'), text);
    const { config } = await loadConfig({ cwd: dir, stopDir: dir });
    expect(config.providers.mine).toMatchObject({ command: 'my-agent', args: ['--acp'] });
    expect(config.models.fallbacks).toEqual({ 'claude:opus': ['claude:sonnet'] });
    expect(config.analyzers.project).toEqual(['eslint']);

    expect(() => renderConfigTemplate(global)).toThrow(ConfigError);
    expect(projectConfigViolations(global)).toEqual([
      'models',
      'analyzers.project',
      'providers.mine.command',
      'providers.mine.args',
    ]);
    expect(() => validateRenderedConfig('roles:\n  review: { provider: nope }\n', 'project')).toThrow(
      /unknown provider "nope"/,
    );
  });

  it('every commented-out example is valid when uncommented', async () => {
    const project = templateExamples('project');
    expect(projectConfigViolations(project)).toEqual([]);
    writeProjectConfig(dir, YAML.stringify(project));
    await expect(loadConfig({ cwd: dir, stopDir: dir, profile: 'strict' })).resolves.toBeDefined();

    const global = templateExamples('global');
    expect(global.models).toBeDefined();
    rmSync(path.join(dir, '.code-reviewer'), { recursive: true });
    writeFileSync(path.join(home, 'config.yaml'), YAML.stringify(global));
    const { config } = await loadConfig({ cwd: dir, stopDir: dir, profile: 'quick' });
    expect(config.review.selfCritique).toBe(false);
  });
});

describe('runInit', () => {
  it('--yes writes the detected defaults into a git repository', async () => {
    const r = repo();
    r.write({
      'package.json': JSON.stringify({ name: '@acme/payments', description: 'Payments\nAPI\u0007' }),
      'src/index.ts': 'export const x = 1;\n',
    });
    r.commit('init');
    r.git('branch', 'develop');
    mkdirSync(path.join(r.root, 'src', 'deep'), { recursive: true });

    const result = await runInit({ cwd: path.join(r.root, 'src', 'deep'), yes: true, logger: silentLogger });
    const root = realpathSync(r.root);
    expect(result.status).toBe('written');
    expect(realpathSync(result.file)).toBe(path.join(root, '.code-reviewer', 'config.yaml'));
    expect(result.gitignoreUpdated).toBe(true);
    expect(result.detection).toMatchObject({
      gitRepo: true,
      project: { name: '@acme/payments', description: 'Payments API', source: 'package.json' },
      currentBranch: 'main',
      branches: ['main', 'develop'],
    });
    expect(result.detection!.languages).toContain('typescript');
    expect(result.detection!.skillGroups.length).toBeGreaterThan(0); // always-on skills at least

    const text = readFileSync(result.file, 'utf8');
    expect(text).toMatch(/^# code-reviewer project configuration/);
    const { config, sources } = await loadConfig({ cwd: r.root, stopDir: r.root });
    expect(sources.map((s) => realpathSync(s))).toEqual([realpathSync(result.file)]);
    expect(config.project).toMatchObject({
      name: '@acme/payments',
      description: 'Payments API',
      focus: ['security', 'correctness'],
    });
    expect(config.git.base.default).toBe('auto');
    expect(config.review).toMatchObject({ selfCritique: true, minConfidence: 0.7 });
    expect(Object.keys(DEFAULT_CONFIG.providers)).toContain(config.roles.review!.provider);
    expect(config.roles.critique).toBeUndefined(); // follows the review model with high reasoning
    expect(readFileSync(path.join(r.root, '.gitignore'), 'utf8')).toBe('.code-reviewer/runs/\n');
  });

  it('refuses to overwrite without --force and keeps .gitignore free of duplicates', async () => {
    const r = repo();
    r.write({ 'a.py': 'x = 1\n' });
    r.commit('init');
    const first = await runInit({ cwd: r.root, yes: true, logger: silentLogger });
    expect(first.status).toBe('written');
    const before = readFileSync(first.file, 'utf8');

    const again = await runInit({
      cwd: r.root,
      yes: true,
      answers: { minConfidence: 0.8 },
      logger: silentLogger,
    });
    expect(again.status).toBe('exists');
    expect(again.message).toMatch(/--force/);
    expect(readFileSync(first.file, 'utf8')).toBe(before);

    const forced = await runInit({
      cwd: r.root,
      yes: true,
      force: true,
      answers: { minConfidence: 0.8 },
      logger: silentLogger,
    });
    expect(forced.status).toBe('written');
    expect(forced.gitignoreUpdated).toBe(false);
    const { config } = await loadConfig({ cwd: r.root, stopDir: r.root });
    expect(config.review.minConfidence).toBe(0.8);
    expect(readFileSync(path.join(r.root, '.gitignore'), 'utf8').match(/runs/g)).toHaveLength(1);
  });

  it('applies scripted answers', async () => {
    const r = repo();
    r.write({ 'main.go': 'package main\n', 'go.mod': 'module github.com/acme/billing\n' });
    r.commit('init');
    const result = await runInit({
      cwd: r.root,
      yes: true,
      logger: silentLogger,
      answers: {
        description: 'Billing service',
        focus: ['security', 'data integrity'],
        instructions: 'Amounts are cents.\nNever log card numbers.',
        ignore: ['legacy/**', ' legacy/** ', ''],
        base: 'develop',
        review: { provider: 'codex', model: 'gpt-x', reasoning: 'high' },
        critique: { provider: 'claude', reasoning: 'high' },
        minConfidence: 0.5,
        analyzersBuiltin: false,
        analyzersExternal: 'off',
        formats: ['json'],
        gitignore: false,
      },
    });
    expect(result.status).toBe('written');
    expect(existsSync(path.join(r.root, '.gitignore'))).toBe(false);
    const { config } = await loadConfig({ cwd: r.root, stopDir: r.root });
    expect(config.project).toEqual({
      name: 'billing',
      description: 'Billing service',
      focus: ['security', 'data integrity'],
      instructions: 'Amounts are cents.\nNever log card numbers.',
      ignore: ['legacy/**'],
    });
    expect(config.git.base.default).toBe('develop');
    expect(config.roles.review).toEqual({ provider: 'codex', model: 'gpt-x', reasoning: 'high' });
    expect(config.roles.critique).toEqual({ provider: 'claude', reasoning: 'high' });
    expect(config.analyzers).toMatchObject({ builtin: false, external: 'off' });
    expect(config.output.formats).toEqual(['json']);

    const off = await runInit({
      cwd: r.root,
      yes: true,
      force: true,
      logger: silentLogger,
      answers: { critique: 'off' },
    });
    expect(off.config?.review?.selfCritique).toBe(false);
    expect(off.config?.roles?.critique).toBeUndefined();
  });

  it('--global writes $CODE_REVIEWER_HOME/config.yaml with private permissions', async () => {
    const r = repo();
    const result = await runInit({ cwd: r.root, yes: true, global: true, logger: silentLogger });
    expect(result.status).toBe('written');
    expect(result.file).toBe(path.join(home, 'config.yaml'));
    if (process.platform !== 'win32') expect(statSync(result.file).mode & 0o777).toBe(0o600);
    expect(existsSync(path.join(r.root, '.code-reviewer'))).toBe(false);
    expect(existsSync(path.join(r.root, '.gitignore'))).toBe(false);
    const text = readFileSync(result.file, 'utf8');
    expect(text).toMatch(/^# code-reviewer global configuration/);
    expect(text).not.toMatch(/^project:/m);
    const { config, sources } = await loadConfig({ cwd: dir, stopDir: dir });
    expect(sources).toEqual([result.file]);
    expect(config.review.selfCritique).toBe(true);

    const again = await runInit({ cwd: r.root, yes: true, global: true, logger: silentLogger });
    expect(again.status).toBe('exists');
  });

  it('rejects bad input and unsafe targets', async () => {
    const r = repo();
    await expect(runInit({ cwd: r.root, interactive: false, logger: silentLogger })).rejects.toThrow(/--yes/);
    await expect(
      runInit({ cwd: r.root, yes: true, answers: { base: '--upload-pack=x' }, logger: silentLogger }),
    ).rejects.toThrow(InitError);
    await expect(
      runInit({
        cwd: r.root,
        yes: true,
        answers: { review: { provider: 'nope', reasoning: 'low' } },
        logger: silentLogger,
      }),
    ).rejects.toThrow(/Unknown provider "nope"/);
    expect(existsSync(path.join(r.root, '.code-reviewer', 'config.yaml'))).toBe(false);

    writeFileSync(path.join(r.root, '.code-reviewerrc.json'), '{}');
    await expect(runInit({ cwd: r.root, yes: true, force: true, logger: silentLogger })).rejects.toThrow(
      /takes precedence/,
    );
    rmSync(path.join(r.root, '.code-reviewerrc.json'));

    const outside = mkdtempSync(path.join(tmpdir(), 'cr-init-outside-'));
    try {
      symlinkSync(outside, path.join(r.root, '.code-reviewer'));
      await expect(runInit({ cwd: r.root, yes: true, force: true, logger: silentLogger })).rejects.toThrow(
        /symlink/,
      );
      expect(existsSync(path.join(outside, 'config.yaml'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps the name of an existing YAML rc file when overwriting', async () => {
    const r = repo();
    writeFileSync(path.join(r.root, '.code-reviewerrc.yaml'), 'review:\n  minConfidence: 0.5\n');
    const result = await runInit({ cwd: r.root, yes: true, force: true, logger: silentLogger });
    expect(realpathSync(result.file)).toBe(realpathSync(path.join(r.root, '.code-reviewerrc.yaml')));
    // defaults come from the existing config
    expect(result.config?.review?.minConfidence).toBe(0.5);
  });

  it('never writes an untrusted output.dir into .gitignore', async () => {
    const r = repo();
    writeProjectConfig(r.root, 'output:\n  dir: "runs\\n!.env"\n');
    const result = await runInit({ cwd: r.root, yes: true, force: true, logger: silentLogger });
    expect(result.status).toBe('written');
    expect(result.gitignoreUpdated).toBe(false);
    expect(existsSync(path.join(r.root, '.gitignore'))).toBe(false);

    writeFileSync(path.join(r.root, '.gitignore'), '/.code-reviewer/runs\n');
    writeProjectConfig(r.root, '{}\n');
    const again = await runInit({ cwd: r.root, yes: true, force: true, logger: silentLogger });
    expect(again.gitignoreUpdated).toBe(false);
    expect(readFileSync(path.join(r.root, '.gitignore'), 'utf8')).toBe('/.code-reviewer/runs\n');
  });
});

describe('init helpers', () => {
  const choices: InitChoices = {
    name: 'x',
    description: '',
    focus: [],
    instructions: '',
    ignore: [],
    base: 'auto',
    review: { provider: 'claude', model: 'opus', reasoning: 'medium' },
    critique: 'same',
    depth: 'essential',
    minConfidence: 0.7,
    analyzersBuiltin: true,
    analyzersExternal: 'auto',
    formats: ['md'],
  };

  it('pins the critic only when another layer configures one', () => {
    expect(buildInitConfig(choices, 'project').roles?.critique).toBeUndefined();
    const withCritic = structuredClone(DEFAULT_CONFIG);
    withCritic.roles.critique = { provider: 'codex' };
    expect(buildInitConfig(choices, 'project', withCritic).roles?.critique).toEqual({
      provider: 'claude',
      model: 'opus',
      reasoning: 'high',
    });
    const global = buildInitConfig(choices, 'global');
    expect(global.project).toBeUndefined();
    expect(global.git).toBeUndefined();
  });

  it('writes Bedrock settings only when a role uses Bedrock', () => {
    const bedrock = { ...choices, bedrock: { region: 'us-west-2', profile: 'dev' } };
    expect(buildInitConfig(bedrock, 'global').providers).toBeUndefined();
    const used = { ...bedrock, review: { provider: 'bedrock', model: 'm', reasoning: 'low' as const } };
    expect(buildInitConfig(used, 'global').providers).toEqual({
      bedrock: { type: 'bedrock', region: 'us-west-2', profile: 'dev' },
    });
  });

  it('groups applicable skills by technology folder, always-on first', () => {
    const group = (folder: string, yaml: string) =>
      parseGroup(yaml, `/pkg/skills/${folder}/_group.yaml`, folder, 'builtin');
    const js = group(
      'javascript',
      'name: JavaScript\ndescription: JS.\ncategory: language\ndetect:\n  languages: [javascript, typescript]',
    );
    const react = group(
      'javascript/react',
      'name: React\ndescription: R.\ncategory: framework\ndetect:\n  stack: [framework.react]',
    );
    const pg = group(
      'databases/postgresql',
      'name: PostgreSQL\ndescription: P.\ncategory: database\ndetect:\n  stack: [db.postgresql]',
    );
    const docker = group(
      'infra/docker',
      'name: Docker\ndescription: D.\ncategory: infra\ndetect:\n  files: ["**/Dockerfile"]',
    );
    const practice = group('practice', 'name: Practice\ndescription: X.\ncategory: practice');
    const skill = (id: string, groups: ReturnType<typeof group>[], extra = '') =>
      parseSkill(
        `---\nname: ${id}\ndescription: d.\n${extra}---\n- **x**: y.\n`,
        `/pkg/skills/${id}.md`,
        'builtin',
        { id, groups },
      );
    const skills = [
      skill('practice/general-bugs', [practice], 'alwaysOn: true\n'),
      skill('practice/concurrency', [practice], 'activation:\n  content: ["Mutex"]\n'),
      skill('javascript/closures', [js], 'activation:\n  content: ["setTimeout"]\n'),
      skill('javascript/react/core', [js, react]),
      skill('javascript/react/effects', [js, react], 'activation:\n  content: ["useEffect"]\n'),
      skill('databases/postgresql/locks', [pg]),
      skill('infra/docker/layers', [docker]),
    ];
    const rows = classifySkills(
      skills,
      {
        files: ['src/App.tsx', 'package.json'],
        languages: ['typescript'],
        techs: new Set(['framework.react', 'lang.typescript']),
        code: '',
      },
      new Set(),
    );
    expect(applicableSkillGroups(rows)).toEqual([
      { group: 'always on', skills: ['practice/general-bugs'] },
      { group: 'JavaScript', skills: ['javascript/closures'] },
      { group: 'React', skills: ['javascript/react/core', 'javascript/react/effects'] },
    ]);
  });

  it('reads the project name from manifests as data', async () => {
    writeFileSync(
      path.join(dir, 'pyproject.toml'),
      '[project]\nname = "svc\\u001b[31m"\ndescription = "A service"\n',
    );
    expect(await detectProjectInfo(dir)).toEqual({
      name: 'svc [31m',
      description: 'A service',
      source: 'pyproject.toml',
    });
    writeFileSync(path.join(dir, 'package.json'), '{ not json');
    expect((await detectProjectInfo(dir)).source).toBe('pyproject.toml');
    rmSync(path.join(dir, 'pyproject.toml'));
    expect(await detectProjectInfo(dir)).toEqual({ name: path.basename(dir) });
  });

  it('validates branch names conservatively', () => {
    for (const ok of ['main', 'develop', 'release/1.2', 'feature/a-b_c'])
      expect(isValidBranchName(ok)).toBe(true);
    for (const bad of [
      '-x',
      '--upload-pack=x',
      'a..b',
      'a/',
      '/a',
      'a.lock',
      'a b',
      '.hidden',
      'a/.b',
      'x~1',
    ]) {
      expect(isValidBranchName(bad), bad).toBe(false);
    }
  });
});

/** Drives the clack wizard through in-memory streams: waits for a prompt, then types keys. */
class FakeTerminal {
  readonly input = new PassThrough();
  text = '';
  private seen = 0;
  readonly output = new Writable({
    write: (chunk, _enc, done) => {
      this.text += String(chunk);
      done();
    },
  });

  async answer(prompt: string, ...keys: string[]): Promise<void> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const at = this.text.indexOf(prompt, this.seen);
      if (at >= 0) {
        this.seen = at + prompt.length;
        break;
      }
      if (Date.now() > deadline) throw new Error(`prompt not shown: ${prompt}\n${this.text.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 10));
    for (const key of keys) {
      this.input.write(key);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

const ENTER = '\r';
const DOWN = '\u001b[B';
const CTRL_C = '\u0003';

describe('init wizard', () => {
  it('walks through every question and writes the answers', async () => {
    const r = repo();
    r.write({ 'package.json': JSON.stringify({ name: 'shop' }), 'src/app.ts': 'export {};\n' });
    r.commit('init');
    const term = new FakeTerminal();
    const run = runInit({ cwd: r.root, interactive: true, io: term, logger: silentLogger });
    await term.answer('Project name', ENTER);
    await term.answer('What does the project do?', 'Shop API', ENTER);
    await term.answer('Focus areas', ENTER);
    await term.answer('Extra instructions', 'No floats for money.', ENTER, ENTER);
    await term.answer('Extra paths never to review', 'legacy/**, gen/**', ENTER);
    await term.answer('Base branch to compare', DOWN, ENTER); // auto -> main
    await term.answer('Provider for the review role', ENTER);
    await term.answer('Model for the review role', 'opus', ENTER);
    await term.answer('Reasoning effort for the review role', ENTER);
    await term.answer('Self-critique', DOWN, DOWN, ENTER); // same -> other -> off
    await term.answer('Review depth', DOWN, ENTER); // essential -> full
    await term.answer('Report findings with confidence', DOWN, ENTER); // 0.7 -> 0.8
    await term.answer('Enable the built-in analyzers', ENTER);
    await term.answer('External analyzers', DOWN, ENTER); // auto -> off
    await term.answer('Report formats', ENTER);
    await term.answer('to .gitignore?', ENTER);
    const result = await run;
    term.input.end();

    expect(result.status).toBe('written');
    expect(term.text).toContain('Detected');
    expect(term.text).toContain('Wrote .code-reviewer/config.yaml');
    const { config } = await loadConfig({ cwd: r.root, stopDir: r.root });
    expect(config.project).toEqual({
      name: 'shop',
      description: 'Shop API',
      focus: ['security', 'correctness'],
      instructions: 'No floats for money.',
      ignore: ['legacy/**', 'gen/**'],
    });
    expect(config.git.base.default).toBe('main');
    expect(config.roles.review).toMatchObject({ model: 'opus', reasoning: 'high' });
    expect(config.review).toMatchObject({ depth: 'full', selfCritique: false, minConfidence: 0.8 });
    // the full preset applies unless a value is set explicitly
    expect(config.review).toMatchObject({ minSeverity: 'info', skillTokenBudget: 6_000 });
    expect(config.analyzers).toMatchObject({ builtin: true, external: 'off' });
    expect(readFileSync(path.join(r.root, '.gitignore'), 'utf8')).toContain('.code-reviewer/runs/');
  });

  it('Ctrl+C cancels without writing; declining an overwrite keeps the file', async () => {
    const r = repo();
    const term = new FakeTerminal();
    const run = runInit({ cwd: r.root, interactive: true, io: term, logger: silentLogger });
    await term.answer('Project name', CTRL_C);
    const cancelled = await run;
    term.input.end();
    expect(cancelled.status).toBe('cancelled');
    expect(term.text).toContain('nothing was written');
    expect(existsSync(path.join(r.root, '.code-reviewer'))).toBe(false);

    const file = writeProjectConfig(r.root, 'review:\n  minConfidence: 0.5\n');
    const term2 = new FakeTerminal();
    const run2 = runInit({ cwd: r.root, interactive: true, io: term2, logger: silentLogger });
    await term2.answer('already exists. Overwrite it?', ENTER); // default: No
    const declined = await run2;
    term2.input.end();
    expect(declined.status).toBe('declined');
    expect(readFileSync(file, 'utf8')).toBe('review:\n  minConfidence: 0.5\n');
  });
});
