import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AcpPresetId, AcpProviderConfig } from '../../config/schema';
import type { ReasoningLevel } from '../../types';
import { findTrustedExecutable } from '../../util/executables';

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Human readable origin of the command (PATH binary, npx, config). */
  via: string;
}

export interface ProcessOptions {
  model?: string;
  reasoning: ReasoningLevel;
}

export interface AcpPreset {
  id: AcpPresetId;
  label: string;
  experimental: boolean;
  /** Underlying CLI whose presence (and login) the adapter relies on. */
  cli?: string;
  /**
   * Session mode that makes the agent consult our permission policy / stay read-only (selected after
   * session/new; failing to apply an offered mode fails the task).
   */
  readOnlyMode?: string;
  /**
   * The agent cannot be confined to read-only: it may run commands (tests, builds) in the review root,
   * i.e. execute the reviewed code. Never chosen as an automatic fallback; a warning is shown when used.
   */
  unconfined?: boolean;
  /** Model and effort are fixed per process for this agent (no session config options). */
  perProcessModel?: boolean;
  launch(cfg: AcpProviderConfig, proc: ProcessOptions): LaunchSpec | undefined;
  /** `_meta` sent with session/new. */
  sessionMeta?(cfg: AcpProviderConfig): Record<string, unknown>;
}

/**
 * Absolute path of `name` from trusted PATH entries only: never the reviewed checkout, snapshots, the
 * current directory, `node_modules/.bin` or relative entries (a PR must not supply its own `claude`).
 */
export function findExecutable(name: string): string | undefined {
  return findTrustedExecutable(name);
}

/** `npx -y <pkg>` with npx resolved like any other program; undefined when npx is not installed. */
function npx(pkg: string): Pick<LaunchSpec, 'command' | 'args'> | undefined {
  const command = findTrustedExecutable('npx');
  return command ? { command, args: ['-y', pkg] } : undefined;
}

function fromConfig(cfg: AcpProviderConfig, extraEnv: Record<string, string> = {}): LaunchSpec | undefined {
  if (!cfg.command) return undefined;
  return { command: cfg.command, args: cfg.args ?? [], env: { ...extraEnv, ...cfg.env }, via: 'config' };
}

/** Claude Code tools that can modify the workspace, run commands or send data out. */
const CLAUDE_WRITE_TOOLS = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'BashOutput',
  'KillShell',
  'KillBash',
  'PowerShell',
  'WebFetch',
  'WebSearch',
];

/**
 * Claude Code's sub-agents: their tool calls and cost never reach the session updates we log and meter,
 * and a review task does not need them.
 */
const CLAUDE_SUBAGENT_TOOLS = ['Task', 'Agent'];
/** The only built-in Claude Code tools a review session gets (our MCP tools come on top). */
const CLAUDE_READ_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * The parts of the user's Claude Code settings (`$CLAUDE_CONFIG_DIR` or `~/.claude`, `settings.json`) that
 * sign in and route requests: `env` (e.g. `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`) and `apiKeyHelper`.
 * Review sessions load no settings files, so these are handed over programmatically; plugins, hooks,
 * permissions and the rest stay out.
 */
export function claudeAuthSettings(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | undefined {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const s = parsed as { env?: unknown; apiKeyHelper?: unknown };
  const out: Record<string, unknown> = {};
  if (s.env && typeof s.env === 'object' && !Array.isArray(s.env)) {
    const vars = Object.entries(s.env).filter(([, v]) => typeof v === 'string');
    if (vars.length) out.env = Object.fromEntries(vars);
  }
  if (typeof s.apiKeyHelper === 'string' && s.apiKeyHelper.trim()) out.apiKeyHelper = s.apiKeyHelper;
  return Object.keys(out).length ? out : undefined;
}

export const PRESETS: Record<AcpPresetId, AcpPreset> = {
  claude: {
    id: 'claude',
    label: 'Claude Code (ACP adapter)',
    experimental: false,
    cli: 'claude',
    launch(cfg) {
      // Our MCP tools (submit_findings above all) are loaded up front instead of behind Claude Code's
      // ToolSearch: models that skip the search otherwise end the review without handing anything in, and
      // every task pays one search turn. A value in the provider's `env` still wins.
      const env: Record<string, string> = { ENABLE_TOOL_SEARCH: 'false' };
      // Make the adapter drive the user's installed (and logged-in) Claude Code.
      const claude = findExecutable('claude');
      if (claude) env.CLAUDE_CODE_EXECUTABLE = claude;
      const configured = fromConfig(cfg, env);
      if (configured) return configured;
      const bin = findExecutable('claude-agent-acp');
      if (bin) return { command: bin, args: [], env: { ...env, ...cfg.env }, via: 'PATH' };
      const viaNpx = npx('@agentclientprotocol/claude-agent-acp@0.81');
      return viaNpx && { ...viaNpx, env: { ...env, ...cfg.env }, via: 'npx' };
    },
    // `default` mode: every tool use goes through session/request_permission (our policy), whatever
    // `permissions.defaultMode` (bypassPermissions / auto) the user's Claude settings select.
    readOnlyMode: 'default',
    // Review sessions load no settings files (the adapter's default is user, project and local): the user's
    // plugins, hooks and skills stay out of every review — tokens, and language servers or hooks running in
    // a snapshot of untrusted code — unless `userSettings` asks for them. Project and local settings would
    // come from the reviewed checkout; the snapshot removes its `.claude/` anyway.
    sessionMeta: (cfg) => {
      const auth = cfg.userSettings ? undefined : claudeAuthSettings();
      return {
        claudeCode: {
          options: {
            settingSources: cfg.userSettings ? ['user'] : [],
            tools: CLAUDE_READ_TOOLS,
            ...(auth ? { settings: auth } : {}),
            disallowedTools: [...CLAUDE_WRITE_TOOLS, ...CLAUDE_SUBAGENT_TOOLS],
            permissionMode: 'default',
            allowDangerouslySkipPermissions: false,
          },
        },
      };
    },
  },
  codex: {
    id: 'codex',
    label: 'OpenAI Codex (ACP adapter)',
    experimental: true,
    cli: 'codex',
    readOnlyMode: 'read-only',
    // codex-acp's "read-only" mode still runs commands in a workspace-write sandbox without asking.
    unconfined: true,
    launch(cfg) {
      const env: Record<string, string> = { INITIAL_AGENT_MODE: 'read-only' };
      const codex = findExecutable('codex');
      if (codex) env.CODEX_PATH = codex;
      const configured = fromConfig(cfg, env);
      if (configured) return configured;
      const bin = findExecutable('codex-acp');
      if (bin) return { command: bin, args: [], env: { ...env, ...cfg.env }, via: 'PATH' };
      const viaNpx = npx('@agentclientprotocol/codex-acp@1');
      return viaNpx && { ...viaNpx, env: { ...env, ...cfg.env }, via: 'npx' };
    },
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot CLI (ACP, public preview)',
    experimental: true,
    cli: 'copilot',
    perProcessModel: true,
    launch(cfg, proc) {
      const configured = fromConfig(cfg);
      if (configured) return configured;
      const bin = findExecutable('copilot');
      if (!bin) return undefined;
      const args = ['--acp', '--stdio', '--deny-tool=write', '--deny-tool=shell'];
      if (proc.model) args.push('--model', proc.model);
      if (proc.reasoning !== 'none') args.push('--effort', proc.reasoning);
      return { command: bin, args, env: { ...cfg.env }, via: 'PATH' };
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI (ACP)',
    experimental: true,
    cli: 'gemini',
    readOnlyMode: 'plan',
    launch(cfg, proc) {
      const configured = fromConfig(cfg);
      if (configured) return configured;
      const bin = findExecutable('gemini');
      if (!bin) return undefined;
      const args = ['--acp'];
      if (proc.model) args.push('--model', proc.model);
      return { command: bin, args, env: { ...cfg.env }, via: 'PATH' };
    },
  },
  custom: {
    id: 'custom',
    label: 'Custom ACP agent',
    experimental: true,
    launch: (cfg) => fromConfig(cfg),
  },
};

/** True when the provider is an agent that may run commands in the review root (see `AcpPreset.unconfined`). */
export function isUnconfined(cfg: { type: string; preset?: string }): boolean {
  return (
    cfg.type === 'acp' && cfg.preset !== undefined && PRESETS[cfg.preset as AcpPresetId]?.unconfined === true
  );
}

/** Candidate values of a `thought_level` config option for each reasoning level, best first. */
export const THOUGHT_LEVEL_CANDIDATES: Record<ReasoningLevel, string[]> = {
  none: ['none', 'off', 'minimal', 'low'],
  low: ['low', 'minimal'],
  medium: ['medium', 'default'],
  high: ['high', 'xhigh', 'max'],
};
