import { describe, expect, it } from "vitest";

import { adfToMarkdown, adfToPlainText } from "../../src/core/adf.js";

// Small helpers to make ADF fixtures less verbose.
const doc = (...content: any[]) => ({ type: "doc", version: 1, content });
const p = (...content: any[]) => ({ type: "paragraph", content });
const t = (text: string, marks: any[] = []) => ({ type: "text", text, marks });
const h = (level: number, ...content: any[]) => ({
  type: "heading",
  attrs: { level },
  content,
});

describe("adfToMarkdown — edge cases", () => {
  it("returns '' for null / undefined / non-objects", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
    expect(adfToMarkdown("string")).toBe("");
    expect(adfToMarkdown(42)).toBe("");
  });

  it("returns '' for empty document", () => {
    expect(adfToMarkdown(doc())).toBe("");
  });
});

describe("adfToMarkdown — paragraphs and headings", () => {
  it("renders paragraphs separated by blank lines", () => {
    const d = doc(p(t("First.")), p(t("Second.")));
    expect(adfToMarkdown(d)).toBe("First.\n\nSecond.");
  });

  it("renders headings with correct #-count, clamped to 1..6", () => {
    expect(adfToMarkdown(doc(h(1, t("One"))))).toBe("# One");
    expect(adfToMarkdown(doc(h(3, t("Three"))))).toBe("### Three");
    expect(adfToMarkdown(doc(h(7, t("Over"))))).toBe("###### Over");
    expect(adfToMarkdown(doc(h(0, t("Zero"))))).toBe("# Zero");
  });
});

describe("adfToMarkdown — marks", () => {
  it("renders strong, em, code, strike", () => {
    const d = doc(
      p(
        t("bold", [{ type: "strong" }]),
        t(" "),
        t("italic", [{ type: "em" }]),
        t(" "),
        t("code", [{ type: "code" }]),
        t(" "),
        t("strike", [{ type: "strike" }]),
      ),
    );
    expect(adfToMarkdown(d)).toBe("**bold** *italic* `code` ~~strike~~");
  });

  it("renders links around the full text run", () => {
    const d = doc(
      p(
        t("See "),
        t("docs", [{ type: "link", attrs: { href: "https://example.com" } }]),
        t(" for more."),
      ),
    );
    expect(adfToMarkdown(d)).toBe("See [docs](https://example.com) for more.");
  });

  it("combines link + strong so the link wraps the emphasized text", () => {
    const d = doc(
      p(
        t("click", [
          { type: "strong" },
          { type: "link", attrs: { href: "https://x.dev" } },
        ]),
      ),
    );
    expect(adfToMarkdown(d)).toBe("[**click**](https://x.dev)");
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["javascript with caps", "JavaScript:alert(1)"],
    ["data url", "data:text/html,<script>"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["file", "file:///etc/passwd"],
    ["protocol-relative", "//evil.example/phish"],
    ["leading whitespace before js", "   javascript:alert(1)"],
  ])("drops link mark with unsafe href (%s) but keeps the label", (_label, href) => {
    const d = doc(p(t("click me", [{ type: "link", attrs: { href } }])));
    expect(adfToMarkdown(d)).toBe("click me");
  });

  it.each([
    "https://example.com",
    "http://example.com",
    "mailto:alice@example.com",
    "ftp://files.example.com",
    "/relative/path",
    "#anchor",
  ])("accepts safe href: %s", (href) => {
    const d = doc(p(t("click", [{ type: "link", attrs: { href } }])));
    expect(adfToMarkdown(d)).toBe(`[click](${href})`);
  });

  it("drops unsafe inlineCard URLs", () => {
    const d = doc(
      p({ type: "inlineCard", attrs: { url: "javascript:alert(1)" } }),
    );
    expect(adfToMarkdown(d)).toBe("");
  });
});

describe("adfToMarkdown — lists", () => {
  it("renders bullet lists", () => {
    const d = doc({
      type: "bulletList",
      content: [
        { type: "listItem", content: [p(t("Apple"))] },
        { type: "listItem", content: [p(t("Banana"))] },
      ],
    });
    expect(adfToMarkdown(d)).toBe("- Apple\n- Banana");
  });

  it("renders ordered lists with 1. 2. 3.", () => {
    const d = doc({
      type: "orderedList",
      content: [
        { type: "listItem", content: [p(t("first"))] },
        { type: "listItem", content: [p(t("second"))] },
      ],
    });
    expect(adfToMarkdown(d)).toBe("1. first\n2. second");
  });

  it("indents nested lists by two spaces per depth", () => {
    const d = doc({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            p(t("outer")),
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [p(t("inner"))] },
              ],
            },
          ],
        },
      ],
    });
    expect(adfToMarkdown(d)).toBe("- outer\n    - inner");
  });
});

describe("adfToMarkdown — code blocks", () => {
  it("wraps code in a fenced block with the language", () => {
    const d = doc({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
    expect(adfToMarkdown(d)).toBe("```ts\nconst x = 1;\n```");
  });

  it("omits the language when absent", () => {
    const d = doc({
      type: "codeBlock",
      content: [{ type: "text", text: "plain" }],
    });
    expect(adfToMarkdown(d)).toBe("```\nplain\n```");
  });
});

describe("adfToMarkdown — blockquote, panel, rule", () => {
  it("prefixes blockquote lines with '> '", () => {
    const d = doc({
      type: "blockquote",
      content: [p(t("quoted text")), p(t("second line"))],
    });
    expect(adfToMarkdown(d)).toBe("> quoted text\n> \n> second line");
  });

  it("renders panel as blockquote with a type header", () => {
    const d = doc({
      type: "panel",
      attrs: { panelType: "warning" },
      content: [p(t("careful!"))],
    });
    expect(adfToMarkdown(d)).toBe("> **[WARNING]**\n> careful!");
  });

  it("renders rule as ---", () => {
    const d = doc({ type: "rule" });
    expect(adfToMarkdown(d)).toBe("---");
  });
});

describe("adfToMarkdown — table", () => {
  it("renders a table with header and body rows", () => {
    const cell = (...content: any[]) => ({
      type: "tableCell",
      content,
    });
    const header = (...content: any[]) => ({
      type: "tableHeader",
      content,
    });
    const d = doc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [header(p(t("Name"))), header(p(t("Value")))],
        },
        {
          type: "tableRow",
          content: [cell(p(t("a"))), cell(p(t("1")))],
        },
      ],
    });
    expect(adfToMarkdown(d)).toBe(
      "| Name | Value |\n| --- | --- |\n| a | 1 |",
    );
  });

  it("escapes pipes in cell content", () => {
    const d = doc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableHeader", content: [p(t("a|b"))] }],
        },
      ],
    });
    expect(adfToMarkdown(d)).toContain("a\\|b");
  });
});

describe("adfToMarkdown — inline nodes", () => {
  it("renders mention with @name", () => {
    const d = doc(
      p(t("cc "), { type: "mention", attrs: { text: "alice" } }),
    );
    expect(adfToMarkdown(d)).toBe("cc @alice");
  });

  it("renders emoji via text then shortName", () => {
    const d = doc(
      p({ type: "emoji", attrs: { shortName: ":thumbs_up:", text: "👍" } }),
    );
    expect(adfToMarkdown(d)).toBe("👍");
  });

  it("falls back to shortName when text is missing", () => {
    const d = doc(p({ type: "emoji", attrs: { shortName: ":rocket:" } }));
    expect(adfToMarkdown(d)).toBe(":rocket:");
  });

  it("renders inlineCard as its url", () => {
    const d = doc(
      p({ type: "inlineCard", attrs: { url: "https://linked.example" } }),
    );
    expect(adfToMarkdown(d)).toBe("https://linked.example");
  });

  it("renders hardBreak as markdown's '  \\n'", () => {
    const d = doc(p(t("line1"), { type: "hardBreak" }, t("line2")));
    expect(adfToMarkdown(d)).toBe("line1  \nline2");
  });

  it("renders date as YYYY-MM-DD", () => {
    const ts = Date.UTC(2026, 0, 15); // 2026-01-15
    const d = doc(p({ type: "date", attrs: { timestamp: String(ts) } }));
    expect(adfToMarkdown(d)).toBe("2026-01-15");
  });
});

describe("adfToMarkdown — media and unknown nodes", () => {
  it("renders media with alt text when present", () => {
    const d = doc({
      type: "mediaSingle",
      content: [{ type: "media", attrs: { alt: "screenshot.png" } }],
    });
    expect(adfToMarkdown(d)).toBe("[media: screenshot.png]");
  });

  it("falls back to id when alt is absent", () => {
    const d = doc({
      type: "mediaSingle",
      content: [{ type: "media", attrs: { id: "attach-42" } }],
    });
    expect(adfToMarkdown(d)).toBe("[media: attach-42]");
  });

  it("walks into unknown wrapper nodes rather than dropping content", () => {
    const d = doc({
      type: "some-new-block-type",
      content: [p(t("hello"))],
    });
    expect(adfToMarkdown(d)).toBe("hello");
  });
});

describe("adfToPlainText", () => {
  it("strips markdown inline markers", () => {
    const d = doc(
      p(
        t("bold", [{ type: "strong" }]),
        t(" and "),
        t("code", [{ type: "code" }]),
        t(" and "),
        t("link", [{ type: "link", attrs: { href: "https://x" } }]),
      ),
    );
    expect(adfToPlainText(d)).toBe("bold and code and link");
  });

  it("leaves block structure (newlines) intact", () => {
    const d = doc(p(t("one")), p(t("two")));
    expect(adfToPlainText(d)).toBe("one\n\ntwo");
  });
});

describe("adfToMarkdown — recursion safety", () => {
  // Build a tree nested `depth` levels deep. Each level is an unknown
  // block type wrapping one paragraph of leaf text plus the next level.
  const nest = (depth: number): any => {
    if (depth === 0) return p(t("leaf"));
    return { type: "unknown-wrapper", content: [p(t(`L${depth}`)), nest(depth - 1)] };
  };

  it("handles a reasonably deep tree (10 levels) without issue", () => {
    const d = doc(nest(10));
    const md = adfToMarkdown(d);
    expect(md).toContain("L10");
    expect(md).toContain("leaf");
  });

  it("caps recursion at MAX_BLOCK_DEPTH and does not throw on a 2000-deep pathological tree", () => {
    const d = doc(nest(2000));
    expect(() => adfToMarkdown(d)).not.toThrow();
    const md = adfToMarkdown(d);
    // Top-level labels are rendered; deep labels are truncated away by
    // the depth cap. Exactly which ones survive depends on the cap
    // value, but the shallow ones must be present and the deepest must
    // not be.
    expect(md).toContain("L2000");
    expect(md).not.toContain("L1500");
  });
});
