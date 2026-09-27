import { spawn } from 'node:child_process';
import path from 'node:path';
import * as p from '@clack/prompts';
import type { Command } from 'commander';
import pc from 'picocolors';
import { REPORT_FORMATS, type ReportFormat } from '../../config/schema';
import { renderReport, writeReports } from '../../report';
import { RunStore } from '../../runs/store';
import { findTrustedExecutable } from '../../util/executables';
import { EXIT, type GlobalOptions, loadCliConfig, makeLogger } from '../context';
import { clean } from '../ui/format';

async function openStore(globals: GlobalOptions): Promise<RunStore> {
  const { config, repo, cwd } = await loadCliConfig(globals);
  return new RunStore(path.resolve(repo?.root ?? cwd, config.output.dir));
}

function parseFormats(value: string | undefined, fallback: ReportFormat[]): ReportFormat[] {
  if (!value) return fallback;
  return value.split(',').map((f) => {
    const t = f.trim() as ReportFormat;
    if (!REPORT_FORMATS.includes(t)) throw new Error(`Unknown format "${f}" (${REPORT_FORMATS.join(', ')})`);
    return t;
  });
}

/**
 * Program that opens a file with its default application. Windows gets an absolute path: a bare name is
 * searched in the current directory first, which is usually the reviewed checkout.
 */
export function openerCommand(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (platform === 'win32')
    return path.win32.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'explorer.exe');
  // Resolved from trusted PATH entries only (never the reviewed checkout).
  return findTrustedExecutable(platform === 'darwin' ? 'open' : 'xdg-open', env);
}

export function registerRunsCommands(program: Command): void {
  const runs = program.command('runs').description('browse, export and delete saved review runs');

  runs
    .command('list', { isDefault: true })
    .description('list saved runs (newest first)')
    .option('-n, --limit <n>', 'max runs to show', '20')
    .option('--json', 'machine-readable output')
    .action(async (opts: { limit: string; json?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const store = await openStore(globals);
      const list = await store.list(Number(opts.limit) || 20);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
        return;
      }
      if (list.length === 0) {
        logger.info(`No runs yet in ${store.dir}`);
        return;
      }
      // run.json can come from the checkout: every field is untrusted text for the terminal.
      for (const r of list) {
        const sev = Object.entries(r.bySeverity)
          .map(([k, v]) => `${clean(v)} ${clean(k)}`)
          .join(', ');
        const color = r.status === 'completed' ? pc.green : r.status === 'failed' ? pc.red : pc.yellow;
        // pad before colouring: ANSI escapes would break padEnd
        const status = color(clean(r.status).padEnd(10));
        process.stdout.write(
          `${pc.cyan(clean(r.id))}  ${status} ${clean(r.command).padEnd(6)} ${clean(r.target).padEnd(30)} ${clean(r.findings).padStart(3)} finding(s)${sev ? pc.dim(` (${sev})`) : ''}  ${pc.dim(clean(r.providers))}\n`,
        );
      }
    });

  runs
    .command('show')
    .description('print a run report (markdown by default)')
    .argument('[id]', 'run id, unique prefix/suffix, or "latest"', 'latest')
    .option('--format <fmt>', 'md | json | html', 'md')
    .action(async (id: string, opts: { format: string }, cmd: Command) => {
      const store = await openStore(cmd.optsWithGlobals());
      const run = await store.load(id);
      const [format] = parseFormats(opts.format, ['md']);
      process.stdout.write(renderReport(run, format!));
    });

  runs
    .command('export')
    .description('(re)generate report files for a run')
    .argument('[id]', 'run id or "latest"', 'latest')
    .option('--format <list>', `formats: ${REPORT_FORMATS.join(',')}`, REPORT_FORMATS.join(','))
    .option('--out <dir>', 'output directory (default: the run directory)')
    .action(async (id: string, opts: { format: string; out?: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const store = await openStore(globals);
      // Paths come from the run's directory name, never from the (untrusted) content of its run.json.
      const resolved = await store.resolveId(id);
      const run = await store.load(resolved);
      const dir = opts.out ? path.resolve(globals.cwd ?? process.cwd(), opts.out) : store.runDir(resolved);
      for (const file of await writeReports(run, parseFormats(opts.format, [...REPORT_FORMATS]), dir)) {
        process.stdout.write(`${file}\n`);
      }
    });

  runs
    .command('open')
    .description('open the HTML report of a run in the browser')
    .argument('[id]', 'run id or "latest"', 'latest')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const store = await openStore(cmd.optsWithGlobals());
      const resolved = await store.resolveId(id);
      const run = await store.load(resolved);
      const [file] = await writeReports(run, ['html'], store.runDir(resolved));
      const opener = openerCommand();
      if (opener) spawn(opener, [file!], { detached: true, stdio: 'ignore' }).unref();
      process.stdout.write(`${file}\n`);
    });

  runs
    .command('rm')
    .description('delete a saved run')
    .argument('<id>', 'run id or unique prefix')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (id: string, opts: { yes?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const store = await openStore(globals);
      const resolved = await store.resolveId(id);
      if (!opts.yes) {
        // The prompt is drawn on stderr (stdout is for machine-readable output), so both must be a terminal.
        if (!process.stdin.isTTY || !process.stderr.isTTY) {
          logger.error('Refusing to delete without --yes in a non-interactive shell.');
          process.exitCode = EXIT.error;
          return;
        }
        const ok = await p.confirm({
          message: `Delete run ${resolved}?`,
          initialValue: false,
          output: process.stderr,
        });
        if (p.isCancel(ok)) {
          // Ctrl+C in the raw-mode prompt raises no SIGINT: exit like an interrupt.
          process.exitCode = EXIT.interrupted;
          return;
        }
        if (!ok) return;
      }
      await store.remove(resolved);
      logger.success(`Deleted ${resolved}`);
    });
}
