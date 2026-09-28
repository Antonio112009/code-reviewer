import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { isInsideDir } from '../util/executables';
import { unsafeGlobReason } from '../util/globs';
import { globalConfigDir } from '../util/paths';
import {
  type Config,
  ConfigSchema,
  DEFAULT_CONFIG,
  DEPTH_PRESETS,
  type PartialConfig,
  PartialConfigSchema,
  PUBLISH_URL_KEYS,
  type ReviewDepth,
} from './schema';

export const PROJECT_CONFIG_FILES = [
  '.code-reviewerrc',
  '.code-reviewerrc.json',
  '.code-reviewerrc.yaml',
  '.code-reviewerrc.yml',
  '.code-reviewer/config.yaml',
  '.code-reviewer/config.yml',
  '.code-reviewer/config.json',
];

export const GLOBAL_CONFIG_FILES = ['config.yaml', 'config.yml', 'config.json'];

export interface LoadConfigOptions {
  cwd: string;
  /** Directory where the upward search for a project config stops (usually the git root). */
  stopDir?: string;
  profile?: string;
  /** Highest-priority overrides (CLI flags). */
  overrides?: PartialConfig;
  /** Skip the global config (tests). */
  ignoreGlobal?: boolean;
}

export interface LoadedConfig {
  config: Config;
  /** Files that contributed, lowest priority first. */
  sources: string[];
  profile?: string;
}

export class ConfigError extends Error {}

export async function loadConfig(opts: LoadConfigOptions): Promise<LoadedConfig> {
  const sources: string[] = [];
  /** Config layers, lowest priority first (global, project, profile, flags). */
  const layers: Array<Record<string, unknown>> = [];

  if (!opts.ignoreGlobal) {
    const globalFile = findFirst(globalConfigDir(), GLOBAL_CONFIG_FILES);
    if (globalFile) {
      layers.push(await readPartial(globalFile));
      sources.push(globalFile);
    }
  }

  const projectFile = findProjectConfig(opts.cwd, opts.stopDir);
  if (projectFile) {
    const partial = await readPartial(projectFile);
    assertNoLaunchFields(partial, projectFile);
    assertSafeGlobs(partial, projectFile);
    layers.push(partial);
    sources.push(projectFile);
  }

  if (opts.profile) {
    const profiles = layers.reduce<Record<string, unknown>>(
      (acc, layer) => deepMerge(acc, (layer.profiles ?? {}) as Record<string, unknown>),
      {},
    );
    const profile = profiles[opts.profile];
    if (profile === undefined) {
      const known = Object.keys(profiles);
      throw new ConfigError(
        `Unknown profile "${opts.profile}". ${known.length ? `Known: ${known.join(', ')}` : 'No profiles are configured.'}`,
      );
    }
    layers.push(parsePartial(profile, `profile "${opts.profile}"`));
  }

  if (opts.overrides) layers.push(opts.overrides as Record<string, unknown>);

  // The depth preset goes between the defaults and the layers, so explicit settings override it.
  const depth = depthOf(layers) ?? DEFAULT_CONFIG.review.depth;
  let merged = deepMerge(structuredClone(DEFAULT_CONFIG) as Record<string, unknown>, DEPTH_PRESETS[depth]);
  for (const layer of layers) merged = deepMerge(merged, layer);

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  const config = result.data;
  for (const [role, rc] of Object.entries(config.roles)) {
    if (rc && !config.providers[rc.provider]) {
      throw new ConfigError(
        `Role "${role}" references unknown provider "${rc.provider}". Known providers: ${Object.keys(config.providers).join(', ')}`,
      );
    }
  }
  return { config, sources, profile: opts.profile };
}

/** The highest-priority `review.depth` among the layers. */
function depthOf(layers: Array<Record<string, unknown>>): ReviewDepth | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const depth = (layers[i]!.review as { depth?: ReviewDepth } | undefined)?.depth;
    if (depth) return depth;
  }
  return undefined;
}

/**
 * The project config for `cwd`: searched from `cwd` up to `stopDir` (the repository root); without a
 * repository only `cwd` itself is checked (walking up would reach unrelated directories such as $HOME).
 * A file inside the global config directory is never taken for a project config.
 */
export function findProjectConfig(cwd: string, stopDir?: string): string | undefined {
  let dir = path.resolve(cwd);
  const stop = stopDir ? path.resolve(stopDir) : dir;
  const globalDir = globalConfigDir();
  for (;;) {
    const found = findFirst(dir, PROJECT_CONFIG_FILES);
    if (found && !isInsideDir(globalDir, found)) return found;
    // the repository root (compared through realpaths too) ends the search
    if (dir === stop || isInsideDir(dir, stop) || !isInsideDir(stop, dir)) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function findFirst(dir: string, names: string[]): string | undefined {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Config files are data only (YAML/JSON): nothing from the repository under review is executed. */
async function readPartial(file: string): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    // YAML is a superset of JSON, so one parser handles .json, .yaml and extension-less rc files.
    raw = YAML.parse(await readFile(file, 'utf8')) ?? {};
  } catch (err) {
    throw new ConfigError(`Failed to parse ${file}: ${(err as Error).message}`);
  }
  return parsePartial(raw, file);
}

const LAUNCH_FIELDS = ['command', 'args', 'env'] as const;

/**
 * The project config comes from the checkout being reviewed, which may be an untrusted branch.
 * It may choose providers and models, but not what program gets launched.
 */
function assertNoLaunchFields(partial: Record<string, unknown>, file: string): void {
  const globalPath = path.join(globalConfigDir(), 'config.yaml');
  const layers: Array<[string, Record<string, unknown>]> = [['', partial]];
  for (const [name, profile] of Object.entries((partial.profiles ?? {}) as Record<string, unknown>)) {
    if (profile && typeof profile === 'object')
      layers.push([`profiles.${name}.`, profile as Record<string, unknown>]);
  }
  for (const [prefix, layer] of layers) {
    // Fallback chains decide where the code is sent; opt-in analyzers execute repository code/configs.
    if (layer.models !== undefined) {
      throw new ConfigError(
        `${file}: ${prefix}models is not allowed in a project config — model fallbacks decide where your code is sent. Put them in ${globalPath}.`,
      );
    }
    const analyzers = layer.analyzers as { project?: unknown[] } | undefined;
    if (analyzers?.project?.length) {
      throw new ConfigError(
        `${file}: ${prefix}analyzers.project is not allowed in a project config — those analyzers run repository code. Enable them in ${globalPath} or with --analyzers.`,
      );
    }
    // A forge API URL receives the user's access token (GITHUB_TOKEN / GITLAB_TOKEN).
    const publish = layer.publish as Record<string, unknown> | undefined;
    const urlKey = PUBLISH_URL_KEYS.find((k) => publish?.[k] !== undefined);
    if (urlKey) {
      throw new ConfigError(
        `${file}: ${prefix}publish.${urlKey} is not allowed in a project config — it decides where your access token is sent. Put it in ${globalPath} or pass --api-url.`,
      );
    }
  }
  const providerSets: Array<[string, unknown]> = layers.map(([prefix, layer]) => [
    `${prefix}providers`,
    layer.providers,
  ]);
  for (const [where, providers] of providerSets) {
    for (const [id, cfg] of Object.entries((providers ?? {}) as Record<string, Record<string, unknown>>)) {
      const field = LAUNCH_FIELDS.find((f) => cfg && cfg[f] !== undefined);
      if (field) {
        throw new ConfigError(
          `${file}: ${where}.${id}.${field} is not allowed in a project config — it would let the reviewed repository choose which program to run. Put launch settings in ${globalPath}.`,
        );
      }
    }
  }
}

/**
 * Globs of a project config (it comes from the checkout under review) must compile to cheap regexes:
 * `review.exclude`, `project.ignore` and `git.base.rules[].match`, also inside profiles.
 */
function assertSafeGlobs(partial: Record<string, unknown>, file: string): void {
  const layers: Array<[string, Record<string, unknown>]> = [['', partial]];
  for (const [name, profile] of Object.entries((partial.profiles ?? {}) as Record<string, unknown>)) {
    if (profile && typeof profile === 'object')
      layers.push([`profiles.${name}.`, profile as Record<string, unknown>]);
  }
  for (const [prefix, layer] of layers) {
    const review = layer.review as { exclude?: unknown } | undefined;
    const project = layer.project as { ignore?: unknown } | undefined;
    const rules = ((layer.git as { base?: { rules?: unknown } } | undefined)?.base?.rules ?? []) as unknown[];
    const lists: Array<[string, unknown]> = [
      [`${prefix}review.exclude`, review?.exclude],
      [`${prefix}project.ignore`, project?.ignore],
      ...rules.map((r, i): [string, unknown] => [
        `${prefix}git.base.rules[${i}].match`,
        (r as { match?: unknown })?.match,
      ]),
    ];
    for (const [where, value] of lists) {
      for (const glob of typeof value === 'string' ? [value] : Array.isArray(value) ? value : []) {
        const reason = typeof glob === 'string' ? unsafeGlobReason(glob) : undefined;
        if (reason)
          throw new ConfigError(`${file}: ${where}: glob ${JSON.stringify(glob)} is not allowed: ${reason}.`);
      }
    }
  }
}

function parsePartial(raw: unknown, origin: string): Record<string, unknown> {
  const result = PartialConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration in ${origin}:\n${z.prettifyError(result.error)}`);
  }
  return result.data as Record<string, unknown>;
}

/** Deep merge for plain objects; arrays and scalars from `over` replace `base`; undefined is ignored. */
export function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
