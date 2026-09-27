import { blameRange, dominantBlame } from '../git/blame';
import { commitUrl, lineUrl, type RemoteInfo } from '../git/remote';
import type { GitRepo } from '../git/repo';
import type { Finding } from '../types';

/**
 * Adds author info (from `git blame` of the reported lines) and web links for GitHub/GitLab.
 * `sha` undefined = blame the working tree (files mode).
 */
export async function attributeFindings(
  findings: Finding[],
  opts: { repo: GitRepo; sha?: string; linkSha?: string; remote?: RemoteInfo },
): Promise<{ findings: Finding[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: Finding[] = [];
  for (const f of findings) {
    try {
      const lines = await blameRange(opts.repo, opts.sha, f.file, f.startLine, f.endLine);
      const top = dominantBlame(lines);
      if (!top) {
        out.push({ ...f, author: undefined });
        continue;
      }
      out.push({
        ...f,
        author: {
          name: top.author,
          email: top.authorMail,
          commit: top.commit,
          summary: top.summary,
          date: top.authorTime ? new Date(top.authorTime * 1000).toISOString() : undefined,
          commitUrl: commitUrl(opts.remote, top.commit),
          lineUrl: opts.linkSha
            ? lineUrl(opts.remote, opts.linkSha, f.file, f.startLine, f.endLine)
            : undefined,
        },
      });
    } catch (err) {
      warnings.push(`blame failed for ${f.file}:${f.startLine}: ${(err as Error).message.split('\n')[0]}`);
      out.push(f);
    }
  }
  return { findings: out, warnings };
}
