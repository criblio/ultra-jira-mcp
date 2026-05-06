import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __setTransportForTests,
  computeBackoffMs,
  DEFAULT_RETRY,
  httpRequest,
  type HttpResponse,
  type TransportFn,
} from "../../src/core/http.js";

function stubResponse(statusCode: number, body = "", headers: Record<string, string> = {}): HttpResponse {
  return {
    statusCode,
    headers,
    text: () => Promise.resolve(body),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computeBackoffMs", () => {
  it("honors numeric Retry-After (seconds)", () => {
    expect(
      computeBackoffMs(0, "5", DEFAULT_RETRY),
    ).toBe(5000);
  });

  it("honors HTTP-date Retry-After", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const header = "Thu, 01 Jan 2026 00:00:07 GMT";
    expect(computeBackoffMs(0, header, DEFAULT_RETRY, now)).toBe(7000);
  });

  it("treats a past Retry-After date as 'retry immediately'", () => {
    // Clock skew: server sent a date older than our current time.
    const now = Date.parse("2026-01-01T00:00:10Z");
    const header = "Thu, 01 Jan 2026 00:00:05 GMT";
    expect(computeBackoffMs(0, header, DEFAULT_RETRY, now)).toBe(0);
  });

  it("clamps Retry-After to maxDelayMs", () => {
    expect(
      computeBackoffMs(0, "9999", DEFAULT_RETRY),
    ).toBe(DEFAULT_RETRY.maxDelayMs);
  });

  it("uses exponential backoff with jitter when no Retry-After", () => {
    // random() = 0.5 → jitter factor = 0.75 → attempt 0: 500 * 1 * 0.75 = 375
    expect(
      computeBackoffMs(0, undefined, DEFAULT_RETRY, 0, () => 0.5),
    ).toBe(375);
    // attempt 2: 500 * 4 * 0.75 = 1500
    expect(
      computeBackoffMs(2, undefined, DEFAULT_RETRY, 0, () => 0.5),
    ).toBe(1500);
  });

  it("ignores invalid Retry-After and falls back to exponential", () => {
    const ms = computeBackoffMs(0, "not-a-number", DEFAULT_RETRY, 0, () => 0.5);
    expect(ms).toBe(375);
  });
});

describe("httpRequest retry logic", () => {
  it("returns immediately on 2xx", async () => {
    const transport = vi.fn<TransportFn>().mockResolvedValue(
      stubResponse(200, "ok"),
    );
    const restore = __setTransportForTests(transport);
    try {
      const res = await httpRequest("https://x", { method: "GET", headers: {} });
      expect(res.statusCode).toBe(200);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("retries up to maxRetries on 429 then returns the last response", async () => {
    const transport = vi.fn<TransportFn>().mockResolvedValue(
      stubResponse(429, "rate limited", { "retry-after": "0" }),
    );
    const restore = __setTransportForTests(transport);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
    try {
      const res = await httpRequest(
        "https://x",
        { method: "GET", headers: {} },
        { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 1000, sleep },
      );
      expect(res.statusCode).toBe(429);
      expect(transport).toHaveBeenCalledTimes(3); // initial + 2 retries
      expect(sleep).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("stops retrying once a non-429 comes back", async () => {
    const transport = vi
      .fn<TransportFn>()
      .mockResolvedValueOnce(stubResponse(429, "", { "retry-after": "0" }))
      .mockResolvedValueOnce(stubResponse(200, "ok"));
    const restore = __setTransportForTests(transport);
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
    try {
      const res = await httpRequest(
        "https://x",
        { method: "GET", headers: {} },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 1000, sleep },
      );
      expect(res.statusCode).toBe(200);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("passes method, headers, and body to the transport", async () => {
    const transport = vi.fn<TransportFn>().mockResolvedValue(
      stubResponse(200, "{}"),
    );
    const restore = __setTransportForTests(transport);
    try {
      await httpRequest("https://x/y", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic abc" },
        body: JSON.stringify({ a: 1 }),
      });
      expect(transport).toHaveBeenCalledWith("https://x/y", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Basic abc" },
        body: '{"a":1}',
      });
    } finally {
      restore();
    }
  });
});
