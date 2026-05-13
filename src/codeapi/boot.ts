// Code-api startup glue.
//
// Three steps wrap together at server boot in code-api mode:
//
//   1. Sweep stale session dirs (>24h old) under the cache root.
//   2. Resolve the bundled `jira-cli` binary path relative to this
//      compiled module's location.
//   3. Start the IPC bridge and publish its socket address in
//      `JIRA_MCP_SOCKET` so any subprocess (Claude Code's Bash, a
//      direct `jira-cli` invocation) inherits it without manual setup.
//
// The toolkit ships a `bootCodeApi` helper that does steps (1) and (3)
// generically, but jira-mcp's bridge needs an explicit socket-prefix
// override (preserving the v2 `jmcp-<hash>.sock` filename) that the
// toolkit's helper doesn't surface. So we orchestrate the steps
// ourselves and call jira-mcp's own `startBridge`, which handles the
// prefix and the agile-vs-platform routing executor.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { JiraClient } from "../auth/jira-client.js";
import { operations } from "../core/operations.js";
import { jiraSandbox } from "../core/sandbox.js";
import { startBridge, type BridgeServer } from "./bridge.js";
import type { CodeApiToolContext } from "./tool.js";

// Resolves to build/cli/index.js at runtime. This module compiles to
// build/codeapi/boot.js, so "../cli/index.js" lands at build/cli/index.js.
// The CLI is what code-api mode hands to the agent — a single
// shell-callable binary that talks to the bridge over JIRA_MCP_SOCKET.
export function defaultCliPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "cli", "index.js");
}

export interface BootedCodeApi {
  bridge: BridgeServer;
  ctx: CodeApiToolContext;
}

export interface BootCodeApiOpts {
  client: JiraClient;
  // Forwarded to startBridge so JIRA_DISABLED_ACTIONS rules apply to
  // bridge dispatch. Without this, an op disabled in classic mode
  // would still be reachable when a user opts into code-api.
  disabledActions?: readonly string[];
  // Override hook for tests. Production callers leave this unset.
  cliPath?: string;
  // When false (default true) skip the cleanup-stale-sessions sweep.
  // Tests turn this off to avoid touching siblings of their session
  // dir.
  cleanupSessions?: boolean;
}

export async function bootCodeApi(
  opts: BootCodeApiOpts,
): Promise<BootedCodeApi> {
  if (opts.cleanupSessions !== false) {
    await jiraSandbox.cleanupStaleSessions().catch(() => {
      // Best-effort. Permission failures on a stale dir shouldn't
      // block startup.
    });
  }

  const cliPath = opts.cliPath ?? defaultCliPath();

  const bridge = await startBridge({
    manifest: operations,
    client: opts.client,
    disabledActions: opts.disabledActions,
  });

  // Place the socket in the *server* env so any subprocess (Claude
  // Code's Bash tool, a direct jira-cli invocation) inherits it
  // without the user having to configure anything.
  process.env.JIRA_MCP_SOCKET = bridge.address;

  return {
    bridge,
    ctx: { cliPath, socketAddress: bridge.address },
  };
}
