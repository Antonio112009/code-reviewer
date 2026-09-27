import { z } from 'zod';
import type { Category, Severity } from '../types';
import { toRepoPath } from './sandbox';
import type { RawHit } from './types';

/*
 * Lenient SARIF 2.1.0 reader: only the fields we use are declared, unknown keys are ignored and every
 * run/result is validated on its own, so one malformed entry never discards a whole report.
 */

const TextSchema = z.object({ text: z.string().optional(), markdown: z.string().optional() });
const PropertiesSchema = z.record(z.string(), z.unknown());

const RegionSchema = z.object({
  startLine: z.number().int().optional(),
  endLine: z.number().int().optional(),
});

const LocationSchema = z.object({
  physicalLocation: z
    .object({
      artifactLocation: z.object({ uri: z.string().optional(), uriBaseId: z.string().optional() }).optional(),
      region: RegionSchema.optional(),
    })
    .optional(),
});

export const SarifResultSchema = z.object({
  ruleId: z.string().optional(),
  ruleIndex: z.number().int().optional(),
  rule: z.object({ id: z.string().optional(), index: z.number().int().optional() }).optional(),
  level: z.string().optional(),
  kind: z.string().optional(),
  message: TextSchema.optional(),
  locations: z.array(LocationSchema).optional(),
  partialFingerprints: z.record(z.string(), z.unknown()).optional(),
  properties: PropertiesSchema.optional(),
});
export type SarifResult = z.infer<typeof SarifResultSchema>;

export const SarifRuleSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  shortDescription: TextSchema.optional(),
  fullDescription: TextSchema.optional(),
  help: TextSchema.optional(),
  helpUri: z.string().optional(),
  defaultConfiguration: z.object({ level: z.string().optional() }).optional(),
  properties: PropertiesSchema.optional(),
});
export type SarifRule = z.infer<typeof SarifRuleSchema>;

const SarifRunHeaderSchema = z.object({
  tool: z
    .object({
      driver: z
        .object({
          name: z.string().optional(),
          version: z.string().optional(),
          semanticVersion: z.string().optional(),
          rules: z.array(z.unknown()).optional(),
        })
        .optional(),
    })
    .optional(),
  results: z.array(z.unknown()).optional(),
});

const SarifLogHeaderSchema = z.object({
  version: z.string().optional(),
  runs: z.array(z.unknown()),
});

/** A flattened SARIF result. */
export interface SarifFinding {
  ruleId: string;
  uri?: string;
  startLine: number;
  endLine: number;
  level: 'error' | 'warning' | 'note' | 'none';
  message: string;
  /** CVSS-like 0..10 score from `security-severity` (result or rule properties). */
  securitySeverity?: number;
  tags: string[];
  helpUri?: string;
  helpText?: string;
  /** `precision` property of the rule (very-high/high/medium/low), when present. */
  precision?: string;
}

function toNumber(value: unknown): number | undefined {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function toTags(...sources: Array<Record<string, unknown> | undefined>): string[] {
  const tags = new Set<string>();
  for (const props of sources) {
    const raw = props?.tags;
    if (Array.isArray(raw)) for (const t of raw) if (typeof t === 'string') tags.add(t);
  }
  return [...tags].sort();
}

function normaliseLevel(level: string | undefined): SarifFinding['level'] {
  return level === 'error' || level === 'warning' || level === 'note' || level === 'none' ? level : 'warning';
}

/** Parses a SARIF log (text or parsed JSON) into flat findings. Throws only when it is not SARIF at all. */
export function parseSarif(input: string | unknown): SarifFinding[] {
  const json = typeof input === 'string' ? JSON.parse(input) : input;
  const log = SarifLogHeaderSchema.parse(json);
  const out: SarifFinding[] = [];
  for (const rawRun of log.runs) {
    const run = SarifRunHeaderSchema.safeParse(rawRun);
    if (!run.success) continue;
    const rules: SarifRule[] = [];
    const rulesById = new Map<string, SarifRule>();
    for (const rawRule of run.data.tool?.driver?.rules ?? []) {
      const rule = SarifRuleSchema.safeParse(rawRule);
      rules.push(rule.success ? rule.data : { id: '' });
      if (rule.success) rulesById.set(rule.data.id, rule.data);
    }
    for (const rawResult of run.data.results ?? []) {
      const parsed = SarifResultSchema.safeParse(rawResult);
      if (!parsed.success) continue;
      const r = parsed.data;
      const index = r.ruleIndex ?? r.rule?.index;
      const rule =
        (r.ruleId ? rulesById.get(r.ruleId) : undefined) ??
        (r.rule?.id ? rulesById.get(r.rule.id) : undefined) ??
        (index !== undefined ? rules[index] : undefined);
      const ruleId = r.ruleId ?? r.rule?.id ?? rule?.id ?? 'unknown';
      const loc = r.locations?.[0]?.physicalLocation;
      const startLine = Math.max(1, loc?.region?.startLine ?? 1);
      const endLine = Math.max(startLine, loc?.region?.endLine ?? startLine);
      const securitySeverity =
        toNumber(r.properties?.['security-severity']) ?? toNumber(rule?.properties?.['security-severity']);
      const precision = rule?.properties?.precision;
      out.push({
        ruleId,
        uri: loc?.artifactLocation?.uri,
        startLine,
        endLine,
        level: normaliseLevel(r.level ?? rule?.defaultConfiguration?.level),
        message: (r.message?.text ?? r.message?.markdown ?? rule?.shortDescription?.text ?? ruleId).trim(),
        securitySeverity,
        tags: toTags(r.properties, rule?.properties),
        helpUri: rule?.helpUri,
        helpText: rule?.help?.text ?? rule?.shortDescription?.text,
        precision: typeof precision === 'string' ? precision : undefined,
      });
    }
  }
  return out;
}

/** CVSS-style score → severity: ≥9 critical, ≥7 major, ≥4 minor, else info. */
export function severityFromScore(score: number): Severity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'major';
  if (score >= 4) return 'minor';
  return 'info';
}

/** SARIF level → severity (used when no `security-severity` is present). */
export function severityFromLevel(level: SarifFinding['level']): Severity {
  if (level === 'error') return 'major';
  if (level === 'warning') return 'minor';
  return 'info';
}

const STYLE_TAG =
  /^(?:style|stylistic|convention|readability|maintainability|formatting|naming|documentation)$/i;
const SECURITY_TAG = /^(?:security|external\/cwe\/cwe-\d+|cwe-\d+|owasp.*)$/i;

/** Category from SARIF tags (security / performance / concurrency / …), default `bug`. */
export function categoryFromTags(tags: string[]): Category {
  if (tags.some((t) => SECURITY_TAG.test(t))) return 'security';
  if (tags.some((t) => /performance/i.test(t))) return 'performance';
  if (tags.some((t) => /concurren|thread|race/i.test(t))) return 'concurrency';
  if (tags.some((t) => /resource|leak/i.test(t))) return 'resource-leak';
  if (tags.some((t) => /error.?handling|exception/i.test(t))) return 'error-handling';
  return 'bug';
}

/** True for rules tagged only as style/maintainability (not worth an LLM's attention). */
export function isStyleOnly(tags: string[]): boolean {
  return (
    tags.some((t) => STYLE_TAG.test(t)) &&
    !tags.some((t) => SECURITY_TAG.test(t) || /correctness|bug|reliability/i.test(t))
  );
}

const PRECISION_CONFIDENCE: Record<string, number> = { 'very-high': 0.7, high: 0.6, medium: 0.45, low: 0.3 };

/**
 * Known file an artifact URI points at. SARIF asks for percent-encoded URI references, but tools such as
 * cppcheck write raw paths (which may contain `%` themselves): the raw value is tried first, then the
 * decoded one. `file:` URIs are decoded exactly once, by `toRepoPath`.
 */
function sarifFile(uri: string, baseDir: string, known: ReadonlySet<string>): string | undefined {
  const raw = toRepoPath(uri, baseDir, known);
  if (raw || uri.trimStart().startsWith('file:') || !uri.includes('%')) return raw;
  try {
    return toRepoPath(decodeURIComponent(uri), baseDir, known);
  } catch {
    return undefined; // malformed escape: not a file we know
  }
}

/** Converts SARIF findings to raw hits, mapping paths relative to `baseDir` onto `known` files. */
export function sarifToRawHits(
  findings: SarifFinding[],
  opts: { baseDir: string; known: ReadonlySet<string>; confidence?: number },
): RawHit[] {
  const hits: RawHit[] = [];
  for (const f of findings) {
    if (!f.uri || isStyleOnly(f.tags)) continue;
    const file = sarifFile(f.uri, opts.baseDir, opts.known);
    if (!file) continue;
    const severity =
      f.securitySeverity !== undefined ? severityFromScore(f.securitySeverity) : severityFromLevel(f.level);
    hits.push({
      ruleId: f.ruleId,
      file,
      startLine: f.startLine,
      endLine: f.endLine,
      severity,
      category: f.securitySeverity !== undefined ? 'security' : categoryFromTags(f.tags),
      message: f.message,
      confidence: (f.precision && PRECISION_CONFIDENCE[f.precision]) || opts.confidence || 0.4,
      help: f.helpUri ?? f.helpText,
    });
  }
  return hits;
}
