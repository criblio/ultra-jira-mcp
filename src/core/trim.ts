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
// These cover the family of paginated "give me the things" endpoints
// (comment.list, worklog.list, board.issues, project.list, etc.).
//
// The projection is deliberately *count + metadata only* — no inline
// items. The full untrimmed body still lands on disk via sandbox(),
// so the agent can read the ref and run their own filter (jq, code,
// whatever) when they want detail. Putting items inline would either
// shape the data wrong for the agent's question or balloon context
// when they don't actually need them.
//
// The exception is `searchSummary` above, which does inline trimmed
// issue rows. Keeping it that way because: (a) issue rows compress
// extremely well to key+summary+status (~80B each), (b) the agent
// often does pick a key out of a search result list and then does
// a follow-up call, so seeing keys inline saves a round-trip.
//
// Ref-only is the right default; `searchSummary` is a justified
// exception, not the model.

export interface ListSummary {
  total: number;
  startAt: number;
  maxResults: number;
  // True when the inline projection is missing items the ref has.
  // Today this is always true if the page contains anything (since
  // we inline nothing). Kept so callers can extend with inline
  // previews later without changing the field set.
  truncated: boolean;
}

// Standard paginated shape used by /comment, /worklog, /board/issues,
// /sprint/issues, /epic/issues, /board/backlog, /search, etc.
//
// The array key isn't standardized in Jira's API — could be `comments`,
// `worklogs`, `issues`, `values` — but every variant carries `total`
// and `maxResults`, which is all we surface. Defaults guard against
// servers that omit them on empty pages.
type PageBean = {
  total?: number;
  startAt?: number;
  maxResults?: number;
  // Possible item arrays. We only check for presence to set
  // `truncated`; the values themselves stay in the ref.
  comments?: unknown[];
  worklogs?: unknown[];
  issues?: unknown[];
  values?: unknown[];
  groups?: unknown[];
};

function pageItemCount(r: PageBean): number {
  return (
    r.comments?.length ??
    r.worklogs?.length ??
    r.issues?.length ??
    r.values?.length ??
    r.groups?.length ??
    0
  );
}

export const paginatedListSummary = (r: PageBean): ListSummary => {
  const itemCount = pageItemCount(r);
  return {
    total: r.total ?? itemCount,
    startAt: r.startAt ?? 0,
    maxResults: r.maxResults ?? itemCount,
    truncated: itemCount > 0,
  };
};

// Bare-array list endpoints (project.listComponents, project.listVersions,
// filter.listFavourite, attachment.meta-style results). No pagination
// envelope from Jira — just an array. We surface a count so the agent
// knows whether to bother reading the ref.
export interface BareListSummary {
  count: number;
  truncated: boolean;
}

export const bareListSummary = (r: unknown[] | null | undefined): BareListSummary => {
  const count = Array.isArray(r) ? r.length : 0;
  return { count, truncated: count > 0 };
};

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
