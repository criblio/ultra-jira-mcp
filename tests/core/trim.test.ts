import { describe, expect, it } from "vitest";

import {
  attachmentSummary,
  bareListSummary,
  commentSummary,
  issueSummary,
  paginatedListSummary,
  projectSummary,
  searchSummary,
  userSummary,
  voteListSummary,
  watcherListSummary,
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

// --- paginatedListSummary ----------------------------------------------

describe("paginatedListSummary", () => {
  it("emits count + metadata only — no inline items", () => {
    const r = {
      total: 26,
      startAt: 0,
      maxResults: 100,
      comments: Array.from({ length: 26 }, (_, i) => ({ id: String(i) })),
    };
    const s = paginatedListSummary(r);
    expect(s).toEqual({
      total: 26,
      startAt: 0,
      maxResults: 100,
      truncated: true,
    });
    // No items inline — that's the whole point.
    expect(Object.keys(s)).not.toContain("comments");
    expect(Object.keys(s)).not.toContain("items");
  });

  it("recognizes the various Jira list array keys", () => {
    expect(paginatedListSummary({ total: 1, comments: [{}] }).truncated).toBe(true);
    expect(paginatedListSummary({ total: 1, worklogs: [{}] }).truncated).toBe(true);
    expect(paginatedListSummary({ total: 1, issues: [{}] }).truncated).toBe(true);
    expect(paginatedListSummary({ total: 1, values: [{}] }).truncated).toBe(true);
    expect(paginatedListSummary({ total: 1, groups: [{}] }).truncated).toBe(true);
  });

  it("falls back to itemCount when total/maxResults are missing", () => {
    const s = paginatedListSummary({ comments: [{}, {}, {}] });
    expect(s).toEqual({
      total: 3,
      startAt: 0,
      maxResults: 3,
      truncated: true,
    });
  });

  it("reports an empty page as not truncated", () => {
    const s = paginatedListSummary({ total: 0, startAt: 0, maxResults: 50, comments: [] });
    expect(s).toEqual({
      total: 0,
      startAt: 0,
      maxResults: 50,
      truncated: false,
    });
  });
});

// --- bareListSummary ----------------------------------------------------

describe("bareListSummary", () => {
  it("counts items in a bare array", () => {
    expect(bareListSummary([{}, {}, {}])).toEqual({ count: 3, truncated: true });
  });

  it("handles empty / null / non-array input", () => {
    expect(bareListSummary([])).toEqual({ count: 0, truncated: false });
    expect(bareListSummary(null)).toEqual({ count: 0, truncated: false });
    expect(bareListSummary(undefined)).toEqual({ count: 0, truncated: false });
  });
});

// --- watcherListSummary -------------------------------------------------

describe("watcherListSummary", () => {
  it("surfaces watchCount and isWatching, hides watchers array", () => {
    const r = {
      watchCount: 5,
      isWatching: true,
      watchers: Array.from({ length: 5 }, (_, i) => ({ accountId: String(i) })),
    };
    const s = watcherListSummary(r);
    expect(s).toEqual({ watchCount: 5, isWatching: true, truncated: true });
  });

  it("falls back to watchers.length when watchCount is missing", () => {
    const s = watcherListSummary({ watchers: [{}, {}] });
    expect(s.watchCount).toBe(2);
  });

  it("treats null/empty input as empty", () => {
    expect(watcherListSummary(null)).toEqual({
      watchCount: 0,
      isWatching: undefined,
      truncated: false,
    });
  });
});

// --- voteListSummary ----------------------------------------------------

describe("voteListSummary", () => {
  it("surfaces votes count and hasVoted, hides voters array", () => {
    const r = {
      votes: 3,
      hasVoted: false,
      voters: [{ accountId: "a" }, { accountId: "b" }, { accountId: "c" }],
    };
    const s = voteListSummary(r);
    expect(s).toEqual({ votes: 3, hasVoted: false, truncated: true });
  });

  it("falls back to voters.length when votes is missing", () => {
    const s = voteListSummary({ voters: [{}] });
    expect(s.votes).toBe(1);
  });
});
