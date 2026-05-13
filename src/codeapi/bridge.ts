// Jira-specific bridge wrapper around the toolkit's IPC primitives.
//
// All socket handling, wire format, connection lifecycle, and the
// invoke→sandbox dispatch loop live in
// `@scottlepper/mcp-toolkit/bridge`. This module:
//
//   1. Pins the address to a `jmcp-<hash>.sock` filename under
//      ${TMPDIR} when the session-cache path is too long for
//      sockaddr_un (preserves the v2 socket prefix).
//   2. Injects the Jira sandbox + trim registry + agile-routing
//      execute hook so the toolkit's dispatcher routes platform vs
//      agile correctly.
//   3. Pre-checks `JIRA_DISABLED_ACTIONS` inside the executor so the
//      OperationError names the env var users actually need to edit
//      (the toolkit's generic check would throw "Operation X is
//      disabled." with no hint).
//   4. Keeps the v2 positional `invokeAndSandbox` signature so
//      `cli/direct.ts` and the bridge tests don't need to change.

import {
  startBridge as toolkitStartBridge,
  invokeAndSandbox as toolkitInvokeAndSandbox,
  defaultBridgeAddress as toolkitDefaultBridgeAddress,
  type BridgeAddress,
  type BridgeServer,
} from "@scottlepper/mcp-toolkit/bridge";
import type { JiraClient } from "../auth/jira-client.js";
import { makeJiraExecutor, type Manifest } from "../core/manifest.js";
import { jiraSandbox } from "../core/sandbox.js";
import { trimRegistry } from "../core/trim-registry.js";
import type { SandboxResult } from "../types/refs.js";

export type { BridgeAddress, BridgeServer };

// Defaults the socket path under the current session cache dir.
// `socketPrefix: "jmcp"` preserves the v2 fallback filename so any
// external tooling watching `${TMPDIR}/jmcp-*.sock` still finds us
// when the preferred in-session path exceeds sockaddr_un's limit on
// macOS.
export function defaultBridgeAddress(): BridgeAddress {
  return toolkitDefaultBridgeAddress({
    sessionCacheDir: jiraSandbox.sessionCacheDir(),
    socketPrefix: "jmcp",
  });
}

export interface StartBridgeOpts {
  manifest: Manifest;
  client: JiraClient;
  address?: BridgeAddress;
  disabledActions?: readonly string[];
}

export async function startBridge(
  opts: StartBridgeOpts,
): Promise<BridgeServer> {
  return toolkitStartBridge({
    manifest: opts.manifest,
    client: opts.client,
    sandbox: jiraSandbox,
    trimRegistry,
    address: opts.address ?? defaultBridgeAddress(),
    // Disabled-action enforcement lives inside the executor so the
    // OperationError mentions JIRA_DISABLED_ACTIONS. We deliberately
    // do not pass disabledActions to the toolkit (its check would run
    // first and throw a generic message).
    execute: makeJiraExecutor(opts.disabledActions),
  });
}

// Positional-signature wrapper preserved for `cli/direct.ts` (which
// dispatches without the bridge running) and the bridge tests.
export async function invokeAndSandbox(
  manifest: Manifest,
  client: JiraClient,
  operation: string,
  args: Record<string, unknown>,
  disabledActions?: readonly string[],
): Promise<SandboxResult<unknown>> {
  return toolkitInvokeAndSandbox(
    {
      manifest,
      client,
      sandbox: jiraSandbox,
      trimRegistry,
      execute: makeJiraExecutor(disabledActions),
    },
    operation,
    args,
  );
}
