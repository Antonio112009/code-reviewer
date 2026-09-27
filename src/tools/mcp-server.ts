import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createSkillCatalog } from '../skills/catalog';
import { skillsForDepth } from '../skills/detector';
import { loadSkills } from '../skills/loader';
import { packageVersion } from '../util/paths';
import { type AnyToolDef, type SubmitKind, type ToolContext, toolsFor } from './definitions';
import { SubmissionCollector } from './submission';

export const MCP_SERVER_NAME = 'code-reviewer';

/** Exposes our tools over MCP so ACP agents (Claude Code, Codex, ...) can call them. */
export function createMcpServer(defs: AnyToolDef[], ctx: ToolContext): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: packageVersion() });
  for (const def of defs) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (input: unknown) => {
        try {
          return { content: [{ type: 'text' as const, text: await def.execute(input, ctx) }] };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}

export interface McpServeOptions {
  root: string;
  git: boolean;
  kind: SubmitKind;
  submitFile: string;
  readTools: boolean;
  /**
   * Repository root for project skills (`.code-reviewer/skills`). Project skills are not loaded when
   * omitted — never implicitly from `root`, which may be an untrusted revision.
   */
  projectRoot?: string;
  /** Expose `list_skills` / `get_skill` (review tasks with read tools only). Default true. */
  skills?: boolean;
  /** Skill ids hidden from the skill tools (`review.skillsExclude`). */
  skillsExclude?: string[];
  /** Review depth: `essential` serves essential-tier skills (and bullets) only. Default `full`. */
  depth?: 'essential' | 'full';
}

/**
 * The MCP server is a grandchild (CLI → agent → us). If the agent dies without closing our stdin, or our
 * parent changes (reparented to init after a SIGKILL), exit instead of lingering as an orphan.
 */
export function startParentWatchdog(intervalMs = 2_000): () => void {
  const initialParent = process.ppid;
  const exit = () => process.exit(0);
  process.stdin.once('end', exit);
  process.stdin.once('close', exit);
  const timer = setInterval(() => {
    if (process.ppid !== initialParent || process.ppid === 1) exit();
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    process.stdin.off('end', exit);
    process.stdin.off('close', exit);
  };
}

/** Entry point of the hidden `code-reviewer mcp-serve` command (stdio transport). */
export async function runMcpServe(opts: McpServeOptions): Promise<void> {
  const ctx: ToolContext = {
    root: opts.root,
    git: opts.git,
    collector: new SubmissionCollector(opts.submitFile),
  };
  if (opts.readTools && opts.kind === 'findings' && opts.skills !== false) {
    // Warnings were already shown by the CLI process that planned the review; stay quiet here.
    const skills = await loadSkills(opts.projectRoot).catch(() => []);
    const visible = skillsForDepth(skills, opts.depth ?? 'full');
    if (visible.length) ctx.skills = createSkillCatalog(visible, opts.skillsExclude);
  }
  const server = createMcpServer(toolsFor(opts.kind, opts.readTools, ctx), ctx);
  await server.connect(new StdioServerTransport());
  startParentWatchdog();
}
