// Benchmark numbers shown on the site. Source: BENCHMARKS.md. Martian rows are judged by Claude Opus 4.5 for every
// reviewer ("Like for like"); Code Reviewer's rows are 0.12.0 on the Anthropic API (2026-10-17), --essential 0.13.0
// (2026-10-18). The breakdown comes from evals/martian/judgings/2026-10-17/breakdown.json and, for --essential,
// evals/martian/judgings/2026-10-18/breakdown.json. Update both together.

export const COLORS = {
  ours: '#2a78d6',
  plain: '#eb6834',
  other: '#a9adb5',
};

export const KIND_LABEL = {
  ours: 'Code Reviewer',
  plain: 'Same model, one call',
  other: 'Other review tools',
};

/** Martian Code Review Bench, 50 PRs, 158 bugs; one judge for every row. P / R / F1 in percent. */
export const martian = [
  {
    label: 'Augment (#3 on the leaderboard)',
    short: 'Augment',
    kind: 'other',
    p: 58.1,
    r: 63.3,
    f1: 60.6,
    perPr: 3.6,
  },
  {
    label: 'Qodo Extended (#1)',
    short: 'Qodo Extended',
    kind: 'other',
    p: 61.4,
    r: 59.5,
    f1: 60.5,
    perPr: 3.0,
  },
  {
    label: 'Code Reviewer 0.12, full report',
    short: 'Code Reviewer',
    kind: 'ours',
    p: 61.4,
    r: 57.0,
    f1: 59.1,
    perPr: 2.9,
    cost: 0.36,
    note: 'defaults, Anthropic API, two runs (58.2 and 60.0)',
  },
  { label: 'Qodo v2 (#4)', short: 'Qodo v2', kind: 'other', p: 51.4, r: 57.0, f1: 54.1, perPr: 3.5 },
  {
    label: 'Code Reviewer 0.12 --deepen',
    short: '--deepen',
    kind: 'ours',
    p: 41.3,
    r: 72.2,
    f1: 52.5,
    perPr: 5.8,
    cost: 0.48,
    note: 'an independent second pass; the most bugs found of any reviewer',
  },
  {
    label: 'Code Reviewer 0.13 --essential',
    short: '--essential',
    kind: 'ours',
    p: 93.8,
    r: 19.0,
    f1: 31.6,
    perPr: 0.5,
    cost: 0.18,
    note: 'a strict filter for a CI gate: the most precise reviewer measured',
  },
  {
    label: 'Claude Sonnet, whole diff in one call',
    short: 'One call',
    kind: 'plain',
    p: 39.0,
    r: 71.5,
    f1: 50.5,
    perPr: 5.9,
    cost: 0.08,
  },
  {
    label: 'Claude Code CLI (#12)',
    short: 'Claude Code CLI',
    kind: 'other',
    p: 41.8,
    r: 41.8,
    f1: 41.8,
    perPr: 3.5,
  },
];

/** The posted part of the report (main report, no "worth a look"). */
export const martianPosted = {
  label: 'Code Reviewer 0.12, posted comments only',
  short: 'Code Reviewer, posted',
  kind: 'ours',
  p: 78.0,
  r: 34.8,
  f1: 48.1,
  perPr: 1.4,
  note: 'the main report, without “worth a look”',
};

/** Recall in percent by bug category and severity, Martian core profile. */
export const breakdown = {
  categories: [
    {
      id: 'bug',
      label: 'Logic bugs',
      of: 94,
    },
    {
      id: 'concurrency',
      label: 'Concurrency',
      of: 14,
    },
    {
      id: 'api',
      label: 'API contracts',
      of: 13,
    },
    {
      id: 'security',
      label: 'Security',
      of: 11,
    },
    {
      id: 'doc_defect',
      label: 'Docs that lie',
      of: 9,
    },
    {
      id: 'data',
      label: 'Data integrity',
      of: 7,
    },
    {
      id: 'perf',
      label: 'Performance',
      of: 6,
    },
    {
      id: 'test_gap',
      label: 'Test gaps',
      of: 4,
    },
  ],
  severities: [
    {
      id: 'Critical',
      of: 12,
    },
    {
      id: 'High',
      of: 54,
    },
    {
      id: 'Medium',
      of: 59,
    },
    {
      id: 'Low',
      of: 33,
    },
  ],
  rows: [
    {
      label: 'Code Reviewer',
      kind: 'ours',
      category: {
        bug: 59,
        concurrency: 79,
        api: 69,
        security: 41,
        doc_defect: 39,
        data: 36,
        perf: 58,
        test_gap: 25,
      },
      severity: {
        Critical: 67,
        High: 69,
        Medium: 58,
        Low: 30,
      },
    },
    {
      label: 'Code Reviewer, deepen',
      kind: 'ours',
      category: {
        bug: 76,
        concurrency: 86,
        api: 69,
        security: 64,
        doc_defect: 56,
        data: 57,
        perf: 67,
        test_gap: 50,
      },
      severity: {
        Critical: 83,
        High: 89,
        Medium: 69,
        Low: 45,
      },
    },
    {
      label: 'Code Reviewer, essential',
      kind: 'ours',
      category: {
        bug: 22,
        concurrency: 7,
        api: 38,
        security: 0,
        doc_defect: 11,
        data: 14,
        perf: 17,
        test_gap: 0,
      },
      severity: {
        Critical: 25,
        High: 28,
        Medium: 19,
        Low: 3,
      },
    },
    {
      label: 'Qodo Extended',
      kind: 'other',
      category: {
        bug: 60,
        concurrency: 79,
        api: 69,
        security: 45,
        doc_defect: 44,
        data: 71,
        perf: 67,
        test_gap: 0,
      },
      severity: {
        Critical: 67,
        High: 69,
        Medium: 61,
        Low: 39,
      },
    },
    {
      label: 'Augment',
      kind: 'other',
      category: {
        bug: 64,
        concurrency: 71,
        api: 85,
        security: 36,
        doc_defect: 56,
        data: 43,
        perf: 67,
        test_gap: 75,
      },
      severity: {
        Critical: 67,
        High: 70,
        Medium: 68,
        Low: 42,
      },
    },
    {
      label: 'Sonnet, one call',
      kind: 'plain',
      category: {
        bug: 76,
        concurrency: 86,
        api: 77,
        security: 73,
        doc_defect: 33,
        data: 79,
        perf: 58,
        test_gap: 0,
      },
      severity: {
        Critical: 83,
        High: 80,
        Medium: 76,
        Low: 45,
      },
    },
  ],
};

/** Blind audits: share of findings an auditor judged real (BENCHMARKS.md, Blind audits). */
export const audit = [
  { label: 'Reviewer alone, before the critic', value: 61, detail: '159 findings, AACR-Bench runs' },
  { label: 'Main report, after the critic', value: 96, detail: '95–97% over two critic runs' },
  { label: '“Worth a look”, after the critic', value: 34, detail: '33–35%; listed in reports, never posted' },
  {
    label: 'Posted findings that matched no known bug',
    value: 100,
    detail: '20 of 20 sampled on Martian were real',
  },
];

/** Depths on Martian's real bugs on the Anthropic API: full and --deepen 0.12.0, --essential 0.13.0 (BENCHMARKS.md). */
export const martianDepths = [
  {
    label: '--essential',
    precision: 93.8,
    recall: 19.0,
    f1: 31.6,
    perPr: 0.5,
    cost: 0.18,
    critical: '3 of 12',
  },
  {
    label: 'full (default)',
    precision: 61.4,
    recall: 57.0,
    f1: 59.1,
    perPr: 2.9,
    cost: 0.36,
    critical: '8 of 12',
  },
  {
    label: '--deepen',
    precision: 41.3,
    recall: 72.2,
    f1: 52.5,
    perPr: 5.8,
    cost: 0.48,
    critical: '10 of 12',
  },
];

/** AACR-Bench ctx30, 30 PRs, two runs each (README, Review depth). */
export const depths = [
  { label: '--essential', findings: 9.5, precision: 63, recall: 2.1, defects: 4.4, cost: 5.1 },
  { label: 'full (default)', findings: 47.5, precision: 46, recall: 7.7, defects: 12.2, cost: 7.6 },
  { label: '--deepen', findings: 150.5, precision: 29, recall: 15.0, defects: 17.4, cost: 17.7 },
];
