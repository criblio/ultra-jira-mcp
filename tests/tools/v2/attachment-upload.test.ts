import * as fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAttachmentAdd } from "../../../src/tools/v2/attachment-upload.js";
import { handleV2Tool } from "../../../src/tools/v2/index.js";
import {
  __resetSessionCacheDirForTests,
  sessionCacheDir,
} from "../../../src/core/sandbox.js";
import type { JiraClient } from "../../../src/auth/jira-client.js";

// Mock the network-touching upload primitive; everything else (sandbox,
// trim, arg validation) runs for real.
vi.mock("../../../src/core/attachments.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/core/attachments.js")>();
  return {
    ...actual,
    uploadAttachment: vi.fn(),
  };
});

import { uploadAttachment } from "../../../src/core/attachments.js";

const originalSessionId = process.env.MCP_SESSION_ID;

beforeEach(() => {
  process.env.MCP_SESSION_ID = `attach-add-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  __resetSessionCacheDirForTests();
  vi.mocked(uploadAttachment).mockReset();
});

afterEach(async () => {
  await fs.rm(sessionCacheDir(), { recursive: true, force: true });
  if (originalSessionId === undefined) delete process.env.MCP_SESSION_ID;
  else process.env.MCP_SESSION_ID = originalSessionId;
  __resetSessionCacheDirForTests();
});

function fakeClient(): JiraClient {
  return {
    attachmentUploadUrl: vi
      .fn()
      .mockResolvedValue("https://jira.example/rest/api/3/issue/PROJ-1/attachments"),
    getAuthorizationHeader: vi.fn().mockReturnValue("Basic test"),
  } as unknown as JiraClient;
}

describe("handleAttachmentAdd", () => {
  it("uploads one file and returns a trimmed summary + ref", async () => {
    vi.mocked(uploadAttachment).mockResolvedValue([
      {
        id: "10001",
        filename: "shot.png",
        mimeType: "image/png",
        size: 7,
        content: "https://jira.example/secure/attachment/10001/shot.png",
        created: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = (await handleAttachmentAdd(fakeClient(), {
      action: "add",
      issueIdOrKey: "PROJ-1",
      filePath: "/tmp/shot.png",
    })) as { summary: unknown[]; ref: string };

    // Summary is the trimmed shape — no content URL, no created date.
    expect(result.summary).toEqual([
      { id: "10001", filename: "shot.png", mimeType: "image/png", size: 7 },
    ]);
    expect(result.ref).toMatch(/attachment\/.*\.json$/);

    // The full response (with content URL) is on disk behind the ref.
    const full = JSON.parse(await fs.readFile(result.ref, "utf8"));
    expect(full[0].content).toContain("secure/attachment");
  });

  it("uploads multiple files, concatenating their results", async () => {
    vi.mocked(uploadAttachment)
      .mockResolvedValueOnce([
        { id: "1", filename: "a.png", mimeType: "image/png", size: 1, content: "", created: "" },
      ])
      .mockResolvedValueOnce([
        { id: "2", filename: "b.png", mimeType: "image/png", size: 2, content: "", created: "" },
      ]);

    const result = (await handleAttachmentAdd(fakeClient(), {
      action: "add",
      issueIdOrKey: "PROJ-1",
      filePath: ["/tmp/a.png", "/tmp/b.png"],
    })) as { summary: Array<{ id: string }> };

    expect(result.summary.map((s) => s.id)).toEqual(["1", "2"]);
    expect(vi.mocked(uploadAttachment)).toHaveBeenCalledTimes(2);
  });

  it("rejects a call with no filePath", async () => {
    await expect(
      handleAttachmentAdd(fakeClient(), { action: "add", issueIdOrKey: "PROJ-1" }),
    ).rejects.toThrow(/invalid args|filePath/);
    expect(vi.mocked(uploadAttachment)).not.toHaveBeenCalled();
  });

  it("rejects a call with no issueIdOrKey", async () => {
    await expect(
      handleAttachmentAdd(fakeClient(), { action: "add", filePath: "/tmp/x.png" }),
    ).rejects.toThrow(/invalid args|issueIdOrKey/);
  });
});

describe("handleV2Tool routes jira_attachment add to the side-channel", () => {
  it("intercepts add before the JSON dispatcher", async () => {
    vi.mocked(uploadAttachment).mockResolvedValue([
      { id: "9", filename: "x.png", mimeType: "image/png", size: 3, content: "", created: "" },
    ]);
    const result = (await handleV2Tool(fakeClient(), "jira_attachment", {
      action: "add",
      issueIdOrKey: "PROJ-1",
      filePath: "/tmp/x.png",
    })) as { summary: Array<{ id: string }> };
    expect(result.summary[0].id).toBe("9");
  });

  it("honors JIRA_DISABLED_ACTIONS for attachment.add", async () => {
    await expect(
      handleV2Tool(
        fakeClient(),
        "jira_attachment",
        { action: "add", issueIdOrKey: "PROJ-1", filePath: "/tmp/x.png" },
        ["attachment.add"],
      ),
    ).rejects.toThrow(/JIRA_DISABLED_ACTIONS/);
    expect(vi.mocked(uploadAttachment)).not.toHaveBeenCalled();
  });
});
