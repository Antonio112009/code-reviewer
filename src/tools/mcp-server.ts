import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { packageVersion } from '../util/paths';
import { type AnyToolDef, runTool, type SubmitKind, type ToolContext, toolsFor } from './definitions';
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
        const { text, isError } = await runTool(def, input, ctx);
        return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
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
  const server = createMcpServer(toolsFor(opts.kind, opts.readTools), ctx);
  await server.connect(new StdioServerTransport());
  startParentWatchdog();
}
