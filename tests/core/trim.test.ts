import { describe, expect, it } from "vitest";

import {
  adfToPlainText,
  attachmentSummary,
  commentSummary,
  issueSummary,
  projectSummary,
  searchSummary,
  userSummary,
} from "../../src/core/trim.js";
import type {
  JiraAttachment,
  JiraComment,
  JiraIssue,
  JiraProject,
  JiraSearchResult,
  JiraUser,
} from "../../src/types/jira.js";

// --- ADF fixtures -------------------------------------------------------

const adfParagraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const adfDoc = (...paragraphs: string[]) => ({
  type: "doc",
  version: 1,
  content: paragraphs.map(adfParagraph),
});

// --- User ---------------------------------------------------------------

describe("userSummary", () => {
  it("returns null for null/undefined", () => {
    expect(userSummary(null)).toBeNull();
    expect(userSummary(undefined)).toBeNull();
  });

  it("keeps id/display/email/active and drops avatar noise", () => {
    const user: JiraUser = {
      self: "https://x.atlassian.net/rest/api/3/user?accountId=1",
      accountId: "1",
      displayName: "Ada Lovelace",
      emailAddress: "ada@example.com",
      active: true,
      avatarUrls: { "48x48": "https://avatars.example/1.png" },
    };
    expect(userSummary(user)).toEqual({
      accountId: "1",
      displayName: "Ada Lovelace",
      emailAddress: "ada@example.com",
      active: true,
    });
  });
});

// --- ADF ----------------------------------------------------------------

describe("adfToPlainText", () => {
  it("returns '' for non-objects", () => {
    expect(adfToPlainText(null)).toBe("");
    expect(adfToPlainText(undefined)).toBe("");
    expect(adfToPlainText("raw string")).toBe("");
  });

  it("concatenates text nodes with newlines between block nodes", () => {
    const doc = adfDoc("First line.", "Second line.");
    expect(adfToPlainText(doc)).toBe("First line.\nSecond line.");
  });

  it("handles nested marks like inline links", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "text", text: "docs", marks: [{ type: "link" }] },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe("See docs.");
  });
});

// --- Comment ------------------------------------------------------------

describe("commentSummary", () => {
  it("flattens ADF body and truncates beyond 300 chars", () => {
    const longText = "x".repeat(400);
    const c: JiraComment = {
      id: "10001",
      body: adfDoc(longText),
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-02T00:00:00.000Z",
      author: {
        accountId: "u1",
        displayName: "Author",
      },
    };
    const s = commentSummary(c);
    expect(s.id).toBe("10001");
    expect(s.author?.displayName).toBe("Author");
    expect(s.preview.endsWith("…")).toBe(true);
    expect(s.preview.length).toBe(301);
  });
});

// --- Attachment + Project ----------------------------------------------

describe("attachmentSummary", () => {
  it("keeps id/filename/mimeType/size only", () => {
    const a: JiraAttachment = {
      self: "https://x/attachments/1",
      id: "1",
      filename: "login-bug.png",
      mimeType: "image/png",
      size: 245312,
      content: "https://x/secure/attachment/1/login-bug.png",
      created: "2026-01-01T00:00:00.000Z",
      author: { accountId: "u1", displayName: "A" },
    };
    expect(attachmentSummary(a)).toEqual({
      id: "1",
      filename: "login-bug.png",
      mimeType: "image/png",
      size: 245312,
    });
  });
});

describe("projectSummary", () => {
  it("keeps id/key/name/projectTypeKey", () => {
    const p: JiraProject = {
      id: "10000",
      key: "PROJ",
      name: "Project",
      projectTypeKey: "software",
      avatarUrls: { "48x48": "https://x/avatar.png" },
    };
    expect(projectSummary(p)).toEqual({
      id: "10000",
      key: "PROJ",
      name: "Project",
      projectTypeKey: "software",
    });
  });
});

// --- Issue --------------------------------------------------------------

function makeIssue(overrides: Partial<JiraIssue["fields"]> = {}): JiraIssue {
  return {
    id: "10000",
    key: "PROJ-1",
    fields: {
      summary: "A bug",
      status: { id: "1", name: "To Do" },
      priority: { id: "1", name: "High" },
      assignee: {
        accountId: "u1",
        displayName: "Dev",
      },
      reporter: {
        accountId: "u2",
        displayName: "Reporter",
      },
      labels: ["frontend"],
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-02T00:00:00.000Z",
      description: adfDoc("short description"),
      ...overrides,
    },
  };
}

describe("issueSummary", () => {
  it("produces a compact projection for a normal issue", () => {
    const s = issueSummary(makeIssue());
    expect(s).toMatchObject({
      key: "PROJ-1",
      id: "10000",
      summary: "A bug",
      status: "To Do",
      priority: "High",
      labels: ["frontend"],
      descriptionPreview: "short description",
      descriptionTruncated: false,
      commentCount: 0,
      recentComments: [],
      attachmentCount: 0,
    });
    expect(s.assignee?.displayName).toBe("Dev");
    expect(s.reporter?.displayName).toBe("Reporter");
  });

  it("truncates long descriptions at 500 chars and marks truncated", () => {
    const long = "a".repeat(600);
    const s = issueSummary(makeIssue({ description: adfDoc(long) }));
    expect(s.descriptionTruncated).toBe(true);
    expect(s.descriptionPreview.length).toBe(501);
    expect(s.descriptionPreview.endsWith("…")).toBe(true);
  });

  it("keeps only the last 3 comments but reports the full count", () => {
    const comments: JiraComment[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      body: adfDoc(`comment ${i}`),
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    }));
    const s = issueSummary(
      makeIssue({
        comment: { comments, maxResults: 10, total: 10 },
      }),
    );
    expect(s.commentCount).toBe(10);
    expect(s.recentComments.map((c) => c.id)).toEqual(["7", "8", "9"]);
  });

  it("summarizes attachments", () => {
    const s = issueSummary(
      makeIssue({
        attachment: [
          {
            id: "1",
            filename: "a.png",
            mimeType: "image/png",
            size: 100,
            content: "https://x",
            created: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(s.attachmentCount).toBe(1);
    expect(s.attachments[0]).toEqual({
      id: "1",
      filename: "a.png",
      mimeType: "image/png",
      size: 100,
    });
  });

  it("handles a null assignee", () => {
    const s = issueSummary(makeIssue({ assignee: null }));
    expect(s.assignee).toBeNull();
  });
});

// --- Search -------------------------------------------------------------

describe("searchSummary", () => {
  it("projects each issue to its lightweight row", () => {
    const r: JiraSearchResult = {
      startAt: 0,
      maxResults: 50,
      total: 2,
      issues: [makeIssue(), makeIssue({ summary: "Another" })],
    };
    const s = searchSummary(r);
    expect(s.total).toBe(2);
    expect(s.issues).toHaveLength(2);
    expect(s.issues[0]).toMatchObject({
      key: "PROJ-1",
      summary: "A bug",
      status: "To Do",
      priority: "High",
    });
  });
});
