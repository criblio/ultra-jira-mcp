// Direct mode for jira-cli — talk to Jira without an MCP server.
//
// When JIRA_MCP_SOCKET is set, the CLI forwards every call over the
// IPC bridge to a running jira-mcp server. That's the supported flow
// for agents driven by an MCP host (Claude Code, Claude Desktop).
//
// When JIRA_MCP_SOCKET is *not* set, this module kicks in: the CLI
// reads JIRA_HOST / JIRA_EMAIL / JIRA_API_TOKEN from its own
// environment, builds a JiraClient locally, and dispatches the
// operation through the same `invokeAndSandbox` primitive the bridge
// uses on the server side. Result: identical trim + ref behaviour,
// no server process required.
//
// Why expose this:
//   - Some users want a CLI without standing up an MCP host. Same
//     credentials, same env var names — just `jira-cli <op> ...`
//     from any shell.
//   - Lets the agent fall through to a working call when its MCP
//     handshake hasn't run, instead of erroring with "JIRA_MCP_SOCKET
//     not set".
//
// Credential isolation: the agent never sees JIRA_API_TOKEN. It
// invokes `jira-cli ...`; the CLI process inherits env from whatever
// shell spawned it. Same trust boundary the MCP-server path has —
// the difference is just *where* the JiraClient lives (in this
// process vs. in the MCP server's process).

import { JiraClient } from "../auth/jira-client.js";
import { getConfig } from "../config.js";
import { operations } from "../core/operations.js";
import { invokeAndSandbox } from "../codeapi/bridge.js";
import type { SandboxResult } from "../types/refs.js";

export interface DirectCallResult extends SandboxResult<unknown> {}

// Run one operation against the local JiraClient and return the
// same SandboxResult shape the bridge would emit. Throws on missing
// env / invalid args / Jira API errors — the CLI's main() turns
// those into a stderr message + non-zero exit.
//
// disabledActions is read from the same JIRA_DISABLED_ACTIONS env
// var the MCP server honors, so a user who relies on it for safety
// gets the same guarantee in direct mode.
export async function callDirect(
  operation: string,
  args: Record<string, unknown>,
): Promise<DirectCallResult> {
  // getConfig() loads .env / .env.local (via dotenv), validates the
  // required Jira creds, and returns a JiraConfig. Any missing var
  // throws a clear error message that the CLI surfaces verbatim.
  const config = getConfig();
  const client = new JiraClient(config);
  return invokeAndSandbox(
    operations,
    client,
    operation,
    args,
    config.toolFilter.disabledActions,
  );
}
