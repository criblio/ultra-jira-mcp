#!/usr/bin/env node
// jira-cli — shell client for Jira. Parses argv into a flat args
// bag, dispatches one operation, prints the trimmed summary as JSON
// followed by a `ref: /path` line pointing at the full response on
// disk so the caller can `cat` it for detail.
//
// Two dispatch paths, auto-selected from the environment:
//
//   - bridge mode (JIRA_MCP_SOCKET set): forward the call over the
//     IPC bridge to a running jira-mcp server. This is what the MCP
//     code-api flow sets up — the server holds the JiraClient and
//     handles auth.
//   - direct mode (JIRA_MCP_SOCKET unset): read JIRA_HOST /
//     JIRA_EMAIL / JIRA_API_TOKEN from env, build a JiraClient
//     in-process, dispatch through the same trim + sandbox helper
//     the bridge uses on the server side. No MCP server required.
//
// Why a CLI rather than TS stubs (replaced earlier code-api shape):
//   - The stubs required `npx tsx -e ...` which has two persistent
//     traps (top-level await unsupported under CJS; tsx's .js → .ts
//     resolver skips paths under /node_modules/). Both manifested
//     in real first-use sessions.
//   - The agent already lives in Bash. Removing the TS runtime
//     collapses the call chain to Bash → binary → IPC (or Bash →
//     binary → Jira HTTP, in direct mode).
//   - All client-side stub code was pure passthrough, so dropping
//     the runtime layer costs nothing.

import * as net from "node:net";
import * as fs from "node:fs/promises";

import { operations } from "../core/operations.js";
import type { Operation, ParamSpec } from "../core/manifest.js";
import { callDirect } from "./direct.js";
import { installSkill, SKILL_CONTENT } from "./install-skill.js";

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
// Operation flags must carry a value — every manifest param does, so
// a bare `--flag` for an op is almost certainly a typo and we error.
// A small allowlist of *boolean* flag names (force, print) is
// recognized for meta-commands like `install-skill`; bare presence
// stores `""` and callers check existence via `key in flags`.
const BOOLEAN_FLAG_NAMES = new Set(["force", "print"]);
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
      const lookahead = next === undefined || next.startsWith("--");
      if (lookahead && BOOLEAN_FLAG_NAMES.has(key)) {
        // Bare boolean meta flag — store presence, no value to consume.
        value = "";
      } else if (lookahead) {
        throw new Error(`Flag --${key} expects a value (use --${key}=value or --${key} value).`);
      } else {
        value = next;
        i++;
      }
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
    "jira-cli — call Jira operations from a shell.",
    "",
    "Two modes (auto-selected from env):",
    "  bridge   JIRA_MCP_SOCKET set → forward to a running jira-mcp server.",
    "  direct   JIRA_MCP_SOCKET unset → read JIRA_HOST/JIRA_EMAIL/",
    "           JIRA_API_TOKEN from env (or .env.local) and call Jira",
    "           directly. No server required.",
    "",
    "Usage:",
    "  jira-cli <op> [--flag=value ...]",
    "  jira-cli <op> --help          show args for one operation",
    "  jira-cli --help               show this listing",
    "  jira-cli install-skill        install a Claude Code skill so",
    "                                agents discover this CLI",
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

// --- Meta commands ----------------------------------------------------

// `jira-cli install-skill` writes ~/.claude/skills/jira/SKILL.md so
// the agent can discover the CLI in standalone (no-MCP) sessions.
// Flags:
//   --force   overwrite an existing SKILL.md
//   --print   dump rendered content to stdout (no write)
async function runInstallSkill(parsed: ParsedArgv): Promise<number> {
  if (parsed.help) {
    process.stdout.write(
      [
        "jira-cli install-skill — install a Claude Code skill that",
        "teaches the agent how to call this CLI.",
        "",
        "Writes ~/.claude/skills/jira/SKILL.md. Once installed, the",
        "skill loads on demand whenever the user mentions Jira.",
        "",
        "Flags:",
        "  --force    overwrite an existing SKILL.md",
        "  --print    print the rendered SKILL.md to stdout (no write)",
        "",
      ].join("\n"),
    );
    return 0;
  }

  const known = new Set(["force", "print"]);
  const unknown = Object.keys(parsed.flags).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    process.stderr.write(
      `jira-cli: unknown flag(s) for install-skill: ${unknown.join(", ")}.\n`,
    );
    return 2;
  }

  // The flag parser stores values as strings; `--force` / `--print`
  // are booleans here. We accept any present-and-not-empty value
  // (the parser rejects bare `--flag` already), so the existence of
  // the key is enough.
  const force = "force" in parsed.flags;
  const print = "print" in parsed.flags;

  if (print) {
    process.stdout.write(SKILL_CONTENT);
    return 0;
  }

  const result = await installSkill({ force });
  switch (result.action) {
    case "wrote":
      process.stdout.write(`Wrote ${result.path}\n`);
      return 0;
    case "overwrote":
      process.stdout.write(`Overwrote ${result.path}\n`);
      return 0;
    case "exists":
      process.stderr.write(
        `${result.path} already exists. Use --force to overwrite, or --print to dump the new content to stdout.\n`,
      );
      return 1;
    case "printed":
      // Unreachable — print branch returned earlier.
      return 0;
  }
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

  // Meta-commands (no Jira call): handle before the manifest lookup
  // so unknown-flag pre-flight doesn't reject their flags.
  if (parsed.command === "install-skill") {
    return runInstallSkill(parsed);
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

  // Two modes:
  //   - bridge mode: JIRA_MCP_SOCKET points at a running jira-mcp
  //     server. Forward every call over IPC. This is what the MCP
  //     `jira_code_api` tool sets up.
  //   - direct mode: no socket → build a JiraClient in-process,
  //     read JIRA_HOST/EMAIL/API_TOKEN from env, dispatch locally.
  //     Same trim + ref behaviour, no server required.
  const address = process.env.JIRA_MCP_SOCKET;
  let result: BridgeResult;
  try {
    if (address) {
      result = await callBridge(address, op.name, parsed.flags);
    } else {
      // SandboxResult is a superset of BridgeResult (carries the same
      // ref + summary; adds hash/fullSize/fetchedAt). Cast is safe;
      // we only print summary + ref, never the bookkeeping fields.
      result = (await callDirect(op.name, parsed.flags)) as BridgeResult;
    }
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
