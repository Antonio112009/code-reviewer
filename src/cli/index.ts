import { Command, CommanderError, Option } from 'commander';
import { runMcpServe } from '../tools/mcp-server';
import { distrustDirectory } from '../util/executables';
import { Logger } from '../util/logger';
import { packageVersion } from '../util/paths';
import { registerConfigCommands } from './commands/config';
import { registerEvalCommand } from './commands/eval';
import { registerInitCommand } from './commands/init';
import { registerProviderCommands } from './commands/providers';
import { registerReviewCommands } from './commands/review';
import { registerRunsCommands } from './commands/runs';
import { registerSkillCommands } from './commands/skills';
import { EXIT } from './context';

export function buildProgram(): Command {
  const program = new Command()
    .name('code-reviewer')
    .description('LLM code review for diffs and files — Bedrock, Claude Code, Codex, Copilot, Gemini')
    .version(packageVersion())
    .option('-v, --verbose', 'debug logging')
    .option('-q, --quiet', 'only errors')
    .option('-p, --profile <name>', 'config profile to apply')
    .option('-C, --cwd <dir>', 'run as if started in <dir>')
    .showHelpAfterError()
    .exitOverride();

  registerInitCommand(program);
  registerReviewCommands(program);
  registerRunsCommands(program);
  registerProviderCommands(program);
  registerConfigCommands(program);
  registerSkillCommands(program);
  registerEvalCommand(program);

  // Internal: MCP server spawned by ACP agents to expose our tools; not for direct use.
  program
    .command('mcp-serve', { hidden: true })
    .requiredOption('--root <dir>')
    .addOption(new Option('--kind <kind>').choices(['findings', 'verdicts']).makeOptionMandatory())
    .requiredOption('--submit-file <file>')
    .option('--no-git')
    .option('--no-read-tools')
    .option('--project-root <dir>', 'repository root used to load project skills')
    .option('--no-skills', 'do not expose list_skills / get_skill')
    .option('--skills-exclude <ids>', 'comma-separated skill ids hidden from the skill tools')
    .addOption(
      new Option('--depth <depth>', 'review depth the skill tools serve').choices(['essential', 'full']),
    )
    .action(
      async (opts: {
        root: string;
        kind: 'findings' | 'verdicts';
        submitFile: string;
        git: boolean;
        readTools: boolean;
        projectRoot?: string;
        skills: boolean;
        skillsExclude?: string;
        depth?: 'essential' | 'full';
      }) => {
        await runMcpServe({
          root: opts.root,
          kind: opts.kind,
          submitFile: opts.submitFile,
          git: opts.git,
          readTools: opts.readTools,
          projectRoot: opts.projectRoot,
          skills: opts.skills,
          skillsExclude: opts.skillsExclude?.split(',').filter(Boolean),
          depth: opts.depth,
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
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // help/version are "errors" with exit code 0 under exitOverride
      process.exitCode = err.exitCode === 0 ? EXIT.ok : EXIT.error;
      return;
    }
    const verbose = argv.includes('-v') || argv.includes('--verbose');
    const logger = new Logger('info');
    logger.error((err as Error).message);
    if (verbose && (err as Error).stack) logger.debug((err as Error).stack!);
    process.exitCode = EXIT.error;
  }
}
