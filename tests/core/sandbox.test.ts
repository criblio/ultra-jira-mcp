import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetSessionCacheDirForTests,
  cleanupStaleSessions,
  rootCacheDir,
  sandbox,
  sessionCacheDir,
} from "../../src/core/sandbox.js";

const originalSessionId = process.env.MCP_SESSION_ID;

async function rmRootIfExists(): Promise<void> {
  await fs.rm(rootCacheDir(), { recursive: true, force: true });
}

beforeEach(async () => {
  process.env.MCP_SESSION_ID = `test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  __resetSessionCacheDirForTests();
  await rmRootIfExists();
});

afterEach(async () => {
  await rmRootIfExists();
  if (originalSessionId === undefined) delete process.env.MCP_SESSION_ID;
  else process.env.MCP_SESSION_ID = originalSessionId;
  __resetSessionCacheDirForTests();
});

describe("sessionCacheDir", () => {
  it("resolves under the OS tmp dir and includes MCP_SESSION_ID", () => {
    process.env.MCP_SESSION_ID = "abc123";
    __resetSessionCacheDirForTests();
    const dir = sessionCacheDir();
    expect(dir).toBe(path.join(os.tmpdir(), "jira-mcp", "abc123"));
  });

  it("falls back to pid when MCP_SESSION_ID is unset", () => {
    delete process.env.MCP_SESSION_ID;
    __resetSessionCacheDirForTests();
    expect(sessionCacheDir()).toBe(
      path.join(os.tmpdir(), "jira-mcp", String(process.pid)),
    );
  });

  it("caches the resolved path across calls", () => {
    const first = sessionCacheDir();
    process.env.MCP_SESSION_ID = "different";
    expect(sessionCacheDir()).toBe(first);
  });

  it.each([
    ["path traversal", "../etc/passwd"],
    ["slash", "foo/bar"],
    ["backslash", "foo\\bar"],
    ["empty after trim", "   "],
    ["too long", "a".repeat(200)],
  ])("falls back to pid when MCP_SESSION_ID is invalid (%s)", (_label, val) => {
    process.env.MCP_SESSION_ID = val;
    __resetSessionCacheDirForTests();
    expect(sessionCacheDir()).toBe(
      path.join(os.tmpdir(), "jira-mcp", String(process.pid)),
    );
  });

  it.each([
    "abc123",
    "session-with-hyphens",
    "session_with_underscores",
    "session.with.dots",
    "MixedCase123",
  ])("accepts safe id %s", (val) => {
    process.env.MCP_SESSION_ID = val;
    __resetSessionCacheDirForTests();
    expect(sessionCacheDir()).toBe(path.join(os.tmpdir(), "jira-mcp", val));
  });
});

describe("sandbox()", () => {
  it("writes the full payload under {kind}/{hash}.json and returns a summary", async () => {
    const payload = { key: "PROJ-1", fields: { summary: "hello" } };
    const result = await sandbox(payload, {
      kind: "issue",
      summarize: (p) => ({ key: p.key }),
    });

    expect(result.summary).toEqual({ key: "PROJ-1" });
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.ref).toBe(
      path.join(sessionCacheDir(), "issue", `${result.hash}.json`),
    );
    expect(result.fullSize).toBeGreaterThan(0);
    expect(() => new Date(result.fetchedAt).toISOString()).not.toThrow();

    const written = JSON.parse(await fs.readFile(result.ref, "utf8"));
    expect(written).toEqual(payload);
  });

  it("is content-addressed: identical payloads produce the same ref", async () => {
    const payload = { a: 1, b: [1, 2, 3] };
    const r1 = await sandbox(payload, { kind: "issue", summarize: () => null });
    const r2 = await sandbox(payload, { kind: "issue", summarize: () => null });
    expect(r1.ref).toBe(r2.ref);
    expect(r1.hash).toBe(r2.hash);
  });

  it("separates payloads by kind even when hashes would otherwise collide", async () => {
    const payload = { v: 1 };
    const a = await sandbox(payload, { kind: "issue", summarize: () => null });
    const b = await sandbox(payload, { kind: "comment", summarize: () => null });
    expect(a.hash).toBe(b.hash);
    expect(a.ref).not.toBe(b.ref);
    expect(a.ref).toContain(`${path.sep}issue${path.sep}`);
    expect(b.ref).toContain(`${path.sep}comment${path.sep}`);
  });

  it("does not rewrite an already-cached file", async () => {
    const payload = { v: "first" };
    const first = await sandbox(payload, { kind: "x", summarize: () => null });
    const beforeMtime = (await fs.stat(first.ref)).mtimeMs;

    await new Promise((r) => setTimeout(r, 15));
    const second = await sandbox(payload, { kind: "x", summarize: () => null });
    const afterMtime = (await fs.stat(second.ref)).mtimeMs;

    expect(afterMtime).toBe(beforeMtime);
  });
});

describe("cleanupStaleSessions()", () => {
  it("returns empty arrays when the root dir does not exist", async () => {
    await rmRootIfExists();
    const result = await cleanupStaleSessions();
    expect(result).toEqual({ removed: [], skipped: [], errors: [] });
  });

  it("removes sessions older than 24h and skips recent ones", async () => {
    const root = rootCacheDir();
    await fs.mkdir(path.join(root, "old-session"), { recursive: true });
    await fs.mkdir(path.join(root, "new-session"), { recursive: true });

    const now = Date.now();
    const oldTime = new Date(now - 48 * 60 * 60 * 1000);
    await fs.utimes(path.join(root, "old-session"), oldTime, oldTime);

    const recentTime = new Date(now - 60 * 1000);
    await fs.utimes(path.join(root, "new-session"), recentTime, recentTime);

    const result = await cleanupStaleSessions(now);

    expect(result.removed).toContain("old-session");
    expect(result.skipped).toContain("new-session");

    await expect(fs.stat(path.join(root, "old-session"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, "new-session"))).resolves.toBeDefined();
  });

  it("never removes the current session directory", async () => {
    // Force creation of the current session dir.
    await sandbox({ x: 1 }, { kind: "k", summarize: () => null });
    const current = sessionCacheDir();

    const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    await fs.utimes(current, ancient, ancient);

    const result = await cleanupStaleSessions();
    expect(result.removed).not.toContain(path.basename(current));
    expect(result.skipped).toContain(path.basename(current));
    await expect(fs.stat(current)).resolves.toBeDefined();
  });

  it("captures per-entry errors separately from skipped/removed", async () => {
    const root = rootCacheDir();
    await fs.mkdir(root, { recursive: true });

    // A broken symlink: readdir sees the entry, but fs.stat fails with
    // ENOENT. This works cross-platform and doesn't require chmod games.
    await fs.symlink(
      path.join(root, "does-not-exist"),
      path.join(root, "broken-link"),
    );

    const result = await cleanupStaleSessions();
    expect(result.errors.map((e) => e.session)).toContain("broken-link");
    expect(result.errors[0]?.message).toMatch(/ENOENT|no such file/i);
    expect(result.removed).not.toContain("broken-link");
    expect(result.skipped).not.toContain("broken-link");
  });
});
