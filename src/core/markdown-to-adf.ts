// Markdown → Atlassian Document Format (ADF) converter.
//
// Jira's REST v3 API requires rich-text fields (description, comment
// body, environment, etc.) as ADF documents — a plain string returns
// `Operation value must be an Atlassian Document`. Callers naturally
// reach for markdown, so we accept it and convert here.
//
// Ported from confluence-mcp's converter with the Confluence-specific
// bits (Mermaid extension nodes, .md link rewriting) removed: Jira
// doesn't render the Mermaid app the same way, and intra-doc links
// don't apply.
//
// Supports the standard markdown surface that shows up in tickets:
// headings, bold/italic/strike, inline code, links, ordered/bullet
// lists (including nested), task lists (`- [ ]`), code blocks with
// language, blockquotes, tables, horizontal rules. Anything we don't
// recognize falls back to plain text.
//
// Scope: one-way (markdown → ADF). The reverse direction (ADF →
// markdown for reads) lives in `adf.ts`.
import { randomUUID } from "node:crypto";
import { Marked, type Token, type Tokens } from "marked";
import type { AdfDocument, AdfMark, AdfNode } from "./adf.js";

export function markdownToAdf(markdown: string): AdfDocument {
  const instance = new Marked();
  const tokens = instance.lexer(markdown);
  const content = convertBlockTokens(tokens);

  return {
    type: "doc",
    content:
      content.length > 0 ? content : [{ type: "paragraph", content: [] }],
    version: 1,
  };
}

function convertBlockTokens(tokens: Token[]): AdfNode[] {
  const nodes: AdfNode[] = [];
  for (const token of tokens) {
    const converted = convertBlockToken(token);
    if (converted) nodes.push(...converted);
  }
  return nodes;
}

// Convert a single block-level token into one or more ADF nodes.
// Returns null for tokens that produce no output (whitespace, defs).
function convertBlockToken(token: Token): AdfNode[] | null {
  switch (token.type) {
    case "heading":
      return [convertHeading(token as Tokens.Heading)];
    case "paragraph":
      return convertParagraphNodes(token as Tokens.Paragraph);
    case "code":
      return [convertCodeBlock(token as Tokens.Code)];
    case "list":
      return [convertList(token as Tokens.List)];
    case "blockquote":
      return [convertBlockquote(token as Tokens.Blockquote)];
    case "table":
      return [convertTable(token as Tokens.Table)];
    case "hr":
      return [{ type: "rule" }];
    case "html": {
      const htmlToken = token as Tokens.HTML;
      if (htmlToken.text.trim()) {
        return [
          {
            type: "paragraph",
            content: [{ type: "text", text: htmlToken.text }],
          },
        ];
      }
      return null;
    }
    case "space":
    case "def":
      return null;
    default:
      return null;
  }
}

function convertHeading(token: Tokens.Heading): AdfNode {
  return {
    type: "heading",
    attrs: { level: token.depth },
    content: convertInlineTokens(token.tokens || []),
  };
}

// A paragraph that contains only image tokens becomes a stack of
// mediaSingle nodes (Jira's standard image embed shape). Mixed content
// keeps images as inline links.
function convertParagraphNodes(token: Tokens.Paragraph): AdfNode[] {
  const inlineTokens = token.tokens || [];
  if (isImageOnlyParagraph(inlineTokens)) {
    return inlineTokens
      .filter((t: Token): t is Tokens.Image => t.type === "image")
      .map(convertImageToMediaSingle);
  }
  const content = convertInlineTokens(inlineTokens);
  return [
    {
      type: "paragraph",
      content: content.length > 0 ? content : [],
    },
  ];
}

function isImageOnlyParagraph(tokens: Token[]): boolean {
  const nonSpaceTokens = tokens.filter(
    (t) => !(t.type === "text" && !(t as Tokens.Text).text.trim()),
  );
  return (
    nonSpaceTokens.length > 0 &&
    nonSpaceTokens.every((t) => t.type === "image")
  );
}

function convertImageToMediaSingle(token: Tokens.Image): AdfNode {
  const mediaAttrs: Record<string, unknown> = {
    type: "external",
    url: token.href,
  };
  if (token.text) mediaAttrs.alt = token.text;
  return {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [{ type: "media", attrs: mediaAttrs }],
  };
}

function convertCodeBlock(token: Tokens.Code): AdfNode {
  const node: AdfNode = {
    type: "codeBlock",
    attrs: {},
    content: [{ type: "text", text: token.text }],
  };
  if (token.lang) node.attrs!.language = token.lang;
  return node;
}

function convertList(token: Tokens.List): AdfNode {
  // GitHub task list: every item is a checkbox → render as ADF taskList.
  if (
    !token.ordered &&
    token.items.length > 0 &&
    token.items.every((i) => i.task)
  ) {
    return convertTaskList(token);
  }

  const listType = token.ordered ? "orderedList" : "bulletList";
  const node: AdfNode = {
    type: listType,
    content: token.items.map(convertListItem),
  };

  if (token.ordered && token.start !== "" && token.start !== 1) {
    node.attrs = { order: token.start };
  }
  return node;
}

function convertTaskList(token: Tokens.List): AdfNode {
  return {
    type: "taskList",
    attrs: { localId: randomUUID() },
    content: token.items.map((item) => {
      const itemTokens = (item.tokens || []).filter(
        (t) => t.type !== "checkbox",
      );
      const inlineNodes: AdfNode[] = [];
      for (const t of itemTokens) {
        if (t.type === "text" && (t as Tokens.Text).tokens) {
          inlineNodes.push(
            ...convertInlineTokens((t as Tokens.Text).tokens || []),
          );
        } else {
          inlineNodes.push(...convertInlineTokens([t]));
        }
      }
      return {
        type: "taskItem",
        attrs: {
          localId: randomUUID(),
          state: item.checked ? "DONE" : "TODO",
        },
        content: inlineNodes,
      };
    }),
  };
}

function convertListItem(item: Tokens.ListItem): AdfNode {
  const content: AdfNode[] = [];
  for (const token of item.tokens) {
    if (token.type === "checkbox") continue;
    if (token.type === "text" && (token as Tokens.Text).tokens) {
      const inlineNodes = convertInlineTokens(
        (token as Tokens.Text).tokens || [],
      );
      if (inlineNodes.length > 0) {
        content.push({ type: "paragraph", content: inlineNodes });
      }
    } else if (token.type === "list") {
      content.push(convertList(token as Tokens.List));
    } else if (token.type === "paragraph") {
      content.push(...convertParagraphNodes(token as Tokens.Paragraph));
    } else if (token.type === "space") {
      // skip
    } else {
      const converted = convertBlockToken(token);
      if (converted) content.push(...converted);
    }
  }
  // ADF requires at least one block-level child in listItem.
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [] });
  }
  return { type: "listItem", content };
}

function convertBlockquote(token: Tokens.Blockquote): AdfNode {
  return {
    type: "blockquote",
    content: convertBlockTokens(token.tokens),
  };
}

function convertTable(token: Tokens.Table): AdfNode {
  const rows: AdfNode[] = [];
  if (token.header && token.header.length > 0) {
    rows.push({
      type: "tableRow",
      content: token.header.map((cell: Tokens.TableCell) => ({
        type: "tableHeader",
        attrs: {},
        content: [
          { type: "paragraph", content: convertInlineTokens(cell.tokens) },
        ],
      })),
    });
  }
  for (const row of token.rows) {
    rows.push({
      type: "tableRow",
      content: row.map((cell: Tokens.TableCell) => ({
        type: "tableCell",
        attrs: {},
        content: [
          { type: "paragraph", content: convertInlineTokens(cell.tokens) },
        ],
      })),
    });
  }
  return {
    type: "table",
    attrs: { isNumberColumnEnabled: false, layout: "default" },
    content: rows,
  };
}

// Inline marks (bold/italic/etc.) thread through nested formatting
// tokens. The `marks` array accumulates as we recurse.
function convertInlineTokens(
  tokens: Token[],
  marks: AdfMark[] = [],
): AdfNode[] {
  const nodes: AdfNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        const textNode: AdfNode = { type: "text", text: t.text };
        if (marks.length > 0) textNode.marks = [...marks];
        nodes.push(textNode);
        break;
      }
      case "escape": {
        const e = token as Tokens.Escape;
        const escNode: AdfNode = { type: "text", text: e.text };
        if (marks.length > 0) escNode.marks = [...marks];
        nodes.push(escNode);
        break;
      }
      case "strong": {
        const s = token as Tokens.Strong;
        nodes.push(
          ...convertInlineTokens(s.tokens, [...marks, { type: "strong" }]),
        );
        break;
      }
      case "em": {
        const e = token as Tokens.Em;
        nodes.push(
          ...convertInlineTokens(e.tokens, [...marks, { type: "em" }]),
        );
        break;
      }
      case "del": {
        const d = token as Tokens.Del;
        nodes.push(
          ...convertInlineTokens(d.tokens, [...marks, { type: "strike" }]),
        );
        break;
      }
      case "codespan": {
        const c = token as Tokens.Codespan;
        const codeNode: AdfNode = { type: "text", text: c.text };
        codeNode.marks = [...marks, { type: "code" }];
        nodes.push(codeNode);
        break;
      }
      case "link": {
        const l = token as Tokens.Link;
        const linkMark: AdfMark = { type: "link", attrs: { href: l.href } };
        if (l.title) linkMark.attrs!.title = l.title;
        nodes.push(
          ...convertInlineTokens(l.tokens, [...marks, linkMark]),
        );
        break;
      }
      case "image": {
        // Images mixed with text render as a labeled link.
        const img = token as Tokens.Image;
        nodes.push({
          type: "text",
          text: img.text || img.href,
          marks: [...marks, { type: "link", attrs: { href: img.href } }],
        });
        break;
      }
      case "br":
        nodes.push({ type: "hardBreak" });
        break;
      default: {
        if (
          "text" in token &&
          typeof (token as Record<string, unknown>).text === "string"
        ) {
          const fallbackNode: AdfNode = {
            type: "text",
            text: (token as Record<string, unknown>).text as string,
          };
          if (marks.length > 0) fallbackNode.marks = [...marks];
          nodes.push(fallbackNode);
        }
        break;
      }
    }
  }
  return nodes;
}
