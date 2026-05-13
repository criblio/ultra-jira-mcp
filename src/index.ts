#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { startStdioServer } from "@scottlepper/mcp-toolkit/stdio";

import { getConfig, type JiraConfig } from "./config.js";
import { JiraClient, JiraApiError } from "./auth/jira-client.js";
import { getV2Tools, handleV2Tool } from "./tools/v2/index.js";
import {
  resourceDefinitions,
  resourceTemplates,
  handleResource,
} from "./resources/index.js";
import { bootCodeApi } from "./codeapi/boot.js";
import type { BridgeServer } from "./codeapi/bridge.js";
import {
  buildCodeApiToolResponse,
  jiraCodeApiToolDefinition,
  JIRA_CODE_API_TOOL_NAME,
  type CodeApiToolContext,
} from "./codeapi/tool.js";
import { closeHttpPool } from "@scottlepper/mcp-toolkit/transport";

// --- Server -----------------------------------------------------------

const server = new Server(
  { name: "ultra-jira-mcp", version: "2.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

let jiraConfig: JiraConfig | null = null;
let jiraClient: JiraClient | null = null;
function getClient(): JiraClient {
  if (!jiraClient) {
    jiraConfig ??= getConfig();
    jiraClient = new JiraClient(jiraConfig);
  }
  return jiraClient;
}

// Mode-specific state populated at startup. Read by the handlers
// below, so mode dispatch happens once instead of per-request.
type ModeState =
  | { mode: "classic"; tools: ReturnType<typeof getV2Tools> }
  | { mode: "code-api"; bridge: BridgeServer; ctx: CodeApiToolContext };

let modeState: ModeState | null = null;

// --- Handlers ---------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!modeState) throw new Error("server not initialized");
  if (modeState.mode === "classic") return { tools: modeState.tools };
  return { tools: [jiraCodeApiToolDefinition] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!modeState) throw new Error("server not initialized");
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

    const client = getClient();
    // jiraConfig is non-null at this point — getClient() populated it.
    const result = await handleV2Tool(
      client,
      name,
      args || {},
      jiraConfig!.toolFilter.disabledActions,
    );
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
    const client = getClient();
    return await handleResource(client, uri);
  } catch (error) {
    if (error instanceof JiraApiError) {
      throw new Error(`Jira API error (${error.statusCode}): ${error.message}`);
    }
    throw error;
  }
});

// --- Response helpers --------------------------------------------------

function textResponse(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
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
      content: [
        { type: "text" as const, text: JSON.stringify({ error: error.message }, null, 2) },
      ],
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

// --- Lifecycle --------------------------------------------------------

async function main() {
  jiraConfig = getConfig();
  if (jiraConfig.toolMode === "code-api") {
    const { bridge, ctx } = await bootCodeApi({
      client: getClient(),
      disabledActions: jiraConfig.toolFilter.disabledActions,
    });
    modeState = { mode: "code-api", bridge, ctx };
  } else {
    const tools = getV2Tools(jiraConfig.toolFilter);
    modeState = { mode: "classic", tools };
  }

  // Surface the active filter on stderr so users can confirm their
  // env vars took effect.
  const f = jiraConfig.toolFilter;
  if (f.enabledCategories.length > 0) {
    console.error(
      `Tool categories enabled: ${f.enabledCategories.join(", ")}`,
    );
  }
  if (f.disabledActions.length > 0) {
    console.error(`Actions disabled: ${f.disabledActions.join(", ")}`);
  }

  const banner =
    `Jira MCP server running on stdio (mode=${modeState.mode}` +
    (modeState.mode === "code-api" ? `, cli=${modeState.ctx.cliPath}` : "") +
    (modeState.mode === "classic" ? `, tools=${modeState.tools.length}` : "") +
    ")";

  await startStdioServer({
    server,
    banner,
    // Shutdown order matters:
    //   1) close the MCP transport so we stop accepting new tool calls
    //   2) close the bridge so in-flight stub calls drain rather than
    //      get cut mid-response
    //   3) close the undici pool so any pending Jira HTTP request
    //      finishes (or is allowed to error cleanly) before exit
    // Each step is best-effort — a failure in one shouldn't block the
    // others. startStdioServer swallows handler exceptions and exits
    // cleanly after this returns.
    async onShutdown(signal) {
      console.error(`Received ${signal}, shutting down`);
      await server.close().catch(() => {});
      if (modeState?.mode === "code-api") {
        await modeState.bridge.close().catch(() => {});
      }
      await closeHttpPool().catch(() => {});
    },
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
