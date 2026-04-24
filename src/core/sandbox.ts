import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { SandboxOpts, SandboxResult } from "../types/refs.js";

const ROOT_DIR_NAME = "jira-mcp";
const STALE_SESSION_MS = 24 * 60 * 60 * 1000;

// Session IDs become a single path segment under the cache root. Restrict
// to a safe charset so a malformed env var can't escape the session dir
// via "../" or collide with other sessions via case/whitespace tricks.
// Anything that doesn't match falls back to the pid.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

let cachedSessionDir: string | null = null;

function resolveSessionId(): string {
  const fromEnv = process.env.MCP_SESSION_ID?.trim();
  if (fromEnv && SESSION_ID_PATTERN.test(fromEnv)) return fromEnv;
  return String(process.pid);
}

export function rootCacheDir(): string {
  return path.join(os.tmpdir(), ROOT_DIR_NAME);
}

export function sessionCacheDir(): string {
  if (cachedSessionDir) return cachedSessionDir;
  cachedSessionDir = path.join(rootCacheDir(), resolveSessionId());
  return cachedSessionDir;
}

// Test-only: forget the cached path so `MCP_SESSION_ID` can be swapped
// between cases. Exported via a `__` prefix to signal "don't touch".
export function __resetSessionCacheDirForTests(): void {
  cachedSessionDir = null;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function hashPayload(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex").slice(0, 16);
}

export async function sandbox<TInput, TSummary>(
  response: TInput,
  opts: SandboxOpts<TInput, TSummary>,
): Promise<SandboxResult<TSummary>> {
  const serialized = JSON.stringify(response, null, 2);
  const hash = hashPayload(serialized);
  const kindDir = path.join(sessionCacheDir(), opts.kind);
  const filePath = path.join(kindDir, `${hash}.json`);

  // Intentional sync check: we want read-before-write atomicity for the
  // content-addressed cache. Two concurrent `sandbox()` calls with the
  // same hash must not both write. `fs.access` would split the check
  // and the write across event-loop ticks and introduce a race window;
  // `existsSync` completes in a single tick.
  if (!existsSync(filePath)) {
    await ensureDir(kindDir);
    await fs.writeFile(filePath, serialized, "utf8");
  }

  return {
    summary: opts.summarize(response),
    ref: filePath,
    hash,
    fullSize: Buffer.byteLength(serialized, "utf8"),
    fetchedAt: new Date().toISOString(),
  };
}

export interface CleanupError {
  session: string;
  message: string;
}

export interface CleanupResult {
  removed: string[];
  skipped: string[];
  errors: CleanupError[];
}

// Delete session directories that haven't been touched in > 24h.
// Called once at server startup. Per-entry failures are captured in
// `errors` rather than thrown, so a permission problem on one stale
// dir can't block the server from starting — but the caller still has
// enough diagnostic info to surface or log the failure.
export async function cleanupStaleSessions(
  now: number = Date.now(),
): Promise<CleanupResult> {
  const root = rootCacheDir();
  const removed: string[] = [];
  const skipped: string[] = [];
  const errors: CleanupError[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { removed, skipped, errors };
    }
    throw err;
  }

  const currentSession = path.basename(sessionCacheDir());

  await Promise.all(
    entries.map(async (name) => {
      if (name === currentSession) {
        skipped.push(name);
        return;
      }
      const full = path.join(root, name);
      try {
        const stat = await fs.stat(full);
        if (!stat.isDirectory()) {
          skipped.push(name);
          return;
        }
        if (now - stat.mtimeMs > STALE_SESSION_MS) {
          await fs.rm(full, { recursive: true, force: true });
          removed.push(name);
        } else {
          skipped.push(name);
        }
      } catch (err) {
        errors.push({
          session: name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  return { removed, skipped, errors };
}
