import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findTrustedExecutable, isInsideDir } from '../util/executables';
import { type ProcessRegistry, runManaged } from '../util/processes';

/** Variables that commonly carry credentials (matched case-insensitively against the name). */
const SECRET_NAME =
  /(?:^AWS_|^GH_|^GITHUB_|^GITLAB_|^GL_|^CI_JOB_|^ANTHROPIC_|^OPENAI_|^AZURE_|^GOOGLE_|^GCP_|^GCLOUD_|^CLOUDSDK_|^VAULT_|^HEROKU_|^DOCKER_|^NPM_CONFIG_|^YARN_NPM_|^GITLEAKS_|^SEMGREP_|TOKEN|SECRET|PASSW|PASSPHRASE|CREDENTIAL|PRIVATE|_KEY$|_KEY_|APIKEY|API_KEY|ACCESS_KEY|SESSION|COOKIE|AUTH|_PAT$|^PAT$|WEBHOOK|DSN$|CONNECTION_STRING|DATABASE_URL)/i;

/**
 * Settings that match the credential patterns but are not secrets. GOPRIVATE & co. keep private module
 * paths away from the public Go proxy and checksum database — removing them would leak those paths.
 */
const NOT_SECRET = new Set(['GOPRIVATE', 'GONOPROXY', 'GONOSUMDB', 'GONOSUMCHECK', 'GOINSECURE', 'GOFLAGS']);

/**
 * Copy of `env` without anything that looks like a credential (AWS_*, *TOKEN*, *SECRET*, *PASSWORD*,
 * *_KEY, GH_*, GITHUB_*, …) and with colours disabled, for analyzer subprocesses.
 */
export function scrubEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || (SECRET_NAME.test(key) && !NOT_SECRET.has(key.toUpperCase()))) continue;
    if (key === 'FORCE_COLOR') continue;
    out[key] = value;
  }
  out.NO_COLOR = '1';
  return out;
}

/** True when `target` is `root` or lies inside it (lexically, through symlinks, case-insensitively on macOS/Windows). */
export function isInside(root: string, target: string): boolean {
  return isInsideDir(root, target);
}

/**
 * Resolves `name` on PATH, ignoring relative entries, `node_modules/.bin` directories and anything
 * inside the repository under review or a registered untrusted directory (a PR must not be able to
 * substitute its own "shellcheck"). Returns the absolute path to spawn, or undefined.
 */
export async function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  repoRoot?: string,
): Promise<string | undefined> {
  return findTrustedExecutable(name, env, repoRoot ? [repoRoot] : []);
}

export interface VersionProbe {
  ok: boolean;
  version?: string;
  reason?: string;
}

const probeCache = new Map<string, Promise<VersionProbe>>();

/** Extracts the first dotted version number from a `--version` output. */
export function parseVersion(text: string): string | undefined {
  return /\b(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1];
}

/** Compares dotted versions numerically (`2.10` > `2.9`). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Runs `<command> --version` (2 s timeout, temp dir as cwd, scrubbed env) and caches the answer per
 * binary path + mtime + size, so a review probes each tool at most once.
 */
export async function probeVersion(
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; signal?: AbortSignal; registry?: ProcessRegistry; timeoutMs?: number },
): Promise<VersionProbe> {
  let key: string;
  try {
    const st = await stat(command);
    key = `${command}\0${args.join('\0')}\0${st.mtimeMs}\0${st.size}`;
  } catch {
    return { ok: false, reason: 'not found' };
  }
  let cached = probeCache.get(key);
  if (!cached) {
    cached = (async (): Promise<VersionProbe> => {
      try {
        const res = await runManaged(command, args, {
          label: `probe ${path.basename(command)}`,
          cwd: tmpdir(),
          env: opts.env,
          timeoutMs: opts.timeoutMs ?? 2_000,
          signal: opts.signal,
          maxBuffer: 64 * 1024,
          registry: opts.registry,
        });
        if (res.timedOut) return { ok: false, reason: 'version probe timed out' };
        if (res.aborted) return { ok: false, reason: 'aborted' };
        const version = parseVersion(`${res.stdout}\n${res.stderr}`);
        if (res.exitCode !== 0 && !version)
          return { ok: false, reason: `version probe exited ${res.exitCode}` };
        return { ok: true, version };
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    })();
    probeCache.set(key, cached);
    // Do not cache transient failures (aborts, timeouts under load).
    void cached.then((r) => {
      if (!r.ok) probeCache.delete(key);
    });
  }
  return cached;
}

/** Clears the version-probe cache (tests). */
export function clearProbeCache(): void {
  probeCache.clear();
}
