// The single MCP tool exposed in code-api mode.
//
// In code-api mode the server publishes only this tool. Calling it
// returns the path to the jira-cli binary and the JIRA_MCP_SOCKET
// address; the agent then drives Jira through that CLI from its own
// shell and never calls an MCP tool again for reads.
//
// The handler is stateless — the heavy lifting (CLI binary already
// built into the package + bridge startup) happens once at server
// boot in `src/index.ts`. We just describe to the agent what was
// set up.
//
// Earlier revisions of this tool advertised a directory of generated
// TypeScript stubs for the agent to import via `npx tsx -e`. That
// shape kept tripping the agent on tsx runtime quirks (top-level
// await under CJS, `.js` → `.ts` resolver skipping paths under
// `/node_modules/`). The CLI handoff collapses Bash → npx → tsx →
// esbuild → node → import resolution → IPC down to Bash → binary →
// IPC, which is the same call surface every other shell tool the
// agent uses already has.

export interface CodeApiToolContext {
  cliPath: string;       // absolute path to the jira-cli binary
  socketAddress: string; // value placed in JIRA_MCP_SOCKET
}

export const JIRA_CODE_API_TOOL_NAME = "jira_code_api";

// Description text rendered in the MCP tool listing. Kept tight so
// the listing token cost stays under the ~500-token target the plan
// quotes for Layer 3.
export const JIRA_CODE_API_TOOL_DESCRIPTION =
  "Access Jira via the bundled jira-cli shell binary. Call once to " +
  "get the binary path and JIRA_MCP_SOCKET address; every subsequent " +
  "call is a `jira-cli <op> --flag=value` invocation that returns a " +
  "trimmed summary on stdout and a ref path to the full response.";

export const jiraCodeApiToolDefinition = {
  name: JIRA_CODE_API_TOOL_NAME,
  description: JIRA_CODE_API_TOOL_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
} as const;

// Body returned by a successful invocation. Stays under 1KB so the
// agent's first call doesn't blow the budget the rest of the session
// is supposed to save.
export interface CodeApiToolResponse {
  cli: string;
  socketEnv: string;
  socketAddress: string;
  usage: string;
}

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
