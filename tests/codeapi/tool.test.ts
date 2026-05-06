import { describe, expect, it } from "vitest";

import {
  buildCodeApiToolResponse,
  jiraCodeApiToolDefinition,
  JIRA_CODE_API_TOOL_NAME,
} from "../../src/codeapi/tool.js";

describe("jiraCodeApiToolDefinition", () => {
  it("uses the canonical tool name and an empty input schema", () => {
    expect(jiraCodeApiToolDefinition.name).toBe(JIRA_CODE_API_TOOL_NAME);
    expect(jiraCodeApiToolDefinition.name).toBe("jira_code_api");
    expect(jiraCodeApiToolDefinition.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("keeps the description tight (under 500 chars) for tool-list cost", () => {
    expect(jiraCodeApiToolDefinition.description.length).toBeLessThan(500);
  });
});

describe("buildCodeApiToolResponse", () => {
  it("surfaces the cli path, socket env name + value, and a usage example", () => {
    const out = buildCodeApiToolResponse({
      cliPath: "/tmp/jira-mcp/abc/cli/index.js",
      socketAddress: "/tmp/jira-mcp/abc/ipc.sock",
    });
    expect(out.cli).toBe("/tmp/jira-mcp/abc/cli/index.js");
    expect(out.socketEnv).toBe("JIRA_MCP_SOCKET");
    expect(out.socketAddress).toBe("/tmp/jira-mcp/abc/ipc.sock");
    // Usage must show the canonical invocation shape: `node <cli>` so
    // the agent isn't required to chmod +x the binary in dev checkouts
    // (npm install handles that, but local builds don't).
    expect(out.usage).toContain("node /tmp/jira-mcp/abc/cli/index.js");
    expect(out.usage).toContain("issue.get");
    // Discovery hint + subtasks gotcha — first-use sessions historically
    // burned multiple calls guessing at endpoint names and the wrong
    // subtask strategy. The CLI's `--help` is the canonical discovery
    // path; the JQL note steers the agent away from "has subtask" link
    // types that don't exist.
    expect(out.usage).toContain("--help");
    expect(out.usage).toContain("parent = KEY");
    // The on-disk Ref pattern stays — agents should know to read the
    // ref file when the trimmed summary isn't enough.
    expect(out.usage).toContain("ref:");
  });

  it("prefixes the cli invocation with JIRA_MCP_SOCKET=<addr>", () => {
    // Regression: the MCP server's process.env doesn't propagate to
    // Claude Code's Bash subprocesses (Bash spawns from Claude Code,
    // not from the server). The usage snippet must therefore set the
    // env var inline rather than assume it's already in scope.
    const out = buildCodeApiToolResponse({
      cliPath: "/tmp/jira-mcp/abc/cli/index.js",
      socketAddress: "/tmp/jira-mcp/abc/ipc.sock",
    });
    expect(out.usage).toContain("JIRA_MCP_SOCKET=/tmp/jira-mcp/abc/ipc.sock");
    // The prefix must be on a line that ends with a backslash
    // continuation, with the cli on the next line — both as one
    // shell command — so the env-var assignment scopes to the cli.
    expect(out.usage).toMatch(/JIRA_MCP_SOCKET=\S+\s*\\\s*\n\s*node\s+\S+/);
  });

  it("stays under 1KB so the tool's first call doesn't blow the budget", () => {
    const out = buildCodeApiToolResponse({
      cliPath: "/tmp/jira-mcp/abcdef/cli/index.js",
      socketAddress: "/tmp/jira-mcp/abcdef/ipc.sock",
    });
    const serialized = JSON.stringify(out);
    expect(serialized.length).toBeLessThan(1024);
  });
});
