import { uniqueFingerprints } from '../review/fingerprint';
import { type RunRecord, SEVERITIES, type Severity } from '../types';
import { clipText, safeRepoPath, sortFindings, stripUnsafeChars } from './common';
import { ruleIdOf } from './sarif';

/*
 * GitLab Code Quality report (`artifacts:reports:codequality`): a JSON array of CodeClimate-style issues,
 * shown in the merge request widget and diff. Kept findings only; model text stays plain and clipped.
 */

export type CodeQualitySeverity = 'info' | 'minor' | 'major' | 'critical' | 'blocker';

/** One-to-one: our `critical` (exploitable, data loss, crash on a main path) is GitLab's `critical`. */
export const CODE_QUALITY_SEVERITIES: Record<Severity, CodeQualitySeverity> = {
  critical: 'critical',
  major: 'major',
  minor: 'minor',
  info: 'info',
};

const MAX_DESCRIPTION = 500;

export interface CodeQualityIssue {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: CodeQualitySeverity;
  location: { path: string; lines: { begin: number; end: number } };
}

function line(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

export function codeQualityIssues(run: RunRecord): CodeQualityIssue[] {
  const issues: CodeQualityIssue[] = [];
  for (const f of uniqueFingerprints(sortFindings(run.findings))) {
    const path = safeRepoPath(f.file);
    if (!path) continue;
    const severity = SEVERITIES.includes(f.severity) ? f.severity : 'info';
    const begin = line(f.startLine);
    issues.push({
      description: clipText(stripUnsafeChars(String(f.title)).replace(/\s+/g, ' ').trim(), MAX_DESCRIPTION),
      check_name: ruleIdOf(f),
      fingerprint: f.fingerprint!,
      severity: CODE_QUALITY_SEVERITIES[severity],
      location: { path, lines: { begin, end: Math.max(begin, line(f.endLine)) } },
    });
  }
  return issues;
}

/** GitLab Code Quality JSON of a run's kept findings. */
export function renderCodeQuality(run: RunRecord): string {
  return `${JSON.stringify(codeQualityIssues(run), null, 2)}\n`;
}
