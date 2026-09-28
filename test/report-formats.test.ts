import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { codeQualityIssues, renderCodeQuality } from '../src/report/codequality';
import { REPORT_FILE_NAMES, renderReport, writeReports } from '../src/report/index';
import { renderSarif, SARIF_FINGERPRINT_KEY } from '../src/report/sarif';
import type { Finding, RunRecord } from '../src/types';
import { packageVersion } from '../src/util/paths';

function finding(over: Partial<Finding>): Finding {
  return {
    id: 'f',
    file: 'src/db/users.ts',
    startLine: 42,
    endLine: 45,
    severity: 'major',
    category: 'bug',
    title: 'Some defect',
    description: 'A concrete failure scenario.',
    confidence: 0.9,
    skills: [],
    source: { chunkIds: ['c001'], provider: 'claude', model: 'sonnet' },
    ...over,
  };
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1,
    id: '20260927-100000-abcd',
    command: 'review',
    status: 'partial',
    createdAt: '2026-09-27T10:00:00.000Z',
    durationMs: 60_000,
    repo: { root: '/repo', remote: 'https://github.com/acme/shop', platform: 'github' },
    target: {
      kind: 'diff',
      base: 'origin/main',
      head: 'HEAD (feature/login)',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      mergeBase: 'c'.repeat(40),
    },
    options: {
      depth: 'essential',
      selfCritique: true,
      minConfidence: 0.7,
      skills: 'auto',
      tools: true,
      authors: false,
      maxChunkTokens: 40_000,
      concurrency: 3,
    },
    routing: { review: { provider: 'claude', model: 'sonnet', reasoning: 'medium' } },
    chunks: [
      { id: 'c001', files: ['src/db/users.ts'], tokens: 1000, skills: [], status: 'done', findings: 3 },
      { id: 'c002', files: ['src/web/page.tsx'], tokens: 1000, skills: [], status: 'failed', findings: 0 },
    ],
    findings: [
      finding({
        id: 'f1',
        severity: 'critical',
        category: 'security',
        title: 'SQL built from request body',
        description: 'The `name` field is concatenated.\r\nAn attacker can inject SQL.',
        suggestion: 'Use a parameterised query.',
        fingerprint: '1'.repeat(32),
        critique: { verdict: 'confirmed', confidence: 0.95, reason: 'Reachable.', originalConfidence: 0.9 },
      }),
      finding({
        id: 'f2',
        file: 'config/.env.production',
        startLine: 3,
        endLine: 3,
        severity: 'major',
        category: 'security',
        title: 'AWS access key committed',
        origin: 'static',
        tool: { analyzer: 'secretlint', ruleId: 'aws-access-key' },
        fingerprint: '2'.repeat(32),
      }),
      finding({ id: 'f3', severity: 'minor', title: 'Off by one', fingerprint: '3'.repeat(32) }),
      finding({
        id: 'f4',
        severity: 'info',
        category: 'performance',
        title: 'N+1 query',
        startLine: 9,
        endLine: 2,
      }),
    ],
    rejected: [
      finding({ id: 'r1', title: 'REJECTED ONE', droppedReason: 'critique', fingerprint: '9'.repeat(32) }),
    ],
    usage: { inputTokens: 1, outputTokens: 1 },
    warnings: [],
    ...over,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: SARIF is checked structurally
type Json = any;

describe('SARIF report', () => {
  const sarif: Json = JSON.parse(renderSarif(makeRun()));
  const run = sarif.runs[0];

  it('is SARIF 2.1.0 with tool metadata and provenance', () => {
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-2.1.0');
    expect(run.tool.driver).toMatchObject({
      name: 'code-reviewer',
      version: packageVersion(),
      informationUri: 'https://github.com/antonio112009/code-reviewer',
    });
    expect(run.versionControlProvenance).toEqual([
      {
        repositoryUri: 'https://github.com/acme/shop',
        revisionId: 'b'.repeat(40),
        mappedTo: { uriBaseId: 'SRCROOT' },
      },
    ]);
    expect(run.originalUriBaseIds.SRCROOT).toBeDefined();
  });

  it('exports kept findings only, with levels, locations and fingerprints', () => {
    expect(run.results).toHaveLength(4);
    expect(JSON.stringify(sarif)).not.toContain('REJECTED ONE');
    expect(run.results.map((r: Json) => r.level)).toEqual(['error', 'error', 'warning', 'note']);
    const [first, second, , fourth] = run.results;
    expect(first.ruleId).toBe('code-reviewer/security/critical');
    expect(first.message.text).toBe(
      'SQL built from request body\n\nThe `name` field is concatenated.\nAn attacker can inject SQL.\n\nSuggestion: Use a parameterised query.',
    );
    expect(first.locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: 'src/db/users.ts', uriBaseId: 'SRCROOT' },
      region: { startLine: 42, endLine: 45 },
    });
    expect(first.partialFingerprints).toEqual({ [SARIF_FINGERPRINT_KEY]: '1'.repeat(32) });
    expect(first.properties).toMatchObject({
      severity: 'critical',
      confidence: 0.9,
      category: 'security',
      origin: 'llm',
      critique: 'confirmed',
    });
    expect(second.ruleId).toBe('secretlint/aws-access-key');
    expect(second.properties.origin).toBe('static');
    // an inverted range is repaired; a finding without a fingerprint gets the fallback
    expect(fourth.locations[0].physicalLocation.region).toEqual({ startLine: 9, endLine: 9 });
    expect(fourth.partialFingerprints[SARIF_FINGERPRINT_KEY]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('declares one rule per category / static rule, ranked for GitHub security alerts', () => {
    const rules = run.tool.driver.rules;
    expect(rules.map((r: Json) => r.id)).toEqual([
      'code-reviewer/security/critical',
      'secretlint/aws-access-key',
      'code-reviewer/bug',
      'code-reviewer/performance',
    ]);
    for (const [i, r] of run.results.entries()) expect(rules[r.ruleIndex].id, `result ${i}`).toBe(r.ruleId);
    expect(rules[0].properties).toMatchObject({ tags: ['security', 'llm'], 'security-severity': '9.5' });
    expect(rules[1].properties).toMatchObject({
      tags: ['security', 'static-analysis'],
      'security-severity': '8.0',
    });
    expect(rules[2].properties['security-severity']).toBeUndefined();
    expect(rules[2].defaultConfiguration.level).toBe('warning');
    expect(rules[0].helpUri).toBe('https://github.com/antonio112009/code-reviewer');
  });

  it('reports failed chunks as tool execution notifications', () => {
    const inv = run.invocations[0];
    expect(inv.executionSuccessful).toBe(false);
    expect(inv.toolExecutionNotifications).toEqual([
      {
        level: 'error',
        message: { text: 'Chunk c002 failed: part of the change was not reviewed (src/web/page.tsx).' },
      },
    ]);
    expect(inv.endTimeUtc).toBe('2026-09-27T10:01:00.000Z');
  });

  it('keeps untrusted text plain, clipped and free of control characters', () => {
    const out: Json = JSON.parse(
      renderSarif(
        makeRun({
          repo: { root: '/r', remote: 'https://user:ghp_secret@github.com/acme/shop' },
          findings: [
            finding({
              title: 'Bad \u001B[31mred\u001B[0m ‮bidi [click](https://evil.example)',
              description: `<img src=x onerror=alert(1)> ${'x'.repeat(10_000)}`,
              file: 'src/a b#.ts',
            }),
            finding({ id: 'evil', file: '../../etc/passwd' }),
            finding({ id: 'abs', file: '/etc/passwd' }),
            finding({ id: 'tool', origin: 'static', tool: { analyzer: 'x"><script>', ruleId: 'r\n1' } }),
          ],
        }),
      ),
    );
    const results = out.runs[0].results;
    expect(results).toHaveLength(2); // path traversal / absolute paths are dropped
    expect(results[0].message.text).not.toMatch(/[\u001B‮]/);
    // plain text, not HTML; brackets escaped so no SARIF embedded link can form
    expect(
      results[0].message.text.startsWith('Bad red bidi \\[click\\](https://evil.example)\n\n<img src=x'),
    ).toBe(true);
    expect(results[0].message.text.length).toBeLessThan(4_300);
    expect(results[0].message.text).toContain('…');
    expect(results[0].locations[0].physicalLocation.artifactLocation.uri).toBe('src/a%20b%23.ts');
    expect(results[1].ruleId).toBe('x-script-/r-1');
    expect(out.runs[0].versionControlProvenance).toBeUndefined(); // never a remote with credentials
  });
});

describe('GitLab Code Quality report', () => {
  it('lists kept findings with severity, check name, fingerprint and lines', () => {
    const issues = codeQualityIssues(makeRun());
    expect(issues).toHaveLength(4);
    expect(issues[0]).toEqual({
      description: 'SQL built from request body',
      check_name: 'code-reviewer/security/critical',
      fingerprint: '1'.repeat(32),
      severity: 'critical',
      location: { path: 'src/db/users.ts', lines: { begin: 42, end: 45 } },
    });
    expect(issues.map((i) => i.severity)).toEqual(['critical', 'major', 'minor', 'info']);
    expect(issues[1]!.check_name).toBe('secretlint/aws-access-key');
    expect(new Set(issues.map((i) => i.fingerprint)).size).toBe(4);
    expect(JSON.stringify(issues)).not.toContain('REJECTED ONE');
  });

  it('keeps fingerprints unique and text plain', () => {
    const run = makeRun({
      findings: [
        finding({ id: 'a', title: 'one\n\u001B]8;;http://x\u0007two', fingerprint: 'f'.repeat(32) }),
        finding({ id: 'b', title: 'three', fingerprint: 'f'.repeat(32) }),
      ],
    });
    const issues = JSON.parse(renderCodeQuality(run));
    expect(issues[0].description).toBe('one two');
    expect(issues[0].fingerprint).not.toBe(issues[1].fingerprint);
  });
});

describe('report files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cr-reports-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes one file per format with per-format names', async () => {
    const files = await writeReports(makeRun(), ['md', 'sarif', 'codequality', 'json', 'html'], dir);
    expect(files.map((f) => path.basename(f))).toEqual([
      'report.md',
      'report.sarif',
      'report.codequality.json',
      'report.json',
      'report.html',
    ]);
    expect(readdirSync(dir).sort()).toEqual(Object.values(REPORT_FILE_NAMES).sort());
    expect(JSON.parse(renderReport(makeRun(), 'sarif')).version).toBe('2.1.0');
    expect(Array.isArray(JSON.parse(renderReport(makeRun(), 'codequality')))).toBe(true);
  });
});
