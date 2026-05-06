import * as fs from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rootCacheDir } from "../../src/core/sandbox.js";
import {
  hostKey,
  readTenantCache,
  writeTenantCache,
} from "../../src/core/tenant-cache.js";

// Scope cleanup to the tenant subdirectory. Other test files (notably
// sandbox.test.ts) create session dirs under rootCacheDir() — removing
// the whole root races with those.
async function rmTenantDir(): Promise<void> {
  await fs.rm(path.join(rootCacheDir(), "tenant"), {
    recursive: true,
    force: true,
  });
}

beforeEach(async () => {
  await rmTenantDir();
});
afterEach(async () => {
  await rmTenantDir();
});

describe("hostKey", () => {
  it("strips scheme and path and lowercases", () => {
    expect(hostKey("https://ACME.atlassian.net/rest/api/3")).toBe("acme.atlassian.net");
  });

  it("replaces unsafe characters", () => {
    expect(hostKey("acme.atlassian.net:8443")).toBe("acme.atlassian.net_8443");
  });
});

describe("readTenantCache / writeTenantCache", () => {
  it("returns null when no file exists", async () => {
    expect(await readTenantCache("https://acme.atlassian.net")).toBeNull();
  });

  it("round-trips cloudId on the same host", async () => {
    await writeTenantCache("https://acme.atlassian.net", "cloud-123");
    expect(await readTenantCache("https://acme.atlassian.net")).toBe("cloud-123");
  });

  it("keeps host caches separate", async () => {
    await writeTenantCache("https://a.atlassian.net", "cloud-a");
    await writeTenantCache("https://b.atlassian.net", "cloud-b");
    expect(await readTenantCache("https://a.atlassian.net")).toBe("cloud-a");
    expect(await readTenantCache("https://b.atlassian.net")).toBe("cloud-b");
  });

  it("returns null for entries older than ttl", async () => {
    await writeTenantCache("https://acme.atlassian.net", "cloud-old");
    // Rewrite the fetchedAt into the past.
    const file = path.join(
      rootCacheDir(),
      "tenant",
      "acme.atlassian.net.json",
    );
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    raw.fetchedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(file, JSON.stringify(raw));
    expect(await readTenantCache("https://acme.atlassian.net")).toBeNull();
  });

  it("returns null for corrupt json", async () => {
    const dir = path.join(rootCacheDir(), "tenant");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "acme.atlassian.net.json"), "{not json");
    expect(await readTenantCache("https://acme.atlassian.net")).toBeNull();
  });

  it("returns null when the cached object is missing required fields", async () => {
    const dir = path.join(rootCacheDir(), "tenant");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "acme.atlassian.net.json"),
      JSON.stringify({ fetchedAt: new Date().toISOString() }),
    );
    expect(await readTenantCache("https://acme.atlassian.net")).toBeNull();
  });
});
