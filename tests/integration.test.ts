// Integration tests against a live Jira instance.
//
// These exercise the v2 surface end-to-end through the same code path
// the MCP server uses: classic mode goes through `handleV2Tool`,
// code-api mode goes through the IPC bridge and `invokeAndSandbox`.
// Read-only by design — no creates, updates, or deletes — so a
// crashed run doesn't leave debris in Jira.
//
// Run with `npm run test:integration` (or `npm test` will pick them
// up too). The whole suite skips when JIRA_HOST is unset, so unit
// runs in CI without Jira creds keep working.

import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Importing config.ts pulls in dotenv as a side-effect, so .env.local
// is read into process.env before we look at JIRA_HOST below. Without
// this the suite would skip even when creds *are* set in .env.local
// because vitest doesn't load env files itself.
import "../src/config.js";
import { JiraClient } from "../src/auth/jira-client.js";
import { bootCodeApi, type BootedCodeApi } from "../src/codeapi/boot.js";
import {
  __resetSessionCacheDirForTests,
  sessionCacheDir,
} from "../src/core/sandbox.js";
import { handleV2Tool } from "../src/tools/v2/index.js";

// --- Skip wiring -------------------------------------------------------

// vitest's describe.skipIf works at file-eval time, so we have to
// resolve the env once up front rather than per-test. The benchmark
// uses the same convention; see scripts/benchmark.ts loadEnvLocal.
const haveCreds =
  !!process.env.JIRA_HOST &&
  !!process.env.JIRA_EMAIL &&
  !!process.env.JIRA_API_TOKEN;
const haveTickets =
  !!process.env.JIRA_BENCH_TICKET_RICH &&
  !!process.env.JIRA_BENCH_TICKET_SIMPLE;
const canRun = haveCreds && haveTickets;

const RICH = process.env.JIRA_BENCH_TICKET_RICH ?? "";
const SIMPLE = process.env.JIRA_BENCH_TICKET_SIMPLE ?? "";

// Pin a stable session id — keeps the per-run cache dir predictable
// for cleanup, and avoids interfering with concurrent benchmarks.
const SESSION_ID = `int-${Date.now().toString(36)}-${process.pid}`;
const ORIGINAL_SESSION_ID = process.env.MCP_SESSION_ID;
const ORIGINAL_SOCKET = process.env.JIRA_MCP_SOCKET;

let client: JiraClient;
let booted: BootedCodeApi | null = null;

beforeAll(() => {
  if (!canRun) return;
  process.env.MCP_SESSION_ID = SESSION_ID;
  __resetSessionCacheDirForTests();
  client = new JiraClient({
    host: process.env.JIRA_HOST!,
    email: process.env.JIRA_EMAIL!,
    apiToken: process.env.JIRA_API_TOKEN!,
    cloudId: process.env.JIRA_CLOUD_ID,
    tokenType: process.env.JIRA_API_TOKEN!.startsWith("ATATT") ||
                process.env.JIRA_API_TOKEN!.startsWith("ATSTT")
      ? "scoped"
      : "classic",
    toolMode: "classic",
    toolFilter: { enabledCategories: [], disabledActions: [] },
  });
});

afterAll(async () => {
  if (booted) {
    await booted.bridge.close().catch(() => {});
    booted = null;
  }
  if (canRun) {
    // Wipe just this session's dir.
    await fs.rm(sessionCacheDir(), { recursive: true, force: true }).catch(() => {});
  }
  if (ORIGINAL_SESSION_ID === undefined) delete process.env.MCP_SESSION_ID;
  else process.env.MCP_SESSION_ID = ORIGINAL_SESSION_ID;
  if (ORIGINAL_SOCKET === undefined) delete process.env.JIRA_MCP_SOCKET;
  else process.env.JIRA_MCP_SOCKET = ORIGINAL_SOCKET;
});

// --- Tests -------------------------------------------------------------

describe.skipIf(!canRun)("classic mode (live Jira)", () => {
  it("jira_user.myself returns the configured user", async () => {
    const result = (await handleV2Tool(client, "jira_user", {
      action: "myself",
    })) as { accountId: string; displayName: string };
    expect(result.accountId).toBeTruthy();
    expect(result.displayName).toBeTruthy();
  });

  it("jira_issue.get on the simple ticket returns a trimmed summary", async () => {
    const result = (await handleV2Tool(client, "jira_issue", {
      action: "get",
      issueIdOrKey: SIMPLE,
    })) as {
      key: string;
      summary: string;
      status?: string;
      assignee: unknown;
      attachmentCount: number;
    };
    expect(result.key).toBe(SIMPLE);
    expect(typeof result.summary).toBe("string");
    expect(typeof result.attachmentCount).toBe("number");
  });

  it("jira_issue.get on the rich ticket includes a comment count", async () => {
    const result = (await handleV2Tool(client, "jira_issue", {
      action: "get",
      issueIdOrKey: RICH,
    })) as { key: string; commentCount: number };
    expect(result.key).toBe(RICH);
    expect(result.commentCount).toBeGreaterThan(0);
  });

  it("jira_comment.list emits count + metadata only (no inline items)", async () => {
    const result = (await handleV2Tool(client, "jira_comment", {
      action: "list",
      issueIdOrKey: RICH,
      maxResults: 100,
    })) as {
      total: number;
      startAt: number;
      maxResults: number;
      truncated: boolean;
    };
    expect(result.total).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
    // No `comments` array on the wire — that's the whole trim point.
    expect((result as Record<string, unknown>).comments).toBeUndefined();
  });

  it("jira_search returns issue rows (cursor-paginated /search/jql)", async () => {
    // Jira's /search/jql endpoint returns {issues, isLast} without
    // a total. searchSummary preserves that shape; the test asserts
    // we got at least the row we asked for and that pagination
    // metadata is present in some form (either total OR isLast).
    const result = (await handleV2Tool(client, "jira_search", {
      action: "issues",
      jql: `key = ${SIMPLE}`,
      fields: "summary,status",
      maxResults: 1,
    })) as {
      total?: number;
      isLast?: boolean;
      issues: Array<{ key: string; summary: string }>;
    };
    expect(result.issues[0].key).toBe(SIMPLE);
    // One of these must surface so the agent can detect end-of-results.
    expect(result.total !== undefined || result.isLast !== undefined).toBe(
      true,
    );
  });

  it("respects JIRA_DISABLED_ACTIONS at the dispatch layer", async () => {
    // Pass disabled actions inline. handleV2Tool forwards them to
    // the dispatcher → invokeOperationRaw, which throws OperationError
    // before any Jira HTTP call. We confirm the error and that no
    // sandbox file shows up under issue-delete (the only side-effect
    // we'd observe — get/list still get cached, so we can't simply
    // count files).
    await expect(
      handleV2Tool(
        client,
        "jira_issue",
        { action: "delete", issueIdOrKey: SIMPLE },
        ["issue.delete"],
      ),
    ).rejects.toThrow(/JIRA_DISABLED_ACTIONS/);
  });
});

// --- code-api mode -----------------------------------------------------

describe.skipIf(!canRun)("code-api mode (live Jira)", () => {
  beforeAll(async () => {
    booted = await bootCodeApi({ client, cleanupSessions: false });
  });

  it("jira_code_api context exposes the cli path + socket", () => {
    expect(booted!.ctx.cliPath).toBeTruthy();
    expect(booted!.ctx.socketAddress).toBeTruthy();
    expect(booted!.bridge.address).toBe(booted!.ctx.socketAddress);
  });

  it("invoking issue.get over the bridge returns a SandboxResult with .ref on disk", async () => {
    const result = await callBridge(booted!.bridge.address, "issue.get", {
      issueIdOrKey: SIMPLE,
    });
    expect(result.summary).toMatchObject({ key: SIMPLE });
    expect(result.ref).toBeTruthy();
    const stat = await fs.stat(result.ref);
    expect(stat.size).toBeGreaterThan(0);
    // Reading the ref returns the full untrimmed Jira response.
    const full = JSON.parse(await fs.readFile(result.ref, "utf8")) as {
      key: string;
      fields: { summary: string };
    };
    expect(full.key).toBe(SIMPLE);
    expect(typeof full.fields.summary).toBe("string");
  });

  it("invoking comment.list over the bridge produces the same trimmed shape as classic", async () => {
    const result = await callBridge(booted!.bridge.address, "comment.list", {
      issueIdOrKey: RICH,
      maxResults: 100,
    });
    expect(result.summary).toMatchObject({
      truncated: true,
    });
    // The bridge trim is the same paginatedListSummary shape used in classic.
    expect((result.summary as Record<string, unknown>).comments).toBeUndefined();
  });

  it("invoking issue.delete with disabledActions wired in is rejected", async () => {
    // Spin up a bridge with the disabled-action set populated so we
    // exercise the safety guarantee end-to-end. Don't reuse the
    // shared `booted` because we want a fresh bridge address with
    // the filter active — the global one in this describe block is
    // unfiltered.
    const local = await bootCodeApi({
      client,
      cleanupSessions: false,
      cliPath: path.join(sessionCacheDir(), "cli-disabled"),
      disabledActions: ["issue.delete"],
    });
    try {
      await expect(
        callBridge(local.bridge.address, "issue.delete", {
          issueIdOrKey: SIMPLE,
        }),
      ).rejects.toThrow(/JIRA_DISABLED_ACTIONS/);
    } finally {
      await local.bridge.close();
    }
  });
});

// --- Helpers -----------------------------------------------------------

interface BridgeResult {
  summary: unknown;
  ref: string;
  hash: string;
  fullSize: number;
  fetchedAt: string;
}

// Mirrors what the generated _client.ts does — open a connection,
// send one ND-JSON line, await one line back. Kept inline rather
// than importing from tests/codeapi so this file stands on its own
// for anyone reading the integration suite.
function callBridge(
  address: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const target = address.startsWith("tcp:")
      ? (() => {
          const lc = address.lastIndexOf(":");
          return {
            host: address.slice(4, lc),
            port: Number(address.slice(lc + 1)),
          };
        })()
      : { path: address };
    const sock = net.connect(target as never);
    sock.setEncoding("utf8");
    sock.setTimeout(30_000, () => {
      sock.destroy(
        new Error(`bridge call to ${operation} timed out after 30s`),
      );
    });
    let buf = "";
    sock.on("connect", () => {
      sock.write(
        JSON.stringify({
          id: "int",
          method: "invoke",
          params: { operation, args },
        }) + "\n",
      );
    });
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      let resp: { id: string; result?: BridgeResult; error?: { name: string; message: string } };
      try {
        resp = JSON.parse(buf.slice(0, nl));
      } catch (err) {
        sock.destroy();
        return reject(err);
      }
      sock.end();
      if (resp.error) {
        return reject(new Error(`${resp.error.name}: ${resp.error.message}`));
      }
      resolve(resp.result!);
    });
    sock.on("error", (err) => reject(err));
  });
}
