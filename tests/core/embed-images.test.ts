import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  embedImagesForAction,
  embedLocalImages,
  isLocalImageHref,
} from "../../src/core/embed-images.js";
import type { JiraClient } from "../../src/auth/jira-client.js";
import type {
  MediaIdTransport,
  UploadResponse,
  UploadTransport,
} from "../../src/core/attachments.js";

// A JiraClient stub exposing only the two methods the embed path calls.
function fakeClient(): JiraClient {
  return {
    attachmentUploadUrl: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(`https://jira.example/rest/api/3/issue/${key}/attachments`),
      ),
    getAuthorizationHeader: vi.fn().mockReturnValue("Basic test"),
  } as unknown as JiraClient;
}

// Deterministic UUID per sequence number (must be 36 chars matching the
// media-file URL regex `[0-9a-f-]{36}`).
function uuid(n: number): string {
  return `0000000${n}-0000-0000-0000-000000000000`.slice(-36);
}

// An upload transport that assigns a sequential REST id + content URL per
// call. The content URL carries the sequence number so the media-id
// transport can map it back to a deterministic UUID.
function fakeUploadTransport(): UploadTransport {
  let n = 0;
  return vi.fn<UploadTransport>().mockImplementation(() => {
    n += 1;
    const res: UploadResponse = {
      statusCode: 200,
      bodyText: () =>
        Promise.resolve(
          JSON.stringify([
            { id: `100${n}`, content: `https://jira.example/rest/api/3/attachment/content/100${n}` },
          ]),
        ),
    };
    return Promise.resolve(res);
  });
}

// A media-id transport that 303-redirects to a media URL whose UUID is
// derived from the attachment id in the content URL (…/content/100<n>).
function fakeMediaIdTransport(): MediaIdTransport {
  return vi.fn<MediaIdTransport>().mockImplementation((url: string) => {
    const m = /content\/100(\d+)$/.exec(url);
    const n = m ? Number(m[1]) : 0;
    return Promise.resolve({
      statusCode: 303,
      headers: {
        location: `https://api.media.atlassian.com/file/${uuid(n)}/binary?token=x`,
      },
      discard: () => Promise.resolve(),
    });
  });
}

describe("isLocalImageHref", () => {
  it.each([
    ["/abs/path.png", true],
    ["./rel/path.png", true],
    ["images/x.png", true],
    ["https://example.com/x.png", false],
    ["http://example.com/x.png", false],
    ["data:image/png;base64,AAAA", false],
    ["//cdn.example.com/x.png", false],
    ["attachment:10001", false],
    ["", false],
  ])("%s → %s", (href, expected) => {
    expect(isLocalImageHref(href)).toBe(expected);
  });
});

describe("embedLocalImages", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "embed-test-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("uploads a local image and rewrites it to a media-UUID marker", async () => {
    const img = path.join(tmpDir, "shot.png");
    await fs.writeFile(img, "PNG");
    const upload = fakeUploadTransport();
    const media = fakeMediaIdTransport();

    const out = await embedLocalImages(`Before\n\n![shot](${img})\n\nAfter`, {
      issueKey: "PROJ-1",
      client: fakeClient(),
      uploadTransport: upload,
      mediaIdTransport: media,
    });

    expect(out).toBe(`Before\n\n![shot](attachment:${uuid(1)})\n\nAfter`);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(media).toHaveBeenCalledTimes(1);
  });

  it("leaves http(s) and data images untouched", async () => {
    const upload = fakeUploadTransport();
    const media = fakeMediaIdTransport();
    const md = "![a](https://x/y.png) ![b](data:image/png;base64,AAA)";
    const out = await embedLocalImages(md, {
      issueKey: "PROJ-1",
      client: fakeClient(),
      uploadTransport: upload,
      mediaIdTransport: media,
    });
    expect(out).toBe(md);
    expect(upload).not.toHaveBeenCalled();
    expect(media).not.toHaveBeenCalled();
  });

  it("uploads a repeated local path only once", async () => {
    const img = path.join(tmpDir, "dup.png");
    await fs.writeFile(img, "PNG");
    const upload = fakeUploadTransport();
    const media = fakeMediaIdTransport();

    const out = await embedLocalImages(`![one](${img}) and ![two](${img})`, {
      issueKey: "PROJ-1",
      client: fakeClient(),
      uploadTransport: upload,
      mediaIdTransport: media,
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(out).toBe(`![one](attachment:${uuid(1)}) and ![two](attachment:${uuid(1)})`);
  });

  it("leaves the image as a link when the media UUID can't be resolved", async () => {
    const img = path.join(tmpDir, "noid.png");
    await fs.writeFile(img, "PNG");
    const upload = fakeUploadTransport();
    // A redirect with no parseable media UUID → resolveMediaId returns null.
    const media: MediaIdTransport = vi.fn<MediaIdTransport>().mockResolvedValue({
      statusCode: 303,
      headers: { location: "https://example.com/not-a-media-url" },
      discard: () => Promise.resolve(),
    });

    const out = await embedLocalImages(`![x](${img})`, {
      issueKey: "PROJ-1",
      client: fakeClient(),
      uploadTransport: upload,
      mediaIdTransport: media,
    });
    // Unchanged — the converter will degrade it to a labeled link.
    expect(out).toBe(`![x](${img})`);
  });

  it("returns the markdown unchanged when there are no images", async () => {
    const upload = fakeUploadTransport();
    const md = "Just text, no images.";
    expect(
      await embedLocalImages(md, {
        issueKey: "PROJ-1",
        client: fakeClient(),
        uploadTransport: upload,
        mediaIdTransport: fakeMediaIdTransport(),
      }),
    ).toBe(md);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("embedImagesForAction", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "embed-action-test-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function transports() {
    return {
      uploadTransport: fakeUploadTransport(),
      mediaIdTransport: fakeMediaIdTransport(),
    };
  }

  it("rewrites issue.update fields.description", async () => {
    const img = path.join(tmpDir, "x.png");
    await fs.writeFile(img, "PNG");
    const t = transports();
    const args = {
      action: "update",
      issueIdOrKey: "PROJ-2",
      fields: { summary: "S", description: `![x](${img})` },
    };

    const out = await embedImagesForAction("jira_issue", "update", args, fakeClient(), t);

    expect((out.fields as Record<string, unknown>).description).toBe(
      `![x](attachment:${uuid(1)})`,
    );
    // Original args untouched (server reuses them for error reporting).
    expect((args.fields as Record<string, unknown>).description).toBe(`![x](${img})`);
  });

  it("rewrites comment.add body", async () => {
    const img = path.join(tmpDir, "c.png");
    await fs.writeFile(img, "PNG");
    const t = transports();
    const args = { action: "add", issueIdOrKey: "PROJ-2", body: `![c](${img})` };

    const out = await embedImagesForAction("jira_comment", "add", args, fakeClient(), t);
    expect(out.body).toBe(`![c](attachment:${uuid(1)})`);
  });

  it("is a no-op for issue.create (no issue key to attach to)", async () => {
    const img = path.join(tmpDir, "x.png");
    await fs.writeFile(img, "PNG");
    const t = transports();
    const args = { action: "create", fields: { description: `![x](${img})` } };

    const out = await embedImagesForAction("jira_issue", "create", args, fakeClient(), t);
    expect(out).toBe(args); // unchanged reference
    expect(t.uploadTransport).not.toHaveBeenCalled();
  });

  it("is a no-op for non-embed actions", async () => {
    const t = transports();
    const args = { action: "get", issueIdOrKey: "PROJ-2" };
    const out = await embedImagesForAction("jira_issue", "get", args, fakeClient(), t);
    expect(out).toBe(args);
    expect(t.uploadTransport).not.toHaveBeenCalled();
  });
});
