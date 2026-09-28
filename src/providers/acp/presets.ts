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
  sessionMeta?(): Record<string, unknown>;
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
    sessionMeta: () => ({
      claudeCode: {
        options: {
          disallowedTools: CLAUDE_WRITE_TOOLS,
          permissionMode: 'default',
          allowDangerouslySkipPermissions: false,
        },
      },
    }),
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
