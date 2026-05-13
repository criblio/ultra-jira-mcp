// Configures the shared `jiraSandbox` instance for this server.
//
// All disk-cache writes (response sandbox, attachment downloads, the
// tenant cache, the bridge socket dir) live under
// $TMPDIR/jira-mcp/$MCP_SESSION_ID/. The toolkit owns the implementation;
// this module just picks the root name and session env var.

import {
  createSandbox,
  type SandboxInstance,
} from "@scottlepper/mcp-toolkit/sandbox";

export const jiraSandbox: SandboxInstance = createSandbox({
  rootName: "jira-mcp",
  sessionEnvVar: "MCP_SESSION_ID",
});

export const sandbox: SandboxInstance["sandbox"] = jiraSandbox.sandbox;
export const sessionCacheDir: SandboxInstance["sessionCacheDir"] = () =>
  jiraSandbox.sessionCacheDir();
export const rootCacheDir: SandboxInstance["rootCacheDir"] = () =>
  jiraSandbox.rootCacheDir();
export const cleanupStaleSessions: SandboxInstance["cleanupStaleSessions"] = (
  now?: number,
) => jiraSandbox.cleanupStaleSessions(now);
export const __resetSessionCacheDirForTests: SandboxInstance["__resetSessionCacheDirForTests"] =
  () => jiraSandbox.__resetSessionCacheDirForTests();

export type {
  CleanupError,
  CleanupResult,
} from "@scottlepper/mcp-toolkit/sandbox";
