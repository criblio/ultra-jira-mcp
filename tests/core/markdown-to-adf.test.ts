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

  // ADF puts `code` in an exclusive mark group — stacking it with a
  // formatting mark makes Jira reject the whole document with an opaque
  // "not valid ADF" error. Bolding inline code is the natural markdown
  // pattern that triggers it, so the converter must drop the formatting
  // mark and keep only `code`.
  it("never stacks code with formatting marks", () => {
    const cases = [
      "**`bolded code`**",
      "*`italic code`*",
      "~~`struck code`~~",
      "**bold then `code` then bold**",
    ];
    for (const md of cases) {
      const doc = markdownToAdf(md);
      const flat: Array<{ type: string; marks?: Array<{ type: string }> }> = [];
      const walk = (n: { content?: unknown[]; type: string; marks?: Array<{ type: string }> }) => {
        if (n.type === "text") flat.push(n);
        (n.content as typeof flat | undefined)?.forEach((c) =>
          walk(c as Parameters<typeof walk>[0]),
        );
      };
      walk(doc as Parameters<typeof walk>[0]);
      const codeNodes = flat.filter((n) =>
        n.marks?.some((m) => m.type === "code"),
      );
      expect(codeNodes.length).toBeGreaterThan(0);
      for (const node of codeNodes) {
        expect(node.marks?.map((m) => m.type)).toEqual(["code"]);
      }
    }
  });

  // `link` is in a non-exclusive group, so a clickable inline-code span
  // (`[`code`](url)`) keeps both marks.
  it("allows code to combine with a link mark", () => {
    const doc = markdownToAdf("[`code`](https://example.com)");
    const inline = (doc.content[0].content ?? []) as Array<{
      text?: string;
      marks?: Array<{ type: string }>;
    }>;
    const node = inline.find((n) => n.text === "code");
    expect(node?.marks?.map((m) => m.type).sort()).toEqual(["code", "link"]);
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

  it("renders an external image URL as an external mediaSingle", () => {
    const doc = markdownToAdf("![cat](https://example.com/cat.png)");
    expect(doc.content[0]).toEqual({
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [
        {
          type: "media",
          attrs: { type: "external", url: "https://example.com/cat.png", alt: "cat" },
        },
      ],
    });
  });

  it("renders an attachment: marker (media UUID) as a file media node", () => {
    const uuid = "732375bc-8db1-47d3-8b2a-babf14273bce";
    const doc = markdownToAdf(`![shot](attachment:${uuid})`);
    expect(doc.content[0]).toEqual({
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [
        {
          type: "media",
          attrs: { type: "file", id: uuid, collection: "", alt: "shot" },
        },
      ],
    });
  });
});
