// Re-runs only the self-critique on the findings of a finished Martian run, several times: independent votes of the
// same critic on the same findings, to test whether their agreement tells real bugs from noise better than one
// critic's confidence. Through the Anthropic API (`ANTHROPIC_API_KEY`), the critic of the API runs:
// claude-sonnet-5-5 at high reasoning.
//
//   npx tsx evals/martian/recritique.mts <run-id> <out.json> [--votes 2] [--below 0.75] [--max-cost 12] [--shard 1/3]
//
// Every finding the critic saw in the run (kept, "worth a look", rejected by critique) is restored to the
// reviewer's confidence, severity and title and verified again, `--votes` times, without a second opinion. Kept
// findings at a critic confidence of `--below` or more are left out: they are posted under any gate. Each PR is
// checked out in a detached worktree at its head, like runner.py. Finished PRs in <out.json> are skipped, so an
// interrupted run continues; `--max-cost` (USD) stops before the next PR once the spend reaches it. `--shard k/n`
// takes every n-th PR (k = 1..n) to run several processes side by side, each with its own <out.json>.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/schema';
import { costOf } from '../../src/models/pricing';
import { ProviderRegistry } from '../../src/providers/registry';
import { critiqueFindings } from '../../src/review/critique';
import type { Finding, RunRecord } from '../../src/types';
import { silentLogger } from '../../src/util/logger';

const args = process.argv.slice(2);
const [runId, outFile] = args;
if (!runId || !outFile) {
  console.error('usage: recritique.mts <run-id> <out.json> [--votes 2] [--below 0.75] [--max-cost 12]');
  process.exit(2);
}
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const votes = opt('--votes', 2);
const below = opt('--below', 0.75);
const maxCost = opt('--max-cost', 12);
const shardArg = args.includes('--shard')
  ? args[args.indexOf('--shard') + 1]!.split('/').map(Number)
  : [1, 1];
const [shard, shards] = shardArg as [number, number];
const martian = process.env.MARTIAN_DIR ?? path.join(homedir(), '.cache', 'code-reviewer-martian');
const runDir = path.join(martian, 'results', runId);
const MODEL = 'claude-sonnet-5-5';

interface Row {
  pr: string;
  id: string;
  vote: number;
  verdict?: string;
  confidence?: number;
  severity: string;
  reason?: string;
}
interface Out {
  run: string;
  votes: number;
  below: number;
  model: string;
  cost: number;
  done: string[];
  rows: Row[];
}

const out: Out = existsSync(outFile)
  ? JSON.parse(readFileSync(outFile, 'utf8'))
  : { run: runId, votes, below, model: MODEL, cost: 0, done: [], rows: [] };

/** New-version lines each file of `base..head` added or modified, marked for the critic as in a review. */
function changedLines(repo: string, base: string, head: string): Map<string, Set<number>> {
  const diff = execFileSync('git', ['-C', repo, 'diff', '-U0', '--no-color', '--no-ext-diff', base, head], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const lines = new Map<string, Set<number>>();
  let file = '';
  let line = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.startsWith('+++ b/') ? l.slice(6) : '';
      if (file && !lines.has(file)) lines.set(file, new Set());
    } else if (l.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
    } else if (l.startsWith('+') && file) {
      lines.get(file)!.add(line++);
    }
  }
  return lines;
}

const repoOf = new Map<string, string>(
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'prs.json'), 'utf8')).map(
    (p: { id: string; repo: string }) => [p.id, p.repo],
  ),
);
const registry = new ProviderRegistry(structuredClone(DEFAULT_CONFIG), silentLogger);
const provider = registry.get('anthropic');
const prs = readdirSync(runDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('eval') && f !== 'provenance.json')
  .sort()
  .filter((_, i) => i % shards === shard - 1);

for (const file of prs) {
  const result = JSON.parse(readFileSync(path.join(runDir, file), 'utf8'));
  const pr: string = result.id;
  if (out.done.includes(pr)) continue;
  if (out.cost >= maxCost) {
    console.log(`stopping: $${out.cost.toFixed(2)} spent, the limit is $${maxCost}`);
    break;
  }
  const run = result.report as RunRecord | undefined;
  if (!run) continue;
  const seen = [
    ...run.findings.filter((f) => (f.critique?.confidence ?? f.confidence) < below),
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
  if (findings.length === 0) {
    out.done.push(pr);
    continue;
  }
  const repo = path.join(martian, 'repos', repoOf.get(pr) ?? '');
  const work = path.join(martian, 'work', `recritique-${runId}`, pr);
  rmSync(work, { recursive: true, force: true });
  execFileSync('git', ['-C', repo, 'worktree', 'prune']);
  mkdirSync(path.dirname(work), { recursive: true });
  execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', '-q', work, result.head]);
  try {
    const marks = changedLines(work, result.mergeBase ?? result.base, result.head);
    for (let vote = 1; vote <= votes; vote++) {
      const started = Date.now();
      const outcome = await critiqueFindings(structuredClone(findings), {
        provider,
        model: MODEL,
        reasoning: 'high',
        mode: 'diff',
        depth: 'full',
        root: work,
        git: true,
        readTools: true,
        maxSteps: DEFAULT_CONFIG.review.maxSteps,
        timeoutMs: 15 * 60_000,
        concurrency: 3,
        batchTokenBudget: 20_000,
        changedLines: marks,
      });
      for (const s of outcome.spend) out.cost += costOf(s, DEFAULT_CONFIG.pricing ?? {})?.amount ?? 0;
      for (const f of [...outcome.kept, ...outcome.rejected]) {
        out.rows.push({
          pr,
          id: f.id,
          vote,
          verdict: f.critique?.verdict,
          confidence: f.critique?.confidence,
          severity: f.severity,
          reason: f.critique?.reason?.slice(0, 400),
        });
      }
      console.log(
        `${pr} vote ${vote}: ${findings.length} finding(s), ${Math.round((Date.now() - started) / 1000)}s, total $${out.cost.toFixed(2)}`,
      );
    }
    out.done.push(pr);
    writeFileSync(outFile, JSON.stringify(out, null, 1));
  } catch (err) {
    console.log(`${pr}: FAILED ${(err as Error).message.split('\n')[0]}`);
  } finally {
    execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', work]);
  }
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
await registry.disposeAll();
console.log(`done: ${out.done.length} PR(s), $${out.cost.toFixed(2)}`);
