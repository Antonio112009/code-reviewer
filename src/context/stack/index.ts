import type { GitRepo } from '../../git/repo';
import type { StackProfile, TechHit } from '../../types';
import { detectLanguage } from '../../util/language';
import { compareVersions, parseVersion } from '../../util/versions';
import { ACTIVE_SCORE, analyze, LANG_TECH } from './detect';
import {
  DEFAULT_LIMITS,
  inSkippedDir,
  listFiles,
  normalizeRel,
  pickCandidates,
  readCandidates,
  type ScanLimits,
} from './read';

export interface DetectStackOptions {
  /** Directory to read from when no `repo`/`sha` is given (files mode, non-git). */
  root: string;
  /** Read manifests at this commit via `git cat-file` (diff mode) instead of the working tree. */
  repo?: GitRepo;
  sha?: string;
  /** Repo-relative file list (e.g. `git ls-tree` at head). Listed automatically when omitted. */
  files?: string[];
  signal?: AbortSignal;
  /** Overrides of the scan limits (defaults: 300 files, 256 KB each, 2 s read budget). */
  limits?: Partial<ScanLimits>;
}

/** `StackProfile` plus diagnostics about the scan itself. */
export interface DetectedStack extends StackProfile {
  /** Human-readable notes: budgets or caps hit, files that could not be parsed. */
  notes: string[];
  /** Number of allow-listed files whose content was read. */
  filesRead: number;
}

/**
 * Static, read-only technology / database detection. Never executes repository code.
 *
 * Techs carry the lowest version the project is on when manifests declare one (`TechHit.version`, and
 * `TechHit.versions` per package root when packages differ): dependency specs (`next ^15.0.3` → 15.0.3),
 * language / runtime declarations (go directive, `requires-python`, `engines.node`, `.nvmrc`,
 * TargetFramework, `maven.compiler.release`, …) and image tags (`FROM node:22-alpine`).
 *
 * With `repo` + `sha` the tree is listed with `git ls-tree` and contents come from one
 * `git cat-file --batch` process (symlinks are never followed, the working tree is never touched);
 * with `repo` only, `git ls-files` + working-tree reads; otherwise a symlink-free directory walk.
 * Only allow-listed manifests/configs are opened, within `DEFAULT_LIMITS`.
 */
export async function detectStack(opts: DetectStackOptions): Promise<DetectedStack> {
  const started = performance.now();
  const limits: ScanLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  opts.signal?.throwIfAborted();
  const listing = await listFiles({
    root: opts.root,
    repo: opts.repo,
    sha: opts.sha,
    files: opts.files,
    signal: opts.signal,
    limits,
  });
  const listed = listing.files
    .filter((f) => !inSkippedDir(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const { picked, skipped } = pickCandidates(listed, limits);
  const read = await readCandidates(picked, {
    root: opts.root,
    repo: opts.repo,
    fromGit: listing.source === 'git-tree',
    signal: opts.signal,
    limits,
  });
  opts.signal?.throwIfAborted();
  const notes = [...listing.notes, ...read.notes];
  if (skipped > 0) notes.push(`file cap reached: ${skipped} more config files were not read`);
  const result = analyze({ files: listed.map((f) => f.path), contents: read.contents, notes });
  return {
    techs: result.techs,
    packages: result.packages,
    languages: result.languages,
    filesScanned: result.files,
    filesRead: read.contents.size,
    durationMs: Math.round(performance.now() - started),
    notes,
  };
}

/** Categories that apply repository-wide regardless of the package a file belongs to. */
const REPO_WIDE_CATEGORIES = new Set(['infra', 'ci', 'cloud']);

/**
 * Tech ids that apply to `file`: techs of its nearest package root(s) up to the repository root,
 * restricted to those at or above the activation threshold, plus repository-wide infra / CI / cloud
 * techs and the `lang.*` id of the file's own language.
 */
export function techsForFile(profile: StackProfile, file: string): Set<string> {
  const rel = normalizeRel(file) ?? file;
  const out = new Set<string>();
  for (const pkg of profile.packages) {
    if (pkg.dir === '.' || rel === pkg.dir || rel.startsWith(`${pkg.dir}/`))
      for (const t of pkg.techs) out.add(t);
  }
  for (const t of profile.techs)
    if (t.score >= ACTIVE_SCORE && REPO_WIDE_CATEGORIES.has(t.category)) out.add(t.id);
  const lang = LANG_TECH[detectLanguage(rel)];
  if (lang) out.add(lang);
  return out;
}

/** Version of `hit` for `rel`: its nearest package root with a version when packages differ, else `version`. */
function versionForFile(hit: TechHit, rel: string): string | undefined {
  if (!hit.versions) return hit.version;
  let best: string | undefined;
  let bestLen = -1;
  for (const [dir, v] of Object.entries(hit.versions)) {
    const len = dir === '.' ? 0 : dir.length;
    if (len <= bestLen || (dir !== '.' && rel !== dir && !rel.startsWith(`${dir}/`))) continue;
    best = v;
    bestLen = len;
  }
  return best ?? hit.version;
}

/**
 * Versions of the techs that apply to `files` (see {@link techsForFile}), e.g. `framework.nextjs` →
 * `15.0.3`. Each file takes the version of its nearest package root that declares one when packages
 * differ (`TechHit.versions`), else the tech's `version`. A tech whose files disagree (monorepo packages
 * on different versions) is left out: an unknown version passes every version gate, so no
 * version-specific skill is wrongly excluded. Techs without a known version are absent.
 */
export function techVersionsForFiles(profile: StackProfile, files: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  const hits = new Map<string, TechHit>();
  for (const t of profile.techs) if (t.version) hits.set(t.id, t);
  if (hits.size === 0) return out;
  const conflicting = new Set<string>();
  for (const file of files) {
    const rel = normalizeRel(file) ?? file;
    for (const id of techsForFile(profile, rel)) {
      const hit = hits.get(id);
      if (!hit || conflicting.has(id)) continue;
      const v = versionForFile(hit, rel);
      if (v === undefined) continue;
      const cur = out.get(id);
      if (cur === undefined) out.set(id, v);
      else if (cur !== v && compareVersions(parseVersion(cur) ?? [], parseVersion(v) ?? []) !== 0) {
        out.delete(id);
        conflicting.add(id);
      }
    }
  }
  return out;
}

export { ACTIVE_SCORE, WEAK_SCORE } from './detect';
export { ruleCount } from './rules';
export { isTechId, TECH_IDS, TECHS, type TechId, techCategory, techName } from './techs';
