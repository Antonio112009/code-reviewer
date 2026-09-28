import path from 'node:path';
import { z } from 'zod';
import { EXPAND_LEVELS, REASONING_LEVELS, REVIEW_PASSES, SEVERITIES } from '../types';

export const ACP_PRESETS = ['claude', 'codex', 'copilot', 'gemini', 'custom'] as const;
export type AcpPresetId = (typeof ACP_PRESETS)[number];

export const REPORT_FORMATS = ['md', 'json', 'html', 'sarif', 'codequality'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** AWS region names (us-east-1, eu-central-2, us-gov-west-1, ap-southeast-5, …). */
export const AWS_REGION_RE = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;

const BedrockProviderSchema = z.strictObject({
  type: z.literal('bedrock'),
  /** Validated: the region becomes part of the endpoint host that receives signed requests. */
  region: z.string().regex(AWS_REGION_RE, 'must be an AWS region name like us-east-1').optional(),
  /** AWS profile (SSO profiles work too). Falls back to the default credential chain. */
  profile: z.string().optional(),
  defaultModel: z.string().optional(),
  /** Model of the self-critique pass when the critique role names none (e.g. a stronger model than the review's). */
  critiqueModel: z.string().optional(),
});

const AcpProviderSchema = z.strictObject({
  type: z.literal('acp'),
  preset: z.enum(ACP_PRESETS),
  /** Override the launch command (required for preset `custom`). */
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  defaultModel: z.string().optional(),
  /** Model of the self-critique pass when the critique role names none (e.g. a stronger model than the review's). */
  critiqueModel: z.string().optional(),
});

/** The Anthropic API with `ANTHROPIC_API_KEY` (no agent in between: see `providers/anthropic.ts`). */
const AnthropicProviderSchema = z.strictObject({
  type: z.literal('anthropic'),
  defaultModel: z.string().optional(),
  /** Model of the self-critique pass when the critique role names none (e.g. a stronger model than the review's). */
  critiqueModel: z.string().optional(),
});

/** Environment variable names (`none`: a server without authentication, such as a local Ollama). */
const API_KEY_ENV_RE = /^(none|[A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * An OpenAI-compatible chat completions API — OpenAI, OpenRouter, Ollama, vLLM, LM Studio, LiteLLM, … (see
 * `providers/openai.ts`). `baseUrl` and `apiKeyEnv` decide where the code and which secret are sent, so a
 * project config may not set them (`config/load.ts`).
 */
const OpenAiProviderSchema = z.strictObject({
  type: z.literal('openai'),
  /** API base URL, e.g. `http://localhost:11434/v1` (default `https://api.openai.com/v1`). */
  baseUrl: z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' }).optional(),
  /** Environment variable holding the API key (default `OPENAI_API_KEY`); `none` for no authentication. */
  apiKeyEnv: z.string().regex(API_KEY_ENV_RE, 'must be an environment variable name or "none"').optional(),
  /**
   * Send the role's reasoning level as `reasoning_effort` (reasoning models such as GPT-5 or o3). Off by default:
   * models without reasoning, and some servers, reject the parameter.
   */
  reasoningEffort: z.boolean().optional(),
  defaultModel: z.string().optional(),
  /** Model of the self-critique pass when the critique role names none (e.g. a stronger model than the review's). */
  critiqueModel: z.string().optional(),
});

const MockProviderSchema = z.strictObject({
  type: z.literal('mock'),
  /** Path to a JSON file with canned `submit_findings` payloads keyed by file path. */
  fixture: z.string().optional(),
});

export const ProviderConfigSchema = z.discriminatedUnion('type', [
  BedrockProviderSchema,
  AnthropicProviderSchema,
  OpenAiProviderSchema,
  AcpProviderSchema,
  MockProviderSchema,
]);
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type BedrockProviderConfig = z.infer<typeof BedrockProviderSchema>;
export type AnthropicProviderConfig = z.infer<typeof AnthropicProviderSchema>;
export type OpenAiProviderConfig = z.infer<typeof OpenAiProviderSchema>;
export type AcpProviderConfig = z.infer<typeof AcpProviderSchema>;
export type MockProviderConfig = z.infer<typeof MockProviderSchema>;

/**
 * How deep a review goes:
 * - `essential` — only defects that can seriously hurt production (security, data loss, crashes, leaks/OOM,
 *   overload, costly performance); essential-tier skills, a smaller skill budget, fewer tool steps, less
 *   related context, critical/major findings only — fewer tokens;
 * - `full` — every real defect, including minor edge cases, accessibility and best practices with a
 *   concrete consequence; all skills.
 */
export const REVIEW_DEPTHS = ['essential', 'full'] as const;
export type ReviewDepth = (typeof REVIEW_DEPTHS)[number];

export const RoleConfigSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  reasoning: z.enum(REASONING_LEVELS).optional(),
  /** Model context window in tokens; used to size chunks. */
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

export const ReviewSettingsSchema = z.object({
  /** `essential` or `full`; also selects the defaults of the depth-dependent settings ({@link DEPTH_PRESETS}). */
  depth: z.enum(REVIEW_DEPTHS),
  selfCritique: z.boolean(),
  minConfidence: z.number().min(0).max(1),
  /**
   * Kept findings below this confidence, and every `info` finding, are listed apart as "worth a look": in the
   * reports, but not in pull request comments, SARIF / Code Quality or the `--fail-on` gate.
   */
  advisoryConfidence: z.number().min(0).max(1),
  /** Findings below this severity are dropped (static findings that cannot be rejected are kept). */
  minSeverity: z.enum(SEVERITIES),
  maxChunkTokens: z.number().int().positive(),
  /** Hard cap on the number of chunks (a warning is printed when exceeded; nothing is dropped). */
  maxChunks: z.number().int().positive(),
  concurrency: z.number().int().positive(),
  projectRules: z.boolean(),
  authors: z.boolean(),
  tools: z.boolean(),
  /** `auto`, `none`, or an explicit list of skill ids. */
  skills: z.union([z.enum(['auto', 'none']), z.array(z.string())]),
  /** Token budget reserved for injected skills per chunk. */
  skillTokenBudget: z.number().int().positive(),
  /** Files smaller than this (tokens) are attached in full next to their diff. */
  fullFileTokens: z.number().int().nonnegative(),
  /** Extra context lines around hunks when the full file is not attached. */
  contextLines: z.number().int().nonnegative(),
  /** Skill ids never to inject. */
  skillsExclude: z.array(z.string()),
  exclude: z.array(z.string()),
  /** Per-task timeout: `auto` scales with the chunk size, or a fixed number of seconds. */
  timeout: z.union([z.literal('auto'), z.number().positive()]),
  /** Upper bound for any task timeout. */
  maxTimeoutMs: z.number().int().positive(),
  /** Cancel a task when the agent sends no update for this long. */
  stallTimeoutMs: z.number().int().positive(),
  maxSteps: z.number().int().positive(),
  summary: z.boolean(),
  /** `smart` groups related files (imports, tests, co-change); `directory` packs by folder only. */
  chunking: z.enum(['smart', 'directory']),
  /** Share of a chunk's budget that may hold read-only excerpts of related files owned by other chunks. */
  contextShare: z.number().min(0).max(0.5),
  /**
   * Related unchanged code added to each chunk (`chunking/expand.ts`): `refs` = usages of the changed
   * declarations and definitions the new code calls; `deep` = also the callers of those usages.
   */
  expand: z.enum(EXPAND_LEVELS),
  /**
   * Passes per chunk: `general` reviews everything in one pass; `local` + `contracts` review the same code
   * twice, once for defects in the changed lines and once for the changed declarations and their consumers.
   */
  passes: z.array(z.enum(REVIEW_PASSES)).min(1),
  /**
   * Where agents read code: `auto` = isolated snapshot for ACP agents, in place for API providers when the
   * checkout is clean and at head; `always` = always an isolated snapshot.
   */
  isolation: z.enum(['auto', 'always']),
});
export type ReviewSettings = z.infer<typeof ReviewSettingsSchema>;

export const OutputSettingsSchema = z.object({
  formats: z.array(z.enum(REPORT_FORMATS)),
  /** Runs directory, relative to the repository root. */
  dir: z.string(),
});

export const ProjectSettingsSchema = z.object({
  name: z.string().optional(),
  /** What the project is; given to reviewers as context. */
  description: z.string().optional(),
  /** Areas to emphasise, e.g. security, performance, correctness, concurrency. */
  focus: z.array(z.string()).optional(),
  /** Extra review instructions in plain language. */
  instructions: z.string().optional(),
  /** Extra globs never to review (added to review.exclude). */
  ignore: z.array(z.string()).optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const BaseRuleSchema = z.object({
  /** Head branch glob(s), e.g. "feature/**". */
  match: z.union([z.string(), z.array(z.string())]),
  /** Candidate base branches in preference order; the nearest existing ancestor wins. */
  base: z.array(z.string()).min(1),
});

export const GitSettingsSchema = z.object({
  /** Remote to compare against: `auto` = upstream remote of the current branch, else origin. */
  remote: z.string(),
  /** `auto` fetches the base (and head upstream) before reviewing unless offline. */
  fetch: z.enum(['auto', 'always', 'never']),
  fetchTimeoutMs: z.number().int().positive(),
  /** How many commits a shallow clone may be deepened to find the merge-base. */
  maxDeepen: z.number().int().nonnegative(),
  /** `local` = review your branch including unpushed commits; `remote` = its remote-tracking ref. */
  headSource: z.enum(['local', 'remote']),
  base: z.object({
    /** `auto` or a branch name. */
    default: z.string(),
    /** Use CI variables (GitHub Actions, GitLab, Azure DevOps, Bitbucket). */
    useCi: z.boolean(),
    /** Ask gh / glab for the open PR/MR of the current branch. */
    useForge: z.boolean(),
    rules: z.array(BaseRuleSchema),
  }),
});
export type GitSettings = z.infer<typeof GitSettingsSchema>;

export const ANALYZER_TIERS = ['builtin', 'external', 'project'] as const;

export const AnalyzerSettingsSchema = z.object({
  /** Bundled analyzers (secret scanning, pattern rules). Never execute repository code. */
  builtin: z.boolean(),
  /** Safe external tools found on PATH (gitleaks, shellcheck, hadolint, ruff --isolated, …). */
  external: z.enum(['auto', 'off']),
  /** Opt-in analyzers that may execute repository code/configs (eslint, tsc, golangci-lint, phpstan, osv-scanner). */
  project: z.array(z.string()),
  /** Analyzer ids to skip. */
  disabled: z.array(z.string()),
  timeoutMs: z.number().int().positive(),
  maxHintsPerChunk: z.number().int().nonnegative(),
});
export type AnalyzerSettings = z.infer<typeof AnalyzerSettingsSchema>;

export const ModelSettingsSchema = z.object({
  /** When a configured model is unavailable: ask (TTY only, else fail), use `fallbacks`, or fail. */
  onUnavailable: z.enum(['ask', 'fallback', 'fail']),
  /** "provider:model" → ordered alternatives ("provider:model"). Global config / CLI only. */
  fallbacks: z.record(z.string(), z.array(z.string())),
  /** Allow falling back to a different provider (e.g. Claude → Codex). */
  allowCrossProvider: z.boolean(),
});
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

export const UiSettingsSchema = z.object({
  /** `auto` = live dashboard on a TTY, plain lines in CI / pipes. */
  mode: z.enum(['auto', 'live', 'plain']),
  /** Clickable file links in the terminal. */
  hyperlinks: z.enum(['auto', 'file', 'vscode', 'off']),
});
export type UiSettings = z.infer<typeof UiSettingsSchema>;

/**
 * Price of a model, used for the cost of a run when the provider reports none. Token prices are per million
 * tokens; `request` is a price per model request (e.g. a Copilot premium request).
 */
export const PriceSchema = z.strictObject({
  input: z.number().nonnegative().optional(),
  /** Input tokens read from the prompt cache (default: the `input` price). */
  cachedInput: z.number().nonnegative().optional(),
  /** Input tokens written to the prompt cache (default: 1.25 × the `input` price, as Anthropic bills it). */
  cacheWrite: z.number().nonnegative().optional(),
  /** Output tokens, reasoning included. */
  output: z.number().nonnegative().optional(),
  request: z.number().nonnegative().optional(),
  /** ISO 4217 code (default USD). */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code like USD')
    .optional(),
});
export type Price = z.infer<typeof PriceSchema>;

/** An http(s) URL (fully checked where it is used: `publish/target.ts#validateApiUrl`). */
const ApiUrlSchema = z.string().regex(/^https?:\/\/\S+$/i, 'must be an http(s) URL');

/** Posting reviews to GitHub pull requests / GitLab merge requests (`review --post`, `runs publish`). */
export const PublishSettingsSchema = z.object({
  /** Most inline comments per run; the rest are listed in the summary comment. */
  maxInlineComments: z.number().int().nonnegative(),
  /** Findings below this severity are listed in the summary only, never commented inline. */
  minSeverity: z.enum(SEVERITIES),
  /**
   * Resolve the threads of earlier inline comments whose finding was fixed: the commented code changed and
   * the new review did not report it again (`publish/resolve.ts`).
   */
  resolveFixed: z.boolean(),
  /**
   * GitHub Enterprise Server API (e.g. https://github.example.com/api/v3) and self-managed GitLab API
   * (e.g. https://gitlab.example.com/api/v4). Your access token is sent there: global config / CLI only.
   */
  githubApiUrl: ApiUrlSchema.optional(),
  gitlabApiUrl: ApiUrlSchema.optional(),
});
export type PublishSettings = z.infer<typeof PublishSettingsSchema>;

/** `publish` keys that decide where an access token is sent: rejected in project configs. */
export const PUBLISH_URL_KEYS = ['githubApiUrl', 'gitlabApiUrl'] as const;

/** Reusing model answers for unchanged chunks and findings (`src/cache/`). */
export const CacheSettingsSchema = z.object({
  /** `--no-cache` turns it off for one run. */
  enabled: z.boolean(),
  /**
   * An absolute directory, or `project` for `.code-reviewer/cache` in the repository. Default: the platform's
   * cache directory. Global config only: a project config must not choose where files are written.
   */
  dir: z
    .string()
    .refine((v) => v === 'project' || path.isAbsolute(v), 'must be an absolute path or "project"')
    .optional(),
  /** Entries not used for this many days are removed (checked at most once a day). */
  maxAgeDays: z.number().int().positive(),
  /** Least recently used entries are removed above this size. */
  maxSizeMb: z.number().int().positive(),
});
export type CacheSettings = z.infer<typeof CacheSettingsSchema>;

const RolesSchema = z.object({
  review: RoleConfigSchema.optional(),
  critique: RoleConfigSchema.optional(),
  summary: RoleConfigSchema.optional(),
});

const ConfigBodySchema = z.object({
  project: ProjectSettingsSchema,
  providers: z.record(z.string(), ProviderConfigSchema),
  roles: RolesSchema,
  review: ReviewSettingsSchema,
  git: GitSettingsSchema,
  analyzers: AnalyzerSettingsSchema,
  models: ModelSettingsSchema,
  ui: UiSettingsSchema,
  output: OutputSettingsSchema,
  /** Prices by `provider:model`, `model` or `provider` (the most specific key wins). */
  pricing: z.record(z.string(), PriceSchema),
  publish: PublishSettingsSchema,
  cache: CacheSettingsSchema,
});

export const ConfigSchema = ConfigBodySchema.extend({
  profiles: z.record(z.string(), z.unknown()),
});
export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_EXCLUDES = [
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lock',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/uv.lock',
  '**/go.sum',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/dist/**',
  '**/build/**',
  '**/vendor/**',
  '**/node_modules/**',
  '**/__generated__/**',
  '**/*.generated.*',
  '**/*.pb.go',
  '**/*.svg',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.ico',
  '**/*.pdf',
  '**/*.woff',
  '**/*.woff2',
];

export const DEFAULT_CONFIG: Config = {
  project: {},
  providers: {
    // Sonnet is the everyday reviewer (cost/quality); pick Opus per run with `--model opus`.
    // Opus checks the findings: it drops the weak ones Sonnet's critique lets through, for ~17% more.
    claude: { type: 'acp', preset: 'claude', defaultModel: 'sonnet', critiqueModel: 'opus' },
    codex: { type: 'acp', preset: 'codex' },
    copilot: { type: 'acp', preset: 'copilot' },
    gemini: { type: 'acp', preset: 'gemini' },
    bedrock: { type: 'bedrock' },
    anthropic: { type: 'anthropic', defaultModel: 'claude-sonnet-5', critiqueModel: 'claude-opus-5-5' },
    // OpenAI-compatible APIs: no default model (pass --model or set roles.review.model / defaultModel).
    openai: { type: 'openai' },
    openrouter: { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
    ollama: { type: 'openai', baseUrl: 'http://localhost:11434/v1', apiKeyEnv: 'none' },
    mock: { type: 'mock' },
  },
  roles: {
    // No critique role by default: it runs on the review provider (its `critiqueModel`, high reasoning), so
    // code is never sent to a provider the user did not choose.
    // medium: on the eval corpus as good as high (also on the hard cases), with half the output tokens.
    review: { provider: 'claude', reasoning: 'medium' },
  },
  review: {
    // The depth-dependent values below are the `essential` preset (see DEPTH_PRESETS).
    depth: 'essential',
    selfCritique: true,
    minConfidence: 0.7,
    advisoryConfidence: 0,
    minSeverity: 'major',
    maxChunkTokens: 40_000,
    maxChunks: 60,
    concurrency: 3,
    projectRules: true,
    authors: false,
    tools: true,
    skills: 'auto',
    skillTokenBudget: 3_500,
    fullFileTokens: 3_000,
    contextLines: 30,
    skillsExclude: [],
    exclude: DEFAULT_EXCLUDES,
    timeout: 'auto',
    maxTimeoutMs: 15 * 60_000,
    stallTimeoutMs: 4 * 60_000,
    maxSteps: 15,
    summary: false,
    chunking: 'smart',
    contextShare: 0.1,
    expand: 'off',
    passes: ['general'],
    isolation: 'auto',
  },
  git: {
    remote: 'auto',
    fetch: 'auto',
    fetchTimeoutMs: 20_000,
    maxDeepen: 500,
    headSource: 'local',
    base: {
      default: 'auto',
      useCi: true,
      useForge: true,
      rules: [
        {
          match: ['feature/**', 'feat/**', 'bugfix/**', 'fix/**', 'chore/**'],
          base: ['develop', 'main', 'master'],
        },
        { match: 'develop', base: ['main', 'master'] },
        { match: ['release/**', 'hotfix/**'], base: ['main', 'master'] },
      ],
    },
  },
  analyzers: {
    builtin: true,
    external: 'auto',
    project: [],
    disabled: [],
    timeoutMs: 60_000,
    maxHintsPerChunk: 15,
  },
  models: {
    onUnavailable: 'ask',
    fallbacks: {},
    allowCrossProvider: true,
  },
  ui: {
    mode: 'auto',
    hyperlinks: 'auto',
  },
  output: {
    formats: ['md', 'json', 'html'],
    dir: '.code-reviewer/runs',
  },
  pricing: {},
  cache: {
    enabled: true,
    maxAgeDays: 30,
    maxSizeMb: 500,
  },
  publish: {
    maxInlineComments: 30,
    minSeverity: 'info',
    resolveFixed: true,
  },
  profiles: {},
};

/**
 * Defaults that depend on `review.depth`. They sit between the built-in defaults and every config file /
 * flag, so an explicit value (e.g. `review.skillTokenBudget: 8000`) always wins over the preset.
 */
export const DEPTH_PRESETS: Record<ReviewDepth, { review: Partial<ReviewSettings> }> = {
  essential: { review: { minSeverity: 'major', skillTokenBudget: 3_500, maxSteps: 15, contextShare: 0.1 } },
  full: {
    review: {
      minSeverity: 'info',
      skillTokenBudget: 6_000,
      maxSteps: 25,
      contextShare: 0.2,
      // What the critic did not reject is kept from 0.3; below advisoryConfidence it is only "worth a look".
      minConfidence: 0.3,
      advisoryConfidence: 0.6,
    },
  },
};

/** Partial config as written by users (every level optional). */
export const PartialConfigSchema = z
  .object({
    project: ProjectSettingsSchema.partial().strict().optional(),
    providers: z.record(z.string(), ProviderConfigSchema).optional(),
    roles: z
      .object({
        review: RoleConfigSchema.partial().strict().optional(),
        critique: RoleConfigSchema.partial().strict().optional(),
        summary: RoleConfigSchema.partial().strict().optional(),
      })
      .strict()
      .optional(),
    review: ReviewSettingsSchema.partial().strict().optional(),
    git: GitSettingsSchema.extend({ base: GitSettingsSchema.shape.base.partial().strict() })
      .partial()
      .strict()
      .optional(),
    analyzers: AnalyzerSettingsSchema.partial().strict().optional(),
    models: ModelSettingsSchema.partial().strict().optional(),
    ui: UiSettingsSchema.partial().strict().optional(),
    output: OutputSettingsSchema.partial().strict().optional(),
    pricing: z.record(z.string(), PriceSchema).optional(),
    publish: PublishSettingsSchema.partial().strict().optional(),
    cache: CacheSettingsSchema.partial().strict().optional(),
    profiles: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PartialConfig = z.infer<typeof PartialConfigSchema>;
