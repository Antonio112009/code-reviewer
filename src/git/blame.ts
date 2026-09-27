import type { GitRepo } from './repo';

export interface BlameLine {
  line: number;
  commit: string;
  author: string;
  authorMail?: string;
  authorTime?: number;
  summary?: string;
}

/** `git blame --porcelain` for a line range of `file` at `sha` (undefined = working tree). */
export async function blameRange(
  repo: GitRepo,
  sha: string | undefined,
  file: string,
  start: number,
  end: number,
): Promise<BlameLine[]> {
  const out = await repo.run([
    'blame',
    '--porcelain',
    '-L',
    `${start},${end}`,
    ...(sha ? [sha] : []),
    '--',
    file,
  ]);
  return parseBlamePorcelain(out);
}

export function parseBlamePorcelain(out: string): BlameLine[] {
  const commits = new Map<string, Omit<BlameLine, 'line' | 'commit'>>();
  const result: BlameLine[] = [];
  let current: { commit: string; line: number } | undefined;
  for (const raw of out.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(raw);
    if (header) {
      current = { commit: header[1]!, line: Number(header[2]) };
      if (!commits.has(current.commit)) commits.set(current.commit, { author: '' });
      continue;
    }
    if (!current) continue;
    const meta = commits.get(current.commit)!;
    if (raw.startsWith('author ')) meta.author = raw.slice(7);
    else if (raw.startsWith('author-mail ')) meta.authorMail = raw.slice(12).replace(/^<|>$/g, '');
    else if (raw.startsWith('author-time ')) meta.authorTime = Number(raw.slice(12));
    else if (raw.startsWith('summary ')) meta.summary = raw.slice(8);
    else if (raw.startsWith('\t')) {
      result.push({ line: current.line, commit: current.commit, ...meta });
      current = undefined;
    }
  }
  // metadata only appears on the first occurrence of a commit — backfill later lines
  return result.map((l) => ({ ...l, ...commits.get(l.commit)! }));
}

/** The commit that touched most lines in the range (ties: most recent). */
export function dominantBlame(lines: BlameLine[]): BlameLine | undefined {
  const counts = new Map<string, { n: number; line: BlameLine }>();
  for (const l of lines) {
    if (/^0+$/.test(l.commit)) continue; // uncommitted
    const entry = counts.get(l.commit) ?? { n: 0, line: l };
    entry.n++;
    counts.set(l.commit, entry);
  }
  return [...counts.values()].sort(
    (a, b) => b.n - a.n || (b.line.authorTime ?? 0) - (a.line.authorTime ?? 0),
  )[0]?.line;
}
