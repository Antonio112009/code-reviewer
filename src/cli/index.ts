import path from 'node:path';
import { Command, CommanderError, Option } from 'commander';
import { osCacheDir } from '../cache/location';
import { runMcpServe } from '../tools/mcp-server';
import { distrustDirectory } from '../util/executables';
import { Logger } from '../util/logger';
import { packageRoot, packageVersion } from '../util/paths';
import { detectInstall, updateNotice, updateNoticeEnabled } from '../util/upgrade';
import { registerCacheCommands } from './commands/cache';
import { registerConfigCommands } from './commands/config';
import { registerEvalCommand } from './commands/eval';
import { registerHookCommands } from './commands/hook';
import { registerInitCommand } from './commands/init';
import { registerProviderCommands } from './commands/providers';
import { registerReviewCommands } from './commands/review';
import { registerRunsCommands } from './commands/runs';
import { registerSkillCommands } from './commands/skills';
import { registerUpgradeCommand } from './commands/upgrade';
import { EXIT } from './context';
import { isCI } from './ui/theme';

export function buildProgram(): Command {
  const program = new Command()
    .name('code-reviewer')
    .description(
      'LLM code review for diffs and files — Claude Code, Codex, Copilot, Gemini, Anthropic, Bedrock, OpenAI-compatible APIs',
    )
    .version(packageVersion(), '-v, --version', 'print the version')
    .option('--verbose', 'debug logging (every run also keeps it in its run.log)')
    .option('-q, --quiet', 'only errors')
    .option('-p, --profile <name>', 'config profile to apply')
    .option('-C, --cwd <dir>', 'run as if started in <dir>')
    .showHelpAfterError()
    .exitOverride();

  program.commandsGroup('Review:');
  registerReviewCommands(program);
  registerHookCommands(program);
  program.commandsGroup('Results:');
  registerRunsCommands(program);
  program.commandsGroup('Setup:');
  registerInitCommand(program);
  registerProviderCommands(program);
  registerConfigCommands(program);
  registerSkillCommands(program);
  registerCacheCommands(program);
  registerUpgradeCommand(program);
  program.helpCommand(true); // listed with the setup commands
  program.commandsGroup('Measure quality:');
  registerEvalCommand(program);
  program.addHelpText(
    'after',
    `
Examples:
  $ code-reviewer review                                          your branch against its base (auto-detected)
  $ code-reviewer review --base main --head feature/login --full  two branches, every real defect
  $ code-reviewer review --staged                                 what you are about to commit
  $ code-reviewer runs open latest                                the HTML report of the last run
  $ code-reviewer init                                            set up this repository

"code-reviewer <command> --help" shows a command's options and examples.
Docs: https://github.com/Antonio112009/code-reviewer#readme
`,
  );

  // Internal: MCP server spawned by ACP agents to expose our tools; not for direct use.
  program
    .command('mcp-serve', { hidden: true })
    .requiredOption('--root <dir>')
    .addOption(new Option('--kind <kind>').choices(['findings', 'verdicts']).makeOptionMandatory())
    .requiredOption('--submit-file <file>')
    .option('--no-git')
    .option('--no-read-tools')
    .option(
      '--dependency-root <dir>',
      'installed dependency sources read_file may read (repeatable)',
      (v: string, all: string[] = []) => [...all, v],
    )
    .action(
      async (opts: {
        root: string;
        kind: 'findings' | 'verdicts';
        submitFile: string;
        git: boolean;
        readTools: boolean;
        dependencyRoot?: string[];
      }) => {
        await runMcpServe({
          root: opts.root,
          kind: opts.kind,
          submitFile: opts.submitFile,
          git: opts.git,
          readTools: opts.readTools,
          ...(opts.dependencyRoot?.length ? { dependencyRoots: opts.dependencyRoot } : {}),
        });
      },
    );

  return program;
}

export async function main(argv: string[]): Promise<void> {
  // Programs are never resolved from the directory the CLI runs in (usually the reviewed checkout):
  // Windows would otherwise search the current directory before PATH for bare command names.
  if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1';
  distrustDirectory(process.cwd());
  const program = buildProgram();
  // Once a day, an interactive review also asks the registry for the latest version (overlapping the
  // review) and says when an upgrade is available.
  let notice: Promise<string | undefined> | undefined;
  program.hook('preAction', (_program, action) => {
    if (action.name() !== 'review' && action.name() !== 'files') return;
    const opts = action.optsWithGlobals<{ json?: boolean; quiet?: boolean }>();
    if (opts.json || opts.quiet) return;
    if (!updateNoticeEnabled(process.env, process.stderr.isTTY === true, isCI(process.env))) return;
    if (detectInstall(packageRoot()).kind === 'source') return;
    notice = updateNotice(packageVersion(), path.join(osCacheDir(), 'update-check.json')).catch(
      () => undefined,
    );
  });
  try {
    await program.parseAsync(argv);
    const text = await notice;
    if (text) process.stderr.write(`\n${text}\n`);
  } catch (err) {
    if (err instanceof CommanderError) {
      // help/version are "errors" with exit code 0 under exitOverride
      process.exitCode = err.exitCode === 0 ? EXIT.ok : EXIT.error;
      return;
    }
    const verbose = argv.includes('--verbose');
    const logger = new Logger('info');
    logger.error((err as Error).message);
    if (verbose && (err as Error).stack) logger.debug((err as Error).stack!);
    process.exitCode = EXIT.error;
  }
}
