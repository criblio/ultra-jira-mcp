import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { HttpServerHandle } from "ultra-mcp-toolkit/http";
import { __setTransportForTests } from "ultra-mcp-toolkit/transport";

import type { JiraServerConfig } from "../src/config.js";
import {
  DEFAULT_HTTP_PORT,
  EMAIL_HEADER,
  TOKEN_HEADER,
  parseHttpPort,
  startJiraHttpServer,
} from "../src/http-server.js";
import { getV2Tools } from "../src/tools/v2/index.js";

const BASE: JiraServerConfig = {
  host: "https://http-mode-test.atlassian.net",
  toolMode: "classic",
  toolFilter: { enabledCategories: [], disabledActions: [] },
};

function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

describe("startJiraHttpServer", () => {
  let handle: HttpServerHandle | undefined;
  let restoreTransport: (() => void) | undefined;
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((c) => c.close()));
    restoreTransport?.();
    restoreTransport = undefined;
    await handle?.close();
    handle = undefined;
  });

  async function connect(h: HttpServerHandle, email: string, token: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(h.url), {
      requestInit: { headers: { [EMAIL_HEADER]: email, [TOKEN_HEADER]: token } },
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  it("calls Jira with each session's own credentials", async () => {
    const authorizations: string[] = [];
    restoreTransport = __setTransportForTests(async (_url, init) => {
      authorizations.push(init.headers.Authorization);
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        text: async () => JSON.stringify({ baseUrl: BASE.host, version: "1001.0.0" }),
      };
    });
    handle = await startJiraHttpServer(BASE, { port: 0 });

    const alice = await connect(handle, "alice@example.com", "alice-token");
    const bob = await connect(handle, "bob@example.com", "bob-token");
    const tools = await alice.listTools();
    expect(tools.tools).toHaveLength(getV2Tools(BASE.toolFilter).length);

    const aliceResult = await alice.callTool({ name: "jira_server", arguments: { action: "info" } });
    const bobResult = await bob.callTool({ name: "jira_server", arguments: { action: "info" } });
    expect(aliceResult.isError).toBeFalsy();
    expect(bobResult.isError).toBeFalsy();
    expect(authorizations).toEqual([
      basicAuth("alice@example.com", "alice-token"),
      basicAuth("bob@example.com", "bob-token"),
    ]);
  });

  it.each([
    ["the token", { [EMAIL_HEADER]: "alice@example.com" }],
    ["the email", { [TOKEN_HEADER]: "alice-token" }],
  ])("refuses a session without %s header", async (_missing, credentialHeaders) => {
    handle = await startJiraHttpServer(BASE, { port: 0 });
    const res = await fetch(handle.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...credentialHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
    expect(res.status).toBe(401);
    expect(handle.sessionCount()).toBe(0);
  });

  it("refuses code-api mode", async () => {
    await expect(startJiraHttpServer({ ...BASE, toolMode: "code-api" }, { port: 0 })).rejects.toThrow(
      /classic only/,
    );
  });
});

describe("parseHttpPort", () => {
  it("defaults when unset or empty", () => {
    expect(parseHttpPort(undefined)).toBe(DEFAULT_HTTP_PORT);
    expect(parseHttpPort("")).toBe(DEFAULT_HTTP_PORT);
  });

  it("accepts a port number", () => {
    expect(parseHttpPort("18555")).toBe(18555);
  });

  it("rejects anything else", () => {
    expect(() => parseHttpPort("http")).toThrow(/JIRA_MCP_HTTP_PORT/);
    expect(() => parseHttpPort("70000")).toThrow(/JIRA_MCP_HTTP_PORT/);
  });
});
