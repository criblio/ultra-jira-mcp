// Tiny TTL-aware LRU cache.
//
// Used for Jira metadata that rarely changes within a session (field
// definitions, issue types, priorities, statuses). Each entry has an
// absolute expiry; reads on an expired entry count as a miss and evict
// the entry. Insertion order is used for LRU eviction — relying on
// Map's spec-guaranteed iteration order.

export interface TtlCacheOptions {
  maxSize: number;
  ttlMs: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlLruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions) {
    if (opts.maxSize < 1) throw new Error("maxSize must be >= 1");
    if (opts.ttlMs < 0) throw new Error("ttlMs must be >= 0");
    this.maxSize = opts.maxSize;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? (() => Date.now());
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Touch: re-insert so this becomes the most recently used.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const expiresAt = this.now() + this.ttlMs;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt });
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
