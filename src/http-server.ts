// Shared streamable-HTTP mode: one process serves many MCP clients.
//
// Each session sends its Jira email and API token as request headers
// and gets its own `JiraClient`, so the shared process needs no
// credentials of its own. Classic tool mode only: code-api hands the
// agent a per-process bridge socket, which a shared server cannot offer.

import type { IncomingHttpHeaders } from "node:http";
import {
  HttpSessionRejected,
  startHttpServer,
  type HttpServerHandle,
} from "ultra-mcp-toolkit/http";
import { closeHttpPool } from "ultra-mcp-toolkit/transport";

import { JiraClient } from "./auth/jira-client.js";
import { withCredentials, type JiraServerConfig } from "./config.js";
import { createJiraServer } from "./server.js";
import { getV2Tools } from "./tools/v2/index.js";

export const EMAIL_HEADER = "jira-email";
export const TOKEN_HEADER = "jira-api-token";

// Next to the 18000 a shared Grafana MCP commonly takes, and outside the
// ephemeral range, so a fixed `-p 127.0.0.1:18001:18001` mapping is stable.
export const DEFAULT_HTTP_PORT = 18001;

export interface JiraHttpOptions {
  host?: string;
  port?: number;
}

export async function startJiraHttpServer(
  base: JiraServerConfig,
  opts: JiraHttpOptions = {},
): Promise<HttpServerHandle> {
  if (base.toolMode !== "classic") {
    throw new Error("JIRA_MCP_TRANSPORT=http supports JIRA_TOOL_MODE=classic only.");
  }
  const tools = getV2Tools(base.toolFilter);
  const disabledActions = base.toolFilter.disabledActions;

  return startHttpServer({
    host: opts.host,
    port: opts.port ?? DEFAULT_HTTP_PORT,
    bindHeaders: [EMAIL_HEADER, TOKEN_HEADER],
    createServer: ({ headers }) => {
      const email = single(headers, EMAIL_HEADER);
      const token = single(headers, TOKEN_HEADER);
      if (!email || !token) {
        throw new HttpSessionRejected(`${EMAIL_HEADER} and ${TOKEN_HEADER} headers are required`);
      }
      const client = new JiraClient(withCredentials(base, email, token));
      return createJiraServer({
        modeState: { mode: "classic", tools },
        getClient: () => client,
        disabledActions,
      });
    },
    banner: `Jira MCP server running on streamable HTTP (mode=classic, tools=${tools.length})`,
    onShutdown: async (signal) => {
      console.error(`Received ${signal}, shutting down`);
      await closeHttpPool().catch(() => {});
    },
  });
}

export function parseHttpPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_HTTP_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid JIRA_MCP_HTTP_PORT=${raw}. Expected a port number.`);
  }
  return port;
}

function single(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
