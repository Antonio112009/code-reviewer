export type Platform = 'github' | 'gitlab' | 'other';

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
  const platform: Platform = lower.includes('github')
    ? 'github'
    : lower.includes('gitlab')
      ? 'gitlab'
      : 'other';
  return { platform, webUrl: `${origin ?? `https://${host}`}/${repoPath}` };
}

export function commitUrl(remote: RemoteInfo | undefined, sha: string): string | undefined {
  if (!remote || remote.platform === 'other') return undefined;
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
  if (remote.platform === 'gitlab') {
    const range = end > start ? `L${start}-${end}` : `L${start}`;
    return `${remote.webUrl}/-/blob/${sha}/${encoded}#${range}`;
  }
  const range = end > start ? `L${start}-L${end}` : `L${start}`;
  return `${remote.webUrl}/blob/${sha}/${encoded}#${range}`;
}
