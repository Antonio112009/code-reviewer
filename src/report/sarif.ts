import { uniqueFingerprints } from '../review/fingerprint';
import { CATEGORIES, type Category, type Finding, type RunRecord, SEVERITIES, type Severity } from '../types';
import { packageVersion } from '../util/paths';
import {
  clipText,
  SEVERITY_ORDER,
  safeRepoPath,
  sortFindings,
  stripUnsafeChars,
  TOOL_INFO_URI,
} from './common';

/*
 * SARIF 2.1.0 for GitHub code scanning (github/codeql-action/upload-sarif) and other SARIF consumers.
 * Only kept findings are exported, never rejected ones. Model and repository text stays plain text (SARIF
 * `message.text` is not rendered as Markdown), stripped of control characters and clipped.
 */

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
/** `partialFingerprints` key of our stable fingerprint (`review/fingerprint.ts`). */
export const SARIF_FINGERPRINT_KEY = 'codeReviewer/v1';
/** The repository root: every result path is relative to it. */
const SRCROOT = 'SRCROOT';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4_000;
const MAX_SUGGESTION = 2_000;

export type SarifLevel = 'error' | 'warning' | 'note';

export const SARIF_LEVELS: Record<Severity, SarifLevel> = {
  critical: 'error',
  major: 'error',
  minor: 'warning',
  info: 'note',
};

/** GitHub ranks `security` alerts by the rule's `security-severity` (≥9 critical, ≥7 high, ≥4 medium, else low). */
const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: '9.5',
  major: '8.0',
  minor: '5.5',
  info: '2.0',
};

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  bug: 'Logic error: wrong results, crashes or broken behaviour.',
  security: 'Security vulnerability: injection, broken access control, leaked secrets, unsafe crypto.',
  concurrency: 'Race condition, deadlock or unsafe shared state.',
  'error-handling': 'Errors that are swallowed, mis-reported or left unhandled.',
  performance: 'Costly or unbounded work: N+1 queries, quadratic loops, missing limits.',
  'resource-leak': 'Memory, handles, connections or timers that are never released.',
  'api-misuse': 'An API used against its contract.',
  'data-loss': 'Data lost or corrupted: missing transactions, wrong writes, destructive migrations.',
};

function severityOf(f: Finding): Severity {
  return SEVERITIES.includes(f.severity) ? f.severity : 'info';
}

function categoryOf(f: Finding): Category {
  return CATEGORIES.includes(f.category) ? f.category : 'bug';
}

/** Rule id charset: a run.json from the checkout may carry anything in `tool`. */
function ruleSegment(s: unknown): string {
  return clipText(String(s).replace(/[^\w.@/-]+/g, '-'), 100) || 'unknown';
}

/**
 * Rule of a finding: `analyzer/ruleId` for static findings, else `code-reviewer/<category>`. Security
 * findings get one rule per severity (`code-reviewer/security/critical`), because GitHub ranks security
 * alerts by their rule's `security-severity`.
 */
export function ruleIdOf(f: Finding): string {
  if (f.origin === 'static' && f.tool) return `${ruleSegment(f.tool.analyzer)}/${ruleSegment(f.tool.ruleId)}`;
  const category = categoryOf(f);
  return category === 'security' ? `code-reviewer/security/${severityOf(f)}` : `code-reviewer/${category}`;
}

/**
 * Untrusted text as SARIF plain text: control characters removed, newlines normalised, clipped, and square
 * brackets escaped — SARIF messages treat `[text](uri)` as an embedded link (§3.11.6) and viewers such as
 * GitHub render it, so model text must not be able to form one.
 */
function plain(s: unknown, max: number): string {
  return clipText(
    stripUnsafeChars(String(s ?? ''))
      .replace(/\r\n?/g, '\n')
      .trim(),
    max,
  ).replace(/[[\]]/g, '\\$&');
}

function pascal(id: string): string {
  return id
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
}

function line(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

export function findingMessage(f: Finding): string {
  const parts = [plain(f.title, MAX_TITLE), plain(f.description, MAX_DESCRIPTION)];
  if (f.suggestion?.trim()) parts.push(`Suggestion: ${plain(f.suggestion, MAX_SUGGESTION)}`);
  return parts.filter(Boolean).join('\n\n');
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
  defaultConfiguration: { level: SarifLevel };
  properties: Record<string, unknown>;
}

function newRule(f: Finding, id: string): SarifRule {
  const category = categoryOf(f);
  const isStatic = f.origin === 'static' && f.tool;
  const short = isStatic
    ? `${plain(f.tool!.analyzer, 100)} rule ${plain(f.tool!.ruleId, 100)}`
    : category === 'security'
      ? `Security (${severityOf(f)})`
      : CATEGORY_DESCRIPTIONS[category].split(':')[0]!;
  return {
    id,
    name: pascal(isStatic ? id : id.replace(/^code-reviewer\//, '')) || 'Finding',
    shortDescription: { text: short },
    fullDescription: {
      text: isStatic
        ? `Static analysis hit (${plain(f.tool!.analyzer, 100)}), verified by code-reviewer. ${CATEGORY_DESCRIPTIONS[category]}`
        : `Found by an LLM review and checked by self-critique. ${CATEGORY_DESCRIPTIONS[category]}`,
    },
    helpUri: TOOL_INFO_URI,
    defaultConfiguration: { level: SARIF_LEVELS[severityOf(f)] },
    properties: { tags: [...new Set([category, isStatic ? 'static-analysis' : 'llm'])] },
  };
}

/** Raises a rule's default level and security-severity to the worst finding it groups. */
function mergeIntoRule(rule: SarifRule, f: Finding, worst: Map<string, Severity>): void {
  const severity = severityOf(f);
  const prev = worst.get(rule.id);
  if (prev && SEVERITY_ORDER[prev] <= SEVERITY_ORDER[severity]) return;
  worst.set(rule.id, severity);
  rule.defaultConfiguration.level = SARIF_LEVELS[severity];
  const tags = rule.properties.tags as string[];
  rule.properties['problem.severity'] =
    SARIF_LEVELS[severity] === 'note' ? 'recommendation' : SARIF_LEVELS[severity];
  if (tags.includes('security')) rule.properties['security-severity'] = SECURITY_SEVERITY[severity];
}

function provenance(run: RunRecord): object[] | undefined {
  // `repo.remote` is a web URL (parseRemote) or, failing that, the raw remote: only a credential-free https
  // URL is exported.
  const remote = run.repo?.remote;
  if (!remote || !/^https:\/\/[^\s/@]+\/[^\s@]+$/.test(remote)) return undefined;
  const sha = run.target.headSha;
  return [
    {
      repositoryUri: remote,
      ...(sha && /^[0-9a-f]{40,64}$/.test(sha) ? { revisionId: sha } : {}),
      mappedTo: { uriBaseId: SRCROOT },
    },
  ];
}

/** SARIF 2.1.0 log of a run's kept findings. */
export function renderSarif(run: RunRecord): string {
  const rules: SarifRule[] = [];
  const ruleIndex = new Map<string, number>();
  const worst = new Map<string, Severity>();
  const results: object[] = [];

  for (const f of uniqueFingerprints(sortFindings(run.findings))) {
    const uri = safeRepoPath(f.file);
    if (!uri) continue;
    const id = ruleIdOf(f);
    let index = ruleIndex.get(id);
    if (index === undefined) {
      index = rules.push(newRule(f, id)) - 1;
      ruleIndex.set(id, index);
    }
    mergeIntoRule(rules[index]!, f, worst);
    const startLine = line(f.startLine);
    const endLine = Math.max(startLine, line(f.endLine));
    const properties: Record<string, unknown> = {
      severity: severityOf(f),
      confidence: typeof f.confidence === 'number' && Number.isFinite(f.confidence) ? f.confidence : 0,
      category: categoryOf(f),
      origin: f.origin === 'static' ? 'static' : 'llm',
    };
    if (f.critique?.verdict) properties.critique = plain(f.critique.verdict, 20);
    if (f.origin !== 'static' && f.tool)
      properties.confirms = `${ruleSegment(f.tool.analyzer)}/${ruleSegment(f.tool.ruleId)}`;
    results.push({
      ruleId: id,
      ruleIndex: index,
      level: SARIF_LEVELS[severityOf(f)],
      message: { text: findingMessage(f) },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: uri.split('/').map(encodeURIComponent).join('/'), uriBaseId: SRCROOT },
            region: { startLine, endLine },
          },
        },
      ],
      partialFingerprints: { [SARIF_FINGERPRINT_KEY]: f.fingerprint! },
      properties,
    });
  }

  const failed = run.chunks.filter((c) => c.status === 'failed');
  const started = Date.parse(run.createdAt);
  const invocation: Record<string, unknown> = {
    executionSuccessful: run.status === 'completed',
    ...(Number.isFinite(started) ? { startTimeUtc: new Date(started).toISOString() } : {}),
    ...(Number.isFinite(started) && typeof run.durationMs === 'number'
      ? { endTimeUtc: new Date(started + run.durationMs).toISOString() }
      : {}),
  };
  // Unreviewed code must be visible to SARIF consumers too.
  if (failed.length) {
    invocation.toolExecutionNotifications = failed.map((c) => ({
      level: 'error',
      message: {
        text: plain(
          `Chunk ${c.id} failed: part of the change was not reviewed (${c.files.slice(0, 10).join(', ')}${c.files.length > 10 ? ', …' : ''}).`,
          1_000,
        ),
      },
    }));
  }

  const log = {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'code-reviewer',
            version: packageVersion(),
            semanticVersion: packageVersion(),
            informationUri: TOOL_INFO_URI,
            rules,
          },
        },
        originalUriBaseIds: { [SRCROOT]: { description: { text: 'The repository root.' } } },
        ...(provenance(run) ? { versionControlProvenance: provenance(run) } : {}),
        invocations: [invocation],
        results,
        properties: {
          runId: plain(run.id, 128),
          status: plain(run.status, 20),
          ...(run.options?.depth ? { depth: plain(run.options.depth, 20) } : {}),
        },
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
