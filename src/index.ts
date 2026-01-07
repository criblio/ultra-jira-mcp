#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getConfig, getToolFilterConfig, ToolFilterConfig } from "./config.js";
import { JiraClient, JiraApiError } from "./auth/jira-client.js";
import { getFilteredTools, handleTool } from "./tools/index.js";
import {
  resourceDefinitions,
  resourceTemplates,
  handleResource,
} from "./resources/index.js";

// Create the MCP server using the lower-level Server class for more control
const server = new Server(
  {
    name: "jira-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Initialize Jira client (will be created on first use)
let jiraClient: JiraClient | null = null;

function getClient(): JiraClient {
  if (!jiraClient) {
    const config = getConfig();
    jiraClient = new JiraClient(config);
  }
  return jiraClient;
}

// Cache tool filter config at startup
const toolFilterConfig: ToolFilterConfig = getToolFilterConfig();
const filteredTools = getFilteredTools(toolFilterConfig);

// Log filtering info if any filtering is active
if (toolFilterConfig.enabledCategories.length > 0) {
  console.error(
    `Tool categories enabled: ${toolFilterConfig.enabledCategories.join(", ")}`
  );
}
if (toolFilterConfig.disabledTools.length > 0) {
  console.error(
    `Tools disabled: ${toolFilterConfig.disabledTools.join(", ")}`
  );
}
if (filteredTools.length < 50) {
  // Only log if significantly filtered
  console.error(`Total tools available: ${filteredTools.length}`);
}

// Register tools list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: filteredTools };
});

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const client = getClient();
    const result = await handleTool(client, name, args || {}, toolFilterConfig);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof JiraApiError) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: error.message,
                statusCode: error.statusCode,
                details: error.response,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "Unknown error occurred" }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Register resources list handler
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: resourceDefinitions };
});

// Register resource templates list handler
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return { resourceTemplates };
});

// Register resource read handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    const client = getClient();
    return await handleResource(client, uri);
  } catch (error) {
    if (error instanceof JiraApiError) {
      throw new Error(
        `Jira API error (${error.statusCode}): ${error.message}`
      );
    }
    throw error;
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jira MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
