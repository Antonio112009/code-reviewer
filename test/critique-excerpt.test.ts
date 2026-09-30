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
