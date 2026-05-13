// Disk-backed cache for the Jira cloudId.
//
// The cloudId is per-site and effectively immutable, but the v1 client
// re-fetched it every cold start via `/_edge/tenant_info`. Caching it
// under the session cache root makes warm starts free.
//
// The on-disk format and path layout are owned by the toolkit's
// `core/disk-cache`. We:
//   - derive a stable host key (the public `hostKey()` is preserved
//     because tests assert on its transformation);
//   - pass the host key as the cache key (the toolkit hashes it
//     before becoming a filename);
//   - default the TTL to 24h, since the cloudId effectively never
//     changes.
//
// Filename layout after the swap:
//   ${rootCacheDir}/tenant/<sha256(hostKey)>.json
//     { "v": "<cloudId>", "fetchedAt": "ISO-8601" }
// (Previously: ${rootCacheDir}/tenant/<hostKey>.json with the raw
// cloudId field; both old and new entries live in the same scope
// directory, so the directory cleanup pattern in tests still works.)

import {
  readDiskCache,
  writeDiskCache,
} from "@scottlepper/mcp-toolkit/disk-cache";

import { jiraSandbox } from "./sandbox.js";

const SCOPE = "tenant";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Host → a safe key. We can't just use the host verbatim because it
// contains a `/` after the scheme. Strip the scheme and any path, and
// replace unsafe characters. Kept exported because tests assert the
// transformation directly.
export function hostKey(host: string): string {
  return host
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "_");
}

function cacheOpts(ttlMs: number) {
  return {
    rootDir: jiraSandbox.rootCacheDir(),
    scope: SCOPE,
    ttlMs,
  };
}

export async function readTenantCache(
  host: string,
  ttlMs: number = DEFAULT_TTL_MS,
  now: number = Date.now(),
): Promise<string | null> {
  const value = await readDiskCache<string>(cacheOpts(ttlMs), hostKey(host), now);
  if (typeof value !== "string") return null;
  return value;
}

export async function writeTenantCache(
  host: string,
  cloudId: string,
): Promise<void> {
  await writeDiskCache<string>(cacheOpts(DEFAULT_TTL_MS), hostKey(host), cloudId);
}
