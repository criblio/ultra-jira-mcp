// Layer 3 IPC bridge (PR #9).
//
// The MCP server opens a local socket; generated stubs in the agent's
// execution environment connect to it and forward each call as a
// newline-delimited JSON request. The server resolves the operation
// against the manifest, runs it through `invokeOperationRaw`, and
// sandboxes the response — returning a `SandboxResult` whose `ref`
// points at the full JSON on disk and whose `summary` carries the
// trimmed projection.
//
// Wire format (one JSON object per line, in both directions):
//
//   request:  { "id": "<string>", "method": "invoke",
//               "params": { "operation": "<name>",
//                           "args": <object> } }
//   ok:       { "id": "<string>", "result": <SandboxResult> }
//   err:      { "id": "<string>",
//               "error": { "name": "<string>", "message": "<string>" } }
//
// The `id` field lets multiple in-flight requests on one connection
// be demultiplexed by the client. Keeping a small explicit envelope
// (rather than the full JSON-RPC 2.0 spec) means we don't carry
// notification/batch baggage we don't use.
//
// Transport: Unix domain socket on POSIX, loopback TCP on Windows.
// `node:net` handles both shapes. Socket addresses surface to the
// agent's execution context via the `JIRA_MCP_SOCKET` env var (set
// at spawn time by PR #10).

import * as net from "node:net";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import type { JiraClient } from "../auth/jira-client.js";
import {
  invokeOperationRaw,
  type Manifest,
} from "../core/manifest.js";
import { sandbox, sessionCacheDir } from "../core/sandbox.js";
import { trimRegistry } from "../core/trim-registry.js";
import type { SandboxResult } from "../types/refs.js";

// --- Wire shapes ------------------------------------------------------

export interface BridgeRequest {
  id: string;
  method: "invoke";
  params: {
    operation: string;
    args?: Record<string, unknown>;
  };
}

export interface BridgeOkResponse {
  id: string;
  result: SandboxResult<unknown>;
}

export interface BridgeErrResponse {
  id: string;
  error: {
    name: string;
    message: string;
  };
}

export type BridgeResponse = BridgeOkResponse | BridgeErrResponse;

// --- Address resolution -----------------------------------------------

// Where the server listens. POSIX uses a Unix domain socket inside
// the session cache dir (auto-cleaned with the rest of the session);
// Windows lacks Unix sockets, so we fall back to loopback TCP.
//
// Returns a `net.ListenOptions`-shaped object plus a stable string
// representation suitable for setting in `JIRA_MCP_SOCKET`. The
// string is what the client uses to reconnect; the listen options
// are what `net.createServer().listen()` consumes.
export interface BridgeAddress {
  // String form passed to clients. On POSIX, this is the abs path
  // to the socket file; on Windows, it's "tcp:127.0.0.1:<port>".
  // The "tcp:" prefix lets the client tell the two apart.
  display: string;
  listen: net.ListenOptions;
}

// macOS limits sockaddr_un.sun_path to 104 bytes; Linux to 108. Both
// will return EINVAL if we try to bind a longer path. The session
// cache path under tmpdir can edge over that on macOS for long
// session IDs, so we keep a short alternative under `${tmpdir}` keyed
// by a hash of the full session path.
const UNIX_SOCKET_PATH_MAX = 100;

function shortSocketPath(fullCachePath: string): string {
  const hash = createHash("sha256")
    .update(fullCachePath)
    .digest("hex")
    .slice(0, 12);
  return path.join(os.tmpdir(), `jmcp-${hash}.sock`);
}

export function defaultBridgeAddress(): BridgeAddress {
  if (process.platform === "win32") {
    // Port 0 = let the kernel pick an ephemeral free port. We
    // discover the actual port after `listen()` and rewrite
    // `display` then. Caller reads `address()` off the server.
    return {
      display: "tcp:127.0.0.1:0",
      listen: { host: "127.0.0.1", port: 0 },
    };
  }
  const preferred = path.join(sessionCacheDir(), "ipc.sock");
  const sockPath =
    Buffer.byteLength(preferred, "utf8") <= UNIX_SOCKET_PATH_MAX
      ? preferred
      : shortSocketPath(preferred);
  return {
    display: sockPath,
    listen: { path: sockPath },
  };
}

// --- Server ------------------------------------------------------------

export interface BridgeServer {
  // Path/host:port advertised to clients. Final form, after Windows
  // ephemeral-port resolution.
  address: string;
  // Stops accepting new connections, closes existing ones, and (on
  // POSIX) removes the socket file. Idempotent.
  close(): Promise<void>;
}

export interface StartBridgeOpts {
  manifest: Manifest;
  client: JiraClient;
  address?: BridgeAddress;
  // Optional. Forwarded to invokeOperationRaw for every bridge call,
  // so JIRA_DISABLED_ACTIONS blocks reach the agent's tsx subprocess
  // before any Jira HTTP request happens — the same safety contract
  // classic mode gets.
  disabledActions?: readonly string[];
}

// Start the bridge server. Returns once it's listening. The caller
// owns the lifetime — call `.close()` at shutdown. PR #10 will wire
// this into the MCP server's startup path.
export async function startBridge(
  opts: StartBridgeOpts,
): Promise<BridgeServer> {
  const addr = opts.address ?? defaultBridgeAddress();

  // POSIX: ensure the socket dir exists, and remove a stale entry
  // from a prior crashed session before binding (otherwise `listen()`
  // errors with EADDRINUSE even though no process is holding it).
  // `recursive: true` covers the case where something else has
  // pre-created a *directory* at the socket path — without it, `rm`
  // would throw EISDIR and kill startup. The hash-fallback path
  // under tmpdir is predictable from the session id, so this is a
  // hardening measure against same-host availability attacks. Windows
  // TCP doesn't need this branch at all.
  if (addr.listen.path) {
    await fs.mkdir(path.dirname(addr.listen.path), { recursive: true });
    if (existsSync(addr.listen.path)) {
      await fs.rm(addr.listen.path, { force: true, recursive: true });
    }
  }

  const server = net.createServer((socket) => {
    handleConnection(socket, opts.manifest, opts.client, opts.disabledActions);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(addr.listen);
  });

  // Resolve the displayed address. On Windows, port=0 → real port
  // is now visible on `address()`.
  let display = addr.display;
  if (addr.listen.port === 0) {
    const a = server.address();
    if (a && typeof a === "object" && "port" in a) {
      display = `tcp:${a.address}:${a.port}`;
    }
  }

  // Track open sockets so close() can tear them down. Without this a
  // pending connection keeps the server alive past shutdown.
  const sockets = new Set<net.Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });

  return {
    address: display,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      if (addr.listen.path) {
        // Best-effort cleanup. ENOENT is fine — the server may have
        // already removed it on close.
        await fs.rm(addr.listen.path, { force: true }).catch(() => {});
      }
    },
  };
}

// --- Connection handler -----------------------------------------------

// Per-connection request loop. Each line on the wire is a complete
// JSON request; we buffer until a newline arrives, parse, dispatch,
// and write back a single-line response. Connections are long-lived
// — the client may send many requests over one socket.
function handleConnection(
  socket: net.Socket,
  manifest: Manifest,
  client: JiraClient,
  disabledActions: readonly string[] | undefined,
): void {
  let buffer = "";
  socket.setEncoding("utf8");

  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      void dispatchLine(line, socket, manifest, client, disabledActions);
    }
  });

  socket.on("error", () => {
    // Client closed early or connection reset. We don't care —
    // the listener stays up for the next connection.
  });
}

async function dispatchLine(
  line: string,
  socket: net.Socket,
  manifest: Manifest,
  client: JiraClient,
  disabledActions: readonly string[] | undefined,
): Promise<void> {
  let req: BridgeRequest | null = null;
  try {
    req = JSON.parse(line) as BridgeRequest;
  } catch (err) {
    // Can't tie an error to a request id when parsing failed.
    // Surface it with a synthetic id so the client at least sees
    // *something* rather than a silent drop.
    writeResponse(socket, {
      id: "<parse-error>",
      error: {
        name: "ParseError",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  if (!req || typeof req.id !== "string" || req.method !== "invoke") {
    writeResponse(socket, {
      id: req?.id ?? "<malformed>",
      error: {
        name: "ProtocolError",
        message: `Expected method "invoke" with string id, got: ${JSON.stringify(req)}`,
      },
    });
    return;
  }

  try {
    const result = await invokeAndSandbox(
      manifest,
      client,
      req.params.operation,
      req.params.args ?? {},
      disabledActions,
    );
    writeResponse(socket, { id: req.id, result });
  } catch (err) {
    writeResponse(socket, {
      id: req.id,
      error: {
        name: err instanceof Error ? err.name : "Error",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function writeResponse(socket: net.Socket, resp: BridgeResponse): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(resp)}\n`);
}

// --- Operation dispatch ------------------------------------------------

// Hash-based slug suitable as a filename for an operation. `issue.get`
// → `issue-get`. Used as the `kind` (subdir) under the sandbox so
// related responses cluster on disk.
function operationKind(operationName: string): string {
  return operationName.replace(/\./g, "-");
}

// Bridge dispatch primitive. Runs the op, then sandboxes the raw
// response with the trim projection (if any) supplying the in-band
// summary. Exported for testing — the connection handler is the
// only production caller.
export async function invokeAndSandbox(
  manifest: Manifest,
  client: JiraClient,
  operation: string,
  args: Record<string, unknown>,
  disabledActions?: readonly string[],
): Promise<SandboxResult<unknown>> {
  const { op, response } = await invokeOperationRaw(
    manifest,
    client,
    operation,
    args,
    disabledActions,
  );

  const summarize = op.trim
    ? trimRegistry[op.trim]
    : (x: unknown) => x;

  return sandbox(response, {
    kind: operationKind(op.name),
    summarize,
  });
}
