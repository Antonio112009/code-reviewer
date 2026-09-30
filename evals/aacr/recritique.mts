// Re-runs only the self-critique on the findings of a finished AACR run, with this checkout's critic: the
// cheap way to compare critic prompts on the same findings (about $1.5 for ctx30, against $7 for a full run).
//
//   npx tsx evals/aacr/recritique.mts <run-dir>/runs <out.json> [--repos <dir>] [--no-marks]
//
// <run-dir> is $AACR_DIR/aacr-bench/evaluation/results/<dataset>/code-reviewer/<run-id>. Every finding the
// critic saw in that run (kept, "worth a look" and rejected by critique) is restored to the reviewer's
// confidence and severity and verified again; the verdicts go to <out.json> (finished PRs are skipped when
// it exists). The repository clones are checked out at each PR's head: do not run it next to a benchmark
// run that uses the same clones (--repos points at another copy).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/schema';
import { ProviderRegistry } from '../../src/providers/registry';
import { critiqueFindings } from '../../src/review/critique';
import type { Finding, RunRecord } from '../../src/types';
import { silentLogger } from '../../src/util/logger';

const args = process.argv.slice(2);
const [runsDir, outFile] = args;
if (!runsDir || !outFile) {
  console.error('usage: recritique.mts <run-dir>/runs <out.json> [--repos <dir>] [--no-marks]');
  process.exit(2);
}
const reposFlag = args.indexOf('--repos');
const repos =
  reposFlag >= 0 ? args[reposFlag + 1]! : path.join(homedir(), '.cache', 'code-reviewer-aacr', 'repos');
const marks = !args.includes('--no-marks');

interface VerdictRow {
  inst: string;
  id: string;
  /** The reviewer's title; `correctedTitle` when the critic changed it. */
  title: string;
  correctedTitle?: string;
  verdict?: string;
  confidence?: number;
  severity: string;
  reason?: string;
}

/** New-version lines each file of `base..head` added or modified. */
function changedLines(repo: string, base: string, head: string): Map<string, Set<number>> {
  const diff = execFileSync('git', ['-C', repo, 'diff', '-U0', '--no-color', '--no-ext-diff', base, head], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = new Map<string, Set<number>>();
  let file = '';
  let line = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.startsWith('+++ b/') ? l.slice(6) : '';
      if (file && !out.has(file)) out.set(file, new Set());
    } else if (l.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
    } else if (l.startsWith('+') && file) {
      out.get(file)!.add(line++);
    }
  }
  return out;
}

const registry = new ProviderRegistry(structuredClone(DEFAULT_CONFIG), silentLogger);
/** Verdicts of an interrupted run of this script, to continue from; none when the file is not there yet. */
function earlierRows(file: string): VerdictRow[] {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
const rows = earlierRows(outFile);
const done = new Set(rows.map((r) => r.inst));

for (const inst of readdirSync(runsDir)
  .filter((d) => d.includes('@'))
  .sort()) {
  if (done.has(inst)) continue;
  try {
    const run = JSON.parse(readFileSync(path.join(runsDir, inst, 'run.json'), 'utf8')) as RunRecord;
    const target = run.target as { base?: string; head?: string };
    const repo = path.join(repos, inst.split('@')[0]!);
    const seen = [
      ...run.findings,
      ...(run.advisory ?? []),
      ...run.rejected.filter((f) => f.droppedReason === 'critique'),
    ];
    // Back to what the critic was given: the reviewer's confidence, severity and title, no verdict.
    const findings = seen.map((f): Finding => {
      const { critique, droppedReason: _dropped, ...rest } = f;
      return {
        ...rest,
        confidence: critique?.originalConfidence ?? f.confidence,
        severity: critique?.originalSeverity ?? f.severity,
        title: critique?.originalTitle ?? f.title,
      };
    });
    if (findings.length === 0 || !target.base || !target.head) continue;
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-f', target.head]);
    execFileSync('git', ['-C', repo, 'clean', '-q', '-fdx']);
    const started = Date.now();
    const outcome = await critiqueFindings(findings, {
      provider: registry.get('claude'),
      model: DEFAULT_CONFIG.providers.claude?.critiqueModel,
      reasoning: 'high',
      mode: 'diff',
      depth: 'full',
      root: repo,
      git: true,
      readTools: true,
      maxSteps: 25,
      timeoutMs: 15 * 60_000,
      concurrency: 3,
      batchTokenBudget: 20_000,
      ...(marks ? { changedLines: changedLines(repo, target.base, target.head) } : {}),
    });
    const titles = new Map(findings.map((f) => [f.id, f.title]));
    for (const f of [...outcome.kept, ...outcome.rejected]) {
      const title = titles.get(f.id) ?? f.title;
      rows.push({
        inst,
        id: f.id,
        title,
        ...(f.title !== title ? { correctedTitle: f.title } : {}),
        verdict: f.critique?.verdict,
        confidence: f.critique?.confidence,
        severity: f.severity,
        reason: f.critique?.reason,
      });
    }
    writeFileSync(outFile, JSON.stringify(rows, null, 1));
    console.log(`${inst}: ${findings.length} finding(s), ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    console.log(`${inst}: FAILED ${(err as Error).message.split('\n')[0]}`);
  }
}
await registry.disposeAll();
