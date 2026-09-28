import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/index';
import { runReview } from '../src/review/pipeline';
import { RunLog } from '../src/runs/log';
import { Logger, silentLogger } from '../src/util/logger';
import { packageVersion } from '../src/util/paths';
import { makeRepo, type TempRepo, testConfig } from './helpers';

describe('Logger taps and children', () => {
  it('taps see every message, debug included, whatever the console level', () => {
    const printed: string[] = [];
    const parent = new Logger('warn');
    parent.setSink((line) => printed.push(line));
    const child = parent.child();
    const seen: string[] = [];
    const untap = child.tap((level, msg) => seen.push(`${level}:${msg}`));
    child.debug('agent started');
    child.info('reviewing');
    child.warn('slow agent');
    expect(seen).toEqual(['debug:agent started', 'info:reviewing', 'warn:slow agent']);
    // the console follows the parent's level and sink
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('slow agent');
    untap();
    child.warn('after');
    expect(seen).toHaveLength(3);
  });

  it("keeps each child's taps to its own messages", () => {
    const parent = new Logger('silent');
    const a = parent.child();
    const b = parent.child();
    const seenA: string[] = [];
    const seenParent: string[] = [];
    a.tap((_l, m) => seenA.push(m));
    parent.tap((_l, m) => seenParent.push(m));
    a.debug('from a');
    b.debug('from b');
    expect(seenA).toEqual(['from a']);
    expect(seenParent).toEqual(['from a', 'from b']);
  });

  it('strips terminal escapes before taps see the text', () => {
    const seen: string[] = [];
    const logger = silentLogger.child();
    logger.tap((_l, m) => seen.push(m));
    logger.debug('agent says \u001b[2Jhi');
    expect(seen).toEqual(['agent says hi']);
  });
});

describe('RunLog', () => {
  it('writes timestamped lines and stops at its size cap', () => {
    const log = new RunLog(() => new Date('2026-09-28T10:00:00.000Z'));
    log.add('debug', 'hello');
    log.event({ type: 'warning', message: 'slow' });
    log.event({ type: 'chunk-activity', chunkId: 'c001', tool: 'read_file' }); // tool calls: not logged here
    expect(log.text()).toBe(
      '2026-09-28T10:00:00.000Z DEBUG hello\n2026-09-28T10:00:00.000Z EVENT warning: slow\n',
    );
    const big = new RunLog();
    for (let i = 0; i < 3_000; i++) big.add('debug', 'x'.repeat(3_000));
    expect(big.text().length).toBeLessThan(5.1 * 1024 * 1024);
    expect(big.text()).toMatch(/log truncated/);
  });
});

describe('run.log and chunk artifacts', () => {
  let repo: TempRepo;

  beforeAll(() => {
    repo = makeRepo();
    repo.write({ 'a.ts': 'export const a = 1;\n' });
    repo.commit('initial');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write({ 'a.ts': 'export const a = 1;\nexport const x = a / 0; // BUG(major): division by zero\n' });
    repo.commit('feature');
  });
  afterAll(() => repo.cleanup());

  it('keeps the debug log and the prompt of every chunk, without --verbose', async () => {
    const outcome = await runReview({
      command: 'review',
      cwd: repo.root,
      base: 'main',
      head: 'feature',
      config: testConfig((c) => {
        c.output.formats = [];
      }),
      logger: new Logger('info'),
      skipPreflight: true,
    });
    const run = outcome.run!;
    const log = readFileSync(path.join(outcome.runDir!, 'run.log'), 'utf8');
    expect(log).toMatch(new RegExp(`DEBUG code-reviewer ${packageVersion().replace(/\./g, '\\.')} · node`));
    expect(log).toMatch(/EVENT plan: 1 file\(s\) in 1 chunk\(s\)/);
    expect(log).toMatch(new RegExp(`EVENT chunk ${run.chunks[0]!.id} done: 1 finding`));
    expect(log).toMatch(/EVENT done: completed, 1 finding\(s\)/);
    const artifact = JSON.parse(
      readFileSync(path.join(outcome.runDir!, 'chunks', `${run.chunks[0]!.id}.json`), 'utf8'),
    );
    expect(artifact.prompt).toContain('## Files to review');
    expect(artifact.instructions).toContain('submit_findings');
  });
});

describe('CLI flags', () => {
  it('-v prints the version; --verbose is the debug switch', async () => {
    const out: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    try {
      await buildProgram()
        .parseAsync(['node', 'code-reviewer', '-v'])
        .catch(() => undefined);
    } finally {
      write.mockRestore();
    }
    expect(out.join('')).toBe(`${packageVersion()}\n`);
    const verbose = buildProgram().options.find((o) => o.long === '--verbose');
    expect(verbose?.short).toBeUndefined();
  });
});
