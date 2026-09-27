import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Config, DEFAULT_CONFIG, DEPTH_PRESETS } from '../src/config/schema';

export interface TempRepo {
  root: string;
  git(...args: string[]): string;
  write(files: Record<string, string>): void;
  commit(message: string, author?: string): string;
  cleanup(): void;
}

/** Creates a throw-away git repository with deterministic identity. */
export function makeRepo(): TempRepo {
  const root = mkdtempSync(path.join(tmpdir(), 'cr-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Dev One');
  git('config', 'commit.gpgsign', 'false');
  return {
    root,
    git,
    write(files) {
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    },
    commit(message, author) {
      git('add', '-A');
      git('commit', '-q', '-m', message, ...(author ? [`--author=${author}`] : []));
      return git('rev-parse', 'HEAD').trim();
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** DEFAULT_CONFIG at the `full` review depth (every severity), with mock roles; `overrides` adjust it. */
export function testConfig(overrides: (c: Config) => void = () => {}): Config {
  const config = structuredClone(DEFAULT_CONFIG);
  Object.assign(config.review, { depth: 'full' }, DEPTH_PRESETS.full.review);
  config.roles = {
    review: { provider: 'mock', reasoning: 'low' },
    critique: { provider: 'mock', reasoning: 'low' },
  };
  config.output.formats = ['md', 'json', 'html'];
  overrides(config);
  return config;
}
