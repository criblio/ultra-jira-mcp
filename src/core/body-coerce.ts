// Body-shape coercion for outgoing Jira requests.
//
// Two transformations happen here, both applied just before the HTTP
// call leaves jira-mcp:
//
// 1. JSON parsing of stringified body values. The `jira-cli` parser
//    resolves `--fields=@/path/payload.json` to the file *contents as
//    a string*, not a parsed object. Without coercion, the wire body
//    becomes `{"fields": "<json-string>"}` and Jira returns the
//    misleading `Invalid request payload`. If a string value looks like
//    JSON (starts with `{` or `[`) and parses, we use the parsed value.
//    Parse failures leave the original string untouched — some body
//    params legitimately accept strings.
//
// 2. Markdown → ADF conversion for rich-text field names. Jira v3's
//    REST API rejects plain strings for `description`, comment `body`,
//    and `environment` fields. Callers pass markdown; we convert.
//    Already-ADF objects (any object with `type: "doc"`) pass through
//    untouched.
//
// Coercion recurses into nested plain objects (e.g. `fields.description`
// inside `body.fields`). Arrays are walked element-wise.

import type { AdfDocument } from "./adf.js";
import { markdownToAdf } from "./markdown-to-adf.js";

// Field names that Jira v3 expects as ADF documents. Match is exact
// and case-sensitive — these are the Jira REST API field names.
const RICH_TEXT_FIELDS = new Set([
  "description",
  "environment",
  "body", // comment.body, worklog.comment.body (also a body-role param name; see note in coerce())
  "comment", // issue.create's "comment" object's body
]);

function isLikelyJson(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed[0];
  return first === "{" || first === "[";
}

function tryJsonParse(value: string): unknown {
  if (!isLikelyJson(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Walk an arbitrary value, applying both transformations. The `key` is
// the property name under which this value sits in its parent object,
// or null for the top-level body. The key drives the rich-text check.
function coerceValue(key: string | null, value: unknown): unknown {
  // Strings: try JSON-parse first, then rich-text → ADF.
  if (typeof value === "string") {
    const parsed = tryJsonParse(value);
    if (parsed !== value) {
      // Successfully parsed JSON → continue coercing the parsed value.
      return coerceValue(key, parsed);
    }
    if (key !== null && RICH_TEXT_FIELDS.has(key)) {
      return markdownToAdf(value);
    }
    return value;
  }

  // Already an ADF document (or anything declaring itself as a doc) —
  // pass through untouched.
  if (isAdfDoc(value)) return value;

  // Arrays: coerce each element with the same key context (e.g. an
  // array of comment bodies).
  if (Array.isArray(value)) {
    return value.map((item) => coerceValue(key, item));
  }

  // Plain objects: recurse, threading the property name as the key.
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = coerceValue(k, v);
    }
    return out;
  }

  return value;
}

function isAdfDoc(value: unknown): value is AdfDocument {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "doc"
  );
}

// Coerce the full request body. Returns undefined for undefined input
// so callers that pass a body-less ctx don't get a synthetic `{}`.
export function coerceBody(body: unknown): unknown {
  if (body === undefined) return undefined;
  return coerceValue(null, body);
}
