import * as p from '@clack/prompts';
import type { Command } from 'commander';
import { type CacheLocation, cacheDirCandidates, pickCacheDir } from '../../cache/location';
import { ResultCache } from '../../cache/store';
import { EXIT, type GlobalOptions, loadCliConfig, makeLogger } from '../context';

const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

/** `1.4 MB`, `820 KB`, `12 B`. */
export function formatBytes(n: number): string {
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

async function openCache(globals: GlobalOptions): Promise<{
  cache: ResultCache;
  location: CacheLocation;
  enabled: boolean;
  maxAgeDays: number;
  maxSizeMb: number;
}> {
  const { config, repo } = await loadCliConfig(globals);
  const location = await pickCacheDir(
    cacheDirCandidates({ configured: config.cache.dir, repoRoot: repo?.root }),
  );
  if (!location) throw new Error('No writable cache directory (set CODE_REVIEWER_CACHE_DIR).');
  // Listing, pruning and clearing never read entry contents: no signing key needed.
  return {
    cache: new ResultCache(location.dir, Buffer.alloc(0)),
    location,
    enabled: config.cache.enabled,
    maxAgeDays: config.cache.maxAgeDays,
    maxSizeMb: config.cache.maxSizeMb,
  };
}

function positive(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag}: invalid value "${value}"`);
  return n;
}

export function registerCacheCommands(program: Command): void {
  const cache = program
    .command('cache')
    .description('inspect and clean the result cache (model answers reused for unchanged code)');

  cache
    .command('info', { isDefault: true })
    .description('where the cache is, how big it is')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const {
        cache: c,
        location,
        enabled,
        maxAgeDays,
        maxSizeMb,
      } = await openCache(cmd.optsWithGlobals<GlobalOptions>());
      const stats = await c.stats();
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ ...stats, source: location.source, enabled, maxAgeDays, maxSizeMb }, null, 2)}\n`,
        );
        return;
      }
      // Local time, `2026-09-28 14:05`.
      const when = (d?: Date) => (d ? d.toLocaleString('sv-SE').slice(0, 16) : '—');
      process.stdout.write(
        [
          `directory  ${stats.dir} (${location.source})`,
          `enabled    ${enabled ? 'yes' : 'no (cache.enabled: false)'}`,
          `entries    ${stats.entries.review} reviews, ${stats.entries.critique} verdicts, ${formatBytes(stats.bytes)}`,
          `used       ${when(stats.oldest)} … ${when(stats.newest)}`,
          `limits     unused for ${maxAgeDays} days or above ${maxSizeMb} MB are removed (daily)`,
          '',
        ].join('\n'),
      );
    });

  cache
    .command('prune')
    .description('remove old entries now (defaults: cache.maxAgeDays, cache.maxSizeMb)')
    .option('--older-than <days>', 'remove entries not used for this many days')
    .option('--max-size <mb>', 'then remove the least recently used entries above this size')
    .action(async (opts: { olderThan?: string; maxSize?: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const { cache: c, maxAgeDays, maxSizeMb } = await openCache(globals);
      const days = positive(opts.olderThan, '--older-than') ?? maxAgeDays;
      const mb = positive(opts.maxSize, '--max-size') ?? maxSizeMb;
      const r = await c.prune({ maxAgeMs: days * DAY_MS, maxBytes: mb * MB });
      logger.success(
        `Removed ${r.removed} entr${r.removed === 1 ? 'y' : 'ies'} (${formatBytes(r.freedBytes)}); ${r.remaining} left (${formatBytes(r.remainingBytes)}).`,
      );
    });

  cache
    .command('clear')
    .description('remove every cached answer')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (opts: { yes?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const { cache: c } = await openCache(globals);
      if (!opts.yes) {
        // The prompt is drawn on stderr (stdout is for machine-readable output), so both must be a terminal.
        if (!process.stdin.isTTY || !process.stderr.isTTY) {
          logger.error('Refusing to clear the cache without --yes in a non-interactive shell.');
          process.exitCode = EXIT.error;
          return;
        }
        const ok = await p.confirm({
          message: `Remove every cached answer in ${c.dir}?`,
          initialValue: false,
          output: process.stderr,
        });
        if (p.isCancel(ok)) {
          process.exitCode = EXIT.interrupted;
          return;
        }
        if (!ok) return;
      }
      await c.clear();
      logger.success(`Cleared ${c.dir}`);
    });
}
