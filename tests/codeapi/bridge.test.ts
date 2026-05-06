import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JiraClient } from "../../src/auth/jira-client.js";
import {
  defaultBridgeAddress,
  invokeAndSandbox,
  startBridge,
  type BridgeServer,
} from "../../src/codeapi/bridge.js";
import type { Manifest } from "../../src/core/manifest.js";
import {
  __resetSessionCacheDirForTests,
  rootCacheDir,
  sessionCacheDir,
} from "../../src/core/sandbox.js";

// --- Test plumbing -----------------------------------------------------

// One unique session id per test run, so each test writes into its
// own isolated subdir under the cache root and won't see another
// test's sockets / sandbox files.
const ORIGINAL_SESSION_ID = process.env.MCP_SESSION_ID;

function makeMockClient() {
  const calls: Array<{ api: string; path: string; query?: unknown; body?: unknown }> = [];
  let nextResponse: unknown = {};
  const record = (api: string) =>
    vi.fn((p: string, bodyOrQuery?: unknown, maybeQuery?: unknown) => {
      if (api === "get" || api === "delete" || api === "agileGet" || api === "agileDelete") {
        calls.push({ api, path: p, query: bodyOrQuery });
      } else {
        calls.push({ api, path: p, body: bodyOrQuery, query: maybeQuery });
      }
      return Promise.resolve(nextResponse);
    });
  const client = {
    get: record("get"),
    post: record("post"),
    put: record("put"),
    delete: record("delete"),
    agileGet: record("agileGet"),
    agilePost: record("agilePost"),
    agilePut: record("agilePut"),
    agileDelete: record("agileDelete"),
  } as unknown as JiraClient;
  return {
    client,
    calls,
    setResponse(v: unknown) {
      nextResponse = v;
    },
  };
}

const fixtureManifest: Manifest = [
  {
    name: "issue.get",
    description: "Fetch a single issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "fields", role: "query" },
    ],
    trim: "issue",
  },
  {
    name: "field.list",
    description: "List fields.",
    verb: "GET",
    pathTemplate: "/field",
    params: [],
    // No trim — used to verify the sandbox falls through to identity.
  },
];

// Minimal Jira issue fixture that satisfies the `issue` trim
// projection's required fields (key, fields.summary, etc.).
const fixtureIssue = {
  id: "10001",
  key: "PROJ-1",
  fields: {
    summary: "Test issue",
    status: { name: "Open" },
    assignee: null,
    reporter: null,
    priority: { name: "Medium" },
    labels: [],
    description: null,
    comment: { total: 0, comments: [] },
    attachment: [],
  },
};

beforeEach(() => {
  // Keep this short — Unix domain socket path = tmpdir + this id +
  // "ipc.sock" must fit in 100 bytes on macOS. The bridge has a
  // hash-fallback for longer paths (covered by its own test), but
  // we want the happy path here.
  process.env.MCP_SESSION_ID = `bt-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  __resetSessionCacheDirForTests();
});

afterEach(async () => {
  // Clean up just this test's session dir.
  await fs.rm(sessionCacheDir(), { recursive: true, force: true }).catch(() => {});
  if (ORIGINAL_SESSION_ID === undefined) {
    delete process.env.MCP_SESSION_ID;
  } else {
    process.env.MCP_SESSION_ID = ORIGINAL_SESSION_ID;
  }
});

// --- invokeAndSandbox (no socket) -------------------------------------

describe("invokeAndSandbox", () => {
  it("returns a SandboxResult with the trim projection in summary", async () => {
    const { client, setResponse } = makeMockClient();
    setResponse(fixtureIssue);

    const result = await invokeAndSandbox(
      fixtureManifest,
      client,
      "issue.get",
      { issueIdOrKey: "PROJ-1" },
    );

    expect(result).toMatchObject({
      summary: { key: "PROJ-1", id: "10001", status: "Open" },
      hash: expect.any(String),
      ref: expect.stringContaining("issue-get"),
      fullSize: expect.any(Number),
    });
    // The full untrimmed response was written to disk.
    const fullJson = await fs.readFile(result.ref, "utf8");
    expect(JSON.parse(fullJson)).toEqual(fixtureIssue);
  });

  it("uses identity summary when the operation declares no trim", async () => {
    const { client, setResponse } = makeMockClient();
    const payload = { fields: [{ id: "summary" }] };
    setResponse(payload);

    const result = await invokeAndSandbox(
      fixtureManifest,
      client,
      "field.list",
      {},
    );
    expect(result.summary).toEqual(payload);
  });

  it("propagates OperationError for unknown operation", async () => {
    const { client } = makeMockClient();
    await expect(
      invokeAndSandbox(fixtureManifest, client, "missing.op", {}),
    ).rejects.toThrow(/Unknown operation: missing\.op/);
  });
});

// --- Bridge server (over a real socket) -------------------------------

// Helpers: open a connection to the running bridge and exchange one
// JSON line. callBridgeRaw lets a test send arbitrary request shapes
// (e.g. malformed ones); callBridge wraps it for the typical
// well-formed "invoke" request. Both handle Unix-socket and
// loopback-TCP transports so tests run on POSIX and Windows.
function dialBridge(address: string): net.Socket {
  if (address.startsWith("tcp:")) {
    const lastColon = address.lastIndexOf(":");
    const host = address.slice(4, lastColon);
    const port = Number(address.slice(lastColon + 1));
    return net.connect({ host, port });
  }
  return net.connect({ path: address });
}

function callBridgeRaw(
  address: string,
  request: Record<string, unknown>,
): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    const socket = dialBridge(address);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.end();
      fn();
    };
    socket.on("connect", () => {
      socket.write(JSON.stringify(request) + "\n");
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      try {
        const resp = JSON.parse(buffer.slice(0, nl));
        settle(() => resolve(resp));
      } catch (err) {
        settle(() => reject(err));
      }
    });
    socket.on("error", (err) => settle(() => reject(err)));
  });
}

function callBridge(
  address: string,
  request: { id: string; operation: string; args?: Record<string, unknown> },
): Promise<any> {
  return callBridgeRaw(address, {
    id: request.id,
    method: "invoke",
    params: { operation: request.operation, args: request.args ?? {} },
  });
}

describe("startBridge", () => {
  let bridge: BridgeServer | null = null;

  afterEach(async () => {
    if (bridge) {
      await bridge.close();
      bridge = null;
    }
  });

  it("listens on a Unix socket file (POSIX)", async () => {
    if (process.platform === "win32") return;
    const { client } = makeMockClient();
    bridge = await startBridge({ manifest: fixtureManifest, client });
    // With short test session ids the address sits inside the session
    // cache dir; with longer ones it falls back to a hashed path
    // directly under tmpdir. Either is valid — we just want a real
    // socket file at the advertised address.
    expect(bridge.address.endsWith(".sock")).toBe(true);
    await fs.access(bridge.address);
  });

  it("dispatches an invoke and returns a SandboxResult over the wire", async () => {
    const { client, calls, setResponse } = makeMockClient();
    setResponse(fixtureIssue);
    bridge = await startBridge({ manifest: fixtureManifest, client });

    const resp: any = await callBridge(bridge.address, {
      id: "req-1",
      operation: "issue.get",
      args: { issueIdOrKey: "PROJ-1", fields: "summary,status" },
    });

    expect(resp.id).toBe("req-1");
    expect(resp.error).toBeUndefined();
    expect(resp.result).toMatchObject({
      summary: { key: "PROJ-1", status: "Open" },
      ref: expect.any(String),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      api: "get",
      path: "/issue/PROJ-1",
    });
    expect(calls[0].query).toMatchObject({ fields: "summary,status" });
  });

  it("returns a typed error response when the operation is unknown", async () => {
    const { client } = makeMockClient();
    bridge = await startBridge({ manifest: fixtureManifest, client });

    const resp: any = await callBridge(bridge.address, {
      id: "req-err",
      operation: "missing.op",
    });

    expect(resp.id).toBe("req-err");
    expect(resp.result).toBeUndefined();
    expect(resp.error).toMatchObject({
      name: "OperationError",
      message: expect.stringContaining("missing.op"),
    });
  });

  it("returns a ProtocolError when the request shape is malformed", async () => {
    const { client } = makeMockClient();
    bridge = await startBridge({ manifest: fixtureManifest, client });

    // Use callBridgeRaw rather than the typed callBridge() helper so
    // we can inject a request with method != "invoke". Mirrors what
    // the typed helper does for transport selection (path vs tcp:),
    // so this test works on Windows as well as POSIX.
    const resp = await callBridgeRaw(bridge.address, {
      id: "x",
      method: "frob",
    });

    expect(resp.id).toBe("x");
    expect(resp.error.name).toBe("ProtocolError");
  });

  it("close() removes the socket file on POSIX", async () => {
    if (process.platform === "win32") return;
    const { client } = makeMockClient();
    bridge = await startBridge({ manifest: fixtureManifest, client });
    const addr = bridge.address;
    await fs.access(addr);
    await bridge.close();
    bridge = null;
    await expect(fs.access(addr)).rejects.toThrow();
  });

  it("removes a stale socket file from a prior crashed session before binding", async () => {
    if (process.platform === "win32") return;
    // Pre-create a regular file at the address the bridge would
    // pick. The bridge should remove it during startBridge() rather
    // than fail with EADDRINUSE.
    const addr = defaultBridgeAddress();
    if (!addr.listen.path) throw new Error("expected POSIX socket path");
    const stalePath = addr.listen.path;
    await fs.mkdir(path.dirname(stalePath), { recursive: true });
    await fs.writeFile(stalePath, "stale data");

    const { client } = makeMockClient();
    bridge = await startBridge({ manifest: fixtureManifest, client });
    expect(bridge.address).toBe(stalePath);
  });

  it("removes a directory pre-existing at the socket path", async () => {
    if (process.platform === "win32") return;
    // Hardening regression: an attacker (or a stuck process) on the
    // same host could pre-create a directory at the predictable
    // hash-fallback socket path. Without `recursive: true` on the
    // stale-entry cleanup, fs.rm would throw EISDIR and kill server
    // startup. We simulate that here by mkdir'ing the path before
    // startBridge runs.
    const addr = defaultBridgeAddress();
    if (!addr.listen.path) throw new Error("expected POSIX socket path");
    const stalePath = addr.listen.path;
    await fs.mkdir(stalePath, { recursive: true });

    const { client } = makeMockClient();
    bridge = await startBridge({ manifest: fixtureManifest, client });
    expect(bridge.address).toBe(stalePath);
    // Confirm we replaced the dir with a real socket — connecting
    // should succeed.
    await fs.access(bridge.address);
  });
});

// Sanity check: rootCacheDir exists. Just confirms our test
// helpers used a real dir, not a stubbed one.
describe("test plumbing", () => {
  it("uses tmpdir-based cache root", () => {
    expect(rootCacheDir().startsWith(os.tmpdir())).toBe(true);
  });
});
