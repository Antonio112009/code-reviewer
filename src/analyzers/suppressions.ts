import type { Category } from '../types';
import { changedLineNumbers } from './lines';
import type { AnalyzerDef, RawHit, SourceFile } from './types';

interface SuppressionMarker {
  id: string;
  regex: RegExp;
  tool: string;
  category: Category;
}

/**
 * Inline suppression markers. A PR that adds one may be hiding exactly the defect a tool would report,
 * so newly added markers become `info` hints. Regexes are anchored on distinctive tokens only.
 */
const MARKERS: SuppressionMarker[] = [
  { id: 'nosemgrep', regex: /\bnosemgrep\b/i, tool: 'Semgrep', category: 'security' },
  { id: 'nosec', regex: /(?:#|\/\/|\/\*)\s*nosec\b/i, tool: 'Bandit/gosec', category: 'security' },
  { id: 'gitleaks-allow', regex: /\bgitleaks:allow\b/i, tool: 'gitleaks', category: 'security' },
  { id: 'secretlint-disable', regex: /\bsecretlint-disable\b/, tool: 'secretlint', category: 'security' },
  {
    id: 'secret-allowlist',
    regex: /\btrufflehog:ignore\b|\bpragma:\s*allowlist\s+secret\b/i,
    tool: 'secret scanners',
    category: 'security',
  },
  { id: 'nosonar', regex: /\bNOSONAR\b/, tool: 'SonarQube', category: 'security' },
  { id: 'codeql', regex: /\b(?:codeql|lgtm)\[[\w/.-]+\]/, tool: 'CodeQL', category: 'security' },
  {
    id: 'iac-skip',
    regex: /\bcheckov:skip=|\btfsec:ignore:|\btrivy:ignore:|\bkics-scan\s+ignore\b/i,
    tool: 'IaC scanners',
    category: 'security',
  },
  { id: 'noqa', regex: /#\s*noqa\b/i, tool: 'ruff/flake8', category: 'bug' },
  {
    id: 'python-type-ignore',
    regex: /#\s*(?:type|pyright|mypy):\s*ignore\b|#\s*pylint:\s*disable\b/,
    tool: 'Python type checkers/pylint',
    category: 'bug',
  },
  {
    id: 'eslint-disable',
    regex: /\beslint-disable(?:-next-line|-line)?\b|\b(?:oxlint|biome|deno-lint)-(?:disable|ignore)\b/,
    tool: 'ESLint/Biome/oxlint',
    category: 'bug',
  },
  {
    id: 'ts-ignore',
    regex: /@ts-(?:ignore|expect-error|nocheck)\b/,
    tool: 'the TypeScript compiler',
    category: 'bug',
  },
  {
    id: 'nolint',
    regex: /\bNOLINT(?:NEXTLINE|BEGIN)?\b|\/\/\s*nolint\b/,
    tool: 'clang-tidy/golangci-lint',
    category: 'bug',
  },
  { id: 'rubocop-disable', regex: /\brubocop:disable\b/, tool: 'RuboCop', category: 'bug' },
  {
    id: 'phpstan-ignore',
    regex: /@(?:phpstan-ignore|psalm-suppress)\b/,
    tool: 'PHPStan/Psalm',
    category: 'bug',
  },
  {
    id: 'suppress-warnings',
    regex: /@SuppressWarnings\s*\(|@Suppress\s*\(|#\s*pragma\s+warning\s+disable\b|#!?\[allow\(/,
    tool: 'the compiler',
    category: 'bug',
  },
  { id: 'shellcheck-disable', regex: /#\s*shellcheck\s+disable=/, tool: 'ShellCheck', category: 'bug' },
  {
    id: 'hadolint-ignore',
    regex: /#\s*hadolint\s+(?:global\s+)?ignore=/,
    tool: 'hadolint',
    category: 'bug',
  },
];

/** Suppression hints for one file's changed lines. */
export function findSuppressions(file: SourceFile): RawHit[] {
  const lines = file.content.split(/\r?\n/);
  const hits: RawHit[] = [];
  for (const lineNo of changedLineNumbers(file, lines.length)) {
    const text = (lines[lineNo - 1] ?? '').slice(0, 2_000);
    for (const marker of MARKERS) {
      const m = marker.regex.exec(text);
      if (!m) continue;
      hits.push({
        ruleId: marker.id,
        file: file.path,
        startLine: lineNo,
        severity: 'info',
        category: marker.category,
        message: `Newly added suppression \`${m[0].trim()}\` silences ${marker.tool} here; check what it hides — the suppressed rule may flag a real defect.`,
        confidence: marker.category === 'security' ? 0.35 : 0.3,
        help: 'Treat suppression comments in untrusted changes as claims to verify, not as evidence.',
      });
    }
  }
  return hits;
}

/** Built-in analyzer reporting inline suppressions added by the change (diff mode only). */
export const suppressionsAnalyzer: AnalyzerDef = {
  id: 'suppressions',
  label: 'Added suppressions',
  tier: 'builtin',
  languages: ['*'],
  description:
    'Newly added nosemgrep / noqa / nosec / eslint-disable / @ts-ignore / gitleaks:allow / NOLINT … comments.',
  select: (files, mode) => (mode === 'diff' ? files : []),
  async run(ctx) {
    const hits: RawHit[] = [];
    for (const file of ctx.files) hits.push(...findSuppressions(file));
    return { hits };
  },
};
