import { describe, expect, it } from "vitest";
import { coerceBody } from "../../src/core/body-coerce.js";

describe("coerceBody — JSON-parsing", () => {
  it("leaves objects untouched at the top level", () => {
    const input = { fields: { summary: "hi" } };
    expect(coerceBody(input)).toEqual(input);
  });

  it("parses a JSON-string value into an object", () => {
    // Simulates `jira-cli --fields=@payload.json` arriving as a string.
    const input = { fields: '{"project":{"key":"MON"},"summary":"hi"}' };
    expect(coerceBody(input)).toEqual({
      fields: { project: { key: "MON" }, summary: "hi" },
    });
  });

  it("leaves non-JSON strings as-is for non-rich-text keys", () => {
    const input = { jql: "project = MON" };
    expect(coerceBody(input)).toEqual({ jql: "project = MON" });
  });

  it("returns undefined for undefined input", () => {
    expect(coerceBody(undefined)).toBeUndefined();
  });

  it("survives JSON.parse failure by leaving the string alone", () => {
    // Looks like JSON (starts with `{`) but isn't parseable. Treat as
    // a plain string rather than throwing.
    const input = { meta: "{not really json}" };
    expect(coerceBody(input)).toEqual({ meta: "{not really json}" });
  });
});

describe("coerceBody — markdown→ADF for rich-text fields", () => {
  it("converts `description` markdown to an ADF doc", () => {
    const result = coerceBody({
      fields: { description: "Hello **world**" },
    }) as { fields: { description: { type: string; version: number; content: unknown[] } } };
    expect(result.fields.description.type).toBe("doc");
    expect(result.fields.description.version).toBe(1);
    expect(result.fields.description.content).toHaveLength(1);
  });

  it("converts comment `body` strings to ADF", () => {
    const result = coerceBody({ body: "edited" }) as {
      body: { type: string; content: { content: { text: string }[] }[] };
    };
    expect(result.body.type).toBe("doc");
    expect(result.body.content[0].content[0].text).toBe("edited");
  });

  it("converts `environment` markdown to ADF", () => {
    const result = coerceBody({ fields: { environment: "prod" } }) as {
      fields: { environment: { type: string } };
    };
    expect(result.fields.environment.type).toBe("doc");
  });

  it("leaves a pre-built ADF doc untouched", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    };
    expect(coerceBody({ fields: { description: adf } })).toEqual({
      fields: { description: adf },
    });
  });

  it("does NOT convert non-rich-text string fields like summary", () => {
    expect(coerceBody({ fields: { summary: "Hello **world**" } })).toEqual({
      fields: { summary: "Hello **world**" },
    });
  });

  it("converts after JSON-parsing a stringified body", () => {
    // Path the CLI takes: file contents arrive as a string containing
    // markdown in `description`. JSON parse first, then ADF-convert.
    const stringified = JSON.stringify({
      project: { key: "MON" },
      description: "# Heading",
    });
    const result = coerceBody({ fields: stringified }) as {
      fields: {
        project: { key: string };
        description: { type: string; content: { type: string }[] };
      };
    };
    expect(result.fields.project).toEqual({ key: "MON" });
    expect(result.fields.description.type).toBe("doc");
    expect(result.fields.description.content[0].type).toBe("heading");
  });
});
