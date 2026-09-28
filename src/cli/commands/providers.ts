import { rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import type { Config } from '../../config/schema';
import {
  checkRoleModels,
  classifyError,
  describeErrorClass,
  detectReplyError,
  findCatalogModel,
  isDefiniteListing,
  listModels,
  type ModelListing,
  type ModelRef,
  matchListedModel,
  type RoleModelCheck,
  tierOf,
} from '../../models';
import { detectProviders, type ProviderStatus } from '../../providers/detect';
import { ProviderRegistry } from '../../providers/registry';
import { resolveFindings } from '../../review/findings';
import { resolveRouting } from '../../review/pipeline';
import { reviewInstructions } from '../../review/prompts';
import { REASONING_LEVELS, type ReasoningLevel, type Role } from '../../types';
import type { Logger } from '../../util/logger';
import { EXIT, type GlobalOptions, loadCliConfig, makeLogger } from '../context';
import { installLifecycle, type Lifecycle } from '../lifecycle';

const PROBE_FILE = 'probe.js';
const PROBE_CODE = `function average(values) {
  let sum = 0;
  for (let i = 0; i <= values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}

module.exports = { average };
`;

export function registerProviderCommands(program: Command): void {
  const providers = program.command('providers').description('inspect and test LLM providers');

  providers
    .command('list', { isDefault: true })
    .description('show configured providers and whether they are available on this machine')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const { config } = await loadCliConfig(cmd.optsWithGlobals());
      const statuses = detectProviders(config);
      const routing = resolveRouting(config);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ providers: statuses, routing }, null, 2)}\n`);
        return;
      }
      for (const s of statuses) {
        const mark = s.available ? pc.green('●') : pc.dim('○');
        const exp = s.experimental ? pc.yellow(' (experimental)') : '';
        process.stdout.write(
          `${mark} ${pc.bold(s.id.padEnd(10))} ${s.label}${exp}\n    ${pc.dim(s.detail)}\n`,
        );
      }
      const fmt = (r?: { provider: string; model?: string; reasoning: string }) =>
        r ? `${r.provider}${r.model ? `:${r.model}` : ''} (reasoning ${r.reasoning})` : 'off';
      process.stdout.write(`\nRoles: review → ${fmt(routing.review)}; critique → ${fmt(routing.critique)}\n`);
    });

  providers
    .command('test')
    .description('send a tiny review task to a provider to verify connectivity, tools and output parsing')
    .argument('<id>', 'provider id')
    .option('--model <id>', 'model to use')
    .option('--reasoning <level>', REASONING_LEVELS.join('|'), 'low')
    .option('--timeout <seconds>', 'timeout', '180')
    .action(
      async (id: string, opts: { model?: string; reasoning: string; timeout: string }, cmd: Command) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const logger = makeLogger(globals);
        const { config } = await loadCliConfig(globals);
        const registry = new ProviderRegistry(config, logger);
        const dir = await mkdtemp(path.join(tmpdir(), 'code-reviewer-probe-'));
        // Ctrl+C must stop the agent's process tree (spawned in its own process group, so the terminal's
        // SIGINT never reaches it) and remove the probe directory instead of orphaning both.
        const lifecycle = tryLifecycle();
        lifecycle?.onForcedExit(() => rmSync(dir, { recursive: true, force: true }));
        lifecycle?.onInterrupt(() =>
          logger.warn('Interrupted — stopping the agent (Ctrl+C again to force quit)'),
        );
        const started = Date.now();
        try {
          await writeFile(path.join(dir, PROBE_FILE), PROBE_CODE);
          const provider = registry.get(id);
          logger.step(`Testing ${id} (${provider.kind})…`);
          // The agent may still be starting (npx download, initialize) when Ctrl+C arrives: stop waiting
          // at once; closing the lifecycle below terminates whatever is still running.
          const result = await untilAborted(
            provider.run({
              kind: 'findings',
              label: 'probe',
              instructions: reviewInstructions({ mode: 'files', skills: [] }),
              prompt: `## File: ${PROBE_FILE}\n\`\`\`javascript\n${PROBE_CODE.split('\n')
                .map((l, i) => `${i + 1}   ${l}`)
                .join('\n')}\n\`\`\`\nReview the code above and submit your findings.`,
              model: opts.model,
              reasoning: opts.reasoning as ReasoningLevel,
              readTools: true,
              root: dir,
              git: false,
              maxSteps: 8,
              timeoutMs: Number(opts.timeout) * 1000,
              signal: lifecycle?.signal,
            }),
            lifecycle?.signal,
          );
          const resolved = resolveFindings(result);
          const secs = ((Date.now() - started) / 1000).toFixed(1);
          logger.success(
            `${id} answered in ${secs}s (stop: ${result.stopReason ?? 'n/a'}, tool calls: ${result.toolCalls})`,
          );
          logger.info(
            `  output via: ${resolved.via === 'tool' ? 'submit tool' : resolved.via === 'text' ? 'JSON in text (tool not used)' : 'none'}`,
          );
          logger.info(
            `  findings: ${resolved.items.length}${resolved.items[0] ? ` — e.g. "${resolved.items[0].title}" (line ${resolved.items[0].startLine}, conf ${resolved.items[0].confidence})` : ''}`,
          );
          if (result.usage) {
            const cached = result.usage.cachedInputTokens
              ? ` (+${result.usage.cachedInputTokens} cached)`
              : '';
            logger.info(
              `  tokens: in ${result.usage.inputTokens}${cached} / out ${result.usage.outputTokens}`,
            );
          }
          for (const w of result.warnings) logger.warn(w);
          if (resolved.via === 'none') {
            logger.warn(
              `No findings payload. Agent reply (first 1500 chars):\n${result.text.slice(0, 1500) || '(empty)'}`,
            );
            const replyError = detectReplyError(result.text);
            if (replyError) hintForError(logger, id, replyError);
          }
          const offByOne = resolved.items.some((f) => f.startLine <= 3 && f.endLine >= 3);
          if (!offByOne) logger.warn('The planted off-by-one bug (line 3) was not reported.');
          process.exitCode = resolved.via === 'none' ? EXIT.error : EXIT.ok;
        } catch (err) {
          if (lifecycle?.interrupted) {
            process.exitCode = lifecycle.interruptExitCode ?? EXIT.error;
          } else {
            logger.error((err as Error).message);
            hintForError(logger, id, err);
            process.exitCode = EXIT.error;
          }
        } finally {
          await registry.disposeAll();
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          await lifecycle?.close();
        }
      },
    );

  providers
    .command('models')
    .description('show the models each provider offers on this machine (no tokens spent) and check the roles')
    .argument('[id]', 'provider id (default: every configured provider)')
    .option('--all', 'list every model a provider reports (Bedrock also lists other vendors)')
    .option('--json', 'machine-readable output')
    .action(async (id: string | undefined, opts: { all?: boolean; json?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const logger = makeLogger(globals);
      const { config, cwd } = await loadCliConfig(globals);
      if (id && !config.providers[id]) {
        logger.error(`Unknown provider "${id}". Configured: ${Object.keys(config.providers).join(', ')}`);
        process.exitCode = EXIT.error;
        return;
      }
      const statuses = detectProviders(config);
      const selected = id ? statuses.filter((s) => s.id === id) : statuses;
      const available = statuses.filter((s) => s.available).map((s) => s.id);
      const routes = roleRoutes(config, id);
      const lifecycle = tryLifecycle();
      try {
        const queried = selected.filter((s) => s.available || s.id === id);
        if (queried.length && !opts.json) {
          logger.step(`Asking ${queried.map((s) => s.id).join(', ')} for their models…`);
        }
        const listings = new Map<string, ModelListing>();
        await Promise.all(
          queried.map(async (s) => {
            const cfg = config.providers[s.id]!;
            listings.set(s.id, await listModels(s.id, cfg, { logger, cwd, signal: lifecycle?.signal }));
          }),
        );
        const { checks } = await checkRoleModels({
          config,
          routes,
          availableProviders: available,
          logger,
          cwd,
          signal: lifecycle?.signal,
          listings,
        });
        if (lifecycle?.signal.aborted) {
          process.exitCode = lifecycle.interruptExitCode ?? EXIT.error;
          return;
        }
        if (opts.json) {
          const report = {
            providers: selected.map((s) => providerJson(config, s, listings.get(s.id), routes)),
            roles: checks.map(checkJson),
          };
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        } else {
          for (const s of selected) {
            process.stdout.write(renderProvider(config, s, listings.get(s.id), routes, !!opts.all));
          }
          process.stdout.write(renderChecks(checks));
        }
        if (checks.some((c) => c.status === 'unavailable')) process.exitCode = EXIT.error;
      } finally {
        // An interrupted listing can leave an agent that was still starting: terminate it too.
        await lifecycle?.close();
      }
    });
}

/** Ctrl+C handling when the lifecycle module is available (agents are stopped instead of orphaned). */
function tryLifecycle(): Lifecycle | undefined {
  try {
    return installLifecycle();
  } catch {
    return undefined;
  }
}

/**
 * Settles like `p`, or rejects as soon as `signal` aborts: the caller stops waiting while the work is
 * stopped separately (the lifecycle terminates the process trees). A late rejection of `p` is handled.
 */
export function untilAborted<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    if (signal.aborted) {
      p.catch(() => undefined);
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function roleRoutes(config: Config, onlyProvider?: string): Partial<Record<Role, ModelRef>> {
  let routing: ReturnType<typeof resolveRouting>;
  try {
    routing = resolveRouting(config);
  } catch {
    return {};
  }
  const routes: Partial<Record<Role, ModelRef>> = {};
  for (const [role, route] of Object.entries(routing) as Array<[Role, ModelRef | undefined]>) {
    if (route && (!onlyProvider || route.provider === onlyProvider)) {
      routes[role] = { provider: route.provider, ...(route.model ? { model: route.model } : {}) };
    }
  }
  return routes;
}

/** Roles whose model resolves to `value` on this provider (the agent default counts for model-less roles). */
function rolesUsing(listing: ModelListing, value: string, routes: Partial<Record<Role, ModelRef>>): Role[] {
  const roles: Role[] = [];
  for (const [role, ref] of Object.entries(routes) as Array<[Role, ModelRef]>) {
    if (ref.provider !== listing.provider) continue;
    const resolved = ref.model ? matchListedModel(listing, ref.model) : listing.current;
    if (resolved === value) roles.push(role);
  }
  return roles;
}

interface ModelRow {
  id: string;
  label?: string;
  tier?: string;
  roles: Role[];
  notes: string[];
}

function modelRows(
  config: Config,
  listing: ModelListing,
  routes: Partial<Record<Role, ModelRef>>,
): ModelRow[] {
  if (!Array.isArray(listing.models)) return [];
  const cfg = config.providers[listing.provider]!;
  return listing.models.map((value) => {
    const entry = findCatalogModel(cfg, value);
    const notes: string[] = [];
    if (listing.current === value) notes.push('agent default');
    if (entry?.gated) notes.push('gated');
    if (entry?.refusalProne) notes.push('refusal-prone');
    if (entry?.note) notes.push(entry.note);
    return {
      id: value,
      label: listing.labels?.[value] ?? entry?.label,
      tier: tierOf(cfg, value),
      roles: rolesUsing(listing, value, routes),
      notes,
    };
  });
}

function providerJson(
  config: Config,
  s: ProviderStatus,
  listing: ModelListing | undefined,
  routes: Partial<Record<Role, ModelRef>>,
) {
  return {
    id: s.id,
    type: s.type,
    label: s.label,
    available: s.available,
    detail: s.detail,
    source: listing?.source,
    verified: isDefiniteListing(listing),
    current: listing?.current,
    error: listing?.error,
    models: listing && Array.isArray(listing.models) ? modelRows(config, listing, routes) : null,
  };
}

function checkJson(c: RoleModelCheck) {
  return {
    role: c.role,
    provider: c.ref.provider,
    model: c.ref.model ?? null,
    tier: c.tier ?? null,
    status: c.status,
    reason: c.reason,
    alternatives: c.alternatives.map((a) => ({
      provider: a.provider,
      model: a.model,
      tier: a.tier,
      status: a.status,
    })),
  };
}

function renderProvider(
  config: Config,
  s: ProviderStatus,
  listing: ModelListing | undefined,
  routes: Partial<Record<Role, ModelRef>>,
  all: boolean,
): string {
  const lines: string[] = [];
  const exp = s.experimental ? pc.yellow(' (experimental)') : '';
  if (!listing) {
    lines.push(`${pc.dim('○')} ${pc.bold(s.id.padEnd(10))} ${s.label}${exp}`, `    ${pc.dim(s.detail)}`);
    return `${lines.join('\n')}\n`;
  }
  const definite = isDefiniteListing(listing);
  const count = Array.isArray(listing.models) ? listing.models.length : 0;
  const builtin = config.providers[s.id]?.type === 'mock';
  const via =
    listing.source === 'bedrock-api' ? 'Bedrock API' : listing.source === 'openai-api' ? '/models' : 'agent';
  const summary = definite
    ? pc.dim(`${count} model${count === 1 ? '' : 's'} (${via})`)
    : builtin
      ? pc.dim('built-in')
      : Array.isArray(listing.models)
        ? pc.dim('suggested models (not verified)')
        : pc.yellow('models unknown');
  const mark =
    definite || builtin ? pc.green('●') : Array.isArray(listing.models) ? pc.yellow('●') : pc.red('✖');
  lines.push(`${mark} ${pc.bold(s.id.padEnd(10))} ${s.label}${exp} — ${summary}`);
  if (listing.error && listing.error !== 'the agent offers no model option') {
    lines.push(`    ${pc.red('✖')} ${listing.error}`);
  } else if (listing.error) {
    lines.push(`    ${pc.dim(listing.error)}`);
  }
  let rows = modelRows(config, listing, routes);
  let hidden = 0;
  if (!all && listing.source === 'bedrock-api') {
    const cfg = config.providers[s.id]!;
    const keep = rows.filter((r) => r.roles.length || findCatalogModel(cfg, r.id));
    hidden = rows.length - keep.length;
    rows = keep;
  }
  const width = Math.min(48, Math.max(8, ...rows.map((r) => r.id.length)));
  for (const r of rows) {
    const tier = (r.tier ?? '').padEnd(8);
    const label = r.label && r.label.toLowerCase() !== r.id.toLowerCase() ? pc.dim(r.label) : '';
    const roles = r.roles.length ? pc.cyan(`← ${r.roles.join(', ')}`) : '';
    const notes = r.notes.length ? pc.dim(`(${r.notes.join('; ')})`) : '';
    lines.push(
      `    ${r.id.padEnd(width)}  ${tier}  ${[label, notes, roles].filter(Boolean).join('  ')}`.trimEnd(),
    );
  }
  if (hidden)
    lines.push(pc.dim(`    +${hidden} more (other vendors, geographies or older models; --all shows them)`));
  if (!definite && !rows.length) lines.push(pc.dim('    no catalog suggestions for this provider'));
  return `${lines.join('\n')}\n`;
}

function renderChecks(checks: RoleModelCheck[]): string {
  if (!checks.length) return '';
  const lines = ['', pc.bold('Roles')];
  for (const c of checks) {
    const ref = c.ref.model ? `${c.ref.provider}:${c.ref.model}` : `${c.ref.provider} (default model)`;
    const tier = c.tier ? pc.dim(` ${c.tier}`) : '';
    if (c.status === 'available') {
      lines.push(`  ${pc.green('✔')} ${c.role.padEnd(9)} ${ref}${tier}`);
    } else if (c.status === 'unverified') {
      const why = c.ref.model ? 'not verified (the provider does not list its models)' : '';
      lines.push(`  ${pc.yellow('?')} ${c.role.padEnd(9)} ${ref}${tier}${why ? pc.dim(` — ${why}`) : ''}`);
    } else {
      lines.push(`  ${pc.red('✖')} ${c.role.padEnd(9)} ${ref}${tier} — ${c.reason ?? 'unavailable'}`);
      const alts = c.alternatives.slice(0, 5);
      if (alts.length) {
        lines.push(
          `      ${pc.dim('try:')} ${alts.map((a) => `${a.provider}:${a.model} ${pc.dim(`(${a.tier}, ${a.status})`)}`).join(', ')}`,
        );
      } else {
        lines.push(pc.dim('      no alternative found on this machine'));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** After a failed probe: say what kind of failure it was and what to do next. */
function hintForError(logger: Logger, id: string, err: unknown): void {
  const cls = classifyError(err);
  if (cls === 'unknown') return;
  const next =
    cls === 'unavailable'
      ? ` — see what is available with \`code-reviewer providers models ${id}\``
      : cls === 'auth'
        ? ' — log in to the provider (or refresh AWS credentials) and retry'
        : '';
  logger.note(`  looks like: ${describeErrorClass(cls)}${next}`);
}
