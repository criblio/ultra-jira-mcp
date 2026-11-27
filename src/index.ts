#!/usr/bin/env node

import { startStdioServer } from "ultra-mcp-toolkit/stdio";
import { closeHttpPool } from "ultra-mcp-toolkit/transport";

import { getConfig, getServerConfig } from "./config.js";
import { JiraClient } from "./auth/jira-client.js";
import { getV2Tools } from "./tools/v2/index.js";
import { bootCodeApi } from "./codeapi/boot.js";
import { createJiraServer, type ModeState } from "./server.js";
import { parseHttpPort, startJiraHttpServer } from "./http-server.js";

// --- Lifecycle --------------------------------------------------------

async function main() {
  const transport = process.env.JIRA_MCP_TRANSPORT || "stdio";
  if (transport === "http") {
    await startJiraHttpServer(getServerConfig(), {
      host: process.env.JIRA_MCP_HTTP_HOST || undefined,
      port: parseHttpPort(process.env.JIRA_MCP_HTTP_PORT),
    });
    return;
  }
  if (transport !== "stdio") {
    throw new Error(`Invalid JIRA_MCP_TRANSPORT=${transport}. Expected "stdio" (default) or "http".`);
  }

  const jiraConfig = getConfig();
  const client = new JiraClient(jiraConfig);
  let modeState: ModeState;
  if (jiraConfig.toolMode === "code-api") {
    const { bridge, ctx } = await bootCodeApi({
      client,
      disabledActions: jiraConfig.toolFilter.disabledActions,
    });
    modeState = { mode: "code-api", bridge, ctx };
  } else {
    modeState = { mode: "classic", tools: getV2Tools(jiraConfig.toolFilter) };
  }
  const server = createJiraServer({
    modeState,
    getClient: () => client,
    disabledActions: jiraConfig.toolFilter.disabledActions,
  });

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
      if (modeState.mode === "code-api") {
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
