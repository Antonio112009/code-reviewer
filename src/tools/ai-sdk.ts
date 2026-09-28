import { type ToolSet, tool } from 'ai';
import { type AnyToolDef, runTool, type ToolContext } from './definitions';

/** Adapts provider-agnostic tool definitions to Vercel AI SDK tools. */
export function toAiSdkTools(
  defs: AnyToolDef[],
  ctx: ToolContext,
  onCall?: (toolName: string) => void,
): ToolSet {
  const out: ToolSet = {};
  for (const def of defs) {
    out[def.name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (input: unknown) => {
        onCall?.(def.name);
        // Tool errors are returned to the model so it can recover instead of aborting the run.
        return (await runTool(def, input, ctx)).text;
      },
    });
  }
  return out;
}
