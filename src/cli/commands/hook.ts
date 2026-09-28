import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { GitRepo } from '../../git/repo';
import { findExecutable } from '../../providers/acp/presets';
import { SEVERITIES, type Severity } from '../../types';
import { EXIT, type GlobalOptions, makeLogger } from '../context';

/** Marks a hook as ours: only such a hook is replaced or removed. */
export const HOOK_MARKER = '# code-reviewer pre-commit hook';

export interface HookOptions {
  /** Severity that blocks the commit; `none` only reports. */
  failOn: Severity | 'none';
  /** More `review` arguments, e.g. `--provider ollama --model qwen3-coder:30b`. */
  args: string[];
}

/** POSIX shell single-quoting. */
function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The command a hook runs (also printed for hook managers such as husky or lefthook). */
export function hookCommand(opts: HookOptions): string {
  const failOn = opts.failOn === 'none' ? [] : ['--fail-on', opts.failOn];
  return ['code-reviewer', 'review', '--staged', '-y', ...failOn, ...opts.args].map(shellQuote).join(' ');
}

/**
 * The pre-commit hook: findings at `failOn` or above (exit 1) block the commit; a review that cannot run
 * (no provider, nothing staged, errors) lets it through with a message, so a broken setup never blocks work.
 */
export function hookScript(opts: HookOptions): string {
  return `#!/bin/sh
${HOOK_MARKER} (\`code-reviewer hook uninstall\` removes it).
# Skip it once with \`git commit --no-verify\` or CODE_REVIEWER_SKIP=1.
[ -n "$CODE_REVIEWER_SKIP" ] && exit 0
if ! command -v code-reviewer >/dev/null 2>&1; then
  echo "code-reviewer: not found on PATH; the commit was not reviewed" >&2
  exit 0
fi
${hookCommand(opts)}
status=$?
if [ "$status" -eq 1 ]; then
  echo "code-reviewer: the staged changes have findings${opts.failOn === 'none' ? '' : ` (${opts.failOn} or worse)`}; fix them, or commit with --no-verify" >&2
  exit 1
fi
[ "$status" -ne 0 ] && echo "code-reviewer: the review did not complete (exit $status); committing without it" >&2
exit 0
`;
}

interface HookLocation {
  file: string;
  /** core.hooksPath, when another tool (husky, lefthook, …) manages the hooks. */
  managedBy?: string;
}

async function hookLocation(repo: GitRepo): Promise<HookLocation> {
  const hooksPath = await repo.configGet('core.hooksPath');
  const dir = (await repo.run(['rev-parse', '--git-path', 'hooks'])).trim();
  return {
    file: path.join(path.resolve(repo.root, dir), 'pre-commit'),
    ...(hooksPath ? { managedBy: hooksPath } : {}),
  };
}

async function readHook(file: string): Promise<string | undefined> {
  return readFile(file, 'utf8').catch(() => undefined);
}

export type InstallResult =
  | { status: 'installed' | 'updated'; file: string }
  | { status: 'managed'; file: string; hooksPath: string; command: string }
  | { status: 'foreign'; file: string; command: string };

/** Installs (or updates) the pre-commit hook; never overwrites a hook it did not write. */
export async function installHook(repo: GitRepo, opts: HookOptions): Promise<InstallResult> {
  const { file, managedBy } = await hookLocation(repo);
  const command = hookCommand(opts);
  if (managedBy) return { status: 'managed', file, hooksPath: managedBy, command };
  const existing = await readHook(file);
  if (existing !== undefined && !existing.includes(HOOK_MARKER)) return { status: 'foreign', file, command };
  await writeFile(file, hookScript(opts), { mode: 0o755 });
  await chmod(file, 0o755);
  return { status: existing === undefined ? 'installed' : 'updated', file };
}

/** Removes the pre-commit hook when it is ours. */
export async function uninstallHook(
  repo: GitRepo,
): Promise<{ status: 'removed' | 'absent' | 'foreign'; file: string }> {
  const { file } = await hookLocation(repo);
  const existing = await readHook(file);
  if (existing === undefined) return { status: 'absent', file };
  if (!existing.includes(HOOK_MARKER)) return { status: 'foreign', file };
  await rm(file, { force: true });
  return { status: 'removed', file };
}

async function repoOf(globals: GlobalOptions): Promise<GitRepo> {
  const repo = await GitRepo.find(path.resolve(globals.cwd ?? process.cwd()));
  if (!repo) throw new Error('Not inside a git repository.');
  return repo;
}

export function registerHookCommands(program: Command): void {
  const hook = program
    .command('hook')
    .description('review the staged changes before every commit (git pre-commit hook)');

  hook
    .command('install')
    .description('install a pre-commit hook running `code-reviewer review --staged`')
    .option(
      '--fail-on <severity>',
      `block the commit on findings of this severity or worse: ${SEVERITIES.join(', ')} or none`,
      'major',
    )
    .argument(
      '[review-args...]',
      'more `review` arguments after --, e.g. -- --provider ollama --model qwen3-coder:30b',
    )
    .action(async (reviewArgs: string[], opts: { failOn: string }, cmd: Command) => {
      const logger = makeLogger(cmd.optsWithGlobals());
      try {
        const failOn =
          opts.failOn === 'none'
            ? 'none'
            : (SEVERITIES as readonly string[]).includes(opts.failOn)
              ? (opts.failOn as Severity)
              : undefined;
        if (!failOn) throw new Error(`--fail-on: expected one of ${SEVERITIES.join(', ')}, none`);
        const repo = await repoOf(cmd.optsWithGlobals());
        const result = await installHook(repo, { failOn, args: reviewArgs });
        switch (result.status) {
          case 'installed':
          case 'updated':
            logger.info(`Pre-commit hook ${result.status}: ${result.file}`);
            logger.info(
              'Every commit now reviews its staged changes. Skip once with `git commit --no-verify`.',
            );
            if (!findExecutable('code-reviewer')) {
              logger.warn(
                'code-reviewer is not on PATH, so the hook will skip reviews: install it globally (npm install -g @antonio112009/code-reviewer).',
              );
            }
            break;
          case 'managed':
            logger.warn(
              `core.hooksPath is set (${result.hooksPath}): another tool manages the git hooks. Add this to its pre-commit hook:`,
            );
            process.stdout.write(`${result.command}\n`);
            break;
          case 'foreign':
            logger.warn(
              `${result.file} exists and was not written by code-reviewer; it was left alone. Add this to it:`,
            );
            process.stdout.write(`${result.command}\n`);
            break;
        }
        process.exitCode =
          result.status === 'installed' || result.status === 'updated' ? EXIT.ok : EXIT.error;
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = EXIT.error;
      }
    });

  hook
    .command('uninstall')
    .description('remove the pre-commit hook installed by `hook install`')
    .action(async (_opts: unknown, cmd: Command) => {
      const logger = makeLogger(cmd.optsWithGlobals());
      try {
        const result = await uninstallHook(await repoOf(cmd.optsWithGlobals()));
        if (result.status === 'removed') logger.info(`Pre-commit hook removed: ${result.file}`);
        else if (result.status === 'absent') logger.info('No pre-commit hook installed.');
        else logger.warn(`${result.file} was not written by code-reviewer; it was left alone.`);
        process.exitCode = result.status === 'foreign' ? EXIT.error : EXIT.ok;
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = EXIT.error;
      }
    });
}
