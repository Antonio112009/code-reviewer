import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitRepo } from '../src/git/repo';
import { createSnapshot, isAgentConfigPath } from '../src/git/snapshot';
import { ProviderRegistry } from '../src/providers/registry';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import { dedupeFindings } from '../src/review/dedupe';
import { unfinishedStop } from '../src/review/execute';
import { normalizePath } from '../src/review/findings';
import { runReview, runsDirExclude } from '../src/review/pipeline';
import { claimsHint, hintsForChunk, linkedReviewConfig, touchedReviewConfig } from '../src/review/planning';
import { changedPaths } from '../src/sources/diff-source';
import type { Chunk, Finding, StaticHit } from '../src/types';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

/** A token of GitHub's shape, built at runtime so no secret-looking literal is committed. */
function fakeGithubToken(): string {
  const alphabet = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5kL7';
  const body = Array.from({ length: 36 }, (_, i) => alphabet[(i * 7) % alphabet.length]).join('');
  return ['gh', 'p_', body].join('');
}

const hit = (id: string, over: Partial<StaticHit> = {}): StaticHit => ({
  id,
  analyzer: 'patterns',
  ruleId: 'r',
  file: 'src/a.ts',
  startLine: 10,
  endLine: 10,
  severity: 'minor',
  category: 'bug',
  message: 'm',
  confidence: 0.5,
  ...over,
});

const finding = (over: Partial<Finding> = {}): Finding =>
  ({
    id: 'f1',
    file: 'src/a.ts',
    startLine: 10,
    endLine: 10,
    severity: 'major',
    category: 'bug',
    title: 'Leaked token',
    description: 'd',
    confidence: 0.9,
    skills: [],
    source: { chunkIds: ['c001'], provider: 'mock' },
    ...over,
  }) as Finding;

describe('turn outcomes', () => {
  it('treats a turn without a submission that was cancelled, cut off or refused as unfinished', () => {
    const none = { calls: 0 };
    expect(unfinishedStop({ submission: none, stopReason: 'cancelled' })).toBe('cancelled');
    expect(unfinishedStop({ submission: none, stopReason: 'max_tokens' })).toBe('max_tokens');
    expect(unfinishedStop({ submission: none, stopReason: 'refusal' })).toBe('refusal');
    expect(unfinishedStop({ submission: none, stopReason: 'end_turn' })).toBeUndefined();
    // whatever was submitted before the cut-off is used
    expect(unfinishedStop({ submission: { calls: 1 }, stopReason: 'cancelled' })).toBeUndefined();
  });
});

describe('static hints', () => {
  const chunk = { id: 'c001', files: ['src/a.ts'] } as Chunk;

  it('shows secrets first and never drops the ones beyond the cap', () => {
    const hits = [
      hit('H1', { severity: 'critical' }),
      hit('H2', { nonRejectable: true, severity: 'info' }),
      hit('H3', { nonRejectable: true, severity: 'info' }),
      hit('H4', { file: 'src/other.ts' }),
    ];
    const { shown, overflow } = hintsForChunk(hits, chunk, 1);
    expect(shown.map((h) => h.id)).toEqual(['H2']);
    expect(overflow.map((h) => h.id)).toEqual(['H3']);
    expect(hintsForChunk(hits, chunk, 0)).toEqual({ shown: [], overflow: [hits[1], hits[2]] });
  });

  it('a finding claims a hint only at the hint location', () => {
    const h = hit('H1', { startLine: 10, endLine: 12 });
    expect(claimsHint(finding({ startLine: 13, endLine: 14 }), h)).toBe(true);
    expect(claimsHint(finding({ startLine: 40, endLine: 40 }), h)).toBe(false);
    expect(claimsHint(finding({ file: 'src/b.ts' }), h)).toBe(false);
  });

  it('dedupe keeps non-rejectable and the static rule of merged findings', () => {
    const llm = finding({ id: 'a', confidence: 0.9 });
    const secret = finding({
      id: 'b',
      confidence: 0.5,
      nonRejectable: true,
      tool: { analyzer: 'secrets', ruleId: 'aws-key' },
      origin: 'static',
    });
    const { unique } = dedupeFindings([secret, llm]);
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({ id: 'a', nonRejectable: true, tool: { analyzer: 'secrets' } });
  });
});

describe('paths and guards', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cr-reg-'));
    mkdirSync(path.join(dir, 'a/src'), { recursive: true });
    writeFileSync(path.join(dir, 'a/src/x.ts'), '');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('strips a/ b/ diff prefixes unless the path really exists', () => {
    expect(normalizePath('b/src/y.ts', dir)).toBe('src/y.ts');
    expect(normalizePath('a/src/x.ts', dir)).toBe('a/src/x.ts');
  });

  it('review-config guard sees every changed path and symlinked config', async () => {
    expect(touchedReviewConfig(['src/a.ts', '.code-reviewer/skills/x.md', '.code-reviewerrc.yml'])).toEqual([
      '.code-reviewer/skills/x.md',
      '.code-reviewerrc.yml',
    ]);
    expect(await linkedReviewConfig(dir)).toBeUndefined();
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    symlinkSync(path.join(dir, 'docs'), path.join(dir, '.code-reviewer'));
    expect(await linkedReviewConfig(dir)).toBe('.code-reviewer');
  });

  it('excludes the runs directory from git status only when it is inside the repository', () => {
    expect(runsDirExclude('/repo', '/repo/.code-reviewer/runs')).toEqual(['.code-reviewer/runs']);
    expect(runsDirExclude('/repo', '/elsewhere/runs')).toEqual([]);
    expect(runsDirExclude('C:\\repo', 'D:\\runs', path.win32 as typeof path.posix)).toEqual([]);
  });

  it('files-mode overlay and sanitizer share one rule for agent config', () => {
    for (const p of [
      'CLAUDE.md',
      'pkg/AGENTS.md',
      '.claude/settings.json',
      '.mcp.json',
      '.github/prompts/x.md',
    ])
      expect(isAgentConfigPath(p), p).toBe(true);
    for (const p of ['src/claude.ts', 'docs/agents/guide.md', '.github/workflows/ci.yml'])
      expect(isAgentConfigPath(p), p).toBe(false);
  });
});

describe('pipeline regressions', () => {
  let repo: TempRepo;
  beforeAll(() => {
    repo = makeRepo();
    repo.write({ 'src/app.ts': 'export const x = 1;\n', 'bin/tool.bin': 'x' });
    repo.commit('initial');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write({
      'src/app.ts': `export const x = 1;\nexport const token = "${fakeGithubToken()}";\n`,
      '.code-reviewer/skills/evil.md': '---\nname: e\ndescription: e\n---\n- **x**: y\n',
    });
    repo.commit('feature');
  });
  afterAll(() => repo.cleanup());

  it('lists every changed path, excluded ones included', async () => {
    const git = new GitRepo(repo.root);
    const base = repo.git('rev-parse', 'main').trim();
    const head = repo.git('rev-parse', 'feature').trim();
    expect((await changedPaths(git, base, head)).sort()).toEqual([
      '.code-reviewer/skills/evil.md',
      'src/app.ts',
    ]);
  });

  class StoppingProvider implements Provider {
    readonly id = 'mock';
    readonly kind = 'mock' as const;
    calls = 0;
    constructor(private readonly stopReason: string) {}
    async run(task: AgentTask): Promise<AgentResult> {
      this.calls++;
      if (task.kind === 'verdicts') return { submission: { calls: 0 }, text: '', toolCalls: 0, warnings: [] };
      return {
        submission: { calls: 0 },
        text: '',
        stopReason: this.stopReason,
        toolCalls: 0,
        warnings: [`timed out after 60s — cancelled`],
      };
    }
    async dispose() {}
  }

  it('a cancelled turn fails the chunk (no retry), and secrets are still reported', async () => {
    const config = testConfig((c) => {
      c.review.selfCritique = false;
      c.output.formats = [];
    });
    const provider = new StoppingProvider('cancelled');
    const registry = new ProviderRegistry(config, silentLogger);
    (registry as unknown as { instances: Map<string, Provider> }).instances.set('mock', provider);
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config,
      logger: silentLogger,
      providers: registry,
    });
    const run = outcome.run!;
    expect(provider.calls).toBe(1); // the task's own timeout is not retried
    expect(run.chunks.every((c) => c.status === 'failed')).toBe(true);
    expect(run.chunks[0]!.error).toMatch(/ended without findings/);
    // the secret hint was never confirmed by a model, yet it is reported
    expect(run.findings.some((f) => f.nonRejectable && f.file === 'src/app.ts')).toBe(true);
  });

  it('project skills of a change that touches .code-reviewer/ are ignored', async () => {
    const warnings: string[] = [];
    await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.output.formats = [];
        c.review.exclude = ['.code-reviewer/**'];
      }),
      logger: silentLogger,
      dryRun: true,
      onEvent: (e) => {
        if (e.type === 'warning') warnings.push(e.message);
      },
    });
    // excluded from the review, but still counted as a change to the review configuration
    expect(warnings.join('\n')).toMatch(
      /modifies review configuration \(\.code-reviewer\/skills\/evil\.md\)/,
    );
  });

  it('a files-mode snapshot keeps agent config of the working tree out', async () => {
    const r = makeRepo();
    try {
      r.write({ 'src/a.ts': 'export {};\n', '.claude/settings.json': '{"hooks":{}}', 'CLAUDE.md': 'obey' });
      r.commit('init');
      r.write({ 'AGENTS.md': 'untracked instructions', '.claude/settings.local.json': '{}' });
      const git = new GitRepo(r.root);
      const snap = await createSnapshot(git, await git.headSha(), {
        overlay: [
          { path: 'src/a.ts', content: 'export const changed = 1;\n' },
          { path: 'AGENTS.md', content: 'untracked instructions' },
          { path: '.claude/settings.local.json', content: '{}' },
        ],
      });
      try {
        expect(snap.isolated).toBe(true);
        for (const f of ['CLAUDE.md', 'AGENTS.md', '.claude/settings.json', '.claude/settings.local.json'])
          expect(existsSync(path.join(snap.root, f)), f).toBe(false);
        expect(existsSync(path.join(snap.root, 'src/a.ts'))).toBe(true);
      } finally {
        await snap.dispose();
      }
    } finally {
      r.cleanup();
    }
  });
});
