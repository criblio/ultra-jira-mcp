// Summary projections keyed by entity type. Applied before sandboxing so
// the caller gets a compact, token-cheap shape while the full payload is
// still written to disk via `sandbox()`.
//
// Each projection strips fields that are never useful to an agent
// (avatars, `self` URLs, icon URLs, full ADF trees) and caps any
// potentially large text at a preview length.

import { adfToPlainText } from "./adf.js";
import type {
  JiraAttachment,
  JiraComment,
  JiraIssue,
  JiraProject,
  JiraSearchResult,
  JiraUser,
} from "../types/jira.js";

// (Description and comment caps were removed — see issueSummary.
// Classic mode has no sandbox-on-disk fallback, so any cap silently
// drops content the agent can't recover.)

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
  body: string;
}

export const commentSummary = (c: JiraComment): CommentSummary => ({
  id: c.id,
  author: userSummary(c.author),
  created: c.created,
  updated: c.updated,
  body: adfToPlainText(c.body),
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

export interface IssueLinkSummary {
  id: string;
  type: string;
  // "inward" or "outward" — the direction relative to *this* issue.
  direction: "inward" | "outward";
  // The semantic relationship from this issue's POV (e.g. "blocks",
  // "is blocked by"). Jira stores both phrasings on the link type;
  // surfacing the one that matches `direction` lets the agent read
  // the relationship without consulting docs.
  relationship: string;
  issue: { key: string; summary?: string };
}

export interface SubtaskSummary {
  id: string;
  key: string;
  summary: string;
}

export interface ParentSummary {
  id: string;
  key: string;
  summary?: string;
}

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
  // Full plain-text description. Was capped at 500 chars in earlier
  // v2 (and the truncated bytes had no recovery path in classic mode
  // since classic doesn't sandbox the raw response). Kept whole now.
  description: string;
  parent?: ParentSummary;
  subtasks: SubtaskSummary[];
  issuelinks: IssueLinkSummary[];
  commentCount: number;
  comments: CommentSummary[];
  attachmentCount: number;
  attachments: AttachmentSummary[];
}

function issueLinkSummary(l: {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { id: string; key: string; fields?: { summary: string } };
  outwardIssue?: { id: string; key: string; fields?: { summary: string } };
}): IssueLinkSummary {
  // Jira's contract is exactly one of inwardIssue/outwardIssue per
  // link record — the API returns each link once from each side, not
  // a combined record with both. So presence of inwardIssue means
  // *this* issue is on the outward side of the link type and the
  // linked issue is the inward target, and vice versa.
  const direction: "inward" | "outward" = l.inwardIssue ? "inward" : "outward";
  const linked = l.inwardIssue ?? l.outwardIssue;
  return {
    id: l.id,
    type: l.type.name,
    direction,
    relationship: direction === "inward" ? l.type.inward : l.type.outward,
    issue: {
      key: linked?.key ?? "",
      summary: linked?.fields?.summary,
    },
  };
}

export const issueSummary = (i: JiraIssue): IssueSummary => {
  const comments = i.fields.comment?.comments ?? [];
  const attachments = i.fields.attachment ?? [];
  const subtasks = i.fields.subtasks ?? [];
  const links = i.fields.issuelinks ?? [];
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
    description: adfToPlainText(i.fields.description),
    parent: i.fields.parent
      ? {
          id: i.fields.parent.id,
          key: i.fields.parent.key,
          // The /issue/{key} response includes `parent.fields.summary`
          // when the parent is populated; older shapes lack `fields`.
          summary: (i.fields.parent as { fields?: { summary?: string } })
            .fields?.summary,
        }
      : undefined,
    subtasks: subtasks.map((s) => ({
      id: s.id,
      key: s.key,
      summary: s.fields.summary,
    })),
    issuelinks: links.map(issueLinkSummary),
    commentCount: i.fields.comment?.total ?? comments.length,
    comments: comments.map(commentSummary),
    attachmentCount: attachments.length,
    attachments: attachments.map(attachmentSummary),
  };
};

// --- Search result ------------------------------------------------------

// Jira's GET /search/jql endpoint dropped `total`/`startAt`/`maxResults`
// and replaced them with cursor-based `isLast`/`nextPageToken` pagination.
// Older callers and other search-shaped endpoints still emit the full
// PageBean shape, so we preserve those fields when present and fall
// back to issue-count + `isLast` when they aren't.
export interface SearchSummary {
  // Known when the server returns the legacy PageBean shape; absent
  // when /search/jql responds. Callers should treat these as hints,
  // not hard counts.
  total?: number;
  startAt?: number;
  maxResults?: number;
  // Cursor-based pagination signal from /search/jql. `isLast: false`
  // (or `isLast` missing alongside a non-empty `nextPageToken`) means
  // more pages are available; `isLast: true` (or a missing
  // `nextPageToken` on the last page) means the cursor is exhausted.
  // Pass the `nextPageToken` value back into the next call to
  // continue paging.
  isLast?: boolean;
  nextPageToken?: string;
  issues: Array<Pick<IssueSummary, "key" | "summary" | "status" | "assignee" | "priority" | "updated">>;
}

export const searchSummary = (
  r: JiraSearchResult & {
    isLast?: boolean;
    nextPageToken?: string;
  },
): SearchSummary => ({
  total: r.total,
  startAt: r.startAt,
  maxResults: r.maxResults,
  isLast: r.isLast,
  nextPageToken: r.nextPageToken,
  issues: (r.issues ?? []).map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name,
    assignee: userSummary(i.fields.assignee),
    priority: i.fields.priority?.name,
    updated: i.fields.updated,
  })),
});

// --- List summaries ------------------------------------------------------
//
// Generic count + metadata summarizers for paginated and bare-array
// endpoints. The toolkit's `paginatedListSummary` defaults probe
// Jira's PageBean shape keys (values/comments/worklogs/issues/groups),
// so no override is needed for any of the standard list endpoints
// (comment.list, worklog.list, board.issues, sprint.issues, etc.).
// Jira's idiosyncratic shapes (/watchers, /votes) get their own
// projections below.
//
// Projections are deliberately count + metadata only — no inline
// items. The full untrimmed body still lands on disk via sandbox();
// callers who want per-item detail read the ref.
//
// The exception is `searchSummary` above, which inlines trimmed issue
// rows: (a) they compress extremely well (~80B each), and (b) the
// agent typically picks a key out of search results and follows up
// per-issue, so inlining saves a round-trip. Ref-only is still the
// default; `searchSummary` is a justified exception, not the model.

export {
  paginatedListSummary,
  bareListSummary,
  type ListSummary,
  type BareListSummary,
} from "@scottlepper/mcp-toolkit/trim";

// /issue/{key}/watchers returns { watchers, watchCount }, not a
// PageBean. Trim down to count + isWatching from the perspective of
// the calling user (Jira sets `isWatching` on the wrapper).
export interface WatcherListSummary {
  watchCount: number;
  isWatching?: boolean;
  truncated: boolean;
}

export const watcherListSummary = (
  r: { watchCount?: number; isWatching?: boolean; watchers?: unknown[] } | null | undefined,
): WatcherListSummary => {
  const watchers = r?.watchers ?? [];
  return {
    watchCount: r?.watchCount ?? watchers.length,
    isWatching: r?.isWatching,
    truncated: watchers.length > 0,
  };
};

// /issue/{key}/votes returns { votes, hasVoted, voters }. Same idea
// as watcher.list — count + the calling user's flag.
export interface VoteListSummary {
  votes: number;
  hasVoted?: boolean;
  truncated: boolean;
}

export const voteListSummary = (
  r: { votes?: number; hasVoted?: boolean; voters?: unknown[] } | null | undefined,
): VoteListSummary => {
  const voters = r?.voters ?? [];
  return {
    votes: r?.votes ?? voters.length,
    hasVoted: r?.hasVoted,
    truncated: voters.length > 0,
  };
};
