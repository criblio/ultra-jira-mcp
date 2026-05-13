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
    // Drive the cutoff via the `now` parameter rather than rewriting
    // the on-disk fetchedAt — the toolkit owns the file layout (sha256
    // of the host key) and tests shouldn't peek at it.
    await writeTenantCache("https://acme.atlassian.net", "cloud-old");
    const future = Date.now() + 48 * 60 * 60 * 1000;
    expect(
      await readTenantCache("https://acme.atlassian.net", undefined, future),
    ).toBeNull();
  });

  // Corrupt-json + missing-fields behavior is covered by the toolkit's
  // disk-cache tests; both surface as undefined here, which
  // readTenantCache turns into null.
});
