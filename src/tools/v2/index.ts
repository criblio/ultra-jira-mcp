// Public surface for v2 consolidated tools.
//
// `getV2Tools(filter)` builds the MCP-shaped tool listing (handed to
// ListToolsRequest), optionally honoring a ToolFilterConfig that
// drops categories and disables individual actions.
// `handleV2Tool` is the call dispatcher (called from
// CallToolRequestSchema's handler in src/index.ts).
//
// Coverage: 16 consolidated tools collapse the 85 v1 tools into one
// per category. Every action dispatches through invokeOperation
// against the manifest in src/core/operations.ts.

import type { JiraClient } from "../../auth/jira-client.js";
import type { ToolFilterConfig } from "../../config.js";
import { operations } from "../../core/operations.js";
import {
  buildInputSchema,
  dispatchTool,
  type ActionDefinition,
  type ConsolidatedTool,
} from "./dispatcher.js";
import { jiraAttachment } from "./attachment.js";
import { jiraBoard } from "./board.js";
import { jiraComment } from "./comment.js";
import { jiraEpic } from "./epic.js";
import { jiraField } from "./field.js";
import { jiraFilter } from "./filter.js";
import { jiraGroup } from "./group.js";
import { jiraIssue } from "./issue.js";
import { jiraLink } from "./link.js";
import { jiraProject } from "./project.js";
import { jiraSearch } from "./search.js";
import { jiraServer } from "./server.js";
import { jiraSprint } from "./sprint.js";
import { jiraUser } from "./user.js";
import { jiraWatcher } from "./watcher.js";
import { jiraWorklog } from "./worklog.js";

const allConsolidatedTools: ConsolidatedTool[] = [
  jiraIssue,
  jiraSearch,
  jiraComment,
  jiraUser,
  jiraProject,
  jiraBoard,
  jiraSprint,
  jiraEpic,
  jiraWorklog,
  jiraAttachment,
  jiraFilter,
  jiraLink,
  jiraWatcher,
  jiraField,
  jiraGroup,
  jiraServer,
];

const toolByName = new Map<string, ConsolidatedTool>();
for (const t of allConsolidatedTools) toolByName.set(t.name, t);

// MCP-shaped descriptors. The shape mirrors v1: { name, description,
// inputSchema }. inputSchema is a flat JSON Schema with `action` as a
// string enum and a merged property bag — see buildInputSchema for
// why it's flat (top-level oneOf isn't accepted by the Anthropic
// tool-use API).
export interface V2Tool {
  name: string;
  description: string;
  inputSchema: unknown;
}

// Tool name → category. v1 tool names are `jira_<category>`; v2
// keeps the same convention. issueLink → "link" because the
// consolidated tool is named jiraLink for brevity (see
// src/tools/v2/link.ts).
function categoryOf(toolName: string): string {
  return toolName.startsWith("jira_") ? toolName.slice(5) : toolName;
}

// Build the MCP tool listing for classic mode. With no filter passed,
// emits the full 16-tool surface (back-compat with how the MCP server
// called this before c2). With a filter:
//   - Tools whose category isn't in `enabledCategories` are dropped
//     from the listing. Empty `enabledCategories` means "all enabled".
//     This is a token-cost knob, not a hard enforcement: the dispatch
//     path (`handleV2Tool`) doesn't consult `enabledCategories`, so a
//     misbehaving or stale-cache agent could still reach a hidden
//     tool. Use `disabledActions` for the safety guarantee — it's
//     enforced at the manifest dispatch layer in both modes.
//   - Actions in `disabledActions` are stripped from each tool's
//     action set before buildInputSchema runs, so the disabled
//     action's fields and description don't bloat the tool listing.
//     A tool with every action disabled is dropped.
export function getV2Tools(filter?: ToolFilterConfig): V2Tool[] {
  const enabled = filter?.enabledCategories ?? [];
  const disabled = new Set(filter?.disabledActions ?? []);
  const enabledSet = new Set(enabled);

  const out: V2Tool[] = [];
  for (const tool of allConsolidatedTools) {
    if (enabled.length > 0 && !enabledSet.has(categoryOf(tool.name))) {
      continue;
    }
    // Filter actions whose underlying manifest operation is disabled.
    const actions: Record<string, ActionDefinition> = {};
    for (const [key, def] of Object.entries(tool.actions)) {
      if (disabled.has(def.operation)) continue;
      actions[key] = def;
    }
    if (Object.keys(actions).length === 0) continue;

    const filteredTool: ConsolidatedTool =
      Object.keys(actions).length === Object.keys(tool.actions).length
        ? tool
        : { ...tool, actions };
    out.push({
      name: tool.name,
      description: tool.description,
      inputSchema: buildInputSchema(filteredTool),
    });
  }
  return out;
}

// Back-compat: the unfiltered tool list. Kept so existing tests and
// any external import paths don't break. New callers should prefer
// `getV2Tools(config.toolFilter)`.
export const v2Tools: V2Tool[] = getV2Tools();

// Router: returns whether the named tool is a v2 tool, and dispatches
// if so. Callers should consult `isV2Tool` first to avoid swallowing
// v1 tool calls during the transition (v1 and v2 names don't overlap
// — v1 uses snake_case operation names, v2 collapses categories).
export function isV2Tool(name: string): boolean {
  return toolByName.has(name);
}

export async function handleV2Tool(
  client: JiraClient,
  name: string,
  args: Record<string, unknown>,
  disabledActions?: readonly string[],
): Promise<unknown> {
  const tool = toolByName.get(name);
  if (!tool) {
    throw new Error(`Not a v2 tool: ${name}`);
  }
  return dispatchTool(tool, operations, client, args, disabledActions);
}

// Re-exports useful for tests.
export { allConsolidatedTools, toolByName };
