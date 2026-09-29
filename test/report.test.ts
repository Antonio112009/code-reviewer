import { describe, expect, it } from 'vitest';
import {
  analyzersSummary,
  formatDuration,
  formatTokens,
  rejectedByReason,
  SEVERITY_ORDER,
  severityCounts,
  skillUsage,
  sortFindings,
  stackSummary,
  summaryLine,
  toolUsage,
} from '../src/report/common';
import { renderHtml } from '../src/report/html';
import { renderReport } from '../src/report/index';
import { mdText, renderMarkdown } from '../src/report/markdown';
import type { AnalyzerRun, Finding, RunRecord } from '../src/types';

const analyzers: AnalyzerRun[] = [
  {
    id: 'secretlint',
    label: 'secretlint',
    tier: 'builtin',
    status: 'ok',
    hits: 2,
    durationMs: 300,
    version: '13.0.6',
  },
  { id: 'patterns', label: 'patterns', tier: 'builtin', status: 'ok', hits: 5, durationMs: 20 },
  {
    id: 'shellcheck',
    label: 'shellcheck',
    tier: 'external',
    status: 'skipped',
    hits: 0,
    durationMs: 0,
    reason: 'not installed',
  },
];

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
    skills: ['sql'],
    source: { chunkIds: ['c001'], provider: 'claude', model: 'sonnet' },
    ...over,
  };
}

function makeRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1,
    id: '2026-09-27-abc123',
    command: 'review',
    status: 'completed',
    createdAt: '2026-09-27T10:00:00.000Z',
    durationMs: 245_000,
    repo: { root: '/repo' },
    target: {
      kind: 'diff',
      base: 'origin/develop',
      head: 'feature/login',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      mergeBase: 'c'.repeat(40),
    },
    options: {
      selfCritique: true,
      minConfidence: 0.7,
      skills: 'auto',
      tools: true,
      authors: false,
      maxChunkTokens: 40_000,
      concurrency: 3,
    },
    routing: {
      review: { provider: 'claude', model: 'sonnet', reasoning: 'medium' },
      critique: { provider: 'claude', model: 'opus', reasoning: 'high' },
    },
    fallbacks: [{ role: 'review', from: 'claude:opus', to: 'claude:sonnet', reason: 'model unavailable' }],
    refs: {
      explanation: ['base origin/develop from GITHUB_BASE_REF'],
      baseSource: 'ci',
      remote: 'origin',
      fetched: true,
      notes: ['2 local commits are not pushed'],
    },
    stack: [
      { id: 'lang.typescript', name: 'TypeScript', category: 'language', score: 1 },
      { id: 'framework.nextjs', name: 'Next.js', category: 'framework', score: 0.95 },
      { id: 'db.postgresql', name: 'PostgreSQL', category: 'database', score: 0.85 },
      { id: 'orm.prisma', name: 'Prisma', category: 'orm', score: 0.8 },
      { id: 'tool.weak', name: 'Weak', category: 'tool', score: 0.2 },
    ],
    analyzers,
    skillsUsed: ['sql', 'react', 'unused-skill'],
    toolUsage: { read_file: 14, grep: 6, find_symbol: 2 },
    chunks: [
      {
        id: 'c001',
        files: ['src/db/users.ts', 'src/db/pool.ts'],
        contextFiles: ['src/api/users.ts'],
        tokens: 12_000,
        skills: ['sql'],
        status: 'done',
        findings: 2,
        hints: 2,
        durationMs: 38_000,
        timeoutMs: 240_000,
        toolCalls: { read_file: 10, grep: 6 },
        provider: 'claude',
        model: 'sonnet',
      },
      {
        id: 'c002',
        files: ['src/web/page.tsx'],
        tokens: 8_000,
        skills: ['react', 'sql'],
        status: 'failed',
        error: 'timeout after 180s | retry\nstack',
        findings: 0,
        timeoutMs: 180_000,
      },
    ],
    findings: [
      finding({
        id: 'f1',
        severity: 'critical',
        title: 'SQL built from request body',
        description: 'The `name` field is concatenated. An attacker can inject SQL.',
        evidence: "db.query('SELECT * FROM users WHERE name = ' + name)",
        suggestion: 'Use a parameterised query.',
        confidence: 0.95,
        critique: {
          verdict: 'confirmed',
          confidence: 0.95,
          reason: 'Reachable from POST /users.',
          originalConfidence: 0.9,
        },
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
      }),
      finding({ id: 'f3', severity: 'info', title: 'Risky pattern', confidence: 0.75 }),
    ],
    rejected: [
      finding({
        id: 'r1',
        droppedReason: 'critique',
        critique: { verdict: 'rejected', confidence: 0.1, reason: 'Guarded above', originalConfidence: 0.8 },
      }),
      finding({ id: 'r2', droppedReason: 'below-threshold', confidence: 0.5 }),
      finding({ id: 'r3', droppedReason: 'unknown-file' }),
    ],
    usage: { inputTokens: 120_345, cachedInputTokens: 80_000, outputTokens: 12_345 },
    warnings: ['c002 failed: timeout after 180s'],
    ...over,
  };
}

describe('report/common', () => {
  it('keeps the severity helpers the pipeline relies on', () => {
    expect(SEVERITY_ORDER).toEqual({ critical: 0, major: 1, minor: 2, info: 3 });
    const run = makeRun();
    expect(sortFindings(run.findings).map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(severityCounts(run.findings)).toEqual({ critical: 1, major: 1, minor: 0, info: 1 });
    expect(summaryLine(run)).toBe(
      '3 findings: 1 critical, 1 major, 1 info · 1 rejected by self-critique · 1 below confidence threshold 0.7 · 1 dropped by validation',
    );
    expect(summaryLine(makeRun({ findings: [], rejected: [] }))).toBe('No findings');
  });

  it('formats durations and token counts', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(420)).toBe('420ms');
    expect(formatDuration(3_250)).toBe('3.2s');
    expect(formatDuration(38_000)).toBe('38s');
    expect(formatDuration(62_000)).toBe('1m 02s');
    expect(formatDuration(3_900_000)).toBe('1h 05m');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(4_800)).toBe('4.8k');
    expect(formatTokens(48_210)).toBe('48k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });

  it('summarises stack, analyzers, skills, tools and rejections', () => {
    const run = makeRun();
    expect(stackSummary(run.stack)).toBe('Next.js · PostgreSQL · Prisma');
    expect(stackSummary([{ id: 'lang.go', name: 'Go', category: 'language', score: 1 }])).toBe('Go');
    expect(analyzersSummary(analyzers)).toBe('secretlint ✓ 2 hints · patterns ✓ 5 hints · shellcheck –');
    expect(skillUsage(run)).toEqual([
      { id: 'sql', chunks: 2, findings: 0 },
      { id: 'react', chunks: 1, findings: 0 },
      { id: 'unused-skill', chunks: 0, findings: 0 },
    ]);
    expect(toolUsage(run)).toEqual([
      { tool: 'read_file', calls: 14 },
      { tool: 'grep', calls: 6 },
      { tool: 'find_symbol', calls: 2 },
    ]);
    expect(toolUsage(makeRun({ toolUsage: undefined }))).toEqual([
      { tool: 'read_file', calls: 10 },
      { tool: 'grep', calls: 6 },
    ]);
    expect(rejectedByReason(run).map((r) => r.label)).toEqual([
      'below confidence 0.7',
      'rejected by critique',
      'unknown file',
    ]);
  });
});

describe('markdown report', () => {
  it('keeps the finding heading format and adds the new sections', () => {
    const md = renderMarkdown(makeRun());
    expect(md).toContain('### 1. [CRITICAL] SQL built from request body');
    expect(md).toContain('### 2. [MAJOR] AWS access key committed');
    expect(md).toContain('### 3. [INFO] Risky pattern');
    expect(md).toContain('static: `secretlint/aws-access-key`');
    expect(md).toContain('> **Critic:** Reachable from POST /users.');
    expect(md).toContain('## Refs');
    expect(md).toContain('- **Base:** `origin/develop` at `aaaaaaaaaaaa`');
    expect(md).toContain('  - base origin/develop from GITHUB_BASE_REF');
    expect(md).toContain('- ⚠️ 2 local commits are not pushed');
    expect(md).toContain('## Detected stack');
    expect(md).toContain('| Next.js | framework | 0.95 |');
    expect(md).not.toContain('| Weak |');
    expect(md).toContain('## Static analysis');
    expect(md).toContain('| secretlint | builtin | ok | 2 | 300ms | v13.0.6 |');
    expect(md).toContain('| shellcheck | external | skipped | 0 | 0ms | not installed |');
    expect(md).toContain('## Skills used');
    expect(md).toContain('`sql` ×2 · `react` ×1 · `unused-skill` ×0');
    expect(md).toContain('## Tool usage');
    expect(md).toContain('22 calls: `read_file` ×14 · `grep` ×6 · `find_symbol` ×2');
    expect(md).toContain('## Model fallbacks');
    expect(md).toContain('- review: claude:opus → claude:sonnet (model unavailable)');
    expect(md).toContain(
      '| Chunk | Files | Context files | Tokens | Skills | Hints | Tool calls | Model | Timeout | Duration | Status | Findings |',
    );
    expect(md).toContain(
      '| c001 | src/db/users.ts, src/db/pool.ts | src/api/users.ts | 12,000 | sql | 2 | read_file×10, grep×6 | claude:sonnet | 4m 00s | 38s | done | 2 |',
    );
    // pipes inside a cell are escaped so the table stays intact
    expect(md).toContain('failed: timeout after 180s \\| retry');
    expect(md).toContain('## Rejected findings (3)');
    expect(md).toContain('1 below confidence 0.7 · 1 rejected by critique · 1 unknown file');
  });

  it('escapes untrusted text', () => {
    const md = renderMarkdown(
      makeRun({
        findings: [
          finding({
            title: '<img src=x onerror=alert(1)> in [link](http://evil)',
            description: 'Loads ![pixel](http://evil/p.png) and <script>x</script>; keep `a<b` as code.',
            evidence: 'const s = ```; // fence breaker\n````',
            author: { name: 'Eve <script>', commit: 'e'.repeat(40), lineUrl: 'javascript:alert(1)' },
          }),
        ],
        warnings: ['<b>bold</b>\u001B[31m'],
      }),
    );
    expect(md).not.toContain('<img');
    expect(md).not.toContain('<script>');
    expect(md).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(md).toContain('!\\[pixel](http://evil/p.png)');
    expect(md).toContain('\\`a&lt;b\\`'); // code spans are escaped too (no CommonMark look-alike)
    expect(md).toContain('`````\nconst s = ```; // fence breaker\n````\n`````');
    expect(md).not.toContain('javascript:');
    expect(md).not.toContain('\u001B');
    expect(md).toContain('- &lt;b&gt;bold&lt;/b&gt;\n');
  });

  it('mdText escapes markup, backticks, images and fences in untrusted text', () => {
    expect(mdText('a <b> `c <d>` e')).toBe('a &lt;b&gt; \\`c &lt;d&gt;\\` e');
    expect(mdText('x &amp; y & z')).toBe('x &amp;amp; y & z');
    // a code-span look-alike cannot smuggle raw HTML, and an unclosed fence cannot swallow the report
    expect(mdText('```<img src=https://evil/p.png>`')).not.toContain('<img');
    expect(mdText('Example:\n```\nfoo(\n~~~')).toBe('Example:\n\\`\\`\\`\nfoo(\n\\~~~');
  });

  it('is reachable through renderReport', () => {
    expect(renderReport(makeRun(), 'md')).toContain('## Chunks');
    expect(JSON.parse(renderReport(makeRun(), 'json')).id).toBe('2026-09-27-abc123');
  });
});

describe('html report', () => {
  it('has severity filters for the four levels, a static badge and the new sections', () => {
    const html = renderHtml(makeRun());
    expect(html).toContain("const SEV = ['critical','major','minor','info'];");
    for (const s of ['critical', 'major', 'minor', 'info']) expect(html).toContain(`--${s}:`);
    expect(html).toContain("el('span', { class: 'badge static'");
    expect(html).toContain('<h2>Refs</h2>');
    expect(html).toContain('<li>base origin/develop from GITHUB_BASE_REF</li>');
    expect(html).toContain('<ul class="notes"><li>2 local commits are not pushed</li></ul>');
    expect(html).toContain('<h2>Detected stack</h2>');
    expect(html).toContain('<li>Next.js<small>framework · 0.95</small></li>');
    expect(html).toContain('<h2>Static analysis</h2>');
    expect(html).toContain('<td>secretlint</td>');
    expect(html).toContain('<h2>Skills used</h2>');
    expect(html).toContain('<li>sql<small>×2</small></li>');
    expect(html).toContain('<h2>Tool usage</h2>');
    expect(html).toContain('<li>read_file<small>×14</small></li>');
    expect(html).toContain('<h2>Model fallbacks</h2>');
    expect(html).toContain(
      '<th>Context files</th><th>Tokens</th><th>Skills</th><th>Hints</th><th>Tool calls</th><th>Model</th><th>Timeout</th>',
    );
    expect(html).toContain('<td>read_file×10, grep×6</td><td>claude:sonnet</td><td class="num">4m 00s</td>');
    expect(html).toContain('<span class="count" style="--sev: var(--critical)"><b>1</b> critical</span>');
    expect(html).toContain("default-src 'none'");
  });

  it('escapes untrusted text and keeps embedded JSON inert', () => {
    const html = renderHtml(
      makeRun({
        findings: [finding({ title: '</script><script>alert(1)</script>', file: 'a"<b>.ts' })],
        warnings: ['<b>x</b>'],
        chunks: [
          {
            id: 'c1',
            files: ['<img src=x>.ts'],
            tokens: 1,
            skills: ['<i>'],
            status: 'failed',
            error: '<svg onload=alert(1)>',
            findings: 0,
          },
        ],
        refs: {
          explanation: ['<b>why</b>'],
          baseSource: 'flag',
          fetched: false,
          notes: ['<script>n</script>'],
        },
      }),
    );
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<svg onload');
    expect(html).not.toContain('<script>n</script>');
    expect(html).toContain('&lt;b&gt;why&lt;/b&gt;');
  });

  it('renders without optional sections', () => {
    const html = renderHtml(
      makeRun({
        refs: undefined,
        stack: undefined,
        analyzers: undefined,
        fallbacks: undefined,
        skillsUsed: undefined,
        toolUsage: undefined,
        chunks: [],
        warnings: [],
        target: { kind: 'files', paths: [] },
      }),
    );
    expect(html).not.toContain('<h2>Refs</h2>');
    expect(html).not.toContain('<h2>Detected stack</h2>');
    expect(html).not.toContain('<h2>Static analysis</h2>');
    expect(html).not.toContain('<h2>Model fallbacks</h2>');
    const md = renderMarkdown(
      makeRun({ refs: undefined, target: { kind: 'files', paths: ['src'] }, stack: [] }),
    );
    expect(md).not.toContain('## Refs');
    expect(md).not.toContain('## Detected stack');
    expect(md).toContain('# Code review — files src');
  });
});
