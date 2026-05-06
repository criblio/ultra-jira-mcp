// Integration tests for the jira-cli binary.
//
// We boot the bridge in-process (the same way boot.test.ts does),
// then spawn the compiled CLI from build/cli/index.js with
// JIRA_MCP_SOCKET pointing at the in-process bridge. This is a
// genuine end-to-end exercise — the CLI parses argv, opens a real
// socket, sends a real bridge request, and we assert on the real
// stdout it produces.
//
// Why fork a subprocess instead of importing the CLI module: the
// CLI's main() calls process.exit() and reads process.argv/env. We
// could refactor to a testable factory, but a forked process is the
// shape the agent actually uses and exercising that exact shape
// catches things (shebang behaviour, exit codes, stdout/stderr
// separation) that an in-process import would not.

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JiraClient } from "../../src/auth/jira-client.js";
import { bootCodeApi, type BootedCodeApi } from "../../src/codeapi/boot.js";
import {
  __resetSessionCacheDirForTests,
  sessionCacheDir,
} from "../../src/core/sandbox.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// The CLI we test is the *compiled* output, since that's what the
// agent runs. tsc must have produced build/cli/index.js before this
// test file runs — the CI pipeline (and `npm run build`) handles
// that, and so does `npm test` for local dev.
const CLI_PATH = path.resolve(here, "..", "..", "build", "cli", "index.js");

const ORIGINAL_SESSION_ID = process.env.MCP_SESSION_ID;
const ORIGINAL_SOCKET = process.env.JIRA_MCP_SOCKET;

let booted: BootedCodeApi | null = null;

function makeMockClient(getResponse: unknown): JiraClient {
  const get = vi.fn().mockResolvedValue(getResponse);
  const stub = vi.fn().mockResolvedValue({});
  return {
    get,
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
  process.env.MCP_SESSION_ID = `cli-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  __resetSessionCacheDirForTests();
  delete process.env.JIRA_MCP_SOCKET;
});

afterEach(async () => {
  if (booted) {
    await booted.bridge.close().catch(() => {});
    booted = null;
  }
  await fs.rm(sessionCacheDir(), { recursive: true, force: true }).catch(() => {});
  if (ORIGINAL_SESSION_ID === undefined) delete process.env.MCP_SESSION_ID;
  else process.env.MCP_SESSION_ID = ORIGINAL_SESSION_ID;
  if (ORIGINAL_SOCKET === undefined) delete process.env.JIRA_MCP_SOCKET;
  else process.env.JIRA_MCP_SOCKET = ORIGINAL_SOCKET;
});

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
  // Strip Jira creds from the parent env so direct-mode tests don't
  // accidentally hit a real Jira instance when a developer has
  // .env.local exported in their shell. Tests that exercise direct
  // mode pass their own JIRA_HOST/EMAIL/TOKEN explicitly. Tests that
  // exercise bridge mode pass JIRA_MCP_SOCKET; the absence of creds
  // is fine because those tests never reach the direct dispatch
  // path. The chdir to /tmp prevents dotenv from loading the repo's
  // .env.local at CLI startup.
  const sanitized: NodeJS.ProcessEnv = { ...process.env };
  delete sanitized.JIRA_HOST;
  delete sanitized.JIRA_EMAIL;
  delete sanitized.JIRA_API_TOKEN;
  delete sanitized.JIRA_CLOUD_ID;
  delete sanitized.JIRA_MCP_SOCKET;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...sanitized, ...env },
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.on("data", (c: string) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// --- Tests -----------------------------------------------------------

describe("jira-cli", () => {
  it("--help prints the operation listing", async () => {
    const r = await runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("jira-cli");
    expect(r.stdout).toContain("Operations:");
    // Spot-check a few well-known ops are in the listing.
    expect(r.stdout).toContain("issue.get");
    expect(r.stdout).toContain("search.issues");
  });

  it("<op> --help prints that op's parameters", async () => {
    const r = await runCli(["issue.get", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("issue.get");
    expect(r.stdout).toContain("--issueIdOrKey");
    expect(r.stdout).toContain("path");
    expect(r.stdout).toContain("required");
  });

  it("rejects unknown operations with exit code 2", async () => {
    const r = await runCli(["nope.invalid"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown operation "nope.invalid"');
  });

  it("rejects unknown flags before opening a socket", async () => {
    // No JIRA_MCP_SOCKET set — but if validation happens before the
    // socket, we should still get an unknown-flag error rather than
    // a missing-socket error.
    const r = await runCli(["issue.get", "--issueIdOrKey=ABC-1", "--bogusFlag=x"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown flag");
    expect(r.stderr).toContain("bogusFlag");
  });

  it("falls through to direct mode when JIRA_MCP_SOCKET is unset and surfaces the missing-creds error", async () => {
    // No socket, no Jira creds → direct mode kicks in, getConfig()
    // detects the missing env vars, and the CLI surfaces that error
    // with exit code 1. The error message names the missing vars so
    // the user knows what to set.
    const r = await runCli(["issue.get", "--issueIdOrKey=ABC-1"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Missing required environment variables");
    expect(r.stderr).toContain("JIRA_HOST");
    expect(r.stderr).toContain("JIRA_API_TOKEN");
  });

  it("--help in direct mode (no socket, no creds) still works", async () => {
    // Help shouldn't require any env — the agent should be able to
    // discover the operation surface before configuring anything.
    const r = await runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Two modes");
    expect(r.stdout).toContain("bridge");
    expect(r.stdout).toContain("direct");
  });

  it("end-to-end: invokes a real bridge and prints summary + ref", async () => {
    const client = makeMockClient({
      id: "10",
      key: "ABC-1",
      fields: {
        summary: "Hello from CLI test",
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
    booted = await bootCodeApi({ client, cleanupSessions: false });

    const r = await runCli(
      ["issue.get", "--issueIdOrKey=ABC-1"],
      { JIRA_MCP_SOCKET: booted.bridge.address },
    );
    expect(r.code).toBe(0);
    // Trimmed summary lands on stdout as JSON, then the ref line.
    const lines = r.stdout.trim().split("\n");
    const refLine = lines[lines.length - 1];
    expect(refLine).toMatch(/^ref: \//);
    const refPath = refLine.slice("ref: ".length);
    // The ref points at a real on-disk file the bridge wrote.
    const full = JSON.parse(await fs.readFile(refPath, "utf8"));
    expect(full.key).toBe("ABC-1");
    // The lines before the ref are the trimmed summary; parsing them
    // back as JSON should yield the trim projection's shape.
    const summaryJson = lines.slice(0, -1).join("\n");
    const summary = JSON.parse(summaryJson);
    expect(summary).toMatchObject({ key: "ABC-1", status: "Open" });
  });

  it("install-skill --print writes SKILL.md content to stdout, not the filesystem", async () => {
    // Subprocess-level smoke test for the meta-command dispatch path.
    // Touches the real CLI bin to confirm: (a) `install-skill` is
    // recognized as a positional, (b) bare boolean `--print` parses
    // without erroring, (c) skill content lands on stdout. The
    // detailed install behaviours (write/refuse/overwrite) are
    // covered in install-skill.test.ts.
    const r = await runCli(["install-skill", "--print"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("name: jira");
    expect(r.stdout).toContain("jira-cli --help");
  });

  it("install-skill --help prints subcommand help, not operation help", async () => {
    const r = await runCli(["install-skill", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("install-skill");
    expect(r.stdout).toContain("--force");
    expect(r.stdout).toContain("--print");
    // Must NOT fall through to a "unknown operation" error.
    expect(r.stderr).toBe("");
  });

  it("repeated --field flags produce an array forwarded to the bridge", async () => {
    // Stub `get` so we can capture the query params the dispatcher
    // built from the CLI's args. The bridge → invokeOperationRaw
    // path joins arrays with commas before sending to JiraClient,
    // so we expect a comma-separated string at the client call.
    const get = vi.fn().mockResolvedValue({ id: "10", key: "ABC-1", fields: {} });
    const client = {
      get,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      agileGet: vi.fn(),
      agilePost: vi.fn(),
      agilePut: vi.fn(),
      agileDelete: vi.fn(),
    } as unknown as JiraClient;
    booted = await bootCodeApi({ client, cleanupSessions: false });

    const r = await runCli(
      ["issue.get", "--issueIdOrKey=ABC-1", "--fields=summary", "--fields=status"],
      { JIRA_MCP_SOCKET: booted.bridge.address },
    );
    expect(r.code).toBe(0);
    expect(get).toHaveBeenCalledTimes(1);
    const query = get.mock.calls[0][1];
    expect(query.fields).toBe("summary,status");
  });
});
