import { config } from "dotenv";

// Load environment variables from .env files
// Priority: .env.local > .env (later calls override earlier)
config({ path: ".env" });
config({ path: ".env.local", override: true });

// Token types based on prefix:
// - ATATT: Scoped API token (user)
// - ATSTT: Scoped API token (service account)
// - No prefix / other: Classic API token
export type TokenType = "scoped" | "classic";

// v2 tool surface modes:
// - "code-api": (default) expose a single `jira_code_api` MCP tool that
//   points at on-disk TypeScript stubs the agent imports via tsx. Most
//   token-efficient — ~500 tokens for the tool listing.
// - "classic": expose the 16 consolidated MCP tools. Keeps the
//   request/response shape v1 users are used to. ~3-4k tokens for the
//   tool listing.
export type ToolMode = "code-api" | "classic";

export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  tokenType: TokenType;
  cloudId?: string; // Required for scoped tokens, can be auto-fetched
  toolMode: ToolMode;
}

/**
 * Detect token type based on prefix
 * - ATATT: Scoped API token (user)
 * - ATSTT: Scoped API token (service account)
 * - Other: Classic API token
 */
function detectTokenType(token: string): TokenType {
  if (token.startsWith("ATATT") || token.startsWith("ATSTT")) {
    return "scoped";
  }
  return "classic";
}

function parseToolMode(raw: string | undefined): ToolMode {
  if (raw === undefined || raw === "") return "code-api";
  if (raw === "classic" || raw === "code-api") return raw;
  throw new Error(
    `Invalid JIRA_TOOL_MODE=${raw}. Expected "code-api" (default) or "classic".`,
  );
}

export function getConfig(): JiraConfig {
  const host = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const cloudId = process.env.JIRA_CLOUD_ID;
  const toolMode = parseToolMode(process.env.JIRA_TOOL_MODE);

  const missing: string[] = [];

  if (!host) missing.push("JIRA_HOST");
  if (!email) missing.push("JIRA_EMAIL");
  if (!apiToken) missing.push("JIRA_API_TOKEN");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n\n` +
        "Please set the following environment variables:\n" +
        "  JIRA_HOST     - Your Jira instance URL (e.g., https://yourcompany.atlassian.net)\n" +
        "  JIRA_EMAIL    - Your Atlassian account email\n" +
        "  JIRA_API_TOKEN - API token from https://id.atlassian.com/manage-profile/security/api-tokens\n" +
        "  JIRA_CLOUD_ID  - (Optional) Cloud ID for scoped tokens, will be auto-fetched if not provided\n" +
        "  JIRA_TOOL_MODE - (Optional) 'code-api' (default) or 'classic'"
    );
  }

  // Normalize host URL (remove trailing slash)
  const normalizedHost = host!.replace(/\/+$/, "");

  const tokenType = detectTokenType(apiToken!);

  return {
    host: normalizedHost,
    email: email!,
    apiToken: apiToken!,
    tokenType,
    cloudId,
    toolMode,
  };
}

