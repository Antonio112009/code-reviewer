export type Platform = 'github' | 'gitlab' | 'gitea' | 'bitbucket' | 'bitbucket-dc' | 'azure' | 'other';

export interface RemoteInfo {
  platform: Platform;
  /** e.g. https://github.com/owner/repo */
  webUrl: string;
}

/** Parses ssh/https/scp-style remote URLs into a web URL and hosting platform. */
export function parseRemote(url: string | undefined): RemoteInfo | undefined {
  if (!url) return undefined;
  let host: string | undefined;
  let origin: string | undefined;
  let repoPath: string | undefined;

  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/.exec(url);
  if (scp && !url.includes('://')) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    try {
      const u = new URL(url);
      host = u.hostname;
      repoPath = u.pathname.replace(/^\//, '');
      // http(s) remotes keep their scheme and port (`https://gitlab.example.com:8443/…`)
      if (u.protocol === 'http:' || u.protocol === 'https:') origin = `${u.protocol}//${u.host}`;
    } catch {
      return undefined;
    }
  }
  if (!host || !repoPath) return undefined;
  repoPath = repoPath.replace(/\.git$/, '').replace(/\/$/, '');
  const lower = host.toLowerCase();
  // Azure Repos: `git@ssh.dev.azure.com:v3/org/project/repo` and `https://org@dev.azure.com/org/project/_git/repo`
  // both mean https://dev.azure.com/org/project/_git/repo.
  if (lower === 'ssh.dev.azure.com' || lower === 'vs-ssh.visualstudio.com') {
    const m = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(repoPath);
    return m
      ? { platform: 'azure', webUrl: `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}` }
      : undefined;
  }
  if (lower === 'dev.azure.com' || lower.endsWith('.visualstudio.com')) {
    return { platform: 'azure', webUrl: `https://${lower}/${repoPath}` };
  }
  const dc = bitbucketDcWebUrl(url, host, origin, repoPath);
  if (dc) return { platform: 'bitbucket-dc', webUrl: dc };
  const platform: Platform = lower.includes('github')
    ? 'github'
    : lower.includes('gitlab')
      ? 'gitlab'
      : lower.includes('gitea') || lower.includes('forgejo') || lower === 'codeberg.org'
        ? 'gitea'
        : lower === 'bitbucket.org' || lower === 'www.bitbucket.org'
          ? 'bitbucket'
          : 'other';
  return { platform, webUrl: `${origin ?? `https://${host}`}/${repoPath}` };
}

/**
 * The web URL of a Bitbucket Data Center repository (`https://host[/context]/projects/KEY/repos/slug`, personal
 * repositories under `/users/name/repos/slug`), or undefined when the remote is not one. Data Center clones over
 * https from `/scm/KEY/slug.git` and over ssh on port 7999; Bitbucket Cloud lives on bitbucket.org only, so
 * any other host named like Bitbucket is a Data Center (or Server) instance.
 */
function bitbucketDcWebUrl(
  url: string,
  host: string,
  origin: string | undefined,
  repoPath: string,
): string | undefined {
  const lower = host.toLowerCase();
  if (lower === 'bitbucket.org' || lower === 'www.bitbucket.org') return undefined;
  // A host named after another forge keeps that forge (a GitLab group may well be called `scm`).
  if (/github|gitlab|gitea|forgejo|codeberg/.test(lower)) return undefined;
  const repoUrl = (base: string, project: string, slug: string) =>
    project.startsWith('~')
      ? `${base}/users/${project.slice(1).toLowerCase()}/repos/${slug}`
      : `${base}/projects/${project.toUpperCase()}/repos/${slug}`;
  if (origin) {
    const scm = /^(?:(.+)\/)?scm\/(~?[\w.-]+)\/([\w.-]+)$/.exec(repoPath);
    if (scm) return repoUrl(scm[1] ? `${origin}/${scm[1]}` : origin, scm[2]!, scm[3]!);
    const web = /^(?:(.+)\/)?(projects|users)\/([\w.-]+)\/repos\/([\w.-]+)(?:\/.*)?$/.exec(repoPath);
    if (web && lower.includes('bitbucket')) {
      const base = web[1] ? `${origin}/${web[1]}` : origin;
      return repoUrl(base, web[2] === 'users' ? `~${web[3]}` : web[3]!, web[4]!);
    }
    return undefined;
  }
  // ssh: `ssh://git@host:7999/key/slug.git`, or any ssh remote of a host named like Bitbucket.
  const ssh = /^(~?[\w.-]+)\/([\w.-]+)$/.exec(repoPath);
  if (!ssh) return undefined;
  let port = '';
  try {
    port = new URL(url).port;
  } catch {
    // scp-style remote: no port
  }
  if (port !== '7999' && !lower.includes('bitbucket')) return undefined;
  return repoUrl(`https://${host}`, ssh[1]!, ssh[2]!);
}

export function commitUrl(remote: RemoteInfo | undefined, sha: string): string | undefined {
  if (!remote || remote.platform === 'other') return undefined;
  if (remote.platform === 'bitbucket') return `${remote.webUrl}/commits/${sha}`;
  if (remote.platform === 'bitbucket-dc') return `${remote.webUrl}/commits/${sha}`;
  if (remote.platform === 'azure') return `${remote.webUrl}/commit/${sha}`;
  return remote.platform === 'gitlab' ? `${remote.webUrl}/-/commit/${sha}` : `${remote.webUrl}/commit/${sha}`;
}

export function lineUrl(
  remote: RemoteInfo | undefined,
  sha: string,
  file: string,
  start: number,
  end: number,
): string | undefined {
  if (!remote || remote.platform === 'other') return undefined;
  const encoded = file.split('/').map(encodeURIComponent).join('/');
  if (remote.platform === 'azure') {
    return `${remote.webUrl}?path=/${encoded}&version=GC${sha}&line=${start}&lineEnd=${end}&lineStartColumn=1&lineEndColumn=1`;
  }
  if (remote.platform === 'bitbucket-dc') {
    const range = end > start ? `${start}-${end}` : `${start}`;
    return `${remote.webUrl}/browse/${encoded}?at=${sha}#${range}`;
  }
  if (remote.platform === 'bitbucket') {
    const range = end > start ? `lines-${start}:${end}` : `lines-${start}`;
    return `${remote.webUrl}/src/${sha}/${encoded}#${range}`;
  }
  if (remote.platform === 'gitea') {
    const range = end > start ? `L${start}-L${end}` : `L${start}`;
    return `${remote.webUrl}/src/commit/${sha}/${encoded}#${range}`;
  }
  if (remote.platform === 'gitlab') {
    const range = end > start ? `L${start}-${end}` : `L${start}`;
    return `${remote.webUrl}/-/blob/${sha}/${encoded}#${range}`;
  }
  const range = end > start ? `L${start}-L${end}` : `L${start}`;
  return `${remote.webUrl}/blob/${sha}/${encoded}#${range}`;
}
