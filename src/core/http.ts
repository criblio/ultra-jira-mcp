// Shared HTTP transport for the Jira client.
//
// v1 used the native `fetch` — fine for one-off calls but terrible when
// an agent makes dozens of calls in a session: each one opens a new TLS
// connection. We swap in an undici `Agent` with keep-alive + a modest
// connection pool, and layer a retry-on-429 wrapper on top.
//
// The Agent is a module-level singleton, lazily created on first use.
// Tests can inject a stub via `__setTransportForTests` to skip the
// network entirely.

import { Agent, request as undiciRequest } from "undici";

// --- Types -------------------------------------------------------------

export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  text: () => Promise<string>;
}

// The subset of undici we depend on. Extracted so tests can stub it
// without mocking the whole module.
export type TransportFn = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

// --- Real transport ----------------------------------------------------

let poolAgent: Agent | null = null;

function getAgent(): Agent {
  if (!poolAgent) {
    poolAgent = new Agent({
      keepAliveTimeout: 10_000,
      keepAliveMaxTimeout: 60_000,
      connections: 8,
      pipelining: 1,
    });
  }
  return poolAgent;
}

// Exposed for graceful shutdown if the host process ever needs it.
export async function closeHttpPool(): Promise<void> {
  if (poolAgent) {
    await poolAgent.close();
    poolAgent = null;
  }
}

const realTransport: TransportFn = async (url, init) => {
  const res = await undiciRequest(url, {
    method: init.method as any,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    dispatcher: getAgent(),
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    text: () => res.body.text(),
  };
};

let activeTransport: TransportFn = realTransport;

// --- Retry logic -------------------------------------------------------

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  // Overridable so tests can avoid real timers.
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Compute the delay for a retry attempt. Honors Retry-After (seconds or
// HTTP-date) when the server sent one; otherwise exponential backoff
// with jitter.
export function computeBackoffMs(
  attempt: number,
  retryAfterHeader: string | undefined,
  opts: RetryOptions,
  now: number = Date.now(),
  random: () => number = Math.random,
): number {
  if (retryAfterHeader) {
    const asNumber = Number(retryAfterHeader);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.min(asNumber * 1000, opts.maxDelayMs);
    }
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) {
      // A past Retry-After (clock skew, queued response) means "retry
      // now" — return 0 rather than falling through to exponential
      // backoff, which would impose a spurious delay.
      const diff = asDate - now;
      return diff > 0 ? Math.min(diff, opts.maxDelayMs) : 0;
    }
  }
  const exp = opts.baseDelayMs * Math.pow(2, attempt);
  const jittered = exp * (0.5 + random() * 0.5);
  return Math.min(Math.round(jittered), opts.maxDelayMs);
}

function headerToString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

// --- Public entry point ------------------------------------------------

export async function httpRequest(
  url: string,
  init: HttpRequestInit,
  retry: RetryOptions = DEFAULT_RETRY,
): Promise<HttpResponse> {
  const sleep = retry.sleep ?? defaultSleep;

  let lastResponse: HttpResponse | null = null;
  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    const res = await activeTransport(url, init);
    lastResponse = res;

    if (res.statusCode !== 429) return res;
    if (attempt === retry.maxRetries) return res;

    const retryAfter = headerToString(res.headers["retry-after"]);
    const delayMs = computeBackoffMs(attempt, retryAfter, retry);
    // Drain the body to free the socket before the next attempt.
    await res.text().catch(() => undefined);
    await sleep(delayMs);
  }

  // Unreachable: the loop always returns. Narrow the type.
  return lastResponse as HttpResponse;
}

// --- Test hooks --------------------------------------------------------

// Replace the transport for the duration of a test. Returns a restore
// function. Exported with a `__` prefix to signal "don't touch".
export function __setTransportForTests(fn: TransportFn): () => void {
  const prev = activeTransport;
  activeTransport = fn;
  return () => {
    activeTransport = prev;
  };
}
