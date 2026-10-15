import type { Dirent } from 'node:fs';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { estimateTokens } from '../chunking/tokens';
import type { GitRepo } from '../git/repo';
import { unsafeGlobReason, untrustedGlobMatcher } from '../util/globs';
import { resolveInside } from '../util/paths';

/** Files where teams already describe their conventions for AI tools, at the repository root. */
const RULE_FILES = [
  '.code-reviewer/rules.md',
  'CLAUDE.md',
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  'REVIEW.md',
];
/**
 * Rule files that apply to part of the tree: `.cursor/rules/*.mdc` (`globs:` in the frontmatter, or
 * `alwaysApply: true`), `.github/instructions/*.instructions.md` (`applyTo:`), and our own
 * `.code-reviewer/rules/*.md` (`paths:`). A file without a scope applies everywhere.
 */
const RULE_DIRS = ['.cursor/rules', '.github/instructions', '.code-reviewer/rules'];
/** Agent instruction files in a subdirectory apply to the files under it (Codex, Claude Code semantics). */
const NESTED_RULE_NAMES = ['AGENTS.md', 'CLAUDE.md'];
/** Per-file read cap: rule files are prose, anything larger is not a rule file. */
const MAX_RULE_BYTES = 256 * 1024;
/** Most scoped rule files read from one repository. */
const MAX_SCOPED_FILES = 40;
/** Working-tree search for nested rule files: directories visited and depth. */
const MAX_WALK_DIRS = 2_000;
const MAX_WALK_DEPTH = 8;
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  '.venv',
  '__pycache__',
]);

/** A rule file that applies only to the files its globs match. */
export interface ScopedRule {
  source: string;
  globs: string[];
  text: string;
  tokens: number;
}

export interface ProjectRules {
  /** Rules that apply everywhere, as prompt sections. */
  text: string;
  sources: string[];
  tokens: number;
  /** Rules that apply to part of the tree ({@link rulesFor} picks them per chunk). */
  scoped: ScopedRule[];
  /** Globs refused as unsafe (`unsafeGlobReason`), with their file. */
  refused: Array<{ source: string; glob: string; reason: string }>;
}

/** Where rule files are read from: the working tree, or a commit (so a change cannot rewrite its own rules). */
export interface RuleReader {
  /** Human-readable origin for messages, e.g. "origin/main" or "working tree". */
  readonly origin: string;
  read(rel: string): Promise<string | undefined>;
  /** File names (not paths) directly inside `dir`. */
  list(dir: string): Promise<string[]>;
  /** Repository-relative paths of files named `names` in subdirectories (not at the root), sorted. */
  find(names: readonly string[]): Promise<string[]>;
}

/** Reads regular files under `root`; symlinks and paths escaping the root are ignored. */
export function workingTreeReader(root: string): RuleReader {
  return {
    origin: 'working tree',
    async read(rel) {
      try {
        const abs = resolveInside(root, rel);
        const file = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const st = await file.stat();
          if (!st.isFile() || st.size > MAX_RULE_BYTES) return undefined;
          return await file.readFile('utf8');
        } finally {
          await file.close();
        }
      } catch {
        return undefined;
      }
    },
    async list(dir) {
      try {
        const abs = resolveInside(root, dir);
        const entries = await readdir(abs, { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => e.name);
      } catch {
        return [];
      }
    },
    async find(names) {
      const wanted = new Set(names);
      const found: string[] = [];
      const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
      let visited = 0;
      while (queue.length && visited < MAX_WALK_DIRS) {
        const { rel, depth } = queue.shift()!;
        visited++;
        let entries: Dirent[];
        try {
          entries = await readdir(rel ? resolveInside(root, rel) : root, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          const child = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && depth < MAX_WALK_DEPTH)
              queue.push({ rel: child, depth: depth + 1 });
          } else if (rel && e.isFile() && wanted.has(e.name)) found.push(child);
        }
      }
      return found.sort();
    },
  };
}

/** Reads blobs of commit `sha` (symlinks and submodules are skipped, never followed). */
export function commitReader(repo: GitRepo, sha: string, origin: string): RuleReader {
  const lsTree = async (args: string[]) => {
    const out = await repo.run(['ls-tree', '-z', ...args], { allowFailure: true });
    return out
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        const [mode, type] = line.slice(0, tab).split(' ');
        return { mode, type, name: line.slice(tab + 1) };
      });
  };
  return {
    origin,
    async read(rel) {
      const [entry] = await lsTree([sha, '--', rel]).catch(() => []);
      // Regular files only: 120000 = symlink, 160000 = submodule.
      if (entry?.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
        return undefined;
      }
      const text = await repo.show(sha, rel);
      return text !== undefined && text.length <= MAX_RULE_BYTES ? text : undefined;
    },
    async list(dir) {
      const listing = await lsTree([sha, '--', `${dir}/`]).catch(() => []);
      return listing.filter((e) => e.type === 'blob').map((e) => path.posix.basename(e.name));
    },
    async find(names) {
      const wanted = new Set(names);
      const listing = await lsTree(['-r', sha]).catch(() => []);
      return listing
        .filter((e) => e.type === 'blob' && e.name.includes('/') && wanted.has(path.posix.basename(e.name)))
        .filter((e) => !e.name.split('/').some((part) => SKIP_DIRS.has(part)))
        .map((e) => e.name)
        .sort();
    },
  };
}

/** YAML frontmatter (`---` … `---`) of a rule file: its fields and the body after it. */
function splitFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  try {
    const parsed: unknown = YAML.parse(m[1]!);
    return {
      meta:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
      body: text.slice(m[0].length),
    };
  } catch {
    return { meta: {}, body: text.slice(m[0].length) };
  }
}

/** The globs a rule file declares (`globs`, `applyTo`, `paths`: a list or a comma-separated string). */
function declaredGlobs(meta: Record<string, unknown>): string[] | undefined {
  if (meta.alwaysApply === true) return undefined;
  for (const key of ['globs', 'applyTo', 'paths']) {
    const v = meta[key];
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : undefined;
    if (!list) continue;
    const globs = list
      .filter((g): g is string => typeof g === 'string')
      .map((g) => g.trim())
      .filter(Boolean);
    if (globs.length) return globs;
  }
  return undefined;
}

/**
 * Collects project guidelines: the root rule files as one text truncated to `budget` tokens in priority order,
 * and the scoped ones (nested `AGENTS.md` / `CLAUDE.md`, rule files with globs) for {@link rulesFor}. Pass a
 * `RuleReader` (e.g. `commitReader` at the base branch) to read them from somewhere other than `root`.
 */
export async function loadProjectRules(
  rootOrReader: string | RuleReader,
  budget: number,
): Promise<ProjectRules> {
  const reader = typeof rootOrReader === 'string' ? workingTreeReader(rootOrReader) : rootOrReader;
  const sections: string[] = [];
  const sources: string[] = [];
  const scoped: ScopedRule[] = [];
  const refused: ProjectRules['refused'] = [];
  let used = 0;
  let truncated = false;

  const addGlobal = (rel: string, text: string) => {
    if (truncated) return;
    const section = `### ${rel}\n${text}`;
    const tokens = estimateTokens(section);
    if (used + tokens > budget) {
      const remaining = budget - used;
      if (remaining > 200) {
        const ratio = remaining / tokens;
        sections.push(`${section.slice(0, Math.floor(section.length * ratio))}\n…(truncated)`);
        sources.push(rel);
      }
      truncated = true;
      return;
    }
    sections.push(section);
    sources.push(rel);
    used += tokens;
  };
  const addScoped = (rel: string, globs: string[], text: string) => {
    if (scoped.length >= MAX_SCOPED_FILES) return;
    const safe = globs.filter((g) => {
      const reason = unsafeGlobReason(g);
      if (reason) refused.push({ source: rel, glob: g, reason });
      return !reason;
    });
    if (!safe.length) return;
    const section = `### ${rel} (for ${safe.join(', ')})\n${text}`;
    scoped.push({ source: rel, globs: safe, text: section, tokens: estimateTokens(section) });
  };

  for (const rel of RULE_FILES) {
    const text = (await reader.read(rel))?.trim();
    if (text) addGlobal(rel, text);
  }
  for (const dir of RULE_DIRS) {
    for (const entry of (await reader.list(dir)).sort()) {
      if (!/\.(md|mdc)$/.test(entry)) continue;
      const rel = path.posix.join(dir, entry);
      const raw = await reader.read(rel);
      if (!raw) continue;
      const { meta, body } = splitFrontmatter(raw);
      const text = body.trim();
      if (!text) continue;
      const globs = declaredGlobs(meta);
      if (globs) addScoped(rel, globs, text);
      else addGlobal(rel, text);
    }
  }
  for (const rel of await reader.find(NESTED_RULE_NAMES)) {
    const text = (await reader.read(rel))?.trim();
    if (text) addScoped(rel, [`${path.posix.dirname(rel)}/**`], text);
  }

  const text = sections.join('\n\n');
  return { text, sources, tokens: estimateTokens(text), scoped, refused };
}

/**
 * The rules for a chunk: the global text, then the scoped rules whose globs match one of `files`, within
 * `budget` tokens (the global text counts; a scoped rule that does not fit is left out whole).
 */
export function rulesFor(rules: ProjectRules, files: readonly string[], budget: number): string {
  if (!rules.scoped.length) return rules.text;
  const parts = rules.text ? [rules.text] : [];
  let used = rules.tokens;
  for (const rule of rules.scoped) {
    const matches = untrustedGlobMatcher(rule.globs);
    if (!files.some((f) => matches(f))) continue;
    if (used + rule.tokens > budget) continue;
    parts.push(rule.text);
    used += rule.tokens;
  }
  return parts.join('\n\n');
}
