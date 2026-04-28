import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "../src/config.js";

const REQUIRED_KEYS = [
  "JIRA_HOST",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_TOOL_MODE",
] as const;

const captured = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of REQUIRED_KEYS) captured.set(k, process.env[k]);
  process.env.JIRA_HOST = "https://example.atlassian.net";
  process.env.JIRA_EMAIL = "user@example.com";
  process.env.JIRA_API_TOKEN = "ATATT-test";
  delete process.env.JIRA_TOOL_MODE;
});

afterEach(() => {
  for (const k of REQUIRED_KEYS) {
    const original = captured.get(k);
    if (original === undefined) delete process.env[k];
    else process.env[k] = original;
  }
});

describe("getConfig toolMode", () => {
  it('defaults to "code-api" when JIRA_TOOL_MODE is unset', () => {
    expect(getConfig().toolMode).toBe("code-api");
  });

  it('defaults to "code-api" when JIRA_TOOL_MODE is empty', () => {
    process.env.JIRA_TOOL_MODE = "";
    expect(getConfig().toolMode).toBe("code-api");
  });

  it('accepts "classic"', () => {
    process.env.JIRA_TOOL_MODE = "classic";
    expect(getConfig().toolMode).toBe("classic");
  });

  it('accepts "code-api" explicitly', () => {
    process.env.JIRA_TOOL_MODE = "code-api";
    expect(getConfig().toolMode).toBe("code-api");
  });

  it("throws on an unknown mode value with the actual value in the message", () => {
    process.env.JIRA_TOOL_MODE = "v3";
    expect(() => getConfig()).toThrow(/JIRA_TOOL_MODE=v3/);
  });
});
