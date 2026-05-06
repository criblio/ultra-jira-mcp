// Code-api startup glue.
//
// Pulled out of `src/index.ts` so the wiring (cleanup → resolve
// CLI path → start bridge → publish socket env var) is testable in
// isolation, without standing up the MCP transport.
//
// The CLI binary (jira-cli) ships pre-built in the npm package at
// build/cli/index.js. Per-session uniqueness is handled entirely by
// JIRA_MCP_SOCKET, which the CLI reads from its own env at invoke
// time.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { JiraClient } from "../auth/jira-client.js";
import { operations } from "../core/operations.js";
import { cleanupStaleSessions } from "../core/sandbox.js";
import { startBridge, type BridgeServer } from "./bridge.js";
import type { CodeApiToolContext } from "./tool.js";

// Resolves to build/cli/index.js at runtime. This module compiles to
// build/codeapi/boot.js, so "../cli/index.js" from there lands at
// build/cli/index.js. The CLI is what code-api mode hands to the
// agent — a single shell-callable binary that talks to the bridge
// over the JIRA_MCP_SOCKET socket.
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
    await cleanupStaleSessions().catch(() => {
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
