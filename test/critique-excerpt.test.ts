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
