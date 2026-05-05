// Tests for tool-list filtering by JIRA_ENABLED_CATEGORIES /
// JIRA_DISABLED_ACTIONS, exposed via getV2Tools(filter).
//
// The tool-list is what every conversation pays at startup; this is
// where the cost reduction lives. Action enforcement at call time is
// covered in tests/core/manifest.test.ts.

import { describe, expect, it } from "vitest";

import type { ToolFilterConfig } from "../../../src/config.js";
import {
  allConsolidatedTools,
  getV2Tools,
  v2Tools,
} from "../../../src/tools/v2/index.js";

const ALL_CATEGORIES = [
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
];

function emptyFilter(): ToolFilterConfig {
  return { enabledCategories: [], disabledActions: [] };
}

// Fish out a JSON Schema's `oneOf` so we can count remaining actions.
function actionsIn(tool: { inputSchema: unknown }): string[] {
  const schema = tool.inputSchema as { oneOf?: Array<{ title?: string }> };
  return (schema.oneOf ?? []).map((b) => b.title ?? "");
}

describe("getV2Tools (no filter)", () => {
  it("emits all 16 consolidated tools by default", () => {
    const out = getV2Tools();
    expect(out).toHaveLength(allConsolidatedTools.length);
    expect(out.map((t) => t.name).sort()).toEqual(
      allConsolidatedTools.map((t) => t.name).sort(),
    );
  });

  it("matches the back-compat v2Tools export", () => {
    expect(getV2Tools().map((t) => t.name)).toEqual(
      v2Tools.map((t) => t.name),
    );
  });

  it("an empty filter behaves the same as no filter", () => {
    expect(getV2Tools(emptyFilter()).map((t) => t.name)).toEqual(
      v2Tools.map((t) => t.name),
    );
  });
});

describe("getV2Tools enabledCategories filter", () => {
  it("keeps only listed categories", () => {
    const out = getV2Tools({
      enabledCategories: ["issue", "search", "comment"],
      disabledActions: [],
    });
    expect(out.map((t) => t.name).sort()).toEqual([
      "jira_comment",
      "jira_issue",
      "jira_search",
    ]);
  });

  it("a category with no matching tool just yields fewer tools (no error)", () => {
    // "permissions" is exposed via jira_group's `mine` action, not a
    // standalone tool — so it won't match a tool name. Filter just
    // returns whatever overlaps with the canonical list.
    const out = getV2Tools({
      enabledCategories: ["permissions"],
      disabledActions: [],
    });
    expect(out).toEqual([]);
  });

  it("category names must match the consolidated tool surface, not manifest categories", () => {
    // The consolidated tool for `issueLink.*` operations is named
    // jira_link, so the user-facing category is "link". Sanity:
    // "issueLink" doesn't accidentally match.
    expect(
      getV2Tools({
        enabledCategories: ["issueLink"],
        disabledActions: [],
      }),
    ).toEqual([]);
    expect(
      getV2Tools({ enabledCategories: ["link"], disabledActions: [] })
        .map((t) => t.name),
    ).toEqual(["jira_link"]);
  });
});

describe("getV2Tools disabledActions filter", () => {
  it("strips disabled actions from a tool's oneOf without dropping the tool", () => {
    const out = getV2Tools({
      enabledCategories: [],
      disabledActions: ["issue.delete"],
    });
    const issueTool = out.find((t) => t.name === "jira_issue");
    expect(issueTool).toBeDefined();
    const actions = actionsIn(issueTool!);
    expect(actions).not.toContain("delete");
    // Other actions still present.
    expect(actions).toContain("get");
    expect(actions).toContain("create");
  });

  it("drops a tool entirely when every action is disabled", () => {
    // jira_server has only one underlying op (server.info). Disabling
    // it should remove the whole tool from the listing.
    const out = getV2Tools({
      enabledCategories: [],
      disabledActions: ["server.info"],
    });
    expect(out.map((t) => t.name)).not.toContain("jira_server");
  });

  it("does not validate disabled action names — unknown ops are silently no-ops", () => {
    // Same philosophy as parseToolFilter: a typo shouldn't blow up
    // the listing.
    const out = getV2Tools({
      enabledCategories: [],
      disabledActions: ["made.up", "issue.delete"],
    });
    expect(out.map((t) => t.name)).toContain("jira_issue");
    const actions = actionsIn(out.find((t) => t.name === "jira_issue")!);
    expect(actions).not.toContain("delete");
  });

  it("category and disabled-action filters compose", () => {
    const out = getV2Tools({
      enabledCategories: ["issue"],
      disabledActions: ["issue.delete", "issue.create"],
    });
    expect(out.map((t) => t.name)).toEqual(["jira_issue"]);
    const actions = actionsIn(out[0]);
    expect(actions).not.toContain("delete");
    expect(actions).not.toContain("create");
    expect(actions).toContain("get");
  });
});

describe("getV2Tools sanity: all 16 categories accept a filter that keeps them", () => {
  // Any future category-name drift between config and tool layers
  // would surface here.
  it.each(ALL_CATEGORIES)("category %s yields exactly one tool", (cat) => {
    const out = getV2Tools({
      enabledCategories: [cat],
      disabledActions: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe(`jira_${cat}`);
  });
});
