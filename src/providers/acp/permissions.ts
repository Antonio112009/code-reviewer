import path from 'node:path';
import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { TOOL_NAMES } from '../../tools/definitions';
import { resolveDependencyPath } from '../../tools/dependencies';
import { MCP_SERVER_NAME } from '../../tools/mcp-server';
import { isInsideDir } from '../../util/executables';

const SAFE_KINDS = new Set(['read', 'search', 'think']);
/** Never approved, whatever the tool claims to be. */
const DANGEROUS_KINDS = new Set(['edit', 'delete', 'move', 'execute', 'fetch', 'switch_mode']);

export interface PermissionDecision {
  allowed: boolean;
  response: RequestPermissionResponse;
  label: string;
}

/**
 * True when the tool identifier names one of our MCP tools exactly, e.g. `submit_findings`,
 * `mcp__code-reviewer__submit_findings` or `code-reviewer/grep`. Free-text titles that merely
 * contain "code-reviewer" (paths, commands) do not qualify.
 */
export function isOwnTool(identifier: string | null | undefined): boolean {
  if (!identifier) return false;
  const id = identifier.trim();
  if (TOOL_NAMES.has(id)) return true;
  const prefixed = new RegExp(`^(?:mcp__)?${MCP_SERVER_NAME}(?:__|/|:|\\.)\\s*([a-z_]+)$`).exec(id);
  return prefixed !== null && TOOL_NAMES.has(prefixed[1]!);
}

/** Paths a read/search request names: its locations and path-like fields of the raw tool input. */
function requestedPaths(call: RequestPermissionRequest['toolCall']): string[] {
  const out = (call.locations ?? []).map((l) => l.path).filter((p): p is string => typeof p === 'string');
  const raw = call.rawInput;
  if (raw && typeof raw === 'object') {
    for (const key of ['file_path', 'path', 'notebook_path', 'directory']) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'string' && v) out.push(v);
    }
  }
  return out;
}

/**
 * Read-only policy: allow reads/searches inside the review `root` and our own MCP tools, reject
 * everything else (edits, deletes, moves, command execution, network fetches, mode switches). Agents
 * read inside their session directory without asking, so a read/search request usually targets a path
 * outside it (`~/.aws/credentials`, the user's checkout): it is allowed only when every path it names
 * lies inside `root`.
 */
export function decidePermission(
  req: RequestPermissionRequest,
  root?: string,
  /** Installed dependency sources (real paths): reads of existing files inside them are allowed too. */
  dependencyRoots: readonly string[] = [],
): PermissionDecision {
  const call = req.toolCall;
  const label = [call.title, call.name, call.kind].filter(Boolean).join(' / ') || call.toolCallId;
  const dangerous = call.kind != null && DANGEROUS_KINDS.has(call.kind);
  const safeKind = call.kind != null && SAFE_KINDS.has(call.kind);
  const own = isOwnTool(call.name) || isOwnTool(call.title);
  let allowed = !dangerous && (safeKind || own);
  if (allowed && !own && call.kind !== 'think' && root !== undefined) {
    const paths = requestedPaths(call);
    allowed =
      paths.length > 0 &&
      paths.every(
        (p) =>
          isInsideDir(root, path.resolve(root, p)) ||
          (call.kind === 'read' &&
            resolveDependencyPath(dependencyRoots, path.resolve(root, p)) !== undefined),
      );
  }
  const option = pick(
    req.options,
    allowed ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'],
  );
  const response: RequestPermissionResponse = option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
  return { allowed: allowed && option !== undefined, response, label };
}

function pick(options: PermissionOption[], kinds: string[]): PermissionOption | undefined {
  for (const kind of kinds) {
    const found = options.find((o) => o.kind === kind);
    if (found) return found;
  }
  return undefined;
}
