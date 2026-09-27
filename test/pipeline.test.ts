import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../src/providers/registry';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import { type ReviewEvent, runReview } from '../src/review/pipeline';
import { RunStore } from '../src/runs/store';
import type { RunRecord } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;

beforeAll(() => {
  repo = makeRepo();
  repo.write({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { react: '^19.0.0' } }),
    'src/math.ts': 'export function sum(xs: number[]) {\n  return xs.reduce((a, b) => a + b, 0);\n}\n',
    'src/legacy.ts': 'export const legacy = 1;\n',
  });
  repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    'src/math.ts': [
      'export function sum(xs: number[]) {',
      '  return xs.reduce((a, b) => a + b, 0);',
      '}',
      '',
      'export function average(xs: number[]) {',
      '  let total = 0;',
      '  for (let i = 0; i <= xs.length; i++) total += xs[i]; // BUG(major): off-by-one reads past the end',
      '  return total / xs.length; // BUG: division by zero for empty input',
      '}',
      '',
    ].join('\n'),
    'src/Widget.tsx': [
      "import { useEffect, useState } from 'react';",
      'export function Widget() {',
      '  const [v, setV] = useState(0);',
      '  useEffect(() => { setV(1); }, []); // BUG(info): false positive about effects',
      '  return <b>{v}</b>;',
      '}',
      '',
    ].join('\n'),
    'package-lock.json': '{}',
  });
  repo.git('rm', '-q', 'src/legacy.ts');
  repo.commit('feature work', 'Dev Two <two@example.com>');
  repo.git('checkout', '-q', 'main');
});

afterAll(() => repo.cleanup());

describe('runReview (diff mode, mock provider)', () => {
  let run: RunRecord;
  let runDir: string;
  const events: ReviewEvent[] = [];

  beforeAll(async () => {
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.review.authors = true;
      }),
      logger: silentLogger,
      onEvent: (e) => events.push(e),
    });
    run = outcome.run!;
    runDir = outcome.runDir!;
  });

  it('plans chunks with skills and skips excluded files', () => {
    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type === 'plan' && plan.plan.skipped.map((s) => s.path)).toEqual(['package-lock.json']);
    expect(plan?.type === 'plan' && plan.plan.deleted).toEqual(['src/legacy.ts']);
    expect(run.chunks[0]!.skills).toEqual(
      expect.arrayContaining(['practice/general-bugs', 'security/core', 'javascript/react/effects']),
    );
  });

  it('reviews the head revision through an isolated snapshot', () => {
    // HEAD is on main, so the feature head must have been materialised in a worktree
    expect(repo.git('worktree', 'list').trim().split('\n')).toHaveLength(1);
    expect(repo.git('status', '--porcelain', '--', '.', ':(exclude).code-reviewer')).toBe('');
  });

  it('keeps confirmed findings, records the critic and rejects false positives', () => {
    expect(run.status).toBe('completed');
    expect(run.findings.map((f) => [f.file, f.startLine, f.severity])).toEqual([
      ['src/math.ts', 7, 'major'],
      ['src/math.ts', 8, 'minor'],
    ]);
    expect(run.findings[0]!.critique?.verdict).toBe('confirmed');
    expect(run.rejected.map((f) => [f.file, f.droppedReason])).toEqual([['src/Widget.tsx', 'critique']]);
  });

  it('attributes authors via git blame', () => {
    expect(run.findings[0]!.author).toMatchObject({ name: 'Dev Two', email: 'two@example.com' });
  });

  it('persists the run with reports and per-chunk artifacts', async () => {
    for (const f of ['run.json', 'report.md', 'report.json', 'report.html', 'chunks/c001.json']) {
      expect(existsSync(path.join(runDir, f)), f).toBe(true);
    }
    const md = readFileSync(path.join(runDir, 'report.md'), 'utf8');
    expect(md).toContain('[MAJOR] off-by-one reads past the end');
    expect(md).toContain('## Rejected findings (1)');
    const html = readFileSync(path.join(runDir, 'report.html'), 'utf8');
    expect(html).not.toMatch(/<\/script>[\s\S]*"findings"/); // JSON is embedded safely
    const store = new RunStore(path.join(repo.root, '.code-reviewer/runs'));
    expect((await store.list()).map((r) => r.id)).toContain(run.id);
    expect((await store.load('latest')).id).toBe(run.id);
  });
});

describe('runReview (files mode)', () => {
  it('reviews whole files of the working tree', async () => {
    const outcome = await runReview({
      command: 'files',
      cwd: repo.root,
      paths: ['src'],
      config: testConfig((c) => {
        c.review.selfCritique = false;
        c.output.formats = ['json'];
      }),
      logger: silentLogger,
    });
    expect(outcome.run!.target).toMatchObject({ kind: 'files', paths: ['src'] });
    expect(outcome.run!.findings).toEqual([]); // main has no BUG markers
    expect(outcome.run!.chunks[0]!.files).toEqual(['src/legacy.ts', 'src/math.ts']);
  });
});

describe('runReview failure handling', () => {
  class FlakyProvider implements Provider {
    readonly id = 'flaky';
    readonly kind = 'mock' as const;
    async run(task: AgentTask): Promise<AgentResult> {
      if (task.kind === 'findings' && !task.label.endsWith('repair')) {
        return {
          submission: { calls: 0 },
          text: 'I think there is an issue but no JSON',
          toolCalls: 0,
          warnings: [],
        };
      }
      return {
        submission: { calls: 0 },
        text: '```json\n{"findings": [{"file": "src/nope.ts", "startLine": 1, "endLine": 1, "severity": "info", "category": "bug", "title": "Hallucinated file", "description": "Refers to a file that does not exist", "confidence": 0.9}]}\n```',
        toolCalls: 0,
        warnings: [],
      };
    }
    async dispose() {}
  }

  it('repairs replies without a payload and drops hallucinated files', async () => {
    const config = testConfig((c) => {
      c.review.selfCritique = false;
      c.output.formats = [];
    });
    const registry = new ProviderRegistry(config, silentLogger);
    (registry as unknown as { instances: Map<string, Provider> }).instances.set('mock', new FlakyProvider());
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config,
      logger: silentLogger,
      providers: registry,
    });
    expect(outcome.run!.findings).toEqual([]);
    expect(outcome.run!.rejected.map((f) => f.droppedReason)).toEqual(['unknown-file']);
  });

  it('an interrupt before the review phase stops without creating a run', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runReview({
        command: 'review',
        cwd: repo.root,
        base: 'main',
        head: 'feature',
        config: testConfig((c) => {
          c.output.formats = [];
        }),
        logger: silentLogger,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(repo.git('worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('an interrupt during the review saves a partial run, skips critique and cleans up', async () => {
    const controller = new AbortController();
    let critiqueCalls = 0;
    class InterruptingProvider implements Provider {
      readonly id = 'interrupting';
      readonly kind = 'mock' as const;
      async run(task: AgentTask): Promise<AgentResult> {
        if (task.kind === 'verdicts') critiqueCalls++;
        controller.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      async dispose() {}
    }
    const config = testConfig((c) => {
      c.output.formats = [];
    });
    const registry = new ProviderRegistry(config, silentLogger);
    (registry as unknown as { instances: Map<string, Provider> }).instances.set(
      'mock',
      new InterruptingProvider(),
    );
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config,
      logger: silentLogger,
      signal: controller.signal,
      providers: registry,
      skipPreflight: true,
    });
    expect(outcome.run!.status).toBe('partial');
    expect(outcome.run!.chunks.every((c) => c.status === 'failed' && c.error === 'aborted')).toBe(true);
    expect(outcome.run!.warnings.join('\n')).toMatch(/interrupted/);
    expect(critiqueCalls).toBe(0);
    expect(repo.git('worktree', 'list').trim().split('\n')).toHaveLength(1);
  });

  it('dry-run plans without creating a run', async () => {
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig(),
      logger: silentLogger,
      dryRun: true,
    });
    expect(outcome.run).toBeUndefined();
    expect(outcome.plan.chunks).toHaveLength(1);
  });
});
