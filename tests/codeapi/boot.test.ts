import * as fs from "node:fs/promises";
import * as net from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JiraClient } from "../../src/auth/jira-client.js";
import { bootCodeApi } from "../../src/codeapi/boot.js";
import {
  __resetSessionCacheDirForTests,
  sessionCacheDir,
} from "../../src/core/sandbox.js";

// --- Plumbing --------------------------------------------------------

const ORIGINAL_SESSION_ID = process.env.MCP_SESSION_ID;
const ORIGINAL_SOCKET = process.env.JIRA_MCP_SOCKET;

function makeMockClient(): JiraClient {
  const stub = vi.fn().mockResolvedValue({});
  return {
    get: stub,
    post: stub,
    put: stub,
    delete: stub,
    agileGet: stub,
    agilePost: stub,
    agilePut: stub,
    agileDelete: stub,
  } as unknown as JiraClient;
}

beforeEach(() => {
  process.env.MCP_SESSION_ID = `boot-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  __resetSessionCacheDirForTests();
  delete process.env.JIRA_MCP_SOCKET;
});

afterEach(async () => {
  // Wipe just this test's session dir.
  await fs.rm(sessionCacheDir(), { recursive: true, force: true }).catch(() => {});
  // Restore env.
  if (ORIGINAL_SESSION_ID === undefined) delete process.env.MCP_SESSION_ID;
  else process.env.MCP_SESSION_ID = ORIGINAL_SESSION_ID;
  if (ORIGINAL_SOCKET === undefined) delete process.env.JIRA_MCP_SOCKET;
  else process.env.JIRA_MCP_SOCKET = ORIGINAL_SOCKET;
});

// --- Tests -----------------------------------------------------------

describe("bootCodeApi", () => {
  it("starts the bridge and publishes JIRA_MCP_SOCKET", async () => {
    // boot no longer generates anything per session — the jira-cli
    // binary ships statically (built by `tsc` at npm run build time).
    // This test only asserts the lifecycle pieces boot still owns:
    // bridge startup + env var publication + cliPath threading.
    const client = makeMockClient();
    const cliPath = "/tmp/test-cli-path-not-actually-executed-here";
    const booted = await bootCodeApi({
      client,
      cliPath,
      cleanupSessions: false,
    });
    try {
      expect(booted.ctx.cliPath).toBe(cliPath);
      expect(booted.bridge.address).toBeTruthy();
      expect(booted.ctx.socketAddress).toBe(booted.bridge.address);
      expect(process.env.JIRA_MCP_SOCKET).toBe(booted.bridge.address);
    } finally {
      await booted.bridge.close();
    }
  });

  it("end-to-end: invoke wire reaches the bridge and returns a SandboxResult", async () => {
    // Stand up the full stack and drive it the way a generated stub
    // would: open a connection to JIRA_MCP_SOCKET, send a one-line
    // ND-JSON request, await one line back.
    const client = makeMockClient();
    // Override one method so we can assert it was reached.
    (client as unknown as { get: ReturnType<typeof vi.fn> }).get = vi
      .fn()
      .mockResolvedValue({
        id: "10",
        key: "ABC-1",
        fields: {
          summary: "End-to-end",
          status: { name: "Open" },
          assignee: null,
          reporter: null,
          priority: { name: "Low" },
          labels: [],
          description: null,
          comment: { total: 0, comments: [] },
          attachment: [],
        },
      });

    const booted = await bootCodeApi({ client, cleanupSessions: false });
    try {
      const addr = process.env.JIRA_MCP_SOCKET!;
      expect(addr).toBeTruthy();

      const resp = await new Promise<any>((resolve, reject) => {
        const target = addr.startsWith("tcp:")
          ? (() => {
              const lastColon = addr.lastIndexOf(":");
              return {
                host: addr.slice(4, lastColon),
                port: Number(addr.slice(lastColon + 1)),
              };
            })()
          : { path: addr };
        const sock = net.connect(target as never);
        sock.setEncoding("utf8");
        let buffer = "";
        sock.on("connect", () => {
          sock.write(
            JSON.stringify({
              id: "1",
              method: "invoke",
              params: { operation: "issue.get", args: { issueIdOrKey: "ABC-1" } },
            }) + "\n",
          );
        });
        sock.on("data", (chunk: string) => {
          buffer += chunk;
          const nl = buffer.indexOf("\n");
          if (nl < 0) return;
          try {
            resolve(JSON.parse(buffer.slice(0, nl)));
            sock.end();
          } catch (e) {
            reject(e);
          }
        });
        sock.on("error", reject);
      });

      expect(resp.id).toBe("1");
      expect(resp.error).toBeUndefined();
      expect(resp.result.summary).toMatchObject({
        key: "ABC-1",
        status: "Open",
      });
      // The full response was sandboxed to disk, retrievable via ref.
      const full = JSON.parse(await fs.readFile(resp.result.ref, "utf8"));
      expect(full.key).toBe("ABC-1");
    } finally {
      await booted.bridge.close();
    }
  });

  it("defaults cliPath to build/cli/index.js when not overridden", async () => {
    const client = makeMockClient();
    const booted = await bootCodeApi({ client, cleanupSessions: false });
    try {
      // The default points at this build's compiled CLI binary,
      // resolved relative to boot.js. We don't assert it exists on
      // disk here (depends on npm run build having run), only that
      // the path shape is correct.
      expect(booted.ctx.cliPath).toMatch(/[/\\]cli[/\\]index\.js$/);
      expect(booted.ctx.cliPath).not.toContain(sessionCacheDir());
    } finally {
      await booted.bridge.close();
    }
  });
});
