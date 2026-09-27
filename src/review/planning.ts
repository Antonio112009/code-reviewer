import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzeFile } from '../analyzers';
import { isTechId, techCategory, techName, techsForFile, techVersionsForFiles } from '../context/stack';
import { addedRanges } from '../git/diff-parser';
import type { GitRepo } from '../git/repo';
import { SEVERITY_ORDER, stackEntries } from '../report/common';
import type { Chunk, Finding, ReviewUnit, StackProfile, StaticHit } from '../types';

/** Largest file read for import resolution (tsconfig.json, go.mod, composer.json, …). */
const MAX_CONFIG_BYTES = 256 * 1024;

/** Every file path in commit `sha` (repo-relative, posix). */
export async function listRevisionFiles(repo: GitRepo, sha: string): Promise<string[]> {
  const out = await repo.run(['ls-tree', '-r', '-z', '--name-only', sha]);
  return out.split('\0').filter(Boolean);
}

/** Reads a (small) file of commit `sha`; undefined when missing or too large. */
export function revisionReader(repo: GitRepo, sha: string): (path: string) => Promise<string | undefined> {
  return async (file) => {
    const text = await repo.show(sha, file).catch(() => undefined);
    return text !== undefined && text.length <= MAX_CONFIG_BYTES ? text : undefined;
  };
}

/** Raw code of the owned files (no line numbers): new side of the hunks in diff mode, full content otherwise. */
export function rawCodeOf(units: ReviewUnit[]): string {
  return units
    .map((u) => {
      if (u.status === 'file') return u.content ?? '';
      if (u.hunks.length === 0) return u.content ?? '';
      return u.hunks.flatMap((h) => h.lines.filter((l) => l.type !== 'del').map((l) => l.text)).join('\n');
    })
    .join('\n');
}

/** Full content of the owned files — what a skill group's `detect.content` looks at ("is this a React file?"). */
export function fileCodeOf(units: ReviewUnit[]): string {
  return units
    .map(
      (u) =>
        u.content ??
        u.hunks.flatMap((h) => h.lines.filter((l) => l.type !== 'del').map((l) => l.text)).join('\n'),
    )
    .join('\n');
}

/** Only the lines added by the change (diff mode) — what skill content signals should react to. */
export function addedCodeOf(units: ReviewUnit[]): string {
  return units
    .flatMap((u) => u.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => l.text)))
    .join('\n');
}

/** Files handed to the static analyzers: reviewed content plus the changed line ranges. */
export function analyzeFilesFrom(units: ReviewUnit[], mode: 'diff' | 'files'): AnalyzeFile[] {
  return units
    .filter((u) => u.status !== 'deleted' && u.content !== undefined)
    .map((u) => ({
      path: u.path,
      content: u.content!,
      language: u.language,
      changedRanges: mode === 'diff' ? addedRanges(u.hunks) : [],
    }));
}

/**
 * Hints for a chunk: hits in the files it owns, most severe and most confident first. `shown` is capped at
 * `max` (secrets / vulnerable dependencies first); `overflow` holds the non-rejectable hits that did not
 * fit — they are never dropped silently.
 */
export function hintsForChunk(
  hits: StaticHit[],
  chunk: Chunk,
  max: number,
): { shown: StaticHit[]; overflow: StaticHit[] } {
  const owned = new Set(chunk.files);
  const sorted = hits
    .filter((h) => owned.has(h.file))
    .sort(
      (a, b) =>
        Number(Boolean(b.nonRejectable)) - Number(Boolean(a.nonRejectable)) ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.confidence - a.confidence ||
        a.file.localeCompare(b.file) ||
        a.startLine - b.startLine,
    );
  const shown = sorted.slice(0, Math.max(0, max));
  const overflow = sorted.slice(shown.length).filter((h) => h.nonRejectable);
  return { shown, overflow };
}

/** Lines of slack when matching a finding to the hint it claims. */
const CLAIM_SLACK = 3;

/** A finding claims a hint only when it points at the hint's code (same file, overlapping lines ± slack). */
export function claimsHint(
  f: Pick<Finding, 'file' | 'startLine' | 'endLine'>,
  h: Pick<StaticHit, 'file' | 'startLine' | 'endLine'>,
): boolean {
  return (
    f.file === h.file && f.startLine <= h.endLine + CLAIM_SLACK && f.endLine >= h.startLine - CLAIM_SLACK
  );
}

/** Tech ids applying to any owned file of the chunk; undefined when the stack is unknown. */
export function techsForChunk(stack: StackProfile | undefined, files: string[]): Set<string> | undefined {
  if (!stack) return undefined;
  const out = new Set<string>();
  for (const f of files) for (const t of techsForFile(stack, f)) out.add(t);
  return out;
}

/**
 * Detected versions of the techs applying to the chunk's files (`framework.nextjs` → `15.1.0`), resolved
 * per file by the stack detector (nearest package with a version). Files a tech does not apply to do not
 * count; when the files that use a tech disagree, it is left out — an unknown version passes every
 * version gate, so no version-specific skill is wrongly excluded. With no files, the repository-wide
 * versions are returned (only when all packages agree).
 */
export function techVersionsForChunk(
  stack: StackProfile | undefined,
  files: string[],
  techs: Set<string> | undefined,
): Map<string, string> {
  if (!stack) return new Map();
  let versions: Map<string, string>;
  if (files.length) {
    versions = techVersionsForFiles(stack, files);
  } else {
    versions = new Map();
    for (const hit of stack.techs) {
      const values = new Set(Object.values(hit.versions ?? {}));
      if (values.size === 0 && hit.version) values.add(hit.version);
      const [only] = values;
      if (values.size === 1 && only) versions.set(hit.id, only);
    }
  }
  if (techs) for (const id of [...versions.keys()]) if (!techs.has(id)) versions.delete(id);
  return versions;
}

/** Max technologies named in a chunk's stack line. */
const MAX_STACK_LINE = 12;

/**
 * `Next.js 15.1.0 · React 19.0.0 · PostgreSQL · Prisma 6.2.1 · TypeScript 5.6.3` — the technologies of
 * the chunk's files (frameworks first), with versions when known. Languages are listed only with a
 * version (the file list already shows them). Undefined when nothing is known.
 */
export function chunkStackLine(
  techs: Set<string> | undefined,
  versions: ReadonlyMap<string, string>,
): string | undefined {
  if (!techs?.size) return undefined;
  const entries = stackEntries(
    [...techs]
      .filter(isTechId)
      .map((id) => ({ id, name: techName(id), category: techCategory(id), score: 1 })),
  ).filter((e) => e.category !== 'language' || versions.has(e.id));
  if (entries.length === 0) return undefined;
  const shown = entries.slice(0, MAX_STACK_LINE).map((e) => {
    const v = versions.get(e.id);
    return v ? `${e.name} ${v}` : e.name;
  });
  return entries.length > shown.length
    ? `${shown.join(' · ')} +${entries.length - shown.length}`
    : shown.join(' · ');
}

/** Paths under `.code-reviewer/` (review config, rules, project skills) among `paths` (every changed path). */
export function touchedReviewConfig(paths: readonly string[]): string[] {
  return [...new Set(paths)].filter(
    (p) =>
      p === '.code-reviewer' ||
      p.startsWith('.code-reviewer/') ||
      /^\.code-reviewerrc(\.(json|ya?ml))?$/.test(p),
  );
}

/**
 * The review-config path that is a symbolic link (`.code-reviewer` or `.code-reviewer/skills`), if any:
 * through it, a change to the link target would steer the review without touching `.code-reviewer/`.
 */
export async function linkedReviewConfig(repoRoot: string): Promise<string | undefined> {
  for (const rel of ['.code-reviewer', '.code-reviewer/skills']) {
    const st = await lstat(path.join(repoRoot, rel)).catch(() => undefined);
    if (st?.isSymbolicLink()) return rel;
  }
  return undefined;
}
