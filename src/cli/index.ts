#!/usr/bin/env node
// jira-cli — thin shell client for the code-api bridge.
//
// Replaces the pre-built TypeScript stubs that earlier versions of
// code-api shipped. The agent calls this binary from Bash; it parses
// argv into a flat args bag, opens JIRA_MCP_SOCKET, sends one bridge
// request, and prints the trimmed summary as JSON. The full response
// path (the bridge's on-disk Ref) is appended on a final line so the
// agent can `cat` or read it when it needs detail beyond the summary.
//
// Why a CLI rather than TS stubs:
//   - The stubs required `npx tsx -e ...` which has two persistent
//     traps (top-level await unsupported under CJS; tsx's .js → .ts
//     resolver skips paths under /node_modules/). Both manifested
//     in real first-use sessions.
//   - The agent already lives in Bash. Removing the TS runtime
//     collapses the call chain to Bash → binary → IPC.
//   - All client-side stub code was pure passthrough — no URL
//     building, no header injection — so dropping the runtime
//     layer costs nothing.

import * as net from "node:net";
import * as fs from "node:fs/promises";

import { operations } from "../core/operations.js";
import type { Operation, ParamSpec } from "../core/manifest.js";

// --- Argv parsing ------------------------------------------------------

interface ParsedArgv {
  // The positional <resource>.<op> identifier, or a meta command.
  // Empty string when invoked with no positional (we show top-level help).
  command: string;
  // --key=value flags. Repeated flags collapse to an array; comma-
  // separated values stay as single strings (server-side coerces
  // to comma-separated for query params anyway, so passing them
  // through verbatim is correct).
  flags: Record<string, string | string[]>;
  // --help anywhere on the line.
  help: boolean;
}

// Flag value resolution rules:
//   --key=value          → flags.key = "value"
//   --key value          → flags.key = "value"
//   --key=@/path/file    → flags.key = (contents of /path/file)
//   --key=-              → flags.key = (read all of stdin)
//   --key=value --key=2  → flags.key = ["value", "2"]
//
// Boolean flags (--foo with no value) aren't supported; every
// operation param the manifest declares carries a value, so a bare
// --flag is almost certainly a mistake — surface it with an error
// rather than silently coercing to "true".
async function parseArgv(argv: readonly string[]): Promise<ParsedArgv> {
  const out: ParsedArgv = { command: "", flags: {}, help: false };
  let positional: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      if (positional === null) positional = a;
      else throw new Error(`Unexpected positional argument: ${a}`);
      continue;
    }
    const eq = a.indexOf("=");
    let key: string;
    let value: string;
    if (eq >= 0) {
      key = a.slice(2, eq);
      value = a.slice(eq + 1);
    } else {
      key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Flag --${key} expects a value (use --${key}=value or --${key} value).`);
      }
      value = next;
      i++;
    }
    if (!key) throw new Error(`Empty flag name in argument: ${a}`);
    const resolved = await resolveValue(value);
    const existing = out.flags[key];
    if (existing === undefined) {
      out.flags[key] = resolved;
    } else if (Array.isArray(existing)) {
      existing.push(resolved);
    } else {
      out.flags[key] = [existing, resolved];
    }
  }

  out.command = positional ?? "";
  return out;
}

async function resolveValue(value: string): Promise<string> {
  if (value === "-") {
    return readStdin();
  }
  if (value.startsWith("@")) {
    return fs.readFile(value.slice(1), "utf8");
  }
  return value;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

// --- Help -------------------------------------------------------------

function topLevelHelp(): string {
  // Group operations by category prefix (the bit before the first dot)
  // so the listing stays scannable. Categories already cluster in the
  // manifest, but we re-derive here so re-orderings don't surprise the
  // help text.
  const byCategory = new Map<string, Operation[]>();
  for (const op of operations) {
    const cat = op.name.split(".")[0];
    const list = byCategory.get(cat) ?? [];
    list.push(op);
    byCategory.set(cat, list);
  }
  const lines: string[] = [
    "jira-cli — call Jira operations over the code-api bridge.",
    "",
    "Usage:",
    "  JIRA_MCP_SOCKET=<addr> jira-cli <op> [--flag=value ...]",
    "  jira-cli <op> --help          show args for one operation",
    "  jira-cli --help               show this listing",
    "",
    "Flag forms:",
    "  --key=value         --key value         --key=@/path/to/file",
    "  --key=-             read value from stdin",
    "  --key=a --key=b     repeat to build an array (also: --key=a,b)",
    "",
    "On success: trimmed summary on stdout (JSON), full-response path",
    "on the final line as: ref: /tmp/.../...json",
    "",
    "Operations:",
  ];
  const cats = Array.from(byCategory.keys()).sort();
  for (const cat of cats) {
    lines.push(`  ${cat}`);
    for (const op of byCategory.get(cat)!) {
      lines.push(`    ${op.name.padEnd(38)} ${op.description}`);
    }
  }
  return lines.join("\n");
}

function operationHelp(op: Operation): string {
  const lines: string[] = [
    `${op.name} — ${op.description}`,
    `  HTTP: ${op.verb} ${op.pathTemplate}`,
    "",
    "Parameters:",
  ];
  if (op.params.length === 0) {
    lines.push("  (none)");
  } else {
    for (const p of op.params) {
      const req = p.required ? "required" : "optional";
      const desc = p.description ? ` — ${p.description}` : "";
      lines.push(`  --${p.name.padEnd(28)} ${p.role.padEnd(5)} ${req}${desc}`);
    }
  }
  return lines.join("\n");
}

// --- Bridge round-trip ------------------------------------------------

interface BridgeResult {
  ref: string;
  summary: unknown;
  hash: string;
  fullSize: number;
  fetchedAt: string;
}

interface BridgeError {
  name: string;
  message: string;
}

// Open the socket, send one request, read one response, close. The
// bridge supports multiplexing on a single connection but a CLI
// invocation is single-shot — keeping the connection short-lived
// avoids any need to track in-flight requests.
function callBridge(
  address: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const socket = parseSocketAddress(address);
    let buffer = "";
    let settled = false;
    const finish = (
      kind: "ok" | "err",
      payload: BridgeResult | BridgeError,
    ) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (kind === "ok") resolve(payload as BridgeResult);
      else {
        const e = payload as BridgeError;
        const err = new Error(e.message);
        err.name = e.name;
        reject(err);
      }
    };

    socket.setEncoding("utf8");
    socket.on("error", (err) => finish("err", { name: "SocketError", message: err.message }));
    socket.on("close", () => {
      if (!settled) finish("err", { name: "SocketError", message: "socket closed before response" });
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      try {
        const resp = JSON.parse(line) as
          | { id: string; result: BridgeResult }
          | { id: string; error: BridgeError };
        if ("error" in resp) finish("err", resp.error);
        else finish("ok", resp.result);
      } catch (err) {
        finish("err", {
          name: "ParseError",
          message: `Invalid response from bridge: ${(err as Error).message}`,
        });
      }
    });

    socket.on("connect", () => {
      const req = {
        id: "1",
        method: "invoke",
        params: { operation, args },
      };
      socket.write(`${JSON.stringify(req)}\n`);
    });
  });
}

function parseSocketAddress(address: string): net.Socket {
  if (address.startsWith("tcp:")) {
    const rest = address.slice(4);
    const colon = rest.lastIndexOf(":");
    if (colon < 0) throw new Error(`Malformed JIRA_MCP_SOCKET: ${address}`);
    const host = rest.slice(0, colon);
    const port = Number(rest.slice(colon + 1));
    return net.connect({ host, port });
  }
  return net.connect({ path: address });
}

// --- Main -------------------------------------------------------------

async function main(): Promise<number> {
  let parsed: ParsedArgv;
  try {
    parsed = await parseArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`jira-cli: ${(err as Error).message}\n`);
    return 2;
  }

  if (parsed.command === "" && parsed.help) {
    process.stdout.write(`${topLevelHelp()}\n`);
    return 0;
  }
  if (parsed.command === "") {
    process.stderr.write("jira-cli: missing operation. Try `jira-cli --help`.\n");
    return 2;
  }

  const op = operations.find((o) => o.name === parsed.command);
  if (!op) {
    process.stderr.write(
      `jira-cli: unknown operation "${parsed.command}". Try \`jira-cli --help\`.\n`,
    );
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(`${operationHelp(op)}\n`);
    return 0;
  }

  // Pre-flight: surface unknown flags before opening a socket. The
  // bridge would accept and silently drop them (splitArgs records them
  // in `unknown` but the dispatcher doesn't reject), and the user
  // would never know their typo did nothing.
  const known = new Set(op.params.map((p: ParamSpec) => p.name));
  const unknown = Object.keys(parsed.flags).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    process.stderr.write(
      `jira-cli: unknown flag(s) for ${op.name}: ${unknown.join(", ")}. ` +
        `Try \`jira-cli ${op.name} --help\`.\n`,
    );
    return 2;
  }

  const address = process.env.JIRA_MCP_SOCKET;
  if (!address) {
    process.stderr.write(
      "jira-cli: JIRA_MCP_SOCKET is not set. Run via the MCP tool's usage example, or export the address printed by jira_code_api.\n",
    );
    return 2;
  }

  let result: BridgeResult;
  try {
    result = await callBridge(address, op.name, parsed.flags);
  } catch (err) {
    process.stderr.write(`jira-cli: ${(err as Error).name}: ${(err as Error).message}\n`);
    return 1;
  }

  // Layout: the trimmed summary first (JSON, pretty-printed for
  // readability in a terminal), then a single trailing line pointing
  // at the on-disk ref. Two distinct shapes on stdout would be
  // ambiguous to parse; the `ref:` prefix is unambiguous and easy to
  // grep out programmatically.
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  process.stdout.write(`ref: ${result.ref}\n`);
  return 0;
}

void main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`jira-cli: unexpected error: ${(err as Error).stack ?? err}\n`);
    process.exit(1);
  },
);
