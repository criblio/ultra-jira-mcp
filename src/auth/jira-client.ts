import { httpRequest } from "../core/http.js";
import { TtlLruCache } from "../core/lru.js";
import { readTenantCache, writeTenantCache } from "../core/tenant-cache.js";
import { JiraConfig } from "../config.js";

export interface JiraRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  queryParams?: Record<string, string | number | boolean | undefined>;
}

export interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: JiraErrorResponse
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

// Metadata endpoints whose responses rarely change within a session.
// GET requests to these paths are served from an in-memory LRU for the
// TTL. Everything else bypasses the cache.
const METADATA_PATHS = new Set([
  "/field",
  "/issuetype",
  "/priority",
  "/status",
  "/resolution",
]);

const METADATA_TTL_MS = 5 * 60 * 1000;
const METADATA_MAX_SIZE = 64;

export class JiraClient {
  private config: JiraConfig;
  private cloudId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly metadataCache = new TtlLruCache<string, unknown>({
    maxSize: METADATA_MAX_SIZE,
    ttlMs: METADATA_TTL_MS,
  });

  constructor(config: JiraConfig) {
    this.config = config;

    // If cloudId is provided in config, use it directly
    if (config.cloudId) {
      this.cloudId = config.cloudId;
    }
  }

  /**
   * Initialize the client by fetching the cloudId if needed (for scoped tokens)
   */
  private async ensureInitialized(): Promise<void> {
    // Classic tokens don't need initialization
    if (this.config.tokenType === "classic") {
      return;
    }

    // Already have cloudId
    if (this.cloudId) {
      return;
    }

    // Prevent multiple parallel initializations. On rejection, clear
    // the promise so the next call can retry — otherwise a transient
    // init failure (network blip, 5xx on tenant_info) would leave the
    // client permanently broken.
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.fetchCloudId().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  /**
   * Fetch the cloudId from the tenant_info endpoint, preferring a
   * cached value on disk (24h TTL) to avoid the network hop on warm
   * starts. Works for both scoped tokens and classic tokens.
   */
  private async fetchCloudId(): Promise<void> {
    // Disk cache first.
    try {
      const cached = await readTenantCache(this.config.host);
      if (cached) {
        this.cloudId = cached;
        return;
      }
    } catch {
      // Cache read failure is non-fatal — fall through to the network.
    }

    const tenantInfoUrl = `${this.config.host}/_edge/tenant_info`;
    const response = await httpRequest(tenantInfoUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await response.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new JiraApiError(
        `Failed to fetch tenant info from ${tenantInfoUrl}: ${text}`,
        response.statusCode
      );
    }

    let tenantInfo: { cloudId?: string };
    try {
      tenantInfo = JSON.parse(text);
    } catch {
      throw new JiraApiError(
        `Invalid JSON from ${tenantInfoUrl}: ${text.slice(0, 200)}`,
        response.statusCode
      );
    }

    if (!tenantInfo.cloudId) {
      throw new JiraApiError("No cloudId found in tenant info response", 500);
    }

    this.cloudId = tenantInfo.cloudId;
    try {
      await writeTenantCache(this.config.host, tenantInfo.cloudId);
    } catch {
      // Cache write failure is non-fatal.
    }
  }

  /**
   * Build the appropriate URL based on token type
   */
  private buildUrl(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>,
    isAgile: boolean = false
  ): string {
    let baseUrl: string;

    if (this.config.tokenType === "scoped") {
      // Scoped tokens use api.atlassian.com with cloudId
      const apiBase = isAgile
        ? `https://api.atlassian.com/ex/jira/${this.cloudId}/rest/agile/1.0`
        : `https://api.atlassian.com/ex/jira/${this.cloudId}/rest/api/3`;
      baseUrl = apiBase;
    } else {
      // Classic tokens use the direct site URL
      const apiBase = isAgile
        ? `${this.config.host}/rest/agile/1.0`
        : `${this.config.host}/rest/api/3`;
      baseUrl = apiBase;
    }

    const url = new URL(`${baseUrl}${path}`);

    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Get the appropriate authorization header
   * Both classic and scoped tokens use Basic authentication (email:token)
   */
  private getAuthHeader(): string {
    // Both classic and scoped tokens use Basic authentication
    const credentials = Buffer.from(
      `${this.config.email}:${this.config.apiToken}`
    ).toString("base64");
    return `Basic ${credentials}`;
  }

  /**
   * Public accessor for the auth header. Used by side-channel clients
   * (attachment downloader) that need to make authenticated requests
   * outside the main request pipeline. Callers are trusted — never
   * expose this value to a response payload or log.
   */
  getAuthorizationHeader(): string {
    return this.getAuthHeader();
  }

  private metadataCacheKey(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>,
    isAgile?: boolean,
  ): string | null {
    if (isAgile) return null;
    if (!METADATA_PATHS.has(path)) return null;
    // Include queryParams in the key so different paginations don't collide.
    const qs = queryParams
      ? JSON.stringify(
          Object.entries(queryParams)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : "";
    return `${path}?${qs}`;
  }

  private async request<T>(
    path: string,
    options: JiraRequestOptions = {},
    isAgile: boolean = false
  ): Promise<T> {
    // Ensure we're initialized (fetches cloudId if needed)
    await this.ensureInitialized();

    const { method = "GET", body, queryParams } = options;

    // Serve metadata GETs from the in-memory LRU if possible.
    const cacheKey =
      method === "GET" ? this.metadataCacheKey(path, queryParams, isAgile) : null;
    if (cacheKey) {
      const hit = this.metadataCache.get(cacheKey);
      if (hit !== undefined) return hit as T;
    }

    const url = this.buildUrl(path, queryParams, isAgile);

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: "application/json",
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await httpRequest(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Handle no content responses
    if (response.statusCode === 204) {
      return {} as T;
    }

    // Get response text first to handle both JSON and non-JSON responses
    const responseText = await response.text();

    // Try to parse as JSON
    let data: T | JiraErrorResponse | undefined;
    let parseError: Error | undefined;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        parseError = e as Error;
        // If it's not JSON, treat the text as the response/error message
      }
    }

    const ok = response.statusCode >= 200 && response.statusCode < 300;
    if (!ok) {
      let errorMessage: string;

      if (data && typeof data === "object") {
        const errorData = data as JiraErrorResponse;
        errorMessage =
          errorData.errorMessages?.join(", ") ||
          Object.values(errorData.errors || {}).join(", ") ||
          `HTTP ${response.statusCode}`;
        throw new JiraApiError(errorMessage, response.statusCode, errorData);
      } else {
        errorMessage = responseText || `HTTP ${response.statusCode}`;
        throw new JiraApiError(errorMessage, response.statusCode, {
          errorMessages: [errorMessage],
        });
      }
    }

    // For successful responses
    if (parseError && responseText) {
      // Non-JSON successful response (like file downloads)
      return responseText as unknown as T;
    }

    const result = (data ?? {}) as T;
    if (cacheKey) this.metadataCache.set(cacheKey, result);
    return result;
  }

  // Platform API (REST API v3)
  async get<T>(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "GET", queryParams }, false);
  }

  async post<T>(
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "POST", body, queryParams }, false);
  }

  async put<T>(
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "PUT", body, queryParams }, false);
  }

  async delete<T>(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "DELETE", queryParams }, false);
  }

  // Agile API (REST Agile 1.0)
  async agileGet<T>(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "GET", queryParams }, true);
  }

  async agilePost<T>(
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "POST", body, queryParams }, true);
  }

  async agilePut<T>(
    path: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "PUT", body, queryParams }, true);
  }

  async agileDelete<T>(
    path: string,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: "DELETE", queryParams }, true);
  }
}
