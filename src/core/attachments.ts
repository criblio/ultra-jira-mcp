// Streaming attachment downloader.
//
// Jira returns attachment metadata with a `content` URL the agent can
// neither download (needs auth) nor render (binary / possibly large).
// v1 handed that URL back verbatim, which meant agents couldn't
// actually use attachments.
//
// v2 downloads attachments to the session cache dir and returns a
// local path, which the agent can feed into Claude Code's `Read` tool
// (for images, the LLM only pays vision tokens for files it actually
// opens; text files are cheap and useful as quoting material).
//
// Streaming: we use undici's `body` as a Node readable stream and
// pipe it directly to disk, so a 50 MB attachment never hits Node's
// heap.
//
// Idempotency: if the target path already exists and has the right
// size, we skip the network entirely. Content-addressing isn't
// possible here because the attachment's stable identifier is its
// Jira ID, not its bytes.

import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { request as undiciRequest } from "undici";

import { sessionCacheDir } from "./sandbox.js";

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
  // Overridable for tests. The default transport uses undici.
  transport?: AttachmentTransport;
  // Cap preview length (characters) for text/json mimes.
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

// The subset of the HTTP transport we need: a streamable response.
export interface AttachmentHttpResponse {
  statusCode: number;
  // A Node Readable stream of the body.
  body: Readable;
  // Read the body to text (called on error to surface server message).
  bodyText: () => Promise<string>;
}

export type AttachmentTransport = (
  url: string,
  init: { method: "GET"; headers: Record<string, string> },
) => Promise<AttachmentHttpResponse>;

const DEFAULT_PREVIEW_CHARS = 2000;

// --- Filename sanitization --------------------------------------------

// The filename is used as a path segment, so we must strip anything
// that could break out of the intended directory. Jira itself allows
// a wide range of characters, but an attachment named `../../.ssh/id`
// must not escape our session cache.
const UNSAFE_CHARS = /[/\\\x00]/g;
const LEADING_DOTS = /^\.+/;

export function sanitizeFilename(name: string): string {
  // Drop any path components the upload might smuggle in.
  let base = name.split(/[/\\]/).pop() ?? "";
  base = base.replace(UNSAFE_CHARS, "_");
  base = base.replace(LEADING_DOTS, "");
  // Collapse runs of whitespace to one space; trim.
  base = base.replace(/\s+/g, " ").trim();
  // Cap length to keep FS happy (ext4 is 255 bytes; APFS 255 UTF-8
  // bytes; NTFS 255 chars). 200 leaves headroom.
  if (base.length > 200) {
    const dot = base.lastIndexOf(".");
    if (dot > 0 && base.length - dot <= 16) {
      const ext = base.slice(dot);
      base = `${base.slice(0, 200 - ext.length)}${ext}`;
    } else {
      base = base.slice(0, 200);
    }
  }
  if (base.length === 0) base = "attachment";
  return base;
}

// --- Directory layout --------------------------------------------------

function attachmentDir(issueKey: string): string {
  return path.join(sessionCacheDir(), "issues", issueKey, "attachments");
}

// --- Default transport -------------------------------------------------

const defaultTransport: AttachmentTransport = async (url, init) => {
  const res = await undiciRequest(url, {
    method: init.method,
    headers: init.headers,
  });
  return {
    statusCode: res.statusCode,
    // undici's body is already a Node Readable when the response is
    // consumed as a stream.
    body: Readable.from(res.body),
    bodyText: () => res.body.text(),
  };
};

// --- Preview extraction ------------------------------------------------

const TEXT_MIME_PATTERN = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript))/i;

async function extractPreview(
  filePath: string,
  mimeType: string,
  maxChars: number,
): Promise<string | null> {
  if (!TEXT_MIME_PATTERN.test(mimeType)) return null;
  try {
    const buf = await fs.readFile(filePath);
    const text = buf.toString("utf8");
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…`;
  } catch {
    return null;
  }
}

// --- Main entry point --------------------------------------------------

export async function downloadAttachment(
  input: AttachmentInput,
  opts: AttachmentDownloadOptions,
): Promise<AttachmentRef> {
  const transport = opts.transport ?? defaultTransport;
  const previewChars = opts.previewChars ?? DEFAULT_PREVIEW_CHARS;

  const filename = sanitizeFilename(input.filename);
  const targetDir = attachmentDir(opts.issueKey);
  const targetPath = path.join(targetDir, filename);

  // Idempotency: if the file exists at the expected size, reuse it.
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

  await fs.mkdir(targetDir, { recursive: true });

  const res = await transport(input.contentUrl, {
    method: "GET",
    headers: {
      Authorization: opts.authorizationHeader,
      Accept: "*/*",
    },
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const errText = await res.bodyText().catch(() => "");
    throw new Error(
      `Failed to download attachment ${input.id} (${filename}): HTTP ${res.statusCode} ${errText.slice(0, 200)}`,
    );
  }

  // Stream to disk. Writing to a temp file and renaming keeps the
  // idempotency check honest: a partial file from an interrupted
  // download won't pass the size check on the next call.
  const tempPath = `${targetPath}.${process.pid}.partial`;
  try {
    await pipeline(res.body, createWriteStream(tempPath));
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    await fs.rm(tempPath, { force: true });
    throw err;
  }

  // Verify the size matches what Jira advertised. A mismatch suggests
  // truncation or a bad proxy — better to fail loudly than to serve
  // corrupt data.
  const stat = await fs.stat(targetPath);
  if (stat.size !== input.size) {
    await fs.rm(targetPath, { force: true });
    throw new Error(
      `Downloaded attachment ${input.id} (${filename}) size mismatch: expected ${input.size}, got ${stat.size}`,
    );
  }

  return {
    id: input.id,
    filename,
    mimeType: input.mimeType,
    size: input.size,
    path: targetPath,
    preview: await extractPreview(targetPath, input.mimeType, previewChars),
  };
}

async function statOrNull(p: string): Promise<{ size: number } | null> {
  try {
    const s = await fs.stat(p);
    return { size: s.size };
  } catch {
    return null;
  }
}
