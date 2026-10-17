// Benchmark numbers shown on the site. Source: BENCHMARKS.md (Martian rows judged by Claude Opus 4.5 for every
// reviewer, "Like for like"; audits and AACR-Bench as listed there). Update both together.

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
    label: 'Code Reviewer, full report',
    short: 'Code Reviewer',
    kind: 'ours',
    p: 57.4,
    r: 63.9,
    f1: 60.5,
    perPr: 3.4,
    cost: 0.61,
    note: '0.8.0 with the sweep, the default since 0.9',
  },
  {
    label: 'Code Reviewer 0.7.0, full report',
    short: 'Code Reviewer 0.7.0',
    kind: 'ours',
    p: 64.0,
    r: 54.1,
    f1: 58.7,
    perPr: 2.6,
    cost: 0.4,
  },
  { label: 'Qodo v2 (#4)', short: 'Qodo v2', kind: 'other', p: 51.4, r: 57.0, f1: 54.1, perPr: 3.5 },
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
  label: 'Code Reviewer, posted comments only',
  short: 'Code Reviewer, posted',
  kind: 'ours',
  p: 70.8,
  r: 43.7,
  f1: 54.0,
  perPr: 1.8,
  note: 'the main report, without “worth a look”',
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

/** AACR-Bench ctx30, 30 PRs, two runs each (README, Review depth). */
export const depths = [
  { label: '--essential', findings: 9.5, precision: 63, recall: 2.1, defects: 4.4, cost: 5.1 },
  { label: 'full (default)', findings: 47.5, precision: 46, recall: 7.7, defects: 12.2, cost: 7.6 },
  { label: '--deepen', findings: 150.5, precision: 29, recall: 15.0, defects: 17.4, cost: 17.7 },
];
