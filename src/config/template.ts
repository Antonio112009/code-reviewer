import YAML, { Document, isMap, isScalar, type Pair, type Scalar, type YAMLMap } from 'yaml';
import { z } from 'zod';
import { ConfigError, deepMerge } from './load';
import {
  type Config,
  ConfigSchema,
  DEFAULT_CONFIG,
  type PartialConfig,
  PartialConfigSchema,
  PUBLISH_URL_KEYS,
} from './schema';

/** Where a config file lives: in the repository (`.code-reviewer/config.yaml`) or in the user's home. */
export type ConfigScope = 'project' | 'global';

/** How the global config is referred to in generated comments (never the real home path: files get committed). */
export const GLOBAL_CONFIG_HINT = '~/.code-reviewer/config.yaml';

interface KeyDoc {
  /** One comment line placed above the key. */
  doc: string;
  /** Commented-out example shown when the key is not set. Must be a valid value for the key. */
  example?: unknown;
  /** Example used in the global config instead of `example`. */
  globalExample?: unknown;
  /** Only documented / exemplified in this scope. */
  scope?: ConfigScope;
  /** Docs of a nested map's keys (e.g. `git.base`). */
  keys?: Record<string, KeyDoc>;
}

interface SectionDoc {
  /** 1–2 lines explaining the section. */
  doc: string[];
  /** Extra lines for one scope (e.g. pointers to the global config). */
  notes?: Partial<Record<ConfigScope, string[]>>;
  /** Section allowed only in this scope. */
  scope?: ConfigScope;
  keys: Record<string, KeyDoc>;
}

export type SectionKey = keyof PartialConfig;

const D = DEFAULT_CONFIG;

/** Section docs in the order sections are written. */
const SECTIONS: ReadonlyArray<readonly [SectionKey, SectionDoc]> = [
  [
    'project',
    {
      doc: [
        'Project context for reviewers. It is added to every review prompt, so keep it short and factual.',
      ],
      keys: {
        name: { doc: 'Project name (shown in reports).', example: 'my-service' },
        description: {
          doc: 'What the project does and which parts are critical (1–3 sentences).',
          example: 'Payments API (Node.js + PostgreSQL). Refund and ledger code is critical.',
        },
        focus: {
          doc: 'Areas to emphasise: security, correctness, performance, concurrency, data integrity, API contracts, tests.',
          example: ['security', 'correctness'],
        },
        instructions: {
          doc: 'Extra instructions in plain language: invariants, known pitfalls, what not to report.',
          example:
            'Money amounts are integer cents: flag float arithmetic on them.\nDo not report TODO comments.',
        },
        ignore: {
          doc: 'Extra globs never to review (added to review.exclude).',
          example: ['**/fixtures/**', 'legacy/**'],
        },
      },
    },
  ],
  [
    'providers',
    {
      doc: [
        'Provider settings. ACP agents (claude, codex, copilot, gemini) use their own CLI login; bedrock uses AWS credentials.',
      ],
      notes: {
        project: [`Launch settings (command/args/env) are only accepted in ${GLOBAL_CONFIG_HINT}.`],
        global: [
          'Launch overrides (command/args/env) and custom agents are allowed here, never in project configs.',
        ],
      },
      keys: {
        bedrock: {
          doc: 'AWS Bedrock. Region and profile default to AWS_REGION / AWS_PROFILE.',
          example: { type: 'bedrock', region: 'us-east-1' },
          globalExample: { type: 'bedrock', region: 'us-east-1', profile: 'my-sso-profile' },
        },
        claude: {
          doc: 'Claude Code over ACP. defaultModel / critiqueModel apply when a role sets no model.',
          example: { type: 'acp', preset: 'claude', defaultModel: 'sonnet', critiqueModel: 'opus' },
        },
        anthropic: {
          doc: 'The Anthropic API directly (ANTHROPIC_API_KEY): no agent overhead per task, cheaper in CI.',
          example: { type: 'anthropic', defaultModel: 'claude-sonnet-5', critiqueModel: 'claude-opus-5-5' },
        },
        'my-agent': {
          doc: 'Any other ACP agent, launched with your own command.',
          scope: 'global',
          example: { type: 'acp', preset: 'custom', command: 'my-agent', args: ['--acp'] },
        },
      },
    },
  ],
  [
    'roles',
    {
      doc: [
        'Which provider and model runs each role (provider ids: `code-reviewer providers`).',
        'reasoning: none | low | medium | high.',
      ],
      notes: {
        project: [
          `Model fallbacks (\`models\`) are set in ${GLOBAL_CONFIG_HINT}: they decide where code is sent.`,
        ],
      },
      keys: {
        review: {
          doc: 'Finds the issues. Omit model for the provider default (claude: sonnet); reasoning defaults to medium.',
          example: { provider: 'claude', model: 'opus', reasoning: 'high' },
        },
        critique: {
          doc: "Self-critique pass that drops false positives. Unset: the review provider's critiqueModel (claude: opus), high reasoning.",
          example: { provider: 'codex', reasoning: 'high' },
        },
        summary: {
          doc: 'Writes the run summary when review.summary is on. Unset: the review model.',
          example: { provider: 'claude', model: 'haiku', reasoning: 'low' },
        },
      },
    },
  ],
  [
    'review',
    {
      doc: ['How the review runs. Only findings with confidence >= minConfidence are reported.'],
      keys: {
        depth: {
          doc: 'essential = serious production issues only (security, data loss, crashes, leaks/OOM, overload, costly performance; fewer tokens); full = every real defect. Also sets the defaults of minSeverity, skillTokenBudget, maxSteps and contextShare.',
          example: D.review.depth,
        },
        minSeverity: {
          doc: 'Drop findings below this severity: critical | major | minor | info (depth default).',
        },
        selfCritique: {
          doc: 'Second pass that re-checks every finding and drops false positives (recommended).',
          example: D.review.selfCritique,
        },
        minConfidence: {
          doc: 'Drop findings below this confidence (0–1). Lower means more findings and more noise.',
          example: D.review.minConfidence,
        },
        concurrency: { doc: 'Review tasks running in parallel.', example: D.review.concurrency },
        dependencySources: {
          doc: 'Let the model read installed dependency sources (Go module cache, node_modules, virtualenv, Cargo), read-only.',
          example: D.review.dependencySources,
        },
        activeExtension: {
          doc: 'Extra time a review task gets while the model keeps calling tools, as a share of its timeout (0 = off).',
          example: D.review.activeExtension,
        },
        maxCost: {
          doc: 'Most a run may spend, in USD (priced by `pricing` or reported by the provider). Unset = no limit.',
        },
        timeout: {
          doc: 'Per-task timeout: auto (scales with the chunk size) or a number of seconds.',
          example: D.review.timeout,
        },
        maxTimeoutMs: { doc: 'Upper bound for any task timeout (ms).' },
        stallTimeoutMs: { doc: 'Cancel a task when the agent sends no update for this long (ms).' },
        chunking: {
          doc: 'smart groups related files (imports, tests, co-change); directory packs by folder.',
          example: D.review.chunking,
        },
        maxChunkTokens: { doc: 'Most tokens of code in one review task.', example: D.review.maxChunkTokens },
        maxChunks: { doc: 'Warn when a review needs more chunks than this (nothing is dropped).' },
        contextShare: { doc: 'Share of a chunk that may hold read-only excerpts of related files (0–0.5).' },
        advisoryConfidence: {
          doc: 'Findings kept below this confidence, and info findings, go to a separate "worth a look" list: in the reports, not in PR comments, SARIF/Code Quality or --fail-on (full depth: 0.6).',
        },
        passes: {
          doc: 'Passes per chunk: [general] (one review), or [local, contracts]: the changed lines, then the changed declarations and their consumers (about twice the cost).',
          example: D.review.passes,
        },
        expand: {
          doc: 'Related unchanged code per chunk: off; refs = usages of the changed declarations and definitions the new code calls; deep = also the callers of those usages.',
          example: D.review.expand,
        },
        fullFileTokens: { doc: 'Files smaller than this (tokens) are attached in full next to their diff.' },
        contextLines: { doc: 'Context lines around hunks when the full file is not attached.' },
        skills: {
          doc: 'Checklists injected per chunk: auto (picked from the detected stack), none, or a list of skill ids.',
          example: D.review.skills,
        },
        skillsExclude: { doc: 'Skill ids never to inject (see `code-reviewer skills`).', example: [] },
        skillTokenBudget: { doc: 'Token budget for injected skills per chunk.' },
        tools: {
          doc: 'Let reviewers read other files and search the repository (read-only).',
          example: D.review.tools,
        },
        projectRules: {
          doc: 'Give reviewers the repository rule files (CLAUDE.md, AGENTS.md, .cursorrules, REVIEW.md, …).',
          example: D.review.projectRules,
        },
        authors: { doc: 'Attribute findings to commit authors (git blame).', example: D.review.authors },
        isolation: {
          doc: 'auto: isolated snapshot for agents, in place for API providers on a clean checkout; always: always a snapshot.',
          example: D.review.isolation,
        },
        maxSteps: { doc: 'Most tool-use steps per task (API providers).' },
        summary: { doc: 'Write a short summary of the whole run.', example: D.review.summary },
        exclude: {
          doc: 'Globs never reviewed. Replaces the built-in list (lock files, builds, images); prefer project.ignore.',
        },
      },
    },
  ],
  [
    'git',
    {
      doc: ['Which branch your changes are compared with, and how it is fetched.'],
      keys: {
        remote: {
          doc: 'Remote to compare against: auto = the upstream remote of the current branch, else origin.',
          example: D.git.remote,
        },
        fetch: {
          doc: 'auto = fetch the base before reviewing (skipped offline); always | never.',
          example: D.git.fetch,
        },
        fetchTimeoutMs: { doc: 'Give up fetching after this long and use the cached ref (ms).' },
        maxDeepen: { doc: 'Commits a shallow clone may be deepened to find the merge-base.' },
        headSource: {
          doc: 'local = your branch including unpushed commits; remote = its remote-tracking ref.',
          example: D.git.headSource,
        },
        base: {
          doc: 'Base branch selection.',
          example: { default: D.git.base.default },
          keys: {
            default: {
              doc: 'auto = CI variables, then the open PR/MR, then the rules below, then the default branch; or a branch name.',
              example: D.git.base.default,
            },
            useCi: {
              doc: 'Read the target branch from CI variables (GitHub Actions, GitLab, Azure DevOps, Bitbucket).',
              example: D.git.base.useCi,
            },
            useForge: {
              doc: 'Ask gh / glab for the open PR/MR of the current branch.',
              example: D.git.base.useForge,
            },
            rules: {
              doc: 'Head-branch globs -> candidate bases; the nearest existing ancestor wins. Replaces the built-in rules.',
              example: [
                { match: ['feature/**', 'fix/**'], base: ['develop', 'main'] },
                { match: 'release/**', base: ['main'] },
              ],
            },
          },
        },
      },
    },
  ],
  [
    'analyzers',
    {
      doc: [
        'Static analyzers run before the review; their hits are given to reviewers as hints.',
        'builtin and external analyzers never execute repository code.',
      ],
      notes: {
        project: [
          `analyzers.project (eslint, tsc, … run repository code) can only be enabled in ${GLOBAL_CONFIG_HINT} or with --analyzers.`,
        ],
      },
      keys: {
        builtin: { doc: 'Bundled secret scanning and bug-pattern rules.', example: D.analyzers.builtin },
        external: {
          doc: 'auto = use safe tools found on PATH (gitleaks, shellcheck, hadolint, ruff --isolated, …); off.',
          example: D.analyzers.external,
        },
        project: {
          doc: 'Opt-in analyzers that may execute repository code or configs (eslint, tsc, golangci-lint, phpstan, osv-scanner).',
          scope: 'global',
          example: ['eslint', 'tsc'],
        },
        disabled: { doc: 'Analyzer ids to skip.', example: [] },
        timeoutMs: { doc: 'Per-analyzer timeout (ms).', example: D.analyzers.timeoutMs },
        maxHintsPerChunk: {
          doc: 'Most analyzer hints given to one review task.',
          example: D.analyzers.maxHintsPerChunk,
        },
      },
    },
  ],
  [
    'models',
    {
      doc: [
        'What happens when a configured model is unavailable. Global config only: fallbacks decide where code is sent.',
      ],
      scope: 'global',
      keys: {
        onUnavailable: {
          doc: 'ask (interactive terminals; otherwise fail) | fallback (use the list below) | fail.',
          example: D.models.onUnavailable,
        },
        fallbacks: {
          doc: '"provider:model" -> alternatives tried in order.',
          example: { 'claude:opus': ['claude:sonnet', 'codex:gpt-5-codex'] },
        },
        allowCrossProvider: {
          doc: 'Allow falling back to another provider (e.g. Claude -> Codex).',
          example: D.models.allowCrossProvider,
        },
      },
    },
  ],
  [
    'ui',
    {
      doc: [
        'Terminal output: live dashboard or plain lines, and clickable file links.',
        'mode: auto | live | plain; hyperlinks: auto | file | vscode | off.',
      ],
      keys: {
        mode: {
          doc: 'auto = live dashboard on a TTY, plain lines in CI and pipes; live | plain.',
          example: D.ui.mode,
        },
        hyperlinks: { doc: 'Clickable file links: auto | file | vscode | off.', example: D.ui.hyperlinks },
      },
    },
  ],
  [
    'output',
    {
      doc: ['Reports written for every run.'],
      keys: {
        formats: {
          doc: 'Any of md, json, html, sarif (GitHub code scanning), codequality (GitLab).',
          example: D.output.formats,
        },
        dir: {
          doc: 'Runs directory, relative to the repository root. Keep it in .gitignore.',
          example: D.output.dir,
        },
      },
    },
  ],
  [
    'cache',
    {
      doc: [
        'Reuses model answers for chunks and findings whose code (and every file the model read) is unchanged.',
        'Entries are signed with a key in the global config directory. `--no-cache` skips the cache for a run.',
      ],
      notes: {
        project: [`cache.dir decides where files are written: set it in ${GLOBAL_CONFIG_HINT}.`],
      },
      keys: {
        enabled: { doc: 'Use the cache.', example: D.cache.enabled },
        dir: {
          doc: 'An absolute directory, or `project` for .code-reviewer/cache (default: the OS cache directory).',
          scope: 'global',
          example: '/var/cache/code-reviewer',
        },
        maxAgeDays: { doc: 'Remove entries unused for this many days.', example: D.cache.maxAgeDays },
        maxSizeMb: {
          doc: 'Remove the least recently used entries above this size.',
          example: D.cache.maxSizeMb,
        },
      },
    },
  ],
  [
    'pricing',
    {
      doc: [
        'Prices for the cost of a run when the provider reports none (Claude Code reports its own). Keys:',
        '"provider:model", "model" or "provider"; per million tokens, or per model request (Copilot). Example values only.',
      ],
      keys: {
        'bedrock:global.anthropic.claude-sonnet-4-5': {
          doc: 'USD per million tokens (set `currency` for another one).',
          example: { input: 3, cachedInput: 0.3, output: 15 },
        },
        copilot: { doc: 'Per request (a premium request).', example: { request: 0.04 } },
      },
    },
  ],
  [
    'publish',
    {
      doc: [
        'Review comments on GitHub pull requests / GitLab merge requests (`review --post`, `runs publish`).',
        'Tokens: GITHUB_TOKEN or GH_TOKEN; GITLAB_TOKEN (api scope). See docs/ci.md.',
      ],
      notes: {
        project: [
          `API URLs (githubApiUrl, gitlabApiUrl) receive your access token: set them in ${GLOBAL_CONFIG_HINT}.`,
        ],
      },
      keys: {
        maxInlineComments: {
          doc: 'Most inline comments per run; the rest are listed in the summary comment.',
          example: D.publish.maxInlineComments,
        },
        minSeverity: {
          doc: 'Comment inline only on findings of this severity or worse (critical | major | minor | info).',
          example: D.publish.minSeverity,
        },
        resolveFixed: {
          doc: 'Resolve the threads of earlier comments whose code changed and whose finding the new review did not report again.',
          example: D.publish.resolveFixed,
        },
        githubApiUrl: {
          doc: 'GitHub Enterprise Server API. Your token is sent here.',
          scope: 'global',
          example: 'https://github.example.com/api/v3',
        },
        gitlabApiUrl: {
          doc: 'Self-managed GitLab API. Your token is sent here.',
          scope: 'global',
          example: 'https://gitlab.example.com/api/v4',
        },
      },
    },
  ],
  [
    'profiles',
    {
      doc: [
        'Named overrides applied with `code-reviewer --profile <name>`; they take the same keys as this file.',
      ],
      keys: {
        strict: { doc: 'Fewer, surer findings.', example: { review: { minConfidence: 0.8 } } },
        audit: { doc: 'Everything, before a release.', example: { review: { depth: 'full' } } },
        quick: {
          doc: 'Fast pass without self-critique.',
          example: { review: { selfCritique: false }, roles: { review: { reasoning: 'low' } } },
        },
      },
    },
  ],
];

const SECTION_BY_KEY = new Map<string, SectionDoc>(SECTIONS);

/** Top-level sections in the order they are written. */
export const SECTION_ORDER: readonly SectionKey[] = SECTIONS.map(([key]) => key);

const HEADER: Record<ConfigScope, string[]> = {
  project: [
    'code-reviewer project configuration (created by `code-reviewer init`).',
    'Every key is optional: anything unset uses the built-in defaults, and `code-reviewer config show`',
    'prints the effective configuration. Commented-out lines are examples of further options.',
    '#',
    'This file is read from the checkout under review, so it cannot choose programs to run or where code',
    'or tokens are sent: provider command/args/env, `models`, `analyzers.project` and publish API URLs',
    `belong in ${GLOBAL_CONFIG_HINT}.`,
  ],
  global: [
    `code-reviewer global configuration (${GLOBAL_CONFIG_HINT}, or $CODE_REVIEWER_HOME/config.yaml).`,
    'Applies to every repository; a repository .code-reviewer/config.yaml overrides it key by key.',
    'Every key is optional. Commented-out lines are examples of further options.',
  ],
};

const TO_STRING = { lineWidth: 0, flowCollectionPadding: false } as const;

/** Plain strings that YAML 1.1 tools would read as booleans or null. */
const AMBIGUOUS_SCALAR = /^(?:y|n|yes|no|on|off|true|false|null|~)$/i;

/** Scalar sequences shorter than this are written in flow style (`[a, b]`). */
const FLOW_SEQ_MAX = 72;

export interface RenderConfigOptions {
  /** `project` (default) writes the safety note and refuses keys a project config may not contain. */
  scope?: ConfigScope;
}

/**
 * Renders `config` as a commented YAML document: a header, 1–2 comment lines per section and per key,
 * commented-out examples for keys (and whole sections) that are not set. The output parses back to
 * exactly `config`. Throws when a project-scope config contains keys the loader rejects there.
 */
export function renderConfigTemplate(config: PartialConfig, opts: RenderConfigOptions = {}): string {
  const scope = opts.scope ?? 'project';
  if (scope === 'project') {
    const violations = projectConfigViolations(config);
    if (violations.length) {
      throw new ConfigError(
        `Not allowed in a project config: ${violations.join(', ')}. Put these in ${GLOBAL_CONFIG_HINT}.`,
      );
    }
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stripUndefined(config) as Record<string, unknown>)) {
    // An empty section would render as `{}`; leave it out so its commented example is shown instead.
    if (!isPlainObject(value) || Object.keys(value).length) clean[key] = value;
  }
  const ordered: Record<string, unknown> = {};
  for (const key of SECTION_ORDER) {
    const section = SECTION_BY_KEY.get(key)!;
    if (clean[key] !== undefined) ordered[key] = orderKeys(clean[key], section.keys);
  }
  for (const [key, value] of Object.entries(clean)) if (!(key in ordered)) ordered[key] = value;

  const doc = new Document(ordered);
  styleNodes(doc);
  doc.commentBefore = toComment(HEADER[scope]);
  const root = doc.contents as YAMLMap | null;
  const pairs = new Map((root && isMap(root) ? root.items : []).map((pair) => [keyName(pair), pair]));

  let pending: string[] = [];
  let first = true;
  for (const [key, section] of SECTIONS) {
    if (section.scope && section.scope !== scope) continue;
    const docLines = [...section.doc, ...(section.notes?.[scope] ?? [])];
    const pair = pairs.get(key);
    if (!pair) {
      const example = exampleOf(section.keys, scope);
      if (Object.keys(example).length) pending.push(...docLines, ...yamlLines({ [key]: example }), '');
      continue;
    }
    const keyNode = pair.key as Scalar;
    keyNode.commentBefore = toComment([...pending, ...docLines]);
    if (!first) keyNode.spaceBefore = true;
    first = false;
    pending = [];
    if (isMap(pair.value)) decorateMap(pair.value, section.keys, scope);
  }
  while (pending.at(-1) === '') pending.pop();
  if (pending.length) doc.comment = toComment(pending);
  return doc.toString(TO_STRING);
}

/**
 * Every commented-out example of `scope` merged into one config — uncommenting any example in a generated
 * file must still give a valid config (tests load this through `loadConfig`).
 */
export function templateExamples(scope: ConfigScope): PartialConfig {
  const out: Record<string, unknown> = {};
  for (const [key, section] of SECTIONS) {
    if (section.scope && section.scope !== scope) continue;
    const example = exampleOf(section.keys, scope);
    if (Object.keys(example).length) out[key] = example;
  }
  return out as PartialConfig;
}

/**
 * Paths a project config may not contain (the loader rejects them): launch settings, fallbacks, project
 * analyzers, forge API URLs.
 */
export function projectConfigViolations(config: PartialConfig): string[] {
  const out: string[] = [];
  const layers: Array<[string, Record<string, unknown>]> = [['', config as Record<string, unknown>]];
  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    if (isPlainObject(profile)) layers.push([`profiles.${name}.`, profile]);
  }
  for (const [prefix, layer] of layers) {
    if (layer.models !== undefined) out.push(`${prefix}models`);
    const analyzers = layer.analyzers as { project?: unknown[] } | undefined;
    if (analyzers?.project?.length) out.push(`${prefix}analyzers.project`);
    const publish = isPlainObject(layer.publish) ? layer.publish : {};
    for (const key of PUBLISH_URL_KEYS) if (publish[key] !== undefined) out.push(`${prefix}publish.${key}`);
    if (isPlainObject(layer.cache) && layer.cache.dir !== undefined) out.push(`${prefix}cache.dir`);
    const providers = isPlainObject(layer.providers) ? layer.providers : {};
    for (const [id, cfg] of Object.entries(providers)) {
      for (const field of ['command', 'args', 'env']) {
        if (isPlainObject(cfg) && cfg[field] !== undefined) out.push(`${prefix}providers.${id}.${field}`);
      }
    }
  }
  return out;
}

/**
 * Checks generated YAML the way the loader will: schema, project-scope restrictions, and that the merged
 * result is a complete config whose roles reference known providers (`base` supplies providers defined
 * elsewhere, e.g. in the global config). Returns the parsed partial config.
 */
export function validateRenderedConfig(
  text: string,
  scope: ConfigScope,
  base: Config = DEFAULT_CONFIG,
): PartialConfig {
  let raw: unknown;
  try {
    raw = YAML.parse(text) ?? {};
  } catch (err) {
    throw new ConfigError(`Generated config does not parse: ${(err as Error).message}`);
  }
  const partial = PartialConfigSchema.safeParse(raw);
  if (!partial.success) {
    throw new ConfigError(`Generated config is invalid:\n${z.prettifyError(partial.error)}`);
  }
  if (scope === 'project') {
    const violations = projectConfigViolations(partial.data);
    if (violations.length) throw new ConfigError(`Not allowed in a project config: ${violations.join(', ')}`);
  }
  const merged = ConfigSchema.safeParse(
    deepMerge(structuredClone(base) as Record<string, unknown>, partial.data as Record<string, unknown>),
  );
  if (!merged.success) {
    throw new ConfigError(`Generated config is invalid:\n${z.prettifyError(merged.error)}`);
  }
  for (const [role, rc] of Object.entries(merged.data.roles)) {
    if (rc && !merged.data.providers[rc.provider]) {
      throw new ConfigError(`Role "${role}" references unknown provider "${rc.provider}".`);
    }
  }
  return partial.data;
}

// ---------------------------------------------------------------------------------------------------------

function decorateMap(map: YAMLMap, keys: Record<string, KeyDoc>, scope: ConfigScope): void {
  const present = new Set<string>();
  for (const pair of map.items) {
    const name = keyName(pair);
    present.add(name);
    const kd = keys[name];
    if (!kd || !inScope(kd, scope)) continue;
    if (isScalar(pair.key)) pair.key.commentBefore = toComment([kd.doc]);
    if (kd.keys && isMap(pair.value)) decorateMap(pair.value, kd.keys, scope);
  }
  const examples: string[] = [];
  let previousLines = 0;
  for (const [name, kd] of Object.entries(keys)) {
    if (present.has(name) || !inScope(kd, scope)) continue;
    const example = exampleValue(kd, scope);
    if (example === undefined) continue;
    const lines = yamlLines({ [name]: example });
    // Multi-line examples get a blank line around them so each reads as one block.
    if (examples.length && (previousLines > 1 || lines.length > 1)) examples.push('');
    examples.push(kd.doc, ...lines);
    previousLines = lines.length;
  }
  if (examples.length && !map.flow) map.comment = `\n${toComment(examples)}`;
}

function exampleOf(keys: Record<string, KeyDoc>, scope: ConfigScope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, kd] of Object.entries(keys)) {
    if (!inScope(kd, scope)) continue;
    const example = exampleValue(kd, scope);
    if (example !== undefined) out[name] = example;
  }
  return out;
}

function exampleValue(kd: KeyDoc, scope: ConfigScope): unknown {
  const own = scope === 'global' && kd.globalExample !== undefined ? kd.globalExample : kd.example;
  if (!kd.keys) return own;
  const nested = exampleOf(kd.keys, scope);
  if (own === undefined && !Object.keys(nested).length) return undefined;
  return { ...(isPlainObject(own) ? own : {}), ...nested };
}

function inScope(kd: KeyDoc, scope: ConfigScope): boolean {
  return !kd.scope || kd.scope === scope;
}

/** YAML lines for a small value (examples), styled like the main document. */
function yamlLines(value: Record<string, unknown>): string[] {
  const doc = new Document(value);
  styleNodes(doc);
  return doc.toString(TO_STRING).replace(/\n+$/, '').split('\n');
}

/**
 * Comment text for the yaml library: every line gets "# ", a lone "#" stays a bare "#" line and an empty
 * string becomes a blank line.
 */
function toComment(lines: string[]): string {
  return lines.map((line) => (line === '#' ? ' ' : line === '' ? '' : ` ${line}`)).join('\n');
}

/** Short scalar lists in flow style; strings YAML 1.1 would read as booleans are quoted. */
function styleNodes(doc: Document): void {
  YAML.visit(doc, {
    Seq(_key, seq) {
      if (!seq.items.length || !seq.items.every((item) => isScalar(item))) return;
      const width = seq.items.reduce((sum, item) => sum + String((item as Scalar).value).length + 2, 2);
      if (width <= FLOW_SEQ_MAX) seq.flow = true;
    },
    Scalar(key, node) {
      if (key !== 'key' && typeof node.value === 'string' && AMBIGUOUS_SCALAR.test(node.value)) {
        node.type = 'QUOTE_SINGLE';
      }
    },
  });
}

function keyName(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

/** Documented keys first (in doc order), then the rest; recurses into documented nested maps. */
function orderKeys(value: unknown, keys: Record<string, KeyDoc>): unknown {
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, kd] of Object.entries(keys)) {
    if (value[name] !== undefined) out[name] = kd.keys ? orderKeys(value[name], kd.keys) : value[name];
  }
  for (const [name, v] of Object.entries(value)) if (!(name in out)) out[name] = v;
  return out;
}

/** Drops undefined values (they would otherwise render as `null` in sequences). */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v) ?? null);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v);
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
