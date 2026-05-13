// The single MCP tool exposed in code-api mode.
//
// In code-api mode the server publishes only this tool. Calling it
// returns the path to the jira-cli binary and the JIRA_MCP_SOCKET
// address; the agent then drives Jira through that CLI from its own
// shell and never calls an MCP tool again for reads.
//
// The toolkit owns the tool definition shape and the wiring contract;
// we override `buildResponse` with Jira-specific hints (the canonical
// `issue.get` example and the subtasks JQL gotcha) that historically
// saved first-use sessions multiple wasted calls.

import { createCodeApiTool } from "@scottlepper/mcp-toolkit/code-api";

export type {
  CodeApiToolContext,
  CodeApiToolResponse,
} from "@scottlepper/mcp-toolkit/code-api";

import type {
  CodeApiToolContext,
  CodeApiToolResponse,
} from "@scottlepper/mcp-toolkit/code-api";

export const JIRA_CODE_API_TOOL_NAME = "jira_code_api";

const JIRA_CODE_API_TOOL_DESCRIPTION =
  "Access Jira via the bundled jira-cli shell binary. Call once to " +
  "get the binary path and JIRA_MCP_SOCKET address; every subsequent " +
  "call is a `jira-cli <op> --flag=value` invocation that returns a " +
  "trimmed summary on stdout and a ref path to the full response.";

// Use the toolkit for the tool definition (name, schema, description
// contract). We ignore its `buildResponse` and provide a Jira-flavored
// one below — the toolkit's generic snippet uses `<op> --flag=value`
// placeholders, but jira-mcp tests assert on the concrete `issue.get`
// example and the subtasks JQL hint that were tuned from real
// first-use sessions.
const { definition } = createCodeApiTool({
  toolName: JIRA_CODE_API_TOOL_NAME,
  cliBinaryName: "jira-cli",
  socketEnvVar: "JIRA_MCP_SOCKET",
  description: JIRA_CODE_API_TOOL_DESCRIPTION,
});

export const jiraCodeApiToolDefinition = definition;

export function buildCodeApiToolResponse(
  ctx: CodeApiToolContext,
): CodeApiToolResponse {
  // The agent typically runs this via Claude Code's Bash tool, whose
  // child shells *do not* inherit env vars from the MCP server
  // process. So the snippet must export JIRA_MCP_SOCKET inline rather
  // than assume it's already set.
  //
  // The discovery hint and subtask note exist because real first-use
  // sessions burned 4-5 calls guessing at the wrong endpoint names
  // ("searchAndReconsileIssuesUsingJql") and wrong subtask
  // strategies ("issueLinkType = has subtask"). `jira-cli --help`
  // lists every operation; `jira-cli <op> --help` lists its flags.
  // We prefix invocations with `node` rather than relying on the
  // shebang + exec bit. `npm install` sets the exec bit when wiring
  // `bin` entries, but a freshly-built local checkout (the common
  // dev path) leaves the file non-executable, and the agent has no
  // reason to suspect that. `node <path>` works either way.
  const cmd = `node ${ctx.cliPath}`;
  const usage = [
    `# JIRA_MCP_SOCKET prefix is load-bearing — child shells don't`,
    `# inherit the MCP server's env.`,
    `JIRA_MCP_SOCKET=${ctx.socketAddress} \\`,
    `  ${cmd} issue.get --issueIdOrKey=PROJ-1`,
    `# stdout: trimmed summary as JSON, then a final \`ref: /path\` line`,
    `# pointing at the full response on disk (\`cat\` it for detail).`,
    `# Discovery: \`${cmd} --help\` lists ops;`,
    `# \`${cmd} <op> --help\` lists flags.`,
    `# Subtasks: use \`parent = KEY\` JQL on search.issues, not "has subtask".`,
  ].join("\n");

  return {
    cli: ctx.cliPath,
    socketEnv: "JIRA_MCP_SOCKET",
    socketAddress: ctx.socketAddress,
    usage,
  };
}
