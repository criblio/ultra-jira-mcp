// Focused test for JiraClient's init-retry behavior after PR #4.
//
// Regression test: if the first `fetchCloudId()` call rejects, the
// second call must be allowed to retry. Before the PR #170 fix, a
// rejected initPromise was left in place and every subsequent call
// awaited the same rejected promise.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JiraClient } from "../../src/auth/jira-client.js";
import {
  __setTransportForTests,
  type HttpResponse,
  type TransportFn,
} from "@scottlepper/mcp-toolkit/transport";
import { rootCacheDir } from "../../src/core/sandbox.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

function stub(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): HttpResponse {
  return {
    statusCode: status,
    headers,
    text: () => Promise.resolve(body),
  };
}

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

describe("JiraClient.ensureInitialized — retry after failure", () => {
  it("clears the cached initPromise on rejection so the next call can retry", async () => {
    let callCount = 0;
    const transport: TransportFn = async (_url, _init) => {
      callCount++;
      if (callCount === 1) {
        return stub(503, "upstream down");
      }
      return stub(200, JSON.stringify({ cloudId: "recovered-cloud-id" }));
    };
    const restore = __setTransportForTests(transport);

    try {
      // Use a unique host so the tenant-cache file for this test
      // can't collide with anything else's fixture.
      const client = new JiraClient({
        host: "https://retry-test-host.atlassian.net",
        email: "x@example.com",
        apiToken: "tok",
        tokenType: "scoped",
      } as any);

      await expect(
        // Any request triggers ensureInitialized → fetchCloudId.
        client.get("/anything"),
      ).rejects.toThrow(/upstream down|503/);

      // Second attempt must recover, not repeat the old rejection.
      const secondTransport: TransportFn = async (url, _init) => {
        if (url.endsWith("/_edge/tenant_info")) {
          return stub(200, JSON.stringify({ cloudId: "recovered-cloud-id" }));
        }
        // After init, the real request goes to api.atlassian.com.
        return stub(200, JSON.stringify({ ok: true }));
      };
      const restore2 = __setTransportForTests(secondTransport);
      try {
        const result = await client.get<{ ok: boolean }>("/anything");
        expect(result).toEqual({ ok: true });
      } finally {
        restore2();
      }
    } finally {
      restore();
    }
  });
});
