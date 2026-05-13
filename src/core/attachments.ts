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

import {
  downloadToFile,
  guardSingleConsumption,
  sanitizeFilename,
  type DownloadTransport,
  type SingleConsumptionResponse,
} from "@scottlepper/mcp-toolkit/streaming";

import { jiraSandbox } from "./sandbox.js";

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
