// Disk-backed cache for the Jira cloudId.
//
// The cloudId is per-site and effectively immutable, but the v1 client
// re-fetched it every cold start via `/_edge/tenant_info`. Caching it
// under the session cache root makes warm starts free.
//
// Layout:
//   ${rootCacheDir}/tenant/${hostKey}.json
//     { "cloudId": "...", "fetchedAt": "ISO-8601" }
//
// Keyed by host rather than session id so the cache survives across
// sessions. TTL is 24h by default — plenty of headroom for the
// "never actually changes" reality.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { rootCacheDir } from "./sandbox.js";

const TENANT_DIR_NAME = "tenant";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface TenantCacheEntry {
  cloudId: string;
  fetchedAt: string;
}

// Host → a safe filename. We can't just use the host verbatim because
// it contains a `/` after the scheme. Strip the scheme and any path,
// and replace unsafe characters.
export function hostKey(host: string): string {
  return host
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "_");
}

function tenantPath(host: string): string {
  return path.join(rootCacheDir(), TENANT_DIR_NAME, `${hostKey(host)}.json`);
}

export async function readTenantCache(
  host: string,
  ttlMs: number = DEFAULT_TTL_MS,
  now: number = Date.now(),
): Promise<string | null> {
  const file = tenantPath(host);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let entry: TenantCacheEntry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof entry.cloudId !== "string" || typeof entry.fetchedAt !== "string") {
    return null;
  }

  const fetchedAt = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetchedAt)) return null;
  if (now - fetchedAt > ttlMs) return null;

  return entry.cloudId;
}

export async function writeTenantCache(host: string, cloudId: string): Promise<void> {
  const file = tenantPath(host);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const entry: TenantCacheEntry = {
    cloudId,
    fetchedAt: new Date().toISOString(),
  };
  await fs.writeFile(file, JSON.stringify(entry, null, 2), "utf8");
}
