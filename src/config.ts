import { config } from "dotenv";

// Load environment variables from .env files
// Priority: .env.local > .env (later calls override earlier)
//
// `quiet: true` suppresses dotenv v17's startup banner ("injected env
// (n) from .env"). The banner goes to stderr and is harmless for
// long-running processes (the MCP server) but adds noise to every
// jira-cli invocation in direct mode. Silencing it keeps the CLI's
// stderr reserved for actual errors.
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

// Token types based on prefix:
// - ATATT: Scoped API token (user)
// - ATSTT: Scoped API token (service account)
// - No prefix / other: Classic API token
export type TokenType = "scoped" | "classic";

// v2 tool surface modes:
// - "classic": (default) expose the 16 consolidated MCP tools. Same
//   request/response shape v1 users are used to, with v2's trim/sandbox
//   on the response side. The default for v2.0 because per-call cost is
//   on par with code-api once list endpoints are trimmed (PR #180), and
//   it skips the agent-side `JIRA_MCP_SOCKET=… npx tsx -e '…'` dance.
// - "code-api": expose a single `jira_code_api` MCP tool that points at
//   on-disk TypeScript stubs the agent imports via tsx. Smallest
//   tool-list cost (~95 tokens vs ~7,800 for classic), at the cost of
//   per-call complexity. Useful for sessions that do many composed
//   queries (jq filters, multi-call investigations).
export type ToolMode = "code-api" | "classic";

// Tool filtering surface (ported from v1 main).
//
// Two independent knobs:
//   - enabledCategories: whitelist of consolidated tool categories
//     (e.g. "issue", "search", "comment"). Empty = all categories.
//     Filters what shows up in the MCP tool listing in classic mode.
//   - disabledActions: blacklist of fine-grained operation names from
//     the manifest (e.g. "issue.delete", "project.delete"). Enforced
//     at the manifest dispatch layer so it applies in *both* classic
//     and code-api modes — a destructive op disabled here can't be
//     reached through the bridge either.
//
// Categories filter the user-facing surface; disabled actions are a
// safety guarantee that survives mode changes.
export interface ToolFilterConfig {
  // Names match consolidated v2 tool categories (the part after `jira_`):
  // issue, search, comment, user, project, board, sprint, epic, worklog,
  // attachment, filter, link, watcher, field, group, server. Empty = no
  // filter (all categories enabled).
  enabledCategories: string[];
  // Manifest operation names like "issue.delete", "vote.add",
  // "permissions.mine". Empty = no actions disabled.
  disabledActions: string[];
}

export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  tokenType: TokenType;
  cloudId?: string; // Required for scoped tokens, can be auto-fetched
  toolMode: ToolMode;
  toolFilter: ToolFilterConfig;
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
  if (raw === undefined || raw === "") return "classic";
  if (raw === "classic" || raw === "code-api") return raw;
  throw new Error(
    `Invalid JIRA_TOOL_MODE=${raw}. Expected "classic" (default) or "code-api".`,
  );
}

// Canonical list of consolidated v2 tool categories. Mirrors the
// `jira_<category>` MCP tool names without the prefix. Kept as a
// constant rather than derived from the tools array to avoid a
// module cycle (config is imported broadly; tools/v2 is not).
export const CONSOLIDATED_CATEGORIES = [
  "issue",
  "search",
  "comment",
  "user",
  "project",
  "board",
  "sprint",
  "epic",
  "worklog",
  "attachment",
  "filter",
  "link",
  "watcher",
  "field",
  "group",
  "server",
] as const;

function splitCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseToolFilter(): ToolFilterConfig {
  const enabledCategories = splitCsv(process.env.JIRA_ENABLED_CATEGORIES);
  // Validate categories. Unknown values are dropped with a warning
  // rather than thrown — a typo shouldn't crash the server.
  const validCategorySet = new Set<string>(CONSOLIDATED_CATEGORIES);
  const validCategories: string[] = [];
  for (const cat of enabledCategories) {
    if (validCategorySet.has(cat)) {
      validCategories.push(cat);
    } else {
      console.error(
        `Warning: Unknown category "${cat}" in JIRA_ENABLED_CATEGORIES. ` +
          `Valid categories: ${CONSOLIDATED_CATEGORIES.join(", ")}`,
      );
    }
  }

  // disabledActions are validated at runtime against the manifest in
  // src/core/manifest.ts — config doesn't import operations.ts to
  // avoid a heavy load-order coupling. Validation there surfaces
  // unknown ops on first use.
  const disabledActions = splitCsv(process.env.JIRA_DISABLED_ACTIONS);

  return {
    enabledCategories: validCategories,
    disabledActions,
  };
}

export function getConfig(): JiraConfig {
  const host = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const cloudId = process.env.JIRA_CLOUD_ID;
  const toolMode = parseToolMode(process.env.JIRA_TOOL_MODE);
  const toolFilter = parseToolFilter();

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
        "  JIRA_TOOL_MODE - (Optional) 'classic' (default) or 'code-api'\n" +
        "  JIRA_ENABLED_CATEGORIES - (Optional) comma-separated tool categories (e.g. 'issue,search,comment'). Unset = all enabled.\n" +
        "  JIRA_DISABLED_ACTIONS - (Optional) comma-separated manifest operation names (e.g. 'issue.delete,project.delete')."
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
    toolFilter,
  };
}

