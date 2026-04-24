import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  downloadAttachment,
  sanitizeFilename,
  type AttachmentHttpResponse,
  type AttachmentInput,
  type AttachmentTransport,
} from "../../src/core/attachments.js";
import {
  __resetSessionCacheDirForTests,
  rootCacheDir,
  sessionCacheDir,
} from "../../src/core/sandbox.js";

const originalSessionId = process.env.MCP_SESSION_ID;

async function rmSessionDir(): Promise<void> {
  await fs.rm(sessionCacheDir(), { recursive: true, force: true });
}

beforeEach(async () => {
  process.env.MCP_SESSION_ID = `attach-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  __resetSessionCacheDirForTests();
  await rmSessionDir();
});

afterEach(async () => {
  await rmSessionDir();
  if (originalSessionId === undefined) delete process.env.MCP_SESSION_ID;
  else process.env.MCP_SESSION_ID = originalSessionId;
  __resetSessionCacheDirForTests();
});

// --- Helpers -----------------------------------------------------------

function ok(body: string | Buffer): AttachmentHttpResponse {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    statusCode: 200,
    body: Readable.from([buf]),
    bodyText: () => Promise.resolve(buf.toString("utf8")),
  };
}

function err(status: number, message: string): AttachmentHttpResponse {
  return {
    statusCode: status,
    body: Readable.from([Buffer.alloc(0)]),
    bodyText: () => Promise.resolve(message),
  };
}

function makeInput(overrides: Partial<AttachmentInput> = {}): AttachmentInput {
  return {
    id: "10001",
    filename: "notes.txt",
    mimeType: "text/plain",
    size: 5,
    contentUrl: "https://jira.example/attachments/10001",
    ...overrides,
  };
}

// --- sanitizeFilename --------------------------------------------------

describe("sanitizeFilename", () => {
  it.each([
    // Path components are stripped — we only keep the basename.
    ["../../../etc/passwd", "passwd"],
    ["..\\..\\windows", "windows"],
    ["foo/bar.txt", "bar.txt"],
    ["foo\\bar.txt", "bar.txt"],
    // Whitespace is collapsed and trimmed.
    ["  spaced name .txt  ", "spaced name .txt"],
    // Leading dots are removed so nothing becomes a dotfile.
    [".hidden", "hidden"],
    ["....weird.txt", "weird.txt"],
    // Empty or pure-separator input falls back to a stable placeholder.
    ["", "attachment"],
    ["///", "attachment"],
  ])("sanitizes %s → %s", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("preserves the extension when truncating long names", () => {
    const longName = "a".repeat(250) + ".txt";
    const out = sanitizeFilename(longName);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".txt")).toBe(true);
  });

  it("caps at 200 when there's no sensible extension", () => {
    const out = sanitizeFilename("a".repeat(500));
    expect(out.length).toBe(200);
  });
});

// --- downloadAttachment ------------------------------------------------

describe("downloadAttachment — happy path", () => {
  it("streams the response body to disk at the expected path", async () => {
    const body = "hello";
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok(body));

    const ref = await downloadAttachment(makeInput({ size: 5 }), {
      issueKey: "PROJ-1",
      authorizationHeader: "Basic abc",
      transport,
    });

    expect(ref.filename).toBe("notes.txt");
    expect(ref.mimeType).toBe("text/plain");
    expect(ref.size).toBe(5);
    expect(ref.path).toBe(
      path.join(sessionCacheDir(), "issues", "PROJ-1", "attachments", "notes.txt"),
    );
    expect(await fs.readFile(ref.path, "utf8")).toBe("hello");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      "https://jira.example/attachments/10001",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Basic abc",
        }),
      }),
    );
  });

  it("populates preview for text/plain", async () => {
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok("hello world"));
    const ref = await downloadAttachment(
      makeInput({ size: 11, mimeType: "text/plain" }),
      { issueKey: "PROJ-2", authorizationHeader: "", transport },
    );
    expect(ref.preview).toBe("hello world");
  });

  it("populates preview for application/json", async () => {
    const json = '{"a":1}';
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok(json));
    const ref = await downloadAttachment(
      makeInput({ size: json.length, mimeType: "application/json" }),
      { issueKey: "PROJ-2", authorizationHeader: "", transport },
    );
    expect(ref.preview).toBe(json);
  });

  it("returns null preview for binary mimes", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok(bytes));
    const ref = await downloadAttachment(
      makeInput({ size: 4, mimeType: "image/png", filename: "a.png" }),
      { issueKey: "PROJ-2", authorizationHeader: "", transport },
    );
    expect(ref.preview).toBeNull();
  });

  it("caps preview at previewChars and appends ellipsis", async () => {
    const body = "x".repeat(5000);
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok(body));
    const ref = await downloadAttachment(
      makeInput({ size: body.length, mimeType: "text/plain" }),
      {
        issueKey: "P",
        authorizationHeader: "",
        transport,
        previewChars: 100,
      },
    );
    expect(ref.preview).toHaveLength(101);
    expect(ref.preview?.endsWith("…")).toBe(true);
  });
});

describe("downloadAttachment — idempotency", () => {
  it("skips the network when the file already exists with matching size", async () => {
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok("hello"));

    const first = await downloadAttachment(makeInput({ size: 5 }), {
      issueKey: "PROJ-1",
      authorizationHeader: "",
      transport,
    });
    expect(transport).toHaveBeenCalledTimes(1);

    const second = await downloadAttachment(makeInput({ size: 5 }), {
      issueKey: "PROJ-1",
      authorizationHeader: "",
      transport,
    });
    expect(transport).toHaveBeenCalledTimes(1); // no re-fetch
    expect(second.path).toBe(first.path);
  });

  it("re-downloads when on-disk size differs from expected", async () => {
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok("hello"));
    const ref = await downloadAttachment(makeInput({ size: 5 }), {
      issueKey: "PROJ-1",
      authorizationHeader: "",
      transport,
    });
    // Corrupt the on-disk file.
    await fs.writeFile(ref.path, "CORRUPT_BUT_SAME_LENGTH_ISH", "utf8");

    const newTransport = vi.fn<AttachmentTransport>().mockResolvedValue(ok("hello"));
    await downloadAttachment(makeInput({ size: 5 }), {
      issueKey: "PROJ-1",
      authorizationHeader: "",
      transport: newTransport,
    });
    // Size now differs from expected (27 vs 5) → re-download.
    expect(newTransport).toHaveBeenCalledTimes(1);
  });
});

describe("downloadAttachment — errors", () => {
  it("throws on non-2xx status and does not leave a partial file", async () => {
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(err(403, "nope"));
    await expect(
      downloadAttachment(makeInput(), {
        issueKey: "PROJ-1",
        authorizationHeader: "",
        transport,
      }),
    ).rejects.toThrow(/HTTP 403/);

    const target = path.join(
      sessionCacheDir(),
      "issues",
      "PROJ-1",
      "attachments",
      "notes.txt",
    );
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it("throws and cleans up when downloaded size does not match expected", async () => {
    // Advertise 5 bytes but serve 3.
    const transport = vi.fn<AttachmentTransport>().mockResolvedValue(ok("ouh"));
    await expect(
      downloadAttachment(makeInput({ size: 5 }), {
        issueKey: "PROJ-1",
        authorizationHeader: "",
        transport,
      }),
    ).rejects.toThrow(/size mismatch/);

    const target = path.join(
      sessionCacheDir(),
      "issues",
      "PROJ-1",
      "attachments",
      "notes.txt",
    );
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it("cleans up the partial temp file when the stream errors mid-flight", async () => {
    const stream = new Readable({
      read() {
        this.push("partial");
        this.destroy(new Error("boom"));
      },
    });
    const transport: AttachmentTransport = async () => ({
      statusCode: 200,
      body: stream,
      bodyText: () => Promise.resolve(""),
    });
    await expect(
      downloadAttachment(makeInput({ size: 7 }), {
        issueKey: "PROJ-1",
        authorizationHeader: "",
        transport,
      }),
    ).rejects.toThrow(/boom/);

    const dir = path.join(
      sessionCacheDir(),
      "issues",
      "PROJ-1",
      "attachments",
    );
    // Directory may exist but must contain no .partial leftovers.
    const entries = await fs
      .readdir(dir)
      .catch(() => [] as string[]);
    for (const entry of entries) {
      expect(entry).not.toMatch(/\.partial$/);
    }
  });
});
