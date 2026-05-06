// ADF (Atlassian Document Format) → Markdown flattener.
//
// Jira's REST API returns rich-text fields (descriptions, comments,
// worklog comments) as an ADF document tree. The agent reasons over
// text far more effectively than over nested ADF JSON, and markdown is
// both token-cheap and lossless enough for the cases that matter
// (headings, lists, code, links, emphasis, tables).
//
// Unknown node types are handled gracefully: any node we don't
// recognize has its `content` walked and its wrapper dropped. This
// keeps us forward-compatible with new ADF node types without
// crashing.
//
// Scope note: this is a pragmatic one-way flattener (ADF → markdown),
// not a round-trip converter. Panels become blockquotes, media becomes
// a descriptive placeholder, etc. The full ADF tree is still available
// via the sandbox ref for anything needing perfect fidelity.
//
// Input safety:
//   - The ADF tree is always the output of `JSON.parse` on a Jira REST
//     response, so it cannot contain reference cycles (JSON is a tree
//     by grammar). The walker therefore has no cycle detection.
//   - Depth, however, is bounded by `MAX_BLOCK_DEPTH` below. Even though
//     real Jira content never approaches this limit, capping protects
//     against a malicious or malformed ticket body from exhausting the
//     stack.
//   - Link hrefs are filtered through `safeHref()` so that `javascript:`,
//     `data:`, and similar dangerous schemes never make it into the
//     rendered markdown. Downstream consumers may render the markdown
//     in an HTML context we don't control.

const MAX_BLOCK_DEPTH = 32;

// Allowed URL schemes for link marks. Anything else (including no
// scheme at all, which could be a protocol-relative `//evil.example`)
// causes the link to render as plain text — the user still sees the
// link label, just without the href.
const SAFE_LINK_PATTERN = /^(https?:|mailto:|ftp:|\/(?!\/)|#)/i;

function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return SAFE_LINK_PATTERN.test(trimmed) ? trimmed : null;
}

export interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  marks?: AdfMark[];
  attrs?: Record<string, unknown>;
}

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export function adfToMarkdown(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const blocks = renderBlocks((doc as AdfNode).content ?? [], {
    listDepth: 0,
    blockDepth: 0,
  });
  return blocks.join("\n\n").trim();
}

// Convenience alias kept around so callers that only need plain text
// (previews, search snippets) don't have to strip markdown markers
// themselves. Uses the markdown renderer then removes inline markers.
export function adfToPlainText(doc: unknown): string {
  const md = adfToMarkdown(doc);
  return md
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

interface RenderCtx {
  listDepth: number;
  blockDepth: number;
}

function renderBlocks(nodes: AdfNode[], ctx: RenderCtx): string[] {
  if (ctx.blockDepth >= MAX_BLOCK_DEPTH) return [];
  const childCtx: RenderCtx = { ...ctx, blockDepth: ctx.blockDepth + 1 };
  const out: string[] = [];
  for (const node of nodes) {
    const rendered = renderBlock(node, childCtx);
    if (rendered !== null && rendered !== "") out.push(rendered);
  }
  return out;
}

function renderBlock(node: AdfNode, ctx: RenderCtx): string | null {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content ?? []);

    case "heading": {
      const level = clampHeadingLevel(node.attrs?.level);
      return `${"#".repeat(level)} ${renderInline(node.content ?? [])}`;
    }

    case "bulletList":
      return renderList(node.content ?? [], ctx, "bullet");

    case "orderedList":
      return renderList(node.content ?? [], ctx, "ordered");

    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = (node.content ?? [])
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "blockquote": {
      const inner = renderBlocks(node.content ?? [], ctx).join("\n\n");
      return inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }

    case "panel": {
      const kind = typeof node.attrs?.panelType === "string" ? node.attrs.panelType : "info";
      const inner = renderBlocks(node.content ?? [], ctx).join("\n\n");
      const body = inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `> **[${kind.toUpperCase()}]**\n${body}`;
    }

    case "rule":
      return "---";

    case "table":
      return renderTable(node);

    case "mediaGroup":
    case "mediaSingle": {
      const inner = renderBlocks(node.content ?? [], ctx).join("\n");
      return inner || null;
    }

    case "media": {
      const alt =
        typeof node.attrs?.alt === "string"
          ? node.attrs.alt
          : typeof node.attrs?.id === "string"
            ? node.attrs.id
            : "attachment";
      return `[media: ${alt}]`;
    }

    // Unknown type — walk children and return their concatenation so
    // we don't swallow content wrapped in wrappers we don't model.
    default: {
      if (!node.content || node.content.length === 0) return null;
      const inner = renderBlocks(node.content, ctx).join("\n\n");
      return inner || null;
    }
  }
}

function clampHeadingLevel(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  const n = Math.trunc(raw);
  if (n < 1) return 1;
  if (n > 6) return 6;
  return n;
}

function renderList(items: AdfNode[], ctx: RenderCtx, kind: "bullet" | "ordered"): string {
  const indent = "  ".repeat(ctx.listDepth);
  const childCtx: RenderCtx = { ...ctx, listDepth: ctx.listDepth + 1 };
  const lines: string[] = [];
  items.forEach((item, idx) => {
    if (item.type !== "listItem") return;
    const marker = kind === "bullet" ? "-" : `${idx + 1}.`;
    const rendered = renderBlocks(item.content ?? [], childCtx);
    if (rendered.length === 0) {
      lines.push(`${indent}${marker} `);
      return;
    }
    const [first, ...rest] = rendered;
    lines.push(`${indent}${marker} ${first}`);
    for (const extra of rest) {
      const extraIndent = " ".repeat(marker.length + 1);
      const indented = extra
        .split("\n")
        .map((line) => `${indent}${extraIndent}${line}`)
        .join("\n");
      lines.push(indented);
    }
  });
  return lines.join("\n");
}

function renderTable(node: AdfNode): string {
  const rows = (node.content ?? []).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return "";
  const matrix = rows.map((row) =>
    (row.content ?? []).map((cell) => renderCellContent(cell)),
  );
  const colCount = Math.max(...matrix.map((r) => r.length));
  const pad = (row: string[]) => {
    const out = [...row];
    while (out.length < colCount) out.push("");
    return out;
  };
  const [header, ...body] = matrix;
  const lines: string[] = [];
  lines.push(`| ${pad(header ?? []).join(" | ")} |`);
  lines.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);
  for (const r of body) lines.push(`| ${pad(r).join(" | ")} |`);
  return lines.join("\n");
}

function renderCellContent(cell: AdfNode): string {
  if (cell.type !== "tableCell" && cell.type !== "tableHeader") return "";
  const blocks = renderBlocks(cell.content ?? [], {
    listDepth: 0,
    blockDepth: 0,
  });
  // Collapse multi-line cell content to a single line so the table
  // stays valid markdown. Pipes inside cells are escaped.
  return blocks
    .join(" ")
    .replace(/\n+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function renderInline(nodes: AdfNode[]): string {
  return nodes.map(renderInlineNode).join("");
}

function renderInlineNode(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks ?? []);

    case "hardBreak":
      return "  \n";

    case "mention": {
      const name =
        typeof node.attrs?.text === "string"
          ? node.attrs.text
          : typeof node.attrs?.displayName === "string"
            ? node.attrs.displayName
            : typeof node.attrs?.id === "string"
              ? node.attrs.id
              : "user";
      return `@${name}`;
    }

    case "emoji": {
      const shortName =
        typeof node.attrs?.shortName === "string" ? node.attrs.shortName : null;
      const text = typeof node.attrs?.text === "string" ? node.attrs.text : null;
      return text ?? shortName ?? "";
    }

    case "inlineCard":
    case "blockCard": {
      return safeHref(node.attrs?.url) ?? "";
    }

    case "date": {
      const ts = node.attrs?.timestamp;
      if (typeof ts === "string" || typeof ts === "number") {
        const d = new Date(Number(ts));
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
      return "";
    }

    default:
      // Unknown inline node: fall back to any text children.
      if (node.content) return renderInline(node.content);
      return node.text ?? "";
  }
}

function applyMarks(text: string, marks: AdfMark[]): string {
  let out = text;
  let href: string | null = null;
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        out = `**${out}**`;
        break;
      case "em":
        out = `*${out}*`;
        break;
      case "code":
        out = `\`${out}\``;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "link": {
        // Only accept URLs on an allowlist of safe schemes. `javascript:`
        // and `data:` URLs can produce XSS if our markdown is later
        // rendered in a web context.
        const safe = safeHref(mark.attrs?.href);
        if (safe) href = safe;
        break;
      }
      default:
        break;
    }
  }
  if (href) out = `[${out}](${href})`;
  return out;
}
