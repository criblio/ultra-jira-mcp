// Summary projections keyed by entity type. Applied before sandboxing so
// the caller gets a compact, token-cheap shape while the full payload is
// still written to disk via `sandbox()`.
//
// Each projection strips fields that are never useful to an agent
// (avatars, `self` URLs, icon URLs, full ADF trees) and caps any
// potentially large text at a preview length.

import type {
  JiraAttachment,
  JiraComment,
  JiraIssue,
  JiraProject,
  JiraSearchResult,
  JiraUser,
} from "../types/jira.js";

const DESCRIPTION_PREVIEW_CHARS = 500;
const COMMENT_PREVIEW_CHARS = 300;
const RECENT_COMMENT_COUNT = 3;

// Minimal ADF-to-text extractor: walks the node tree and concatenates any
// `text` fields, inserting newlines between block-level nodes. PR #3
// (src/core/adf.ts) will replace this with a proper markdown flattener;
// for now this is enough to populate previews without dragging the full
// ADF tree into every summary.
export function adfToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const parts: string[] = [];
  walk(doc as AdfNode, parts);
  return parts.join("").trim();
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "blockquote",
  "rule",
]);

function walk(node: AdfNode, out: string[]): void {
  if (typeof node.text === "string") {
    out.push(node.text);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walk(child, out);
    }
    if (node.type && BLOCK_TYPES.has(node.type)) {
      out.push("\n");
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

// --- User ---------------------------------------------------------------

export interface UserSummary {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active?: boolean;
}

export const userSummary = (u: JiraUser | null | undefined): UserSummary | null => {
  if (!u) return null;
  return {
    accountId: u.accountId,
    displayName: u.displayName,
    emailAddress: u.emailAddress,
    active: u.active,
  };
};

// --- Comment ------------------------------------------------------------

export interface CommentSummary {
  id: string;
  author: UserSummary | null;
  created: string;
  updated: string;
  preview: string;
}

export const commentSummary = (c: JiraComment): CommentSummary => ({
  id: c.id,
  author: userSummary(c.author),
  created: c.created,
  updated: c.updated,
  preview: truncate(adfToPlainText(c.body), COMMENT_PREVIEW_CHARS),
});

// --- Attachment ---------------------------------------------------------

export interface AttachmentSummary {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export const attachmentSummary = (a: JiraAttachment): AttachmentSummary => ({
  id: a.id,
  filename: a.filename,
  mimeType: a.mimeType,
  size: a.size,
});

// --- Project ------------------------------------------------------------

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
}

export const projectSummary = (p: JiraProject): ProjectSummary => ({
  id: p.id,
  key: p.key,
  name: p.name,
  projectTypeKey: p.projectTypeKey,
});

// --- Issue --------------------------------------------------------------

export interface IssueSummary {
  key: string;
  id: string;
  summary: string;
  status?: string;
  assignee: UserSummary | null;
  reporter: UserSummary | null;
  priority?: string;
  labels: string[];
  created?: string;
  updated?: string;
  descriptionPreview: string;
  descriptionTruncated: boolean;
  commentCount: number;
  recentComments: CommentSummary[];
  attachmentCount: number;
  attachments: AttachmentSummary[];
}

export const issueSummary = (i: JiraIssue): IssueSummary => {
  const desc = adfToPlainText(i.fields.description);
  const comments = i.fields.comment?.comments ?? [];
  const attachments = i.fields.attachment ?? [];
  return {
    key: i.key,
    id: i.id,
    summary: i.fields.summary,
    status: i.fields.status?.name,
    assignee: userSummary(i.fields.assignee),
    reporter: userSummary(i.fields.reporter),
    priority: i.fields.priority?.name,
    labels: i.fields.labels ?? [],
    created: i.fields.created,
    updated: i.fields.updated,
    descriptionPreview: truncate(desc, DESCRIPTION_PREVIEW_CHARS),
    descriptionTruncated: desc.length > DESCRIPTION_PREVIEW_CHARS,
    commentCount: i.fields.comment?.total ?? comments.length,
    recentComments: comments.slice(-RECENT_COMMENT_COUNT).map(commentSummary),
    attachmentCount: attachments.length,
    attachments: attachments.map(attachmentSummary),
  };
};

// --- Search result ------------------------------------------------------

export interface SearchSummary {
  total: number;
  startAt: number;
  maxResults: number;
  issues: Array<Pick<IssueSummary, "key" | "summary" | "status" | "assignee" | "priority" | "updated">>;
}

export const searchSummary = (r: JiraSearchResult): SearchSummary => ({
  total: r.total,
  startAt: r.startAt,
  maxResults: r.maxResults,
  issues: r.issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name,
    assignee: userSummary(i.fields.assignee),
    priority: i.fields.priority?.name,
    updated: i.fields.updated,
  })),
});
