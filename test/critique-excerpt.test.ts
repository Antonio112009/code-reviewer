import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockProvider } from '../src/providers/mock';
import { ProviderRegistry } from '../src/providers/registry';
import type { AgentResult, AgentTask, Provider } from '../src/providers/types';
import { runReview } from '../src/review/pipeline';
import { silentLogger } from '../src/util/logger';
import { makeRepo, type TempRepo, testConfig } from './helpers';

let repo: TempRepo;

beforeAll(() => {
  repo = makeRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\nexport const b = 2;\n' });
  repo.commit('initial');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    'src/a.ts':
      'export const a = 1;\nexport const b = 2;\nexport const x = a / 0; // BUG(major): division by zero\n',
  });
  repo.commit('feature');
  repo.git('checkout', '-q', 'main');
});

afterAll(() => repo.cleanup());

/** The mock provider, recording every task. */
class Recording implements Provider {
  readonly id = 'mock';
  readonly kind = 'mock' as const;
  readonly tasks: AgentTask[] = [];
  private readonly mock = new MockProvider('mock');
  async run(task: AgentTask): Promise<AgentResult> {
    this.tasks.push(task);
    return this.mock.run(task);
  }
  async dispose(): Promise<void> {}
}

async function critiquePromptOf(command: 'review' | 'files'): Promise<string> {
  const config = testConfig((c) => {
    c.output.formats = [];
  });
  const provider = new Recording();
  const registry = new ProviderRegistry(config, silentLogger);
  (registry as unknown as { instances: Map<string, Provider> }).instances.set('mock', provider);
  await runReview({
    command,
    cwd: repo.root,
    ...(command === 'review' ? { base: 'main', head: 'feature' } : { paths: ['src/a.ts'] }),
    config,
    logger: silentLogger,
    providers: registry,
    skipPreflight: true,
  });
  if (command === 'files') repo.git('checkout', '-q', 'main');
  return provider.tasks.find((t) => t.kind === 'verdicts')?.prompt ?? '';
}

describe('critique excerpts', () => {
  it('mark the lines the change added, so the critic can tell a pre-existing problem', async () => {
    const prompt = await critiquePromptOf('review');
    expect(prompt).toContain('"+" the lines this change added or modified');
    expect(prompt).toMatch(/^3 \+> export const x = a \/ 0;/m);
    expect(prompt).toMatch(/^2 {4}export const b = 2;/m);
  });

  it('have no change marks when whole files are reviewed', async () => {
    repo.git('checkout', '-q', 'feature');
    const prompt = await critiquePromptOf('files');
    expect(prompt).toContain('(">" marks the reported lines)');
    expect(prompt).toMatch(/^3 > export const x = a \/ 0;/m);
  });
});

describe('critic verdicts', () => {
  it('apply a corrected title and keep the original in the critique', async () => {
    const { critiqueFindings } = await import('../src/review/critique');
    const finding = {
      id: 'f1',
      file: 'src/a.ts',
      startLine: 3,
      endLine: 3,
      severity: 'major',
      category: 'bug',
      title: 'Parse failure silently drops the settings update',
      description: 'A parse error skips the write.',
      confidence: 0.8,
      skills: [],
      source: { chunkIds: ['c1'], provider: 'mock' },
    } as never;
    const scripted: Provider = {
      id: 'mock',
      kind: 'mock',
      async run(task: AgentTask): Promise<AgentResult> {
        expect(task.kind).toBe('verdicts');
        return {
          submission: {
            calls: 1,
            verdicts: [
              {
                id: 'f1',
                verdict: 'confirmed',
                confidence: 0.7,
                reason: 'Not silent (the error is logged), but the update is dropped.',
                severity: 'minor',
                title: 'Parse failure drops the settings update',
              },
            ],
          },
          text: '',
          toolCalls: 0,
          warnings: [],
        };
      },
      async dispose() {},
    };
    const out = await critiqueFindings([finding], {
      provider: scripted,
      reasoning: 'high',
      mode: 'diff',
      depth: 'full',
      root: repo.root,
      git: false,
      readTools: false,
      maxSteps: 5,
      timeoutMs: 10_000,
      concurrency: 1,
      batchTokenBudget: 10_000,
    });
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]).toMatchObject({
      title: 'Parse failure drops the settings update',
      severity: 'minor',
      confidence: 0.7,
      critique: {
        verdict: 'confirmed',
        originalTitle: 'Parse failure silently drops the settings update',
        originalSeverity: 'major',
      },
    });
  });
});

describe('second opinion', () => {
  const finding = (id: string, line: number) =>
    ({
      id,
      file: 'src/a.ts',
      startLine: line,
      endLine: line,
      severity: 'major',
      category: 'bug',
      title: `Finding ${id}`,
      description: 'A description long enough.',
      confidence: 0.8,
      skills: [],
      source: { chunkIds: ['c1'], provider: 'mock' },
    }) as never;
  const verdict = (id: string, v: 'confirmed' | 'rejected', confidence: number) => ({
    id,
    verdict: v,
    confidence,
    reason: `${v} ${id}`,
  });
  const options = (provider: Provider) => ({
    provider,
    reasoning: 'high' as const,
    mode: 'diff' as const,
    depth: 'full' as const,
    root: repo.root,
    git: false,
    readTools: false,
    maxSteps: 5,
    timeoutMs: 10_000,
    concurrency: 1,
    batchTokenBudget: 10_000,
    secondOpinion: { min: 0.5, max: 0.75 },
  });
  const scripted = (second: (task: AgentTask) => AgentResult | Error) => {
    const tasks: AgentTask[] = [];
    const provider: Provider = {
      id: 'mock',
      kind: 'mock',
      async run(task: AgentTask): Promise<AgentResult> {
        tasks.push(task);
        if (task.label.startsWith('second-opinion')) {
          const out = second(task);
          if (out instanceof Error) throw out;
          return out;
        }
        return {
          submission: {
            calls: 1,
            verdicts: [
              verdict('f1', 'confirmed', 0.65),
              verdict('f2', 'confirmed', 0.9),
              verdict('f3', 'confirmed', 0.6),
            ],
          },
          text: '',
          toolCalls: 0,
          warnings: [],
        };
      },
      async dispose() {},
    };
    return { provider, tasks };
  };

  it('asks a second verifier about borderline findings only; its verdict replaces the first', async () => {
    const { critiqueFindings } = await import('../src/review/critique');
    const { provider, tasks } = scripted(() => ({
      submission: { calls: 1, verdicts: [verdict('f1', 'rejected', 0.2), verdict('f3', 'confirmed', 0.85)] },
      text: '',
      toolCalls: 0,
      warnings: [],
    }));
    const out = await critiqueFindings(
      [finding('f1', 1), finding('f2', 2), finding('f3', 3)],
      options(provider),
    );
    const second = tasks.filter((t) => t.label.startsWith('second-opinion'));
    expect(second).toHaveLength(1);
    expect(second[0]!.instructions).toContain('## Second opinion');
    expect(second[0]!.prompt).toContain('"firstVerdict"');
    expect(second[0]!.prompt).toContain('Finding f1');
    expect(second[0]!.prompt).not.toContain('Finding f2'); // 0.9: not borderline
    expect(out.secondOpinions).toBe(2);
    expect(out.kept.map((f) => [f.id, f.confidence])).toEqual([
      ['f2', 0.9],
      ['f3', 0.85],
    ]);
    expect(out.kept[1]!.critique).toMatchObject({
      verdict: 'confirmed',
      originalConfidence: 0.8, // the reviewer's, not the first verifier's
      firstOpinion: { verdict: 'confirmed', confidence: 0.6, reason: 'confirmed f3' },
    });
    expect(out.kept[0]!.critique?.firstOpinion).toBeUndefined();
    expect(out.rejected.map((f) => [f.id, f.droppedReason, f.critique?.firstOpinion?.confidence])).toEqual([
      ['f1', 'critique', 0.65],
    ]);
  });

  it('keeps the first verdicts when the second verifier fails', async () => {
    const { critiqueFindings } = await import('../src/review/critique');
    const { provider } = scripted(() => new Error('agent crashed'));
    const out = await critiqueFindings(
      [finding('f1', 1), finding('f2', 2), finding('f3', 3)],
      options(provider),
    );
    expect(out.kept.map((f) => [f.id, f.confidence])).toEqual([
      ['f1', 0.65],
      ['f2', 0.9],
      ['f3', 0.6],
    ]);
    expect(out.rejected).toEqual([]);
    expect(out.warnings.join(' ')).toContain('second-opinion batch 1 failed');
  });

  it('covers the confidence range around the bar of the main report', async () => {
    const { secondOpinionRange } = await import('../src/review/pipeline');
    const round = (r: { min: number; max: number }) => [r.min.toFixed(2), r.max.toFixed(2)];
    expect(round(secondOpinionRange({ minConfidence: 0.3, advisoryConfidence: 0.6 }))).toEqual([
      '0.50',
      '0.75',
    ]);
    expect(round(secondOpinionRange({ minConfidence: 0.7, advisoryConfidence: 0 }))).toEqual([
      '0.60',
      '0.85',
    ]);
  });
});
