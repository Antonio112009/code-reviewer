import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentResult } from '../providers/types';
import {
  type Finding,
  type ReportedFinding,
  ReportedFindingSchema,
  type ReportedVerdict,
  ReportedVerdictSchema,
} from '../types';
import { shortHash } from '../util/ids';
import { extractJson } from '../util/json';

export interface Resolved<T> {
  items: T[];
  via: 'tool' | 'text' | 'none';
  invalid: number;
}

/** Findings from the submit tool, falling back to JSON embedded in the reply text. */
export function resolveFindings(result: AgentResult): Resolved<ReportedFinding> {
  if (result.submission.findings)
    return validateAll(result.submission.findings, ReportedFindingSchema, 'tool');
  const json = extractJson(result.text);
  const list = Array.isArray(json) ? json : (json as { findings?: unknown })?.findings;
  if (Array.isArray(list)) return validateAll(list, ReportedFindingSchema, 'text');
  return { items: [], via: 'none', invalid: 0 };
}

export function resolveVerdicts(result: AgentResult): Resolved<ReportedVerdict> {
  if (result.submission.verdicts)
    return validateAll(result.submission.verdicts, ReportedVerdictSchema, 'tool');
  const json = extractJson(result.text);
  const list = Array.isArray(json) ? json : (json as { verdicts?: unknown })?.verdicts;
  if (Array.isArray(list)) return validateAll(list, ReportedVerdictSchema, 'text');
  return { items: [], via: 'none', invalid: 0 };
}

function validateAll<T>(
  list: unknown[],
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  via: 'tool' | 'text',
): Resolved<T> {
  const items: T[] = [];
  let invalid = 0;
  for (const raw of list) {
    const r = schema.safeParse(raw);
    if (r.success) items.push(r.data);
    else invalid++;
  }
  return { items, via, invalid };
}

/** Normalises paths and line order, assigns a stable id. */
export function toFinding(
  reported: ReportedFinding,
  ctx: { root: string; chunkId: string; provider: string; model?: string; skills: string[] },
): Finding {
  const file = normalizePath(reported.file, ctx.root);
  const startLine = Math.min(reported.startLine, reported.endLine);
  const endLine = Math.max(reported.startLine, reported.endLine);
  return {
    ...reported,
    file,
    startLine,
    endLine,
    id: `f-${shortHash(`${file}:${startLine}:${reported.title}`)}`,
    skills: ctx.skills,
    source: { chunkIds: [ctx.chunkId], provider: ctx.provider, model: ctx.model },
  };
}

export function normalizePath(p: string, root: string): string {
  let out = p.trim().replace(/\\/g, '/');
  if (path.isAbsolute(out)) out = path.relative(root, out).replace(/\\/g, '/');
  out = out.replace(/^\.\//, '');
  // `a/src/x.ts` / `b/src/x.ts` are diff prefixes — unless the repository really has that path.
  const m = /^[ab]\/(.+)$/.exec(out);
  if (m && !existsSync(path.join(root, out))) out = m[1]!;
  return out;
}
