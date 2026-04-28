// The single MCP tool exposed in code-api mode (PR #10).
//
// In default mode the server publishes only this tool. Calling it
// returns the path to the generated TypeScript stubs and a short
// usage example; the agent then drives Jira through those stubs in
// its own execution environment (Claude Code's Bash + tsx, etc.) and
// never calls an MCP tool again for reads.
//
// The handler is stateless — the heavy lifting (stub generation +
// bridge startup) happens once at server boot in `src/index.ts`. We
// just describe to the agent what was set up.

export interface CodeApiToolContext {
  apiDir: string;        // absolute path to generated `api/`
  socketAddress: string; // value placed in JIRA_MCP_SOCKET
}

export const JIRA_CODE_API_TOOL_NAME = "jira_code_api";

// Description text rendered in the MCP tool listing. Kept tight so
// the listing token cost stays under the ~500-token target the plan
// quotes for Layer 3.
export const JIRA_CODE_API_TOOL_DESCRIPTION =
  "Access Jira via TypeScript. Call once to get the on-disk API path, " +
  "then `import` the generated stubs in your shell (tsx) — every call " +
  "returns a Ref<T> with a trimmed summary inline and the full response " +
  "on disk for when you need it.";

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
  apiDir: string;
  rootIndex: string;
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
  // than assume it's already set. tsx is the recommended runner — it
  // executes the .ts stubs directly.
  const usage = [
    `# Run in your shell (tsx required). The JIRA_MCP_SOCKET prefix is`,
    `# load-bearing — child shells don't inherit the MCP server's env.`,
    `JIRA_MCP_SOCKET=${ctx.socketAddress} npx tsx -e '`,
    `import * as jira from "${ctx.apiDir}/index.js";`,
    `const issue = await jira.issue.get({ issueIdOrKey: "PROJ-1" });`,
    `console.log(issue.summary.status);  // trimmed projection — free to inspect`,
    `// issue.ref points at the full JSON; read it with fs.readFile when you need detail.`,
    `'`,
  ].join("\n");

  return {
    apiDir: ctx.apiDir,
    rootIndex: `${ctx.apiDir}/index.js`,
    socketEnv: "JIRA_MCP_SOCKET",
    socketAddress: ctx.socketAddress,
    usage,
  };
}
