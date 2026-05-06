import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getConfig } from "../src/config.js";

const REQUIRED_KEYS = [
  "JIRA_HOST",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_TOOL_MODE",
  "JIRA_ENABLED_CATEGORIES",
  "JIRA_DISABLED_ACTIONS",
] as const;

const captured = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of REQUIRED_KEYS) captured.set(k, process.env[k]);
  process.env.JIRA_HOST = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "user@example.com";
  process.env.JIRA_API_TOKEN = "ATATT-test";
  delete process.env.JIRA_TOOL_MODE;
  delete process.env.JIRA_ENABLED_CATEGORIES;
  delete process.env.JIRA_DISABLED_ACTIONS;
});

afterEach(() => {
  for (const k of REQUIRED_KEYS) {
    const original = captured.get(k);
    if (original === undefined) delete process.env[k];
    else process.env[k] = original;
  }
});

describe("getConfig toolMode", () => {
  it('defaults to "classic" when JIRA_TOOL_MODE is unset', () => {
    expect(getConfig().toolMode).toBe("classic");
  });

  it('defaults to "classic" when JIRA_TOOL_MODE is empty', () => {
    process.env.JIRA_TOOL_MODE = "";
    expect(getConfig().toolMode).toBe("classic");
  });

  it('accepts "classic" explicitly', () => {
    process.env.JIRA_TOOL_MODE = "classic";
    expect(getConfig().toolMode).toBe("classic");
  });

  it('accepts "code-api"', () => {
    process.env.JIRA_TOOL_MODE = "code-api";
    expect(getConfig().toolMode).toBe("code-api");
  });

  it("throws on an unknown mode value with the actual value in the message", () => {
    process.env.JIRA_TOOL_MODE = "v3";
    expect(() => getConfig()).toThrow(/JIRA_TOOL_MODE=v3/);
  });
});

describe("getConfig toolFilter", () => {
  it("defaults to empty arrays when no filter env vars are set", () => {
    const f = getConfig().toolFilter;
    expect(f.enabledCategories).toEqual([]);
    expect(f.disabledActions).toEqual([]);
  });

  it("parses JIRA_ENABLED_CATEGORIES as a CSV", () => {
    process.env.JIRA_ENABLED_CATEGORIES = "issue,search,comment";
    expect(getConfig().toolFilter.enabledCategories).toEqual([
      "issue",
      "search",
      "comment",
    ]);
  });

  it("trims whitespace and drops empty entries", () => {
    process.env.JIRA_ENABLED_CATEGORIES = " issue , , search ,";
    expect(getConfig().toolFilter.enabledCategories).toEqual([
      "issue",
      "search",
    ]);
  });

  it("drops unknown categories with a stderr warning rather than throwing", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.JIRA_ENABLED_CATEGORIES = "issue,nope,search";
      expect(getConfig().toolFilter.enabledCategories).toEqual([
        "issue",
        "search",
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown category "nope"'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("parses JIRA_DISABLED_ACTIONS as a CSV", () => {
    process.env.JIRA_DISABLED_ACTIONS = "issue.delete,project.delete,vote.add";
    expect(getConfig().toolFilter.disabledActions).toEqual([
      "issue.delete",
      "project.delete",
      "vote.add",
    ]);
  });

  it("does not validate disabled action names against the manifest", () => {
    // By design: validation happens at runtime in invokeOperationRaw
    // so a typo doesn't crash startup. The list is forwarded as-is.
    process.env.JIRA_DISABLED_ACTIONS = "made.up,issue.delete";
    expect(getConfig().toolFilter.disabledActions).toEqual([
      "made.up",
      "issue.delete",
    ]);
  });

  it("handles both filters set together", () => {
    process.env.JIRA_ENABLED_CATEGORIES = "issue,comment";
    process.env.JIRA_DISABLED_ACTIONS = "issue.delete";
    const f = getConfig().toolFilter;
    expect(f.enabledCategories).toEqual(["issue", "comment"]);
    expect(f.disabledActions).toEqual(["issue.delete"]);
  });
});
