import { describe, expect, it } from "vitest";

import { TtlLruCache } from "../../src/core/lru.js";

describe("TtlLruCache", () => {
  it("returns undefined for unknown keys", () => {
    const c = new TtlLruCache<string, number>({ maxSize: 4, ttlMs: 1000 });
    expect(c.get("missing")).toBeUndefined();
  });

  it("stores and retrieves values", () => {
    const c = new TtlLruCache<string, number>({ maxSize: 4, ttlMs: 1000 });
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
  });

  it("expires values after ttl", () => {
    let now = 0;
    const c = new TtlLruCache<string, number>({ maxSize: 4, ttlMs: 100, now: () => now });
    c.set("a", 1);
    now = 50;
    expect(c.get("a")).toBe(1);
    now = 200;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("evicts the least recently used when over capacity", () => {
    const c = new TtlLruCache<string, number>({ maxSize: 2, ttlMs: 1_000_000 });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // touch a → b becomes LRU
    c.set("c", 3); // evicts b
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe(3);
  });

  it("refreshes ttl on set for an existing key", () => {
    let now = 0;
    const c = new TtlLruCache<string, number>({ maxSize: 4, ttlMs: 100, now: () => now });
    c.set("a", 1);
    now = 90;
    c.set("a", 2);
    now = 150; // original would have expired at 100, but we re-set at 90 so expires at 190
    expect(c.get("a")).toBe(2);
    now = 200;
    expect(c.get("a")).toBeUndefined();
  });

  it("delete removes an entry", () => {
    const c = new TtlLruCache<string, number>({ maxSize: 4, ttlMs: 1000 });
    c.set("a", 1);
    expect(c.delete("a")).toBe(true);
    expect(c.get("a")).toBeUndefined();
    expect(c.delete("a")).toBe(false);
  });

  it("clear empties the cache", () => {
    const c = new TtlLruCache<string, number>({ maxSize: 4, ttlMs: 1000 });
    c.set("a", 1);
    c.set("b", 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });

  it("rejects invalid maxSize", () => {
    expect(() => new TtlLruCache({ maxSize: 0, ttlMs: 1 })).toThrow();
  });
});
