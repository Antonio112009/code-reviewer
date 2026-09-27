import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { estimateTokens } from '../chunking/tokens';
import type { GitRepo } from '../git/repo';
import { resolveInside } from '../util/paths';

/** Files where teams already describe their conventions for AI tools. */
const RULE_FILES = [
  '.code-reviewer/rules.md',
  'CLAUDE.md',
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  'REVIEW.md',
];
const RULE_DIRS = ['.cursor/rules'];
/** Per-file read cap: rule files are prose, anything larger is not a rule file. */
const MAX_RULE_BYTES = 256 * 1024;

export interface ProjectRules {
  text: string;
  sources: string[];
  tokens: number;
}

/** Where rule files are read from: the working tree, or a commit (so a change cannot rewrite its own rules). */
export interface RuleReader {
  /** Human-readable origin for messages, e.g. "origin/main" or "working tree". */
  readonly origin: string;
  read(rel: string): Promise<string | undefined>;
  /** File names (not paths) directly inside `dir`. */
  list(dir: string): Promise<string[]>;
}

/** Reads regular files under `root`; symlinks and paths escaping the root are ignored. */
export function workingTreeReader(root: string): RuleReader {
  return {
    origin: 'working tree',
    async read(rel) {
      try {
        const abs = resolveInside(root, rel);
        const st = await lstat(abs);
        if (!st.isFile() || st.size > MAX_RULE_BYTES) return undefined;
        return await readFile(abs, 'utf8');
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
  };
}

/** Reads blobs of commit `sha` (symlinks and submodules are skipped, never followed). */
export function commitReader(repo: GitRepo, sha: string, origin: string): RuleReader {
  const lsTree = async (pathspec: string) => {
    const out = await repo.run(['ls-tree', '-z', sha, '--', pathspec], { allowFailure: true });
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
      const [entry] = await lsTree(rel).catch(() => []);
      // Regular files only: 120000 = symlink, 160000 = submodule.
      if (entry?.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
        return undefined;
      }
      const text = await repo.show(sha, rel);
      return text !== undefined && text.length <= MAX_RULE_BYTES ? text : undefined;
    },
    async list(dir) {
      const listing = await lsTree(`${dir}/`).catch(() => []);
      return listing.filter((e) => e.type === 'blob').map((e) => path.posix.basename(e.name));
    },
  };
}

/**
 * Collects project guidelines, truncated to `budget` tokens in priority order. Pass a `RuleReader`
 * (e.g. `commitReader` at the base branch) to read them from somewhere other than `root`.
 */
export async function loadProjectRules(
  rootOrReader: string | RuleReader,
  budget: number,
): Promise<ProjectRules> {
  const reader = typeof rootOrReader === 'string' ? workingTreeReader(rootOrReader) : rootOrReader;
  const candidates: string[] = [...RULE_FILES];
  for (const dir of RULE_DIRS) {
    for (const entry of (await reader.list(dir)).sort()) {
      if (/\.(md|mdc)$/.test(entry)) candidates.push(path.posix.join(dir, entry));
    }
  }

  const sections: string[] = [];
  const sources: string[] = [];
  let used = 0;
  for (const rel of candidates) {
    const text = (await reader.read(rel))?.trim();
    if (!text) continue;
    const section = `### ${rel}\n${text}`;
    const tokens = estimateTokens(section);
    if (used + tokens > budget) {
      const remaining = budget - used;
      if (remaining > 200) {
        const ratio = remaining / tokens;
        sections.push(`${section.slice(0, Math.floor(section.length * ratio))}\n…(truncated)`);
        sources.push(rel);
      }
      break;
    }
    sections.push(section);
    sources.push(rel);
    used += tokens;
  }
  const text = sections.join('\n\n');
  return { text, sources, tokens: estimateTokens(text) };
}
