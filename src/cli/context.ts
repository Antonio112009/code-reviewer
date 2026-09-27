import { type LoadedConfig, loadConfig } from '../config/load';
import type { PartialConfig } from '../config/schema';
import { GitRepo } from '../git/repo';
import { Logger } from '../util/logger';

export interface GlobalOptions {
  verbose?: boolean;
  quiet?: boolean;
  profile?: string;
  cwd?: string;
}

export function makeLogger(opts: GlobalOptions): Logger {
  return new Logger(opts.quiet ? 'error' : opts.verbose ? 'debug' : 'info');
}

export async function loadCliConfig(
  opts: GlobalOptions,
  overrides?: PartialConfig,
): Promise<LoadedConfig & { repo?: GitRepo; cwd: string }> {
  const cwd = opts.cwd ?? process.cwd();
  const repo = await GitRepo.find(cwd);
  const loaded = await loadConfig({ cwd, stopDir: repo?.root, profile: opts.profile, overrides });
  return { ...loaded, repo, cwd };
}

/** Exit codes: 0 ok, 1 findings at/above --fail-on, 2 usage/runtime error. */
/** Process exit codes: findings at/above `--fail-on` → 1, errors → 2, Ctrl+C → 130 (128 + SIGINT). */
export const EXIT = { ok: 0, findings: 1, error: 2, interrupted: 130 } as const;
