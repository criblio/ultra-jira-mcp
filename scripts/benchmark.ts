// Token-budget benchmark for v2 (PR #11 prep).
//
// Spawns the real MCP server in each tool mode, talks MCP to it via the
// stdio client, and measures how many bytes of request/response would
// land in an agent's context for a fixed sequence of Jira calls. Hits
// real Jira — no fixtures — so the numbers reflect what an agent
// actually sees in production.
//
// Usage:
//   JIRA_BENCH_TICKET_RICH=ABC-1 JIRA_BENCH_TICKET_SIMPLE=ABC-2 \
//     npm run benchmark
//
// Requires .env.local (or shell env) with JIRA_HOST / JIRA_EMAIL /
// JIRA_API_TOKEN. The two ticket env vars name a "rich" ticket
// (comments + attachments — where v2 should win) and a "simple"
// ticket (no comments — where v2 likely doesn't help).
//
// Output: a markdown table on stdout. Each row is one scenario; each
// numeric cell is bytes that would enter the agent's context window.
// For code-api mode we report two numbers (summary-only and
// summary+full) since the cost depends on whether the agent decides
// to read each ref's full body.

import { promises as fs, readFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// --- Config -----------------------------------------------------------

interface BenchEnv {
  JIRA_HOST: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  JIRA_BENCH_TICKET_RICH: string;
  JIRA_BENCH_TICKET_SIMPLE: string;
}

function loadEnvLocal(): void {
  // The MCP server itself loads .env.local via dotenv at startup.
  // The benchmark script also needs the env locally so it can read
  // ticket keys for scenario assembly. Keep it simple: read the
  // file directly, set vars that aren't already set.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "..", ".env.local");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // not present — caller must have set env elsewhere
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function requireEnv(): BenchEnv {
  const need = [
    "JIRA_HOST",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "JIRA_BENCH_TICKET_RICH",
    "JIRA_BENCH_TICKET_SIMPLE",
  ] as const;
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Set them in .env.local or your shell.`,
    );
  }
  return {
    JIRA_HOST: process.env.JIRA_HOST!,
    JIRA_EMAIL: process.env.JIRA_EMAIL!,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN!,
    JIRA_BENCH_TICKET_RICH: process.env.JIRA_BENCH_TICKET_RICH!,
    JIRA_BENCH_TICKET_SIMPLE: process.env.JIRA_BENCH_TICKET_SIMPLE!,
  };
}

// --- MCP server lifecycle --------------------------------------------

type Mode = "v1" | "classic" | "code-api";

// v1 lives on `main`; we measure it from a sibling git worktree
// checked out at the v1.0.0 tag. The script doesn't manage the
// worktree — set it up once with:
//   git worktree add ../jira-mcp-v1 v1.0.0
//   (cd ../jira-mcp-v1 && npm install && npm run build)
const V1_WORKTREE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "jira-mcp-v1",
);

interface Connection {
  client: Client;
  transport: StdioClientTransport;
  toolListBytes: number;
  socketAddress?: string;
  cli?: string;
}

async function connect(mode: Mode, env: BenchEnv): Promise<Connection> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverEntry =
    mode === "v1"
      ? path.resolve(V1_WORKTREE, "build", "index.js")
      : path.resolve(here, "..", "build", "index.js");

  // v1 doesn't read JIRA_TOOL_MODE; passing it is harmless. Sessions
  // are unused in v1 (no sandbox), but we keep the same env shape so
  // the spawn paths stay symmetric.
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    env: {
      ...env,
      JIRA_TOOL_MODE: mode === "v1" ? "" : mode,
      MCP_SESSION_ID: `bench-${mode}-${Date.now()}`,
      // Forward PATH so the server can spawn child processes if it
      // ever needs to (it doesn't today, but cheap insurance).
      PATH: process.env.PATH ?? "",
    },
    // Pipe stderr so the server's startup log doesn't pollute our
    // markdown output. We discard it; if anything goes wrong, the
    // MCP error path surfaces as a failed RPC.
    stderr: "pipe",
  });

  const client = new Client(
    { name: "jira-mcp-benchmark", version: "0.1" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const tools = await client.listTools();
  const toolListBytes = byteLength(tools);

  let socketAddress: string | undefined;
  let cli: string | undefined;
  if (mode === "code-api") {
    // First call to jira_code_api gives us the cli path + socket.
    const resp = await client.callTool({ name: "jira_code_api", arguments: {} });
    const payload = parseToolText(resp);
    cli = payload.cli;
    socketAddress = payload.socketAddress;
  }

  return { client, transport, toolListBytes, socketAddress, cli };
}

async function disconnect(conn: Connection): Promise<void> {
  await conn.client.close().catch(() => {});
  await conn.transport.close().catch(() => {});
}

// --- Measurement primitives ------------------------------------------

function byteLength(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

function parseToolText(resp: any): any {
  // MCP tool responses come back as { content: [{ type: "text", text: "..." }] }.
  // For our handlers the text is JSON.stringify(...)'d payload.
  const item = resp?.content?.[0];
  if (!item || item.type !== "text") return null;
  try {
    return JSON.parse(item.text);
  } catch {
    return item.text;
  }
}

interface CallCost {
  // Bytes of the MCP response that lands in agent context.
  responseBytes: number;
  // For code-api responses (SandboxResult shape), this is the cost
  // if the agent only reads the inline `summary`. For classic
  // responses, this equals responseBytes (the whole thing is inline).
  summaryOnlyBytes: number;
  // For code-api: cost if the agent also reads the full ref file.
  // For classic: equals responseBytes.
  summaryPlusFullBytes: number;
}

async function classicCallCost(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallCost> {
  const resp = await client.callTool({ name: toolName, arguments: args });
  // Strip the MCP envelope ({content:[{type,text}]}) so we measure
  // just the JSON payload — what the agent's reasoning actually
  // sees as tool output. Code-api's invokeOverBridge already
  // returns the bare payload, so without this strip the per-call
  // numbers are asymmetric and code-api looks ~50B leaner per call
  // for purely envelope reasons. On a 1.4KB simple-ticket row
  // those 50B account for most of the gap.
  const payload = parseToolText(resp);
  const bytes = payload === null ? byteLength(resp) : byteLength(payload);
  return {
    responseBytes: bytes,
    summaryOnlyBytes: bytes,
    summaryPlusFullBytes: bytes,
  };
}

// In code-api mode the agent invokes a stub through the IPC bridge,
// not through MCP. The MCP layer only carries the one-time
// `jira_code_api` call. We measure the stub-side cost by connecting
// to the bridge directly using the same wire format the generated
// _client.ts uses — same shape, same bytes, no tsx required.
async function codeApiCallCost(
  socketAddress: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<CallCost> {
  const result = await invokeOverBridge(socketAddress, operation, args);
  // What the agent sees by default: the SandboxResult itself (small).
  // The summary lives inline, the ref points at a file on disk.
  const summaryOnlyBytes = byteLength(result);
  // What it sees if it then reads the full ref file (the cost of
  // wanting full details).
  const fullBody = await fs.readFile(result.ref, "utf8");
  const summaryPlusFullBytes =
    summaryOnlyBytes + Buffer.byteLength(fullBody, "utf8");
  return {
    responseBytes: summaryOnlyBytes,
    summaryOnlyBytes,
    summaryPlusFullBytes,
  };
}

// 30s is generous — a real Jira call on a chunky ticket completes
// in 2-3s. Past that we're hung on rate-limit, network, or
// auth. Surfacing a timeout error beats a script that silently
// blocks forever.
const BRIDGE_CALL_TIMEOUT_MS = 30_000;

function invokeOverBridge(
  address: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<{ summary: any; ref: string; fullSize: number; hash: string; fetchedAt: string }> {
  return new Promise((resolve, reject) => {
    const target = address.startsWith("tcp:")
      ? (() => {
          const lc = address.lastIndexOf(":");
          return { host: address.slice(4, lc), port: Number(address.slice(lc + 1)) };
        })()
      : { path: address };
    const socket = net.connect(target as never);
    socket.setEncoding("utf8");
    socket.setTimeout(BRIDGE_CALL_TIMEOUT_MS, () => {
      socket.destroy(
        new Error(
          `bridge call to ${operation} timed out after ${BRIDGE_CALL_TIMEOUT_MS}ms`,
        ),
      );
    });
    let buf = "";
    socket.on("connect", () => {
      socket.write(
        JSON.stringify({
          id: "bench",
          method: "invoke",
          params: { operation, args },
        }) + "\n",
      );
    });
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      let resp: any;
      try {
        resp = JSON.parse(buf.slice(0, nl));
      } catch (err) {
        socket.destroy();
        return reject(err);
      }
      socket.end();
      if (resp.error) {
        return reject(new Error(`${resp.error.name}: ${resp.error.message}`));
      }
      resolve(resp.result);
    });
    socket.on("error", (err) => reject(err));
  });
}

// --- Scenarios --------------------------------------------------------

interface Scenario {
  name: string;
  v1Calls: { tool: string; args: Record<string, unknown> }[];
  classicCalls: { tool: string; args: Record<string, unknown> }[];
  codeApiCalls: { operation: string; args: Record<string, unknown> }[];
}

function buildScenarios(env: BenchEnv): Scenario[] {
  const jql = "assignee = currentUser() ORDER BY updated DESC";
  return [
    {
      name: "fetch 1 simple ticket",
      v1Calls: [
        {
          tool: "jira_get_issue",
          args: { issueIdOrKey: env.JIRA_BENCH_TICKET_SIMPLE },
        },
      ],
      classicCalls: [
        {
          tool: "jira_issue",
          args: { action: "get", issueIdOrKey: env.JIRA_BENCH_TICKET_SIMPLE },
        },
      ],
      codeApiCalls: [
        {
          operation: "issue.get",
          args: { issueIdOrKey: env.JIRA_BENCH_TICKET_SIMPLE },
        },
      ],
    },
    {
      name: "investigate rich ticket",
      v1Calls: [
        {
          tool: "jira_get_issue",
          args: {
            issueIdOrKey: env.JIRA_BENCH_TICKET_RICH,
            expand: "renderedFields,comments,attachment",
          },
        },
        {
          tool: "jira_get_comments",
          args: {
            issueIdOrKey: env.JIRA_BENCH_TICKET_RICH,
            maxResults: 100,
          },
        },
      ],
      classicCalls: [
        {
          tool: "jira_issue",
          args: {
            action: "get",
            issueIdOrKey: env.JIRA_BENCH_TICKET_RICH,
            expand: "renderedFields,comments,attachment",
          },
        },
        {
          tool: "jira_comment",
          args: {
            action: "list",
            issueIdOrKey: env.JIRA_BENCH_TICKET_RICH,
            maxResults: 100,
          },
        },
      ],
      codeApiCalls: [
        {
          operation: "issue.get",
          args: {
            issueIdOrKey: env.JIRA_BENCH_TICKET_RICH,
            expand: "renderedFields,comments,attachment",
          },
        },
        {
          operation: "comment.list",
          args: {
            issueIdOrKey: env.JIRA_BENCH_TICKET_RICH,
            maxResults: 100,
          },
        },
      ],
    },
    {
      name: "JQL search ~10 tickets",
      v1Calls: [
        // v1's jira_search_issues returns full issue payloads by default.
        // We pass the same `fields` filter v2 uses so the comparison is
        // strictly about projection/trim, not about asking v1 for a
        // larger payload than v2.
        {
          tool: "jira_search_issues",
          args: {
            jql,
            maxResults: 10,
            fields: ["summary", "status", "assignee", "priority", "updated"],
          },
        },
      ],
      classicCalls: [
        {
          tool: "jira_search",
          args: {
            action: "issues",
            jql,
            maxResults: 10,
            // The new /search/jql endpoint returns bare issue refs
            // unless `fields` is requested. Both modes need the same
            // shape so the comparison is fair.
            fields: "summary,status,assignee,priority,updated",
          },
        },
      ],
      codeApiCalls: [
        {
          operation: "search.issues",
          args: {
            jql,
            maxResults: 10,
            fields: "summary,status,assignee,priority,updated",
          },
        },
      ],
    },
  ];
}

interface ScenarioResult {
  name: string;
  v1Bytes: number;
  classicBytes: number;
  codeApiSummaryBytes: number;
  codeApiFullBytes: number;
}

async function runScenarios(env: BenchEnv): Promise<{
  results: ScenarioResult[];
  v1ToolList: number;
  classicToolList: number;
  codeApiToolList: number;
}> {
  const scenarios = buildScenarios(env);

  // --- v1 pass (separate worktree at v1.0.0 tag) ---
  const v1 = await connect("v1", env);
  const v1ToolList = v1.toolListBytes;
  const v1Totals = new Map<string, number>();
  try {
    for (const s of scenarios) {
      let total = 0;
      for (const c of s.v1Calls) {
        const cost = await classicCallCost(v1.client, c.tool, c.args);
        total += cost.responseBytes;
      }
      v1Totals.set(s.name, total);
    }
  } finally {
    await disconnect(v1);
  }

  // --- Classic mode pass ---
  const classic = await connect("classic", env);
  const classicToolList = classic.toolListBytes;
  const classicTotals = new Map<string, number>();
  try {
    for (const s of scenarios) {
      let total = 0;
      for (const c of s.classicCalls) {
        const cost = await classicCallCost(classic.client, c.tool, c.args);
        total += cost.responseBytes;
      }
      classicTotals.set(s.name, total);
    }
  } finally {
    await disconnect(classic);
  }

  // --- Code-api mode pass ---
  const codeApi = await connect("code-api", env);
  const codeApiToolList = codeApi.toolListBytes;
  const codeApiSummary = new Map<string, number>();
  const codeApiFull = new Map<string, number>();
  try {
    if (!codeApi.socketAddress) {
      throw new Error("code-api connection didn't expose a socket address");
    }
    for (const s of scenarios) {
      let summary = 0;
      let full = 0;
      for (const c of s.codeApiCalls) {
        const cost = await codeApiCallCost(
          codeApi.socketAddress,
          c.operation,
          c.args,
        );
        summary += cost.summaryOnlyBytes;
        full += cost.summaryPlusFullBytes;
      }
      codeApiSummary.set(s.name, summary);
      codeApiFull.set(s.name, full);
    }
  } finally {
    await disconnect(codeApi);
  }

  const results: ScenarioResult[] = scenarios.map((s) => ({
    name: s.name,
    v1Bytes: v1Totals.get(s.name) ?? 0,
    classicBytes: classicTotals.get(s.name) ?? 0,
    codeApiSummaryBytes: codeApiSummary.get(s.name) ?? 0,
    codeApiFullBytes: codeApiFull.get(s.name) ?? 0,
  }));
  return { results, v1ToolList, classicToolList, codeApiToolList };
}

// --- Reporting --------------------------------------------------------

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function ratio(a: number, b: number): string {
  if (b === 0) return "—";
  const r = a / b;
  if (r >= 1) return `${r.toFixed(1)}× larger`;
  return `${(1 / r).toFixed(1)}× smaller`;
}

function tokens(bytes: number): number {
  // Rough tokenizer-independent approximation. JSON-flavored English
  // is ~4 bytes/token across both Anthropic and OpenAI tokenizers.
  return Math.round(bytes / 4);
}

function renderReport(
  v1ToolList: number,
  classicToolList: number,
  codeApiToolList: number,
  results: ScenarioResult[],
): string {
  const lines: string[] = [];
  lines.push("# ultra-jira-mcp token budget benchmark");
  lines.push("");
  lines.push(
    "Bytes of MCP request/response that would land in the agent's context window.",
  );
  lines.push(
    "Token estimates use bytes/4 (close enough across Anthropic and OpenAI tokenizers).",
  );
  lines.push("");
  lines.push("## Tool-list cost (one-time, at startup)");
  lines.push("");
  lines.push("| mode           | bytes | ~tokens |");
  lines.push("| -------------- | ----- | ------- |");
  lines.push(`| v1             | ${fmt(v1ToolList)} | ${tokens(v1ToolList)} |`);
  lines.push(`| v2 classic     | ${fmt(classicToolList)} | ${tokens(classicToolList)} |`);
  lines.push(`| v2 code-api    | ${fmt(codeApiToolList)} | ${tokens(codeApiToolList)} |`);
  lines.push("");
  lines.push(`v2 classic vs v1: ${ratio(classicToolList, v1ToolList)}`);
  lines.push(`v2 code-api vs v1: ${ratio(codeApiToolList, v1ToolList)}`);
  lines.push("");
  lines.push("## Per-flow cost");
  lines.push("");
  lines.push("`v2 code-api summary` = agent reads only the inline summary.");
  lines.push("`v2 code-api +full` = agent also reads every ref file (upper bound).");
  lines.push("");
  lines.push(
    "| scenario | v1 | v2 classic | v2 code-api summary | v2 code-api +full | classic vs v1 |",
  );
  lines.push(
    "| -------- | -- | ---------- | ------------------- | ----------------- | ------------- |",
  );
  for (const r of results) {
    lines.push(
      `| ${r.name} | ${fmt(r.v1Bytes)} | ${fmt(r.classicBytes)} | ${fmt(
        r.codeApiSummaryBytes,
      )} | ${fmt(r.codeApiFullBytes)} | ${ratio(r.classicBytes, r.v1Bytes)} |`,
    );
  }
  return lines.join("\n");
}

// --- Main -------------------------------------------------------------

async function main(): Promise<void> {
  loadEnvLocal();
  const env = requireEnv();

  // Build before benchmark — ensures we measure the current source.
  // We deliberately don't run tsc here (it slows the script and the
  // user's npm script chain handles it). Just verify the entry exists.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverEntry = path.resolve(here, "..", "build", "index.js");
  try {
    await fs.access(serverEntry);
  } catch {
    throw new Error(
      `Server entry not found at ${serverEntry}. Run \`npm run build\` first.`,
    );
  }

  const v1Entry = path.resolve(V1_WORKTREE, "build", "index.js");
  try {
    await fs.access(v1Entry);
  } catch {
    throw new Error(
      `v1 server entry not found at ${v1Entry}. Set up the worktree once with:\n` +
        `  git worktree add ${V1_WORKTREE} v1.0.0\n` +
        `  (cd ${V1_WORKTREE} && npm install && npm run build)`,
    );
  }

  const { v1ToolList, classicToolList, codeApiToolList, results } =
    await runScenarios(env);
  // eslint-disable-next-line no-console
  console.log(
    renderReport(v1ToolList, classicToolList, codeApiToolList, results),
  );
}

void (async () => {
  try {
    await main();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("benchmark failed:", err);
    process.exit(1);
  }
})();
