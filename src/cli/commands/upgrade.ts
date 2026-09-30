import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import type { Logger } from '../../util/logger';
import { packageRoot } from '../../util/paths';
import { runManaged } from '../../util/processes';
import {
  changelogBetween,
  detectInstall,
  type Install,
  isNewer,
  isReleaseVersion,
  PACKAGE_NAME,
  RELEASES_URL,
  upgradeCommand,
} from '../../util/upgrade';
import { EXIT, type GlobalOptions, makeLogger } from '../context';

const NPM_QUERY_TIMEOUT_MS = 60_000;
const NPM_INSTALL_TIMEOUT_MS = 10 * 60_000;
/** npm may answer ETARGET for a version published moments ago (registry replicas lag): retried. */
const LAG_RETRIES = 3;
const LAG_WAIT_MS = 15_000;
/** Most CHANGELOG lines printed after an upgrade; the rest is on the releases page. */
const MAX_NOTES_LINES = 60;

export interface UpgradeOptions {
  check?: boolean;
  json?: boolean;
  /** An exact version instead of the latest (also allows going back). */
  to?: string;
}

export interface UpgradeDeps {
  /** Package directory of the running copy (default: this package). */
  root?: string;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  write?: (text: string) => void;
  /** Waits between ETARGET retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

function installedVersion(root: string): string {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

function lastLines(text: string, n: number): string {
  return text.trim().split(/\r?\n/).slice(-n).join('\n');
}

async function npm(args: string[], env: NodeJS.ProcessEnv, timeoutMs = NPM_QUERY_TIMEOUT_MS) {
  return runManaged('npm', args, { label: `npm ${args[0]}`, env, timeoutMs });
}

/** `npm root -g`, or undefined when npm is missing or fails. */
async function npmGlobalRoot(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const r = await npm(['root', '--global'], env);
    return r.exitCode === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The version `spec` (`latest` or an exact version) resolves to on the registry npm is configured for. */
async function resolveVersion(spec: string, env: NodeJS.ProcessEnv): Promise<string> {
  let r: Awaited<ReturnType<typeof npm>>;
  try {
    r = await npm(['view', `${PACKAGE_NAME}@${spec}`, 'version', '--prefer-online'], env);
  } catch {
    throw new Error('npm was not found on PATH: it is needed to look up and install new versions.');
  }
  // `npm view pkg@x version` prints nothing (exit 0) for a version that does not exist
  const version = r.stdout.trim().split(/\s+/).pop();
  if (r.exitCode !== 0 || !isReleaseVersion(version)) {
    const why = r.exitCode === 0 ? `no version ${spec} of ${PACKAGE_NAME}` : lastLines(r.stderr, 3);
    throw new Error(`Could not look up ${PACKAGE_NAME}@${spec}: ${why || 'npm failed'}`);
  }
  return version;
}

/** What to tell someone whose copy `upgrade` does not update itself. */
function manualSteps(install: Install, version: string): string[] {
  const cmd = upgradeCommand(install.kind, version)?.join(' ');
  switch (install.kind) {
    case 'source':
      return [
        `This copy runs from a source checkout (${install.root}). Update it with:`,
        '  git pull && npm ci && npm run build',
      ];
    case 'npx':
      return [
        'This copy runs through npx, which caches packages. Ask for the new version explicitly:',
        `  npx ${PACKAGE_NAME}@${version} …`,
      ];
    case 'project':
      return [`This copy is a dependency of a project (${install.root}). In that project, run:`, `  ${cmd}`];
    default:
      return [
        `This copy was installed with ${install.kind.replace('-global', '')}. Update it with:`,
        `  ${cmd}`,
      ];
  }
}

/** Installs `version` globally with npm, retrying while the registry has not caught up. */
async function npmInstall(version: string, deps: UpgradeDeps, env: NodeJS.ProcessEnv): Promise<void> {
  const [, ...args] = upgradeCommand('npm-global', version)!;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    const r = await npm(args, env, NPM_INSTALL_TIMEOUT_MS);
    if (r.exitCode === 0) return;
    const out = `${r.stderr}\n${r.stdout}`;
    if (/\bETARGET\b|notarget/i.test(out) && attempt < LAG_RETRIES) {
      deps.logger.info(
        `The registry does not serve ${version} everywhere yet; retrying in ${LAG_WAIT_MS / 1000}s…`,
      );
      await sleep(LAG_WAIT_MS);
      continue;
    }
    if (/\bEACCES\b|\bEPERM\b/.test(out)) {
      throw new Error(
        `npm may not write to its global directory. Run "npm install --global ${PACKAGE_NAME}@${version}" the way you installed it (for example with sudo), or point npm at a user-owned prefix: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally`,
      );
    }
    throw new Error(
      r.timedOut
        ? 'npm install timed out.'
        : `npm install failed:\n${lastLines(out, 15) || `exit code ${r.exitCode}`}`,
    );
  }
}

/** `code-reviewer upgrade`: returns the exit code. */
export async function runUpgrade(opts: UpgradeOptions, deps: UpgradeDeps): Promise<number> {
  const env = deps.env ?? process.env;
  const root = deps.root ?? packageRoot();
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const current = installedVersion(root);
  const install = detectInstall(root, await npmGlobalRoot(env));
  const target = await resolveVersion(opts.to ?? 'latest', env);
  const available = opts.to ? target !== current : isNewer(target, current);
  const command = upgradeCommand(install.kind, target);
  // An unreleased build (a source checkout, a local tarball) can be ahead of the registry.
  const upToDate =
    !opts.to && isNewer(current, target)
      ? `${current} is newer than the latest release (${target}).`
      : `Already on ${current}, the ${opts.to ? 'requested' : 'latest'} version.`;

  if (opts.check || opts.json) {
    if (opts.json) {
      write(
        `${JSON.stringify({ current, latest: target, updateAvailable: available, install: install.kind, root: install.root, ...(command ? { command: command.join(' ') } : {}) }, null, 2)}\n`,
      );
    } else if (available) {
      write(`${current} → ${target} available. Run: code-reviewer upgrade\n`);
    } else {
      write(`${upToDate}\n`);
    }
    return EXIT.ok;
  }
  if (!available) {
    deps.logger.success(upToDate);
    return EXIT.ok;
  }
  if (install.kind !== 'npm-global') {
    deps.logger.info(`${current} → ${target} available.`);
    for (const line of manualSteps(install, target)) deps.logger.info(line);
    return EXIT.ok;
  }

  deps.logger.info(`Installing ${PACKAGE_NAME}@${target} (now ${current}) with npm…`);
  await npmInstall(target, deps, env);
  const now = installedVersion(root);
  if (now !== target) {
    deps.logger.warn(
      `npm installed ${target}, but ${install.root} still has ${now}: another npm or Node.js installation may own this copy.`,
    );
    return EXIT.error;
  }
  deps.logger.success(`Upgraded to ${target}.`);
  let notes = '';
  try {
    notes = changelogBetween(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), current, target);
  } catch {
    // an older package without its CHANGELOG: the releases page has the notes
  }
  if (notes) {
    const lines = notes.split('\n');
    write(`\n${lines.slice(0, MAX_NOTES_LINES).join('\n')}\n`);
    if (lines.length > MAX_NOTES_LINES) write('…\n');
  }
  write(`\nRelease notes: ${RELEASES_URL}\n`);
  return EXIT.ok;
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('update code-reviewer to the latest version and show what changed')
    .option('--check', 'only say whether a newer version exists')
    .option('--json', 'machine-readable answer of --check (current, latest, install kind)')
    .option('--to <version>', 'install this exact version (also to go back)')
    .addHelpText(
      'after',
      `
An npm global install is updated in place (npm install --global). For other installs (pnpm, yarn, bun,
npx, a project dependency, a source checkout) the command to run is printed.

Examples:
  $ code-reviewer upgrade             install the latest version
  $ code-reviewer upgrade --check     is there a newer version?
  $ code-reviewer upgrade --to 0.5.0  go back to 0.5.0
`,
    )
    .action(async (opts: UpgradeOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      process.exitCode = await runUpgrade(opts, { logger: makeLogger(globals) });
    });
}
