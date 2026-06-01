// Inline local-image embedding for rich-text fields.
//
// When a description or comment contains a markdown image that points at
// a *local file* (`![shot](/abs/path.png)` or a relative path), the
// agent means "embed this image inline in the issue". Jira can't fetch a
// local path, so we:
//
//   1. upload the file to the issue as an attachment (the agent passed a
//      path; the bytes are read here, never in agent context), and
//   2. rewrite the markdown image URL to `attachment:<attachmentId>`,
//      which markdown-to-adf turns into a `file` media node Jira resolves
//      against the issue's attachments.
//
// Images that already point at an http(s)/data URL are left untouched —
// markdown-to-adf renders those as external media, which works as-is.
//
// Scope: this runs only where the issue already exists (issue.update,
// comment.add). On create there's no issue id to attach to yet, so the
// pre-pass is skipped and local images fall through to the existing
// labeled-link behavior in markdown-to-adf.

import * as path from "node:path";

import type { JiraClient } from "../auth/jira-client.js";
import {
  resolveMediaId,
  uploadAttachment,
  type MediaIdTransport,
  type UploadTransport,
} from "./attachments.js";
import { ATTACHMENT_URL_SCHEME } from "./markdown-to-adf.js";

// Matches a markdown image: `![alt](url)` or `![alt](url "title")`.
// The URL capture stops at whitespace or `)` — markdown image URLs with
// spaces must be wrapped in <>, which Jira content effectively never
// does, so this covers the real cases without a full parser.
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(\s+"[^"]*")?\s*\)/g;

// An href is "remote" (leave it for external-media rendering) if it has a
// URL scheme we recognize as fetchable, or is protocol-relative. Anything
// else — absolute paths, relative paths, file:// — is treated as a local
// file to upload. We deliberately treat `attachment:` as remote too so a
// pre-rewritten doc is idempotent.
const REMOTE_SCHEME_RE = /^(https?:|data:|mailto:|ftp:|\/\/|attachment:)/i;

export function isLocalImageHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed.length === 0) return false;
  return !REMOTE_SCHEME_RE.test(trimmed);
}

export interface EmbedImagesOptions {
  issueKey: string;
  client: JiraClient;
  // Test seams: forwarded to uploadAttachment / resolveMediaId so the
  // network round-trips can be exercised offline. Production omits them.
  uploadTransport?: UploadTransport;
  mediaIdTransport?: MediaIdTransport;
}

// Replace local-file image hrefs in `markdown` with `attachment:<id>`
// markers, uploading each referenced file to the issue first. Returns the
// rewritten markdown. The same local path appearing twice is uploaded
// once and reused. Non-image markdown and remote-URL images are
// untouched. Throws if an upload fails — better to surface "couldn't
// attach image X" than to silently post a description with a dangling
// reference.
export async function embedLocalImages(
  markdown: string,
  opts: EmbedImagesOptions,
): Promise<string> {
  // First pass: collect the distinct local paths so we upload each once.
  const localPaths = new Set<string>();
  for (const match of markdown.matchAll(IMAGE_RE)) {
    const href = match[2];
    if (isLocalImageHref(href)) localPaths.add(href.trim());
  }
  if (localPaths.size === 0) return markdown;

  const url = await opts.client.attachmentUploadUrl(opts.issueKey);
  const authorizationHeader = opts.client.getAuthorizationHeader();

  // path → Media Services UUID. Each local image is uploaded, then its
  // media UUID is resolved from the attachment content redirect — the
  // ADF media node needs the UUID, not the REST attachment id. Relative
  // paths resolve against cwd so the upload reads the intended file.
  const idByPath = new Map<string, string>();
  for (const p of localPaths) {
    const resolved = path.resolve(p);
    const uploaded = await uploadAttachment(
      { filePath: resolved },
      { url, authorizationHeader, transport: opts.uploadTransport },
    );
    const contentUrl = uploaded[0]?.content;
    if (!contentUrl) {
      throw new Error(`Upload of image ${p} returned no content URL.`);
    }
    const mediaId = await resolveMediaId(
      contentUrl,
      authorizationHeader,
      opts.mediaIdTransport,
    );
    // If the UUID can't be resolved (unexpected redirect shape), leave
    // this image as a labeled link rather than emitting a media node Jira
    // would reject and fail the whole update.
    if (mediaId) idByPath.set(p, mediaId);
  }

  // Second pass: rewrite resolved images to attachment markers. Preserve
  // the alt text; drop the title (Jira media nodes carry alt, not title).
  return markdown.replace(IMAGE_RE, (whole, alt: string, href: string) => {
    const key = href.trim();
    const id = idByPath.get(key);
    if (!id) return whole; // remote image, or UUID unresolved — leave as-is
    return `![${alt}](${ATTACHMENT_URL_SCHEME}${id})`;
  });
}

// --- Action orchestration ----------------------------------------------

// Tool+action → the arg locations that may hold markdown with embeddable
// local images. Only update/comment are listed: they carry an existing
// issue key to attach to. issue.create is intentionally absent (no key
// yet). Each location is a path into the args object.
//
//   issue.update    → fields.description, fields.environment
//   comment.add     → body
//   comment.update  → body
const EMBED_LOCATIONS: Record<string, string[][]> = {
  "jira_issue:update": [["fields", "description"], ["fields", "environment"]],
  "jira_comment:add": [["body"]],
  "jira_comment:update": [["body"]],
};

function getAtPath(obj: unknown, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setAtPath(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    if (next == null || typeof next !== "object") return; // path absent — nothing to set
    cur = next as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

// If `toolName`/`action` is embed-capable and any of its rich-text
// locations hold a markdown string with local images, upload those images
// to the issue and return a shallow-cloned args object with the markdown
// rewritten to attachment markers. Returns the original args unchanged
// when there's nothing to embed (no allocation in the common case).
//
// `issueKey` is read from `args.issueIdOrKey`; if it's missing or not a
// string the pre-pass is skipped (the dispatcher will reject the call on
// its own).
export async function embedImagesForAction(
  toolName: string,
  action: string,
  args: Record<string, unknown>,
  client: JiraClient,
  transports?: { uploadTransport?: UploadTransport; mediaIdTransport?: MediaIdTransport },
): Promise<Record<string, unknown>> {
  const locations = EMBED_LOCATIONS[`${toolName}:${action}`];
  if (!locations) return args;

  const issueKey = args.issueIdOrKey;
  if (typeof issueKey !== "string" || issueKey.length === 0) return args;

  let result = args;
  let cloned = false;
  for (const loc of locations) {
    const value = getAtPath(result, loc);
    if (typeof value !== "string") continue;
    // Cheap gate before any upload. A non-/g copy avoids touching the
    // shared IMAGE_RE's lastIndex.
    if (!/!\[[^\]]*\]\(/.test(value)) continue;
    const rewritten = await embedLocalImages(value, {
      issueKey,
      client,
      uploadTransport: transports?.uploadTransport,
      mediaIdTransport: transports?.mediaIdTransport,
    });
    if (rewritten === value) continue;
    if (!cloned) {
      // Deep-clone only the touched branches: structuredClone keeps the
      // caller's args untouched (the MCP server reuses the request obj
      // for error reporting).
      result = structuredClone(result);
      cloned = true;
    }
    setAtPath(result, loc, rewritten);
  }
  return result;
}
