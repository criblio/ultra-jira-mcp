// Builds one Jira MCP `Server` with its handlers.
//
// stdio mode builds one at startup. HTTP mode builds one per session,
// each with a `JiraClient` for that session's credentials, because an
// SDK `Server` connects to a single transport.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { JiraApiError, type JiraClient } from "./auth/jira-client.js";
import type { BridgeServer } from "./codeapi/bridge.js";
import {
  buildCodeApiToolResponse,
  jiraCodeApiToolDefinition,
  JIRA_CODE_API_TOOL_NAME,
  type CodeApiToolContext,
} from "./codeapi/tool.js";
import { resourceDefinitions, resourceTemplates, handleResource } from "./resources/index.js";
import { getV2Tools, handleV2Tool } from "./tools/v2/index.js";

export type ModeState =
  | { mode: "classic"; tools: ReturnType<typeof getV2Tools> }
  | { mode: "code-api"; bridge: BridgeServer; ctx: CodeApiToolContext };

export interface JiraServerOptions {
  modeState: ModeState;
  getClient: () => JiraClient;
  disabledActions: readonly string[];
}

export function createJiraServer(opts: JiraServerOptions): Server {
  const { modeState, getClient, disabledActions } = opts;
  const server = new Server(
    { name: "ultra-jira-mcp", version: "2.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (modeState.mode === "classic") return { tools: modeState.tools };
    return { tools: [jiraCodeApiToolDefinition] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (modeState.mode === "code-api") {
        if (name !== JIRA_CODE_API_TOOL_NAME) {
          throw new Error(
            `Unknown tool in code-api mode: ${name}. Only "${JIRA_CODE_API_TOOL_NAME}" is exposed; ` +
              `set JIRA_TOOL_MODE=classic for the consolidated tool surface.`,
          );
        }
        const result = buildCodeApiToolResponse(modeState.ctx);
        return textResponse(result);
      }

      const result = await handleV2Tool(getClient(), name, args || {}, disabledActions);
      return textResponse(result);
    } catch (error) {
      return errorResponse(error);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceDefinitions,
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
      return await handleResource(getClient(), uri);
    } catch (error) {
      if (error instanceof JiraApiError) {
        throw new Error(`Jira API error (${error.statusCode}): ${error.message}`);
      }
      throw error;
    }
  });

  return server;
}

// --- Response helpers --------------------------------------------------

function textResponse(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResponse(error: unknown) {
  if (error instanceof JiraApiError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { error: error.message, statusCode: error.statusCode, details: error.response },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  if (error instanceof Error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }, null, 2) }],
      isError: true,
    };
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ error: "Unknown error occurred" }, null, 2) },
    ],
    isError: true,
  };
}
