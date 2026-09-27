import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import YAML from 'yaml';
import { findProjectConfig, GLOBAL_CONFIG_FILES, PROJECT_CONFIG_FILES } from '../../config/load';
import { globalConfigDir } from '../../util/paths';
import { type GlobalOptions, loadCliConfig } from '../context';
import { addInitOptions, initCommandAction } from './init';

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('show or create configuration');

  config
    .command('show', { isDefault: true })
    .description('print the effective configuration and where it came from')
    .option('--json', 'JSON instead of YAML')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const loaded = await loadCliConfig(cmd.optsWithGlobals());
      const { profiles: _profiles, ...effective } = loaded.config;
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ sources: loaded.sources, config: effective }, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        `# sources: ${loaded.sources.length ? loaded.sources.join(', ') : '(defaults only)'}\n`,
      );
      process.stdout.write(YAML.stringify(effective));
    });

  config
    .command('path')
    .description('list the config file locations that are searched')
    .action(async (_opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { repo, cwd } = await loadCliConfig(globals);
      const found = findProjectConfig(cwd, repo?.root);
      process.stdout.write(`project (first match, searched from cwd up to the repo root):\n`);
      for (const f of PROJECT_CONFIG_FILES) process.stdout.write(`  ${f}\n`);
      process.stdout.write(`  → ${found ?? 'none found'}\n`);
      process.stdout.write(`global:\n`);
      for (const f of GLOBAL_CONFIG_FILES) {
        const abs = path.join(globalConfigDir(), f);
        process.stdout.write(`  ${abs}${existsSync(abs) ? '  (exists)' : ''}\n`);
      }
    });

  // Kept for compatibility: the same wizard as `code-reviewer init`.
  addInitOptions(
    config.command('init').description('same as `code-reviewer init`: set up this repository (or --global)'),
  ).action(initCommandAction);
}
