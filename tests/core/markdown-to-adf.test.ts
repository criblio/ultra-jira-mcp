import { describe, expect, it } from "vitest";
import { markdownToAdf } from "../../src/core/markdown-to-adf.js";

describe("markdownToAdf", () => {
  it("wraps plain text in a paragraph", () => {
    const doc = markdownToAdf("Hello world");
    expect(doc).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    });
  });

  it("preserves bold/italic/code as marks", () => {
    const doc = markdownToAdf("**bold** and *em* and `code`");
    const inline = (doc.content[0].content ?? []) as Array<{
      text?: string;
      marks?: Array<{ type: string }>;
    }>;
    const findMarks = (text: string) =>
      inline.find((n) => n.text === text)?.marks?.map((m) => m.type) ?? [];
    expect(findMarks("bold")).toEqual(["strong"]);
    expect(findMarks("em")).toEqual(["em"]);
    expect(findMarks("code")).toEqual(["code"]);
  });

  it("renders headings with the correct level", () => {
    const doc = markdownToAdf("# H1\n\n## H2");
    expect(doc.content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
    });
    expect(doc.content[1]).toMatchObject({
      type: "heading",
      attrs: { level: 2 },
    });
  });

  it("renders bullet and ordered lists", () => {
    const doc = markdownToAdf("- a\n- b\n\n1. one\n2. two");
    expect(doc.content[0].type).toBe("bulletList");
    expect(doc.content[1].type).toBe("orderedList");
  });

  it("renders fenced code blocks with language attr", () => {
    const doc = markdownToAdf("```ts\nconst x = 1;\n```");
    expect(doc.content[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
  });

  it("renders links with href marks", () => {
    const doc = markdownToAdf("See [docs](https://example.com).");
    const inline = (doc.content[0].content ?? []) as Array<{
      text?: string;
      marks?: Array<{ type: string; attrs?: { href?: string } }>;
    }>;
    const linkNode = inline.find((n) => n.text === "docs");
    expect(linkNode?.marks?.[0]).toMatchObject({
      type: "link",
      attrs: { href: "https://example.com" },
    });
  });

  it("emits an empty paragraph for empty input", () => {
    expect(markdownToAdf("")).toEqual({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [] }],
    });
  });
});
