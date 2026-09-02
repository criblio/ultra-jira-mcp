// Streaming attachment downloader.
//
// Jira returns attachment metadata with a `content` URL the agent can
// neither download (needs auth) nor render (binary / possibly large).
// v1 handed that URL back verbatim, which meant agents couldn't
// actually use attachments.
//
// v2 downloads to the session cache dir and returns a local path the
// agent can feed into Claude Code's `Read` tool. The toolkit's
// `client/streaming` owns the generic primitives (filename
// sanitization, single-consumption guard, atomic temp+rename, sha256);
// this module adds the Jira-specific bits on top:
//
//   - issue-key validation (PROJECT-123 form) before the key becomes a
//     path segment;
//   - layout under `${sessionCacheDir}/issues/<key>/attachments/`;
//   - idempotency: skip the network when the target file already
//     exists with the expected size;
//   - size verification against Jira's advertised content length;
//   - text-mime preview extraction.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import { request as undiciRequest } from "undici";

import {
  downloadToFile,
  guardSingleConsumption,
  sanitizeFilename,
  type DownloadTransport,
  type SingleConsumptionResponse,
} from "@scottlepper/mcp-toolkit/streaming";

import { jiraSandbox } from "./sandbox.js";
import type { JiraAttachment } from "../types/jira.js";

// Type aliases preserve the v2-era names used by tests and any external
// consumers. The toolkit's generic primitives back them.
export type AttachmentTransport = DownloadTransport;
export type AttachmentHttpResponse = SingleConsumptionResponse;

export { guardSingleConsumption, sanitizeFilename };

export interface AttachmentInput {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentUrl: string;
}

export interface AttachmentDownloadOptions {
  issueKey: string;
  authorizationHeader: string;
  transport?: AttachmentTransport;
  previewChars?: number;
}

export interface AttachmentRef {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  // Populated only for text-like mimes; null for binaries.
  preview: string | null;
}

const DEFAULT_PREVIEW_CHARS = 2000;

// --- Issue-key validation ----------------------------------------------

// Jira issue keys are `PROJECT-123` — uppercase project key (letters,
// digits, underscore; must start with a letter) + hyphen + numeric id.
// Anything else is rejected rather than being used as a path segment,
// since path.join() happily resolves `..` and would escape the session
// cache dir.
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-[0-9]+$/;

export function assertValidIssueKey(key: string): void {
  if (!ISSUE_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid Jira issue key: ${JSON.stringify(key)}`);
  }
}

function attachmentDir(issueKey: string): string {
  assertValidIssueKey(issueKey);
  return path.join(
    jiraSandbox.sessionCacheDir(),
    "issues",
    issueKey,
    "attachments",
  );
}

// --- Preview extraction ------------------------------------------------

const TEXT_MIME_PATTERN =
  /^(text\/|application\/(json|xml|x-yaml|yaml|javascript))/i;

async function extractPreview(
  filePath: string,
  mimeType: string,
  maxChars: number,
): Promise<string | null> {
  if (!TEXT_MIME_PATTERN.test(mimeType)) return null;
  // Only read the prefix of the file rather than buffering the whole
  // thing — a multi-MB log/JSON attachment would otherwise allocate
  // (buffer + UTF-8 string) proportional to its size even though we
  // only return maxChars of it. Worst-case UTF-8 is 4 bytes per char,
  // plus one extra codepoint of slack to detect truncation.
  const readBytes = maxChars * 4 + 4;
  let fh;
  try {
    fh = await fs.open(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.allocUnsafe(readBytes);
    const { bytesRead } = await fh.read(buf, 0, readBytes, 0);
    const slice = buf.subarray(0, bytesRead);
    const truncatedRead = bytesRead === readBytes;
    const text = slice.toString("utf8");
    if (!truncatedRead && text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…`;
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => undefined);
  }
}

async function statOrNull(p: string): Promise<{ size: number } | null> {
  try {
    const s = await fs.stat(p);
    return { size: s.size };
  } catch {
    return null;
  }
}

// --- Main entry point --------------------------------------------------

export async function downloadAttachment(
  input: AttachmentInput,
  opts: AttachmentDownloadOptions,
): Promise<AttachmentRef> {
  const previewChars = opts.previewChars ?? DEFAULT_PREVIEW_CHARS;
  const filename = sanitizeFilename(input.filename);
  const targetDir = attachmentDir(opts.issueKey);
  const targetPath = path.join(targetDir, filename);

  // Idempotency: if the file exists at the expected size, reuse it.
  // Content-addressing isn't possible here because Jira's stable
  // identifier is the attachment id, not the bytes.
  const existing = await statOrNull(targetPath);
  if (existing && existing.size === input.size) {
    return {
      id: input.id,
      filename,
      mimeType: input.mimeType,
      size: input.size,
      path: targetPath,
      preview: await extractPreview(targetPath, input.mimeType, previewChars),
    };
  }

  // Stream via the toolkit. Pass the already-sanitized filename so the
  // toolkit's identical sanitization is a no-op and we control which
  // fallback name applies for empty/separator-only inputs.
  let ref;
  try {
    ref = await downloadToFile({
      url: input.contentUrl,
      headers: {
        Authorization: opts.authorizationHeader,
        Accept: "*/*",
      },
      targetDir,
      filename,
      transport: opts.transport,
    });
  } catch (err) {
    // Rewrite the toolkit's generic "Download failed for <url>" into
    // the v2 message shape so any error monitors keep matching. The
    // toolkit's message already includes the HTTP code and body
    // prefix — we just want the attachment id + filename out front.
    const msg = err instanceof Error ? err.message : String(err);
    const httpMatch = /HTTP (\d+) ([\s\S]*)$/.exec(msg);
    if (httpMatch) {
      throw new Error(
        `Failed to download attachment ${input.id} (${filename}): HTTP ${httpMatch[1]} ${httpMatch[2]}`,
      );
    }
    throw err;
  }

  // Size check: a mismatch suggests truncation or a bad proxy — fail
  // loudly rather than serve corrupt data.
  if (ref.size !== input.size) {
    await fs.rm(ref.absolutePath, { force: true });
    throw new Error(
      `Downloaded attachment ${input.id} (${filename}) size mismatch: expected ${input.size}, got ${ref.size}`,
    );
  }

  return {
    id: input.id,
    filename,
    mimeType: input.mimeType,
    size: input.size,
    path: ref.absolutePath,
    preview: await extractPreview(ref.absolutePath, input.mimeType, previewChars),
  };
}

// --- Upload ------------------------------------------------------------
//
// The inverse of downloadAttachment: read a file off disk and POST it
// to Jira as a multipart attachment. Like the download path, this is a
// side-channel that bypasses the JSON request pipeline in
// jira-client.ts — Jira's attachment endpoint wants
// `multipart/form-data` + the `X-Atlassian-Token: no-check` header,
// neither of which the JSON `post()` helper can produce. The agent
// never sees the file bytes; it passes a path, we read it here.

// Minimal extension → MIME map. We only need enough fidelity for Jira
// to render the attachment correctly — images especially, since those
// are what get embedded inline. Everything unrecognized falls back to
// application/octet-stream, which Jira accepts (it just won't get an
// inline preview). No `mime-types` dep for one lookup.
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".log": "text/plain",
  ".html": "text/html",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
};

export function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

// Injectable transport so tests can assert on the request without a
// network round-trip. Defaults to undici (a direct dep) rather than the
// toolkit's `httpRequest`, whose `body` is typed `string` and so can't
// carry the multipart Buffer.
export interface UploadResponse {
  statusCode: number;
  bodyText: () => Promise<string>;
}

export type UploadTransport = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: Buffer;
  },
) => Promise<UploadResponse>;

const defaultUploadTransport: UploadTransport = async (url, init) => {
  const res = await undiciRequest(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  return {
    statusCode: res.statusCode,
    bodyText: () => res.body.text(),
  };
};

export interface AttachmentUploadInput {
  // Absolute or relative path on disk to the file to upload.
  filePath: string;
  // Override the filename Jira records. Defaults to the basename of
  // filePath.
  filename?: string;
}

export interface AttachmentUploadOptions {
  // Fully-resolved attachment-upload URL for the target issue
  // (from `JiraClient.attachmentUploadUrl(issueKey)`).
  url: string;
  authorizationHeader: string;
  transport?: UploadTransport;
}

// Build a single-part multipart/form-data body. The field name MUST be
// `file` — Jira's attachment endpoint rejects any other field name.
function buildMultipart(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
): { body: Buffer; contentType: string } {
  const boundary = `----jiraMcpBoundary${randomBytes(16).toString("hex")}`;
  // Quote-escape the filename per RFC 2388 so a name with a quote or
  // CRLF can't break out of the header (sanitizeFilename already strips
  // path separators, but defense in depth on the wire format).
  const safeName = filename.replace(/["\r\n]/g, "_");
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    "utf8",
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([header, fileBuffer, footer]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// Upload one file. Returns the parsed Jira response — an array of the
// created attachment objects (Jira returns an array even for a single
// file). Throws JiraApiError-shaped messages on non-2xx so callers
// surface the HTTP code + body the same way the rest of the client does.
export async function uploadAttachment(
  input: AttachmentUploadInput,
  opts: AttachmentUploadOptions,
): Promise<JiraAttachment[]> {
  const transport = opts.transport ?? defaultUploadTransport;
  const filename = sanitizeFilename(input.filename ?? path.basename(input.filePath));
  const mimeType = guessMimeType(filename);

  const fileBuffer = await fs.readFile(input.filePath);
  const { body, contentType } = buildMultipart(fileBuffer, filename, mimeType);

  const res = await transport(opts.url, {
    method: "POST",
    headers: {
      Authorization: opts.authorizationHeader,
      Accept: "application/json",
      // Required by Jira to defeat XSRF checks on the attachment
      // endpoint — without it the upload is rejected with a 403.
      "X-Atlassian-Token": "no-check",
      "Content-Type": contentType,
    },
    body,
  });

  const text = await res.bodyText();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(
      `Failed to upload attachment ${filename}: HTTP ${res.statusCode} ${text}`,
    );
  }

  try {
    return JSON.parse(text) as JiraAttachment[];
  } catch {
    throw new Error(
      `Upload of ${filename} returned non-JSON response: ${text.slice(0, 200)}`,
    );
  }
}

// --- Media id resolution -----------------------------------------------
//
// Embedding an uploaded attachment inline needs the Media Services UUID,
// NOT the REST attachment id (`164576`) the upload returns. Jira doesn't
// expose the UUID via any documented field — but `GET
// /attachment/content/{id}` answers with a 30x redirect whose Location is
// the media-services binary URL, and the UUID sits between `/file/` and
// `/binary`. We follow that one hop (without consuming the redirect) and
// parse it out. This is the standard workaround the Atlassian developer
// community settled on; see docs/MIGRATION.md.

// `https://api.media.atlassian.com/file/<uuid>/binary?...`
const MEDIA_FILE_URL_RE = /\/file\/([0-9a-f-]{36})\/binary/i;

export interface MediaIdTransport {
  (url: string, init: { method: "GET"; headers: Record<string, string> }): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    discard: () => Promise<void>;
  }>;
}

const defaultMediaIdTransport: MediaIdTransport = async (url, init) => {
  // undici's request() does not follow redirects by default, so it hands
  // us the 30x with its Location header intact — exactly what we want
  // (the binary download would be a wasted transfer, and the redirect
  // target is what carries the UUID).
  const res = await undiciRequest(url, {
    method: init.method,
    headers: init.headers,
  });
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    // Drain the body so undici can return the socket to the pool.
    discard: async () => {
      await res.body.text().catch(() => undefined);
    },
  };
};

// Resolve the Media Services UUID for an uploaded attachment given its
// `content` URL (the field on the upload response). Returns null if the
// redirect doesn't carry a parseable UUID — callers decide whether to
// fall back. Never throws on a missing id; only a transport failure
// propagates.
export async function resolveMediaId(
  contentUrl: string,
  authorizationHeader: string,
  transport: MediaIdTransport = defaultMediaIdTransport,
): Promise<string | null> {
  const res = await transport(contentUrl, {
    method: "GET",
    headers: { Authorization: authorizationHeader, Accept: "*/*" },
  });
  await res.discard();
  const loc = res.headers["location"];
  const location = Array.isArray(loc) ? loc[0] : loc;
  if (!location) return null;
  const match = MEDIA_FILE_URL_RE.exec(location);
  return match ? match[1] : null;
}
