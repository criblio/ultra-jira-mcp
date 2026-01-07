import { JiraClient } from "../auth/jira-client.js";
import {
  getToolFilterConfig,
  ToolCategory,
  ToolFilterConfig,
} from "../config.js";

// Import all tool definitions and handlers
import { issueTools, handleIssueTool } from "./issues.js";
import { searchTools, handleSearchTool } from "./search.js";
import { projectTools, handleProjectTool } from "./projects.js";
import { userTools, handleUserTool } from "./users.js";
import { boardTools, handleBoardTool } from "./boards.js";
import { sprintTools, handleSprintTool } from "./sprints.js";
import { epicTools, handleEpicTool } from "./epics.js";
import { commentTools, handleCommentTool } from "./comments.js";
import { attachmentTools, handleAttachmentTool } from "./attachments.js";
import { worklogTools, handleWorklogTool } from "./worklogs.js";
import { issueLinkTools, handleIssueLinkTool } from "./issue-links.js";
import { watcherTools, handleWatcherTool } from "./watchers.js";
import { fieldTools, handleFieldTool } from "./fields.js";
import { filterTools, handleFilterTool } from "./filters.js";
import { groupTools, handleGroupTool } from "./groups.js";
import { serverTools, handleServerTool } from "./server.js";

// Tool type definition
interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
}

// Map category names to their tools
const toolsByCategory: Record<ToolCategory, Tool[]> = {
  issue: issueTools,
  search: searchTools,
  project: projectTools,
  user: userTools,
  board: boardTools,
  sprint: sprintTools,
  epic: epicTools,
  comment: commentTools,
  attachment: attachmentTools,
  worklog: worklogTools,
  issueLink: issueLinkTools,
  watcher: watcherTools,
  field: fieldTools,
  filter: filterTools,
  group: groupTools,
  server: serverTools,
};

// Export all tools as a single array (unfiltered)
export const allTools: Tool[] = Object.values(toolsByCategory).flat();

// Map of tool names to their categories for routing
const toolCategories: Record<string, ToolCategory> = {};

// Populate tool categories
for (const [category, tools] of Object.entries(toolsByCategory)) {
  for (const tool of tools) {
    toolCategories[tool.name] = category as ToolCategory;
  }
}

/**
 * Get filtered tools based on environment configuration
 *
 * Filtering rules:
 * 1. If JIRA_ENABLED_CATEGORIES is set, only include tools from those categories
 * 2. Remove any tools listed in JIRA_DISABLED_TOOLS
 */
export function getFilteredTools(filterConfig?: ToolFilterConfig): Tool[] {
  const config = filterConfig ?? getToolFilterConfig();

  let tools = allTools;

  // Filter by enabled categories (if specified)
  if (config.enabledCategories.length > 0) {
    const enabledSet = new Set(config.enabledCategories);
    tools = tools.filter((tool) => {
      const category = toolCategories[tool.name];
      return category && enabledSet.has(category);
    });
  }

  // Remove disabled tools
  if (config.disabledTools.length > 0) {
    const disabledSet = new Set(config.disabledTools);
    tools = tools.filter((tool) => !disabledSet.has(tool.name));
  }

  return tools;
}

/**
 * Check if a tool is enabled based on the filter configuration
 */
export function isToolEnabled(
  toolName: string,
  filterConfig?: ToolFilterConfig
): boolean {
  const config = filterConfig ?? getToolFilterConfig();

  // Check if tool is explicitly disabled
  if (config.disabledTools.includes(toolName)) {
    return false;
  }

  // Check if category filtering is enabled
  if (config.enabledCategories.length > 0) {
    const category = toolCategories[toolName];
    if (!category || !config.enabledCategories.includes(category)) {
      return false;
    }
  }

  return true;
}

// Main tool handler that routes to the appropriate category handler
export async function handleTool(
  client: JiraClient,
  toolName: string,
  args: unknown,
  filterConfig?: ToolFilterConfig
): Promise<unknown> {
  const category = toolCategories[toolName];

  if (!category) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Check if tool is enabled
  if (!isToolEnabled(toolName, filterConfig)) {
    throw new Error(`Tool "${toolName}" is disabled`);
  }

  switch (category) {
    case "issue":
      return handleIssueTool(client, toolName, args);
    case "search":
      return handleSearchTool(client, toolName, args);
    case "project":
      return handleProjectTool(client, toolName, args);
    case "user":
      return handleUserTool(client, toolName, args);
    case "board":
      return handleBoardTool(client, toolName, args);
    case "sprint":
      return handleSprintTool(client, toolName, args);
    case "epic":
      return handleEpicTool(client, toolName, args);
    case "comment":
      return handleCommentTool(client, toolName, args);
    case "attachment":
      return handleAttachmentTool(client, toolName, args);
    case "worklog":
      return handleWorklogTool(client, toolName, args);
    case "issueLink":
      return handleIssueLinkTool(client, toolName, args);
    case "watcher":
      return handleWatcherTool(client, toolName, args);
    case "field":
      return handleFieldTool(client, toolName, args);
    case "filter":
      return handleFilterTool(client, toolName, args);
    case "group":
      return handleGroupTool(client, toolName, args);
    case "server":
      return handleServerTool(client, toolName, args);
    default:
      throw new Error(`Unknown tool category: ${category}`);
  }
}
