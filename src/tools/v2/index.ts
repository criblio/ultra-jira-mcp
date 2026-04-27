// Public surface for v2 consolidated tools.
//
// `v2Tools` is the MCP-shaped tool listing (handed to ListToolsRequest);
// `handleV2Tool` is the call dispatcher (called from
// CallToolRequestSchema's handler in src/index.ts).
//
// Coverage: 16 consolidated tools collapse the 85 v1 tools into one
// per category. Every action dispatches through invokeOperation
// against the manifest in src/core/operations.ts.

import type { JiraClient } from "../../auth/jira-client.js";
import { operations } from "../../core/operations.js";
import {
  buildInputSchema,
  dispatchTool,
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
// inputSchema }. inputSchema is a JSON Schema with a oneOf over the
// tool's actions — gives the agent a tight constraint on what can
// land in args per action.
export interface V2Tool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export const v2Tools: V2Tool[] = allConsolidatedTools.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: buildInputSchema(t),
}));

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
): Promise<unknown> {
  const tool = toolByName.get(name);
  if (!tool) {
    throw new Error(`Not a v2 tool: ${name}`);
  }
  return dispatchTool(tool, operations, client, args);
}

// Re-exports useful for tests.
export { allConsolidatedTools, toolByName };
