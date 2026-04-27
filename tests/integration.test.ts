/**
 * Integration tests against a live Jira instance.
 *
 * SKIPPED in PR #7c. The previous suite called v1 tools by name
 * (jira_get_current_user, jira_create_project, …) via `handleTool`.
 * v1 was deleted in PR #7c; v2 exposes consolidated tools
 * (jira_user, jira_project, …) with action-discriminated args.
 *
 * Per the plan, PR #11 rebuilds this suite against the v2 surface
 * and adds a token-budget benchmark. Until then, unit coverage
 * (296+ tests under tests/core and tests/tools) is the source of
 * truth for behavior.
 *
 * Original tests preserved in git history at the commit that landed
 * PR #7c — recoverable when PR #11 starts.
 */

import { describe, it } from "vitest";

describe.skip("Jira MCP Integration Tests (rebuild in PR #11)", () => {
  it("placeholder", () => {
    // No-op. See file-level comment.
  });
});
