import { SubmissionCollector } from '../tools/submission';
import type { ReportedFinding, ReportedVerdict, Severity } from '../types';
import type { AgentResult, AgentTask, Provider } from './types';

const MARKER = /^\s*(\d+) [+ ] .*?(?:\/\/|#|--)\s*BUG(?:\((critical|major|minor|info)\))?:\s*(.+?)\s*$/;

/**
 * Deterministic offline provider for tests and demos.
 * Review: reports a finding for every rendered line carrying a `BUG:` / `BUG(major):` comment.
 * Critique: confirms every finding, except ones whose title contains "false positive".
 */
export class MockProvider implements Provider {
  readonly kind = 'mock' as const;
  constructor(readonly id: string) {}

  async run(task: AgentTask): Promise<AgentResult> {
    const collector = new SubmissionCollector();
    if (task.kind === 'findings') collector.add('findings', { findings: scanFindings(task.prompt) });
    else collector.add('verdicts', { verdicts: judge(task.prompt) });
    return {
      submission: collector.submission,
      text: 'done',
      usage: { inputTokens: Math.ceil(task.prompt.length / 4), outputTokens: 50 },
      model: 'mock',
      stopReason: 'end_turn',
      toolCalls: 1,
      warnings: [],
    };
  }

  async dispose(): Promise<void> {}
}

function scanFindings(prompt: string): ReportedFinding[] {
  const findings: ReportedFinding[] = [];
  const seen = new Set<string>();
  let file: string | undefined;
  for (const line of prompt.split('\n')) {
    const header = /^## File: (\S+)/.exec(line);
    if (header) {
      file = header[1];
      continue;
    }
    // Read-only context owned by another chunk: never report on it.
    if (/^## (Context: |Related files)/.test(line)) {
      file = undefined;
      continue;
    }
    const m = MARKER.exec(line);
    if (!m || !file) continue;
    const lineNo = Number(m[1]);
    const key = `${file}:${lineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      file,
      startLine: lineNo,
      endLine: lineNo,
      severity: (m[2] as Severity | undefined) ?? 'minor',
      category: 'bug',
      title: m[3]!,
      description: `Mock finding: ${m[3]} (marker comment on line ${lineNo}).`,
      confidence: 0.85,
    });
  }
  return findings;
}

function judge(prompt: string): ReportedVerdict[] {
  const verdicts: ReportedVerdict[] = [];
  for (const m of prompt.matchAll(/"id":\s*"([^"]+)",\s*"title":\s*"([^"]*)"/g)) {
    const falsePositive = /false positive/i.test(m[2]!);
    verdicts.push({
      id: m[1]!,
      verdict: falsePositive ? 'rejected' : 'confirmed',
      confidence: falsePositive ? 0.1 : 0.9,
      reason: falsePositive ? 'Mock critic: marked as false positive.' : 'Mock critic: confirmed.',
    });
  }
  return verdicts;
}
