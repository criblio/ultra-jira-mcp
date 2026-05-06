// Complete operation manifest.
//
// One Operation per discrete Jira API call the server supports. Both
// Layer 2 (consolidated classic tools, PR #7b/#7c) and Layer 3
// (code-api stubs, PR #8) read this at runtime; no Jira call should
// be made outside the dispatcher in `manifest.ts`.
//
// Naming convention: `category.verb` where `verb` reflects the
// logical action (not the HTTP verb). Plural categories for
// collection-level ops (`sprints.listForBoard`), singular for
// entity ops (`sprint.get`).
//
// Derivation: each entry was translated from the corresponding v1
// tool handler by reading its `client.get/post/put/delete` (or
// agile* variant) call site. Paths, verbs, and param roles are
// taken verbatim from v1 to preserve behavior.

import type { Manifest } from "./manifest.js";

export const operations: Manifest = [
  // =================================================================
  // Issue
  // =================================================================
  {
    name: "issue.get",
    description: "Fetch a single issue by key or id.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "fields", role: "query" },
      { name: "expand", role: "query" },
    ],
    trim: "issue",
  },
  {
    name: "issue.create",
    description: "Create a new issue.",
    verb: "POST",
    pathTemplate: "/issue",
    params: [
      { name: "fields", role: "body", required: true },
      { name: "update", role: "body" },
      { name: "historyMetadata", role: "body" },
      { name: "properties", role: "body" },
      { name: "transition", role: "body" },
    ],
  },
  {
    name: "issue.update",
    description: "Update an existing issue.",
    verb: "PUT",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "fields", role: "body" },
      { name: "update", role: "body" },
      { name: "notifyUsers", role: "query" },
    ],
  },
  {
    name: "issue.delete",
    description: "Delete an issue.",
    verb: "DELETE",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "deleteSubtasks", role: "query" },
    ],
  },
  {
    name: "issue.bulkCreate",
    description: "Create up to 50 issues in one request.",
    verb: "POST",
    pathTemplate: "/issue/bulk",
    params: [{ name: "issueUpdates", role: "body", required: true }],
  },
  {
    name: "issue.listTransitions",
    description: "List workflow transitions available for an issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}/transitions",
    params: [{ name: "issueIdOrKey", role: "path", required: true }],
  },
  {
    name: "issue.transition",
    description: "Perform a workflow transition on an issue.",
    verb: "POST",
    pathTemplate: "/issue/{issueIdOrKey}/transitions",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "transition", role: "body", required: true },
      { name: "fields", role: "body" },
      { name: "update", role: "body" },
    ],
  },
  {
    name: "issue.assign",
    description: "Assign an issue to a user (or unassign).",
    verb: "PUT",
    pathTemplate: "/issue/{issueIdOrKey}/assignee",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "accountId", role: "body" },
    ],
  },
  {
    name: "issue.changelog",
    description: "Paginated changelog for an issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}/changelog",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
  },

  // =================================================================
  // Search / JQL
  // =================================================================
  {
    name: "search.issues",
    description: "Search issues by JQL. Uses the GET /search/jql endpoint.",
    verb: "GET",
    pathTemplate: "/search/jql",
    params: [
      { name: "jql", role: "query", required: true },
      { name: "fields", role: "query" },
      { name: "expand", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "nextPageToken", role: "query" },
    ],
    trim: "search",
  },
  {
    name: "search.jqlAutocompleteData",
    description: "Get autocomplete data (all fields + operators) for JQL.",
    verb: "GET",
    pathTemplate: "/jql/autocompletedata",
    params: [],
  },
  {
    name: "search.jqlAutocompleteSuggestions",
    description: "Get JQL field value suggestions.",
    verb: "GET",
    pathTemplate: "/jql/autocompletedata/suggestions",
    params: [
      { name: "fieldName", role: "query", required: true },
      { name: "fieldValue", role: "query" },
    ],
  },

  // =================================================================
  // Comment
  // =================================================================
  {
    name: "comment.list",
    description: "List comments on an issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}/comment",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "orderBy", role: "query" },
      { name: "expand", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "comment.add",
    description: "Add a comment to an issue.",
    verb: "POST",
    pathTemplate: "/issue/{issueIdOrKey}/comment",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "body", role: "body", required: true },
      { name: "visibility", role: "body" },
    ],
    trim: "comment",
  },
  {
    name: "comment.update",
    description: "Update an existing comment.",
    verb: "PUT",
    pathTemplate: "/issue/{issueIdOrKey}/comment/{commentId}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "commentId", role: "path", required: true },
      { name: "body", role: "body", required: true },
      { name: "visibility", role: "body" },
    ],
    trim: "comment",
  },
  {
    name: "comment.delete",
    description: "Delete a comment.",
    verb: "DELETE",
    pathTemplate: "/issue/{issueIdOrKey}/comment/{commentId}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "commentId", role: "path", required: true },
    ],
  },

  // =================================================================
  // Attachment
  // =================================================================
  {
    name: "attachment.get",
    description: "Get metadata for a single attachment.",
    verb: "GET",
    pathTemplate: "/attachment/{attachmentId}",
    params: [{ name: "attachmentId", role: "path", required: true }],
    trim: "attachment",
  },
  {
    name: "attachment.delete",
    description: "Delete an attachment.",
    verb: "DELETE",
    pathTemplate: "/attachment/{attachmentId}",
    params: [{ name: "attachmentId", role: "path", required: true }],
  },
  {
    name: "attachment.meta",
    description: "Global attachment settings (upload size limit, etc.).",
    verb: "GET",
    pathTemplate: "/attachment/meta",
    params: [],
  },

  // =================================================================
  // Project
  // =================================================================
  {
    name: "project.list",
    description: "Paginated search over projects.",
    verb: "GET",
    pathTemplate: "/project/search",
    params: [
      { name: "query", role: "query" },
      { name: "typeKey", role: "query" },
      { name: "categoryId", role: "query" },
      { name: "action", role: "query" },
      { name: "expand", role: "query" },
      { name: "status", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "orderBy", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "project.get",
    description: "Fetch a project by key or id.",
    verb: "GET",
    pathTemplate: "/project/{projectIdOrKey}",
    params: [
      { name: "projectIdOrKey", role: "path", required: true },
      { name: "expand", role: "query" },
    ],
    trim: "project",
  },
  {
    name: "project.create",
    description: "Create a new project.",
    verb: "POST",
    pathTemplate: "/project",
    params: [
      { name: "key", role: "body", required: true },
      { name: "name", role: "body", required: true },
      { name: "projectTypeKey", role: "body", required: true },
      { name: "projectTemplateKey", role: "body" },
      { name: "description", role: "body" },
      { name: "leadAccountId", role: "body" },
      { name: "assigneeType", role: "body" },
      { name: "categoryId", role: "body" },
    ],
  },
  {
    name: "project.update",
    description: "Update an existing project.",
    verb: "PUT",
    pathTemplate: "/project/{projectIdOrKey}",
    params: [
      { name: "projectIdOrKey", role: "path", required: true },
      { name: "key", role: "body" },
      { name: "name", role: "body" },
      { name: "description", role: "body" },
      { name: "leadAccountId", role: "body" },
      { name: "assigneeType", role: "body" },
      { name: "categoryId", role: "body" },
    ],
  },
  {
    name: "project.delete",
    description: "Delete a project.",
    verb: "DELETE",
    pathTemplate: "/project/{projectIdOrKey}",
    params: [{ name: "projectIdOrKey", role: "path", required: true }],
  },
  {
    name: "project.listComponents",
    description: "List components in a project.",
    verb: "GET",
    pathTemplate: "/project/{projectIdOrKey}/components",
    params: [{ name: "projectIdOrKey", role: "path", required: true }],
    trim: "bareList",
  },
  {
    name: "project.createComponent",
    description: "Create a component within a project.",
    verb: "POST",
    pathTemplate: "/component",
    params: [
      { name: "project", role: "body", required: true },
      { name: "name", role: "body", required: true },
      { name: "description", role: "body" },
      { name: "leadAccountId", role: "body" },
      { name: "assigneeType", role: "body" },
    ],
  },
  {
    name: "project.listVersions",
    description: "List versions in a project.",
    verb: "GET",
    pathTemplate: "/project/{projectIdOrKey}/versions",
    params: [
      { name: "projectIdOrKey", role: "path", required: true },
      { name: "expand", role: "query" },
    ],
    trim: "bareList",
  },
  {
    name: "project.createVersion",
    description: "Create a version within a project.",
    verb: "POST",
    pathTemplate: "/version",
    params: [
      { name: "projectId", role: "body", required: true },
      { name: "name", role: "body", required: true },
      { name: "description", role: "body" },
      { name: "startDate", role: "body" },
      { name: "releaseDate", role: "body" },
      { name: "released", role: "body" },
      { name: "archived", role: "body" },
    ],
  },
  {
    name: "project.updateVersion",
    description: "Update a version.",
    verb: "PUT",
    pathTemplate: "/version/{versionId}",
    params: [
      { name: "versionId", role: "path", required: true },
      { name: "name", role: "body" },
      { name: "description", role: "body" },
      { name: "startDate", role: "body" },
      { name: "releaseDate", role: "body" },
      { name: "released", role: "body" },
      { name: "archived", role: "body" },
    ],
  },
  {
    name: "project.statuses",
    description: "List statuses available for each issue type in a project.",
    verb: "GET",
    pathTemplate: "/project/{projectIdOrKey}/statuses",
    params: [{ name: "projectIdOrKey", role: "path", required: true }],
  },

  // =================================================================
  // User
  // =================================================================
  {
    name: "user.myself",
    description: "Fetch the current authenticated user.",
    verb: "GET",
    pathTemplate: "/myself",
    params: [{ name: "expand", role: "query" }],
    trim: "user",
  },
  {
    name: "user.search",
    description: "Search users by query string.",
    verb: "GET",
    pathTemplate: "/user/search",
    params: [
      { name: "query", role: "query" },
      { name: "accountId", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "property", role: "query" },
    ],
    // /user/search returns a bare array.
    trim: "bareList",
  },
  {
    name: "user.get",
    description: "Fetch a single user by accountId.",
    verb: "GET",
    pathTemplate: "/user",
    params: [
      { name: "accountId", role: "query", required: true },
      { name: "expand", role: "query" },
    ],
    trim: "user",
  },
  {
    name: "user.assignable",
    description: "List users assignable to an issue or project.",
    verb: "GET",
    pathTemplate: "/user/assignable/search",
    params: [
      { name: "query", role: "query" },
      { name: "sessionId", role: "query" },
      { name: "username", role: "query" },
      { name: "accountId", role: "query" },
      { name: "project", role: "query" },
      { name: "issueKey", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "actionDescriptorId", role: "query" },
      { name: "recommend", role: "query" },
    ],
    // /user/assignable/search returns a bare array.
    trim: "bareList",
  },
  {
    name: "user.bulkGet",
    description: "Get multiple users by accountId.",
    verb: "GET",
    pathTemplate: "/user/bulk",
    params: [
      { name: "accountId", role: "query", required: true },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    trim: "list",
  },

  // =================================================================
  // Board (Agile)
  // =================================================================
  {
    name: "board.list",
    description: "List boards (filterable by project/name/type).",
    verb: "GET",
    pathTemplate: "/board",
    isAgile: true,
    params: [
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "type", role: "query" },
      { name: "name", role: "query" },
      { name: "projectKeyOrId", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "board.get",
    description: "Fetch a board by id.",
    verb: "GET",
    pathTemplate: "/board/{boardId}",
    isAgile: true,
    params: [{ name: "boardId", role: "path", required: true }],
  },
  {
    name: "board.create",
    description: "Create a board.",
    verb: "POST",
    pathTemplate: "/board",
    isAgile: true,
    params: [
      { name: "name", role: "body", required: true },
      { name: "type", role: "body", required: true },
      { name: "filterId", role: "body", required: true },
      { name: "location", role: "body" },
    ],
  },
  {
    name: "board.delete",
    description: "Delete a board.",
    verb: "DELETE",
    pathTemplate: "/board/{boardId}",
    isAgile: true,
    params: [{ name: "boardId", role: "path", required: true }],
  },
  {
    name: "board.configuration",
    description: "Fetch the board's configuration (columns, estimation, etc.).",
    verb: "GET",
    pathTemplate: "/board/{boardId}/configuration",
    isAgile: true,
    params: [{ name: "boardId", role: "path", required: true }],
  },
  {
    name: "board.issues",
    description: "List issues on a board.",
    verb: "GET",
    pathTemplate: "/board/{boardId}/issue",
    isAgile: true,
    params: [
      { name: "boardId", role: "path", required: true },
      { name: "jql", role: "query" },
      { name: "fields", role: "query" },
      { name: "expand", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "board.backlog",
    description: "List issues in a board's backlog.",
    verb: "GET",
    pathTemplate: "/board/{boardId}/backlog",
    isAgile: true,
    params: [
      { name: "boardId", role: "path", required: true },
      { name: "jql", role: "query" },
      { name: "fields", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "board.epics",
    description: "List epics associated with a board.",
    verb: "GET",
    pathTemplate: "/board/{boardId}/epic",
    isAgile: true,
    params: [
      { name: "boardId", role: "path", required: true },
      { name: "done", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    trim: "list",
  },

  // =================================================================
  // Sprint (Agile)
  // =================================================================
  {
    name: "sprint.listForBoard",
    description: "List sprints belonging to a board.",
    verb: "GET",
    pathTemplate: "/board/{boardId}/sprint",
    isAgile: true,
    params: [
      { name: "boardId", role: "path", required: true },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "state", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "sprint.get",
    description: "Fetch a sprint by id.",
    verb: "GET",
    pathTemplate: "/sprint/{sprintId}",
    isAgile: true,
    params: [{ name: "sprintId", role: "path", required: true }],
  },
  {
    name: "sprint.create",
    description: "Create a sprint.",
    verb: "POST",
    pathTemplate: "/sprint",
    isAgile: true,
    params: [
      { name: "name", role: "body", required: true },
      { name: "originBoardId", role: "body", required: true },
      { name: "goal", role: "body" },
      { name: "startDate", role: "body" },
      { name: "endDate", role: "body" },
    ],
  },
  {
    name: "sprint.update",
    description: "Update a sprint.",
    verb: "PUT",
    pathTemplate: "/sprint/{sprintId}",
    isAgile: true,
    params: [
      { name: "sprintId", role: "path", required: true },
      { name: "name", role: "body" },
      { name: "state", role: "body" },
      { name: "goal", role: "body" },
      { name: "startDate", role: "body" },
      { name: "endDate", role: "body" },
      { name: "completeDate", role: "body" },
    ],
  },
  {
    name: "sprint.delete",
    description: "Delete a sprint.",
    verb: "DELETE",
    pathTemplate: "/sprint/{sprintId}",
    isAgile: true,
    params: [{ name: "sprintId", role: "path", required: true }],
  },
  {
    name: "sprint.issues",
    description: "List issues in a sprint.",
    verb: "GET",
    pathTemplate: "/sprint/{sprintId}/issue",
    isAgile: true,
    params: [
      { name: "sprintId", role: "path", required: true },
      { name: "jql", role: "query" },
      { name: "fields", role: "query" },
      { name: "expand", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "sprint.moveIssues",
    description: "Move issues into a sprint.",
    verb: "POST",
    pathTemplate: "/sprint/{sprintId}/issue",
    isAgile: true,
    params: [
      { name: "sprintId", role: "path", required: true },
      { name: "issues", role: "body", required: true },
      { name: "rankBeforeIssue", role: "body" },
      { name: "rankAfterIssue", role: "body" },
      { name: "rankCustomFieldId", role: "body" },
    ],
  },
  {
    name: "sprint.moveIssuesToBacklog",
    description: "Move issues out of a sprint and back to the backlog.",
    verb: "POST",
    pathTemplate: "/backlog/issue",
    isAgile: true,
    params: [{ name: "issues", role: "body", required: true }],
  },

  // =================================================================
  // Epic (Agile)
  // =================================================================
  {
    name: "epic.get",
    description: "Fetch an epic by key or id.",
    verb: "GET",
    pathTemplate: "/epic/{epicIdOrKey}",
    isAgile: true,
    params: [{ name: "epicIdOrKey", role: "path", required: true }],
  },
  {
    name: "epic.issues",
    description: "List issues under an epic.",
    verb: "GET",
    pathTemplate: "/epic/{epicIdOrKey}/issue",
    isAgile: true,
    params: [
      { name: "epicIdOrKey", role: "path", required: true },
      { name: "jql", role: "query" },
      { name: "fields", role: "query" },
      { name: "expand", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "epic.moveIssuesIn",
    description: "Move issues into an epic.",
    verb: "POST",
    pathTemplate: "/epic/{epicIdOrKey}/issue",
    isAgile: true,
    params: [
      { name: "epicIdOrKey", role: "path", required: true },
      { name: "issues", role: "body", required: true },
    ],
  },
  {
    name: "epic.removeIssues",
    description: "Remove issues from their current epic.",
    verb: "POST",
    pathTemplate: "/epic/none/issue",
    isAgile: true,
    params: [{ name: "issues", role: "body", required: true }],
  },

  // =================================================================
  // Worklog
  // =================================================================
  {
    name: "worklog.list",
    description: "List worklogs on an issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}/worklog",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "startedAfter", role: "query" },
      { name: "startedBefore", role: "query" },
      { name: "expand", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "worklog.add",
    description: "Add a worklog to an issue.",
    verb: "POST",
    pathTemplate: "/issue/{issueIdOrKey}/worklog",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "timeSpent", role: "body" },
      { name: "timeSpentSeconds", role: "body" },
      { name: "comment", role: "body" },
      { name: "started", role: "body" },
      { name: "visibility", role: "body" },
      { name: "adjustEstimate", role: "query" },
      { name: "newEstimate", role: "query" },
      { name: "reduceBy", role: "query" },
    ],
  },
  {
    name: "worklog.update",
    description: "Update a worklog.",
    verb: "PUT",
    pathTemplate: "/issue/{issueIdOrKey}/worklog/{worklogId}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "worklogId", role: "path", required: true },
      { name: "timeSpent", role: "body" },
      { name: "timeSpentSeconds", role: "body" },
      { name: "comment", role: "body" },
      { name: "started", role: "body" },
      { name: "visibility", role: "body" },
      { name: "adjustEstimate", role: "query" },
      { name: "newEstimate", role: "query" },
    ],
  },
  {
    name: "worklog.delete",
    description: "Delete a worklog.",
    verb: "DELETE",
    pathTemplate: "/issue/{issueIdOrKey}/worklog/{worklogId}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "worklogId", role: "path", required: true },
      { name: "adjustEstimate", role: "query" },
      { name: "newEstimate", role: "query" },
      { name: "increaseBy", role: "query" },
    ],
  },

  // =================================================================
  // Filter
  // =================================================================
  {
    name: "filter.list",
    description: "Paginated search over saved filters.",
    verb: "GET",
    pathTemplate: "/filter/search",
    params: [
      { name: "filterName", role: "query" },
      { name: "accountId", role: "query" },
      { name: "owner", role: "query" },
      // Note: Jira deprecated `groupname` here in favour of
      // `groupId` (Cloud REST v3). v2 is a clean break, so we go
      // straight to the new param.
      { name: "groupId", role: "query" },
      { name: "projectId", role: "query" },
      { name: "id", role: "query" },
      { name: "orderBy", role: "query" },
      { name: "maxResults", role: "query" },
      { name: "startAt", role: "query" },
      { name: "expand", role: "query" },
    ],
    trim: "list",
  },
  {
    name: "filter.get",
    description: "Fetch a saved filter by id.",
    verb: "GET",
    pathTemplate: "/filter/{filterId}",
    params: [
      { name: "filterId", role: "path", required: true },
      { name: "expand", role: "query" },
    ],
  },
  {
    name: "filter.create",
    description: "Create a saved filter.",
    verb: "POST",
    pathTemplate: "/filter",
    params: [
      { name: "name", role: "body", required: true },
      { name: "jql", role: "body", required: true },
      { name: "description", role: "body" },
      { name: "favourite", role: "body" },
      { name: "sharePermissions", role: "body" },
    ],
  },
  {
    name: "filter.update",
    description: "Update a saved filter.",
    verb: "PUT",
    pathTemplate: "/filter/{filterId}",
    params: [
      { name: "filterId", role: "path", required: true },
      { name: "name", role: "body" },
      { name: "jql", role: "body" },
      { name: "description", role: "body" },
      { name: "favourite", role: "body" },
      { name: "sharePermissions", role: "body" },
    ],
  },
  {
    name: "filter.delete",
    description: "Delete a saved filter.",
    verb: "DELETE",
    pathTemplate: "/filter/{filterId}",
    params: [{ name: "filterId", role: "path", required: true }],
  },
  {
    name: "filter.listFavourite",
    description: "List filters favourited by the current user.",
    verb: "GET",
    pathTemplate: "/filter/favourite",
    params: [{ name: "expand", role: "query" }],
    trim: "bareList",
  },

  // =================================================================
  // Issue link
  // =================================================================
  {
    name: "issueLink.create",
    description: "Create a link between two issues.",
    verb: "POST",
    pathTemplate: "/issueLink",
    params: [
      { name: "type", role: "body", required: true },
      { name: "inwardIssue", role: "body", required: true },
      { name: "outwardIssue", role: "body", required: true },
      { name: "comment", role: "body" },
    ],
  },
  {
    name: "issueLink.get",
    description: "Fetch a single issue link by id.",
    verb: "GET",
    pathTemplate: "/issueLink/{linkId}",
    params: [{ name: "linkId", role: "path", required: true }],
  },
  {
    name: "issueLink.delete",
    description: "Delete an issue link by id.",
    verb: "DELETE",
    pathTemplate: "/issueLink/{linkId}",
    params: [{ name: "linkId", role: "path", required: true }],
  },
  {
    name: "issueLink.types",
    description: "List available issue link types.",
    verb: "GET",
    pathTemplate: "/issueLinkType",
    params: [],
  },

  // =================================================================
  // Watcher / vote
  // =================================================================
  {
    name: "watcher.list",
    description: "List watchers on an issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}/watchers",
    params: [{ name: "issueIdOrKey", role: "path", required: true }],
    trim: "watcherList",
  },
  {
    name: "watcher.add",
    description: "Add a watcher to an issue.",
    verb: "POST",
    pathTemplate: "/issue/{issueIdOrKey}/watchers",
    // Jira's POST /issue/{key}/watchers expects a raw JSON string
    // body (e.g. `"acc123"`), not a JSON object. Without bodyShape,
    // the dispatcher would send `{"accountId":"acc123"}` which Jira
    // rejects with HTTP 400.
    bodyShape: "rawString",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "accountId", role: "body", required: true },
    ],
  },
  {
    name: "watcher.remove",
    description: "Remove a watcher from an issue.",
    verb: "DELETE",
    pathTemplate: "/issue/{issueIdOrKey}/watchers",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "accountId", role: "query", required: true },
    ],
  },
  {
    name: "vote.list",
    description: "List votes on an issue.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}/votes",
    params: [{ name: "issueIdOrKey", role: "path", required: true }],
    trim: "voteList",
  },
  {
    name: "vote.add",
    description: "Vote on an issue.",
    verb: "POST",
    pathTemplate: "/issue/{issueIdOrKey}/votes",
    params: [{ name: "issueIdOrKey", role: "path", required: true }],
  },
  {
    name: "vote.remove",
    description: "Remove a vote from an issue.",
    verb: "DELETE",
    pathTemplate: "/issue/{issueIdOrKey}/votes",
    params: [{ name: "issueIdOrKey", role: "path", required: true }],
  },

  // =================================================================
  // Field / metadata (LRU-cached by JiraClient)
  // =================================================================
  {
    name: "field.list",
    description: "List all fields available in this Jira instance.",
    verb: "GET",
    pathTemplate: "/field",
    params: [],
  },
  {
    name: "field.issueTypes",
    description: "List issue types.",
    verb: "GET",
    pathTemplate: "/issuetype",
    params: [],
  },
  {
    name: "field.priorities",
    description: "List priorities.",
    verb: "GET",
    pathTemplate: "/priority",
    params: [],
  },
  {
    name: "field.statuses",
    description: "List statuses.",
    verb: "GET",
    pathTemplate: "/status",
    params: [],
  },
  {
    name: "field.resolutions",
    description: "List resolutions.",
    verb: "GET",
    pathTemplate: "/resolution",
    params: [],
  },
  {
    name: "field.createMeta",
    description: "Fetch issue creation metadata (per project/issue type).",
    verb: "GET",
    pathTemplate: "/issue/createmeta",
    params: [
      { name: "projectIds", role: "query" },
      { name: "projectKeys", role: "query" },
      { name: "issuetypeIds", role: "query" },
      { name: "issuetypeNames", role: "query" },
      { name: "expand", role: "query" },
    ],
  },

  // =================================================================
  // Group
  // =================================================================
  {
    name: "group.search",
    description: "Search groups by query.",
    verb: "GET",
    pathTemplate: "/groups/picker",
    params: [
      { name: "query", role: "query" },
      { name: "accountId", role: "query" },
      { name: "caseInsensitive", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    // /groups/picker returns { groups: [...], total }. The
    // `groups` array key is included in paginatedListSummary's
    // PageBean recognizer alongside comments/worklogs/issues/values.
    trim: "list",
  },
  {
    name: "group.members",
    description: "List members of a group.",
    verb: "GET",
    pathTemplate: "/group/member",
    params: [
      { name: "groupId", role: "query", required: true },
      { name: "includeInactiveUsers", role: "query" },
      { name: "startAt", role: "query" },
      { name: "maxResults", role: "query" },
    ],
    trim: "list",
  },

  // =================================================================
  // Permissions
  // =================================================================
  {
    name: "permissions.mine",
    description: "List permissions the current user has.",
    verb: "GET",
    pathTemplate: "/mypermissions",
    params: [
      { name: "projectKey", role: "query" },
      { name: "projectId", role: "query" },
      { name: "issueKey", role: "query" },
      { name: "issueId", role: "query" },
      { name: "permissions", role: "query" },
    ],
  },

  // =================================================================
  // Server
  // =================================================================
  {
    name: "server.info",
    description: "Fetch Jira server info (version, build, deployment type).",
    verb: "GET",
    pathTemplate: "/serverInfo",
    params: [],
  },
];
