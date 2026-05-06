// Per-tool integration tests against the real production manifest.
//
// These ensure that every action declared on a v2 tool maps to an
// operation that actually exists in src/core/operations.ts and that
// the request shape Jira sees is what we expect. The mock JiraClient
// records every call so we can assert verb + path + body + query.

import { describe, expect, it, vi } from "vitest";

import type { JiraClient } from "../../../src/auth/jira-client.js";
import { operations } from "../../../src/core/operations.js";
import { jiraAttachment } from "../../../src/tools/v2/attachment.js";
import { jiraBoard } from "../../../src/tools/v2/board.js";
import { jiraComment } from "../../../src/tools/v2/comment.js";
import { jiraEpic } from "../../../src/tools/v2/epic.js";
import { jiraField } from "../../../src/tools/v2/field.js";
import { jiraFilter } from "../../../src/tools/v2/filter.js";
import { jiraGroup } from "../../../src/tools/v2/group.js";
import { jiraLink } from "../../../src/tools/v2/link.js";
import { jiraProject } from "../../../src/tools/v2/project.js";
import { jiraServer } from "../../../src/tools/v2/server.js";
import { jiraSprint } from "../../../src/tools/v2/sprint.js";
import { jiraWatcher } from "../../../src/tools/v2/watcher.js";
import { jiraWorklog } from "../../../src/tools/v2/worklog.js";
import { dispatchTool } from "../../../src/tools/v2/dispatcher.js";
import { jiraIssue } from "../../../src/tools/v2/issue.js";
import { jiraSearch } from "../../../src/tools/v2/search.js";
import { jiraUser } from "../../../src/tools/v2/user.js";
import { allConsolidatedTools } from "../../../src/tools/v2/index.js";

function makeMockClient() {
  const calls: Array<{ api: string; path: string; query?: unknown; body?: unknown }> = [];
  let ret: unknown = {};
  const record = (api: string) =>
    vi.fn((path: string, bodyOrQuery?: unknown, maybeQuery?: unknown) => {
      if (api === "get" || api === "delete" || api === "agileGet" || api === "agileDelete") {
        calls.push({ api, path, query: bodyOrQuery });
      } else {
        calls.push({ api, path, body: bodyOrQuery, query: maybeQuery });
      }
      return Promise.resolve(ret);
    });
  const client = {
    get: record("get"),
    post: record("post"),
    put: record("put"),
    delete: record("delete"),
    agileGet: record("agileGet"),
    agilePost: record("agilePost"),
    agilePut: record("agilePut"),
    agileDelete: record("agileDelete"),
  } as unknown as JiraClient;
  return { client, calls, setReturn: (v: unknown) => { ret = v; } };
}

// --- Manifest coverage -------------------------------------------------

describe("v2 tool registry — manifest coverage", () => {
  it("every action's operation references a real manifest entry", () => {
    const declared = new Set(operations.map((o) => o.name));
    const orphans: string[] = [];
    for (const tool of allConsolidatedTools) {
      for (const [actionName, def] of Object.entries(tool.actions)) {
        if (!declared.has(def.operation)) {
          orphans.push(`${tool.name}.${actionName} → ${def.operation}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });
});

// --- jira_issue --------------------------------------------------------

describe("jira_issue", () => {
  it("get → GET /issue/{key}", async () => {
    const ctx = makeMockClient();
    ctx.setReturn({ id: "1", key: "PROJ-1", fields: { summary: "x", labels: [], description: null } });
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "get",
      issueIdOrKey: "PROJ-1",
      fields: "summary,status",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/issue/PROJ-1",
      query: { fields: "summary,status" },
    });
  });

  it("create → POST /issue with body", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "create",
      fields: { project: { key: "PROJ" }, issuetype: { name: "Bug" }, summary: "Boom" },
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue",
      body: { fields: { project: { key: "PROJ" }, issuetype: { name: "Bug" }, summary: "Boom" } },
    });
  });

  it("update → PUT /issue/{key} with body and query notify", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "update",
      issueIdOrKey: "PROJ-1",
      fields: { summary: "New" },
      notifyUsers: false,
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "put",
      path: "/issue/PROJ-1",
      body: { fields: { summary: "New" } },
      query: { notifyUsers: false },
    });
  });

  it("delete → DELETE /issue/{key} with deleteSubtasks query", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "delete",
      issueIdOrKey: "PROJ-1",
      deleteSubtasks: true,
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "delete",
      path: "/issue/PROJ-1",
      query: { deleteSubtasks: true },
    });
  });

  it("transition → POST /issue/{key}/transitions with body", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "transition",
      issueIdOrKey: "PROJ-1",
      transition: { id: "31" },
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue/PROJ-1/transitions",
      body: { transition: { id: "31" } },
    });
  });

  it("assign → PUT /issue/{key}/assignee", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "assign",
      issueIdOrKey: "PROJ-1",
      accountId: "acc1",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "put",
      path: "/issue/PROJ-1/assignee",
      body: { accountId: "acc1" },
    });
  });

  it("changelog → GET /issue/{key}/changelog with paging", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "changelog",
      issueIdOrKey: "PROJ-1",
      startAt: 0,
      maxResults: 50,
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/issue/PROJ-1/changelog",
      query: { startAt: 0, maxResults: 50 },
    });
  });

  it("listTransitions → GET /issue/{key}/transitions", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "listTransitions",
      issueIdOrKey: "PROJ-1",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/issue/PROJ-1/transitions",
    });
  });

  it("bulkCreate → POST /issue/bulk with body", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraIssue, operations, ctx.client, {
      action: "bulkCreate",
      issueUpdates: [{ fields: { summary: "a" } }, { fields: { summary: "b" } }],
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue/bulk",
      body: { issueUpdates: [{ fields: { summary: "a" } }, { fields: { summary: "b" } }] },
    });
  });
});

// --- jira_search -------------------------------------------------------

describe("jira_search", () => {
  it("issues → GET /search/jql with JQL in query", async () => {
    const ctx = makeMockClient();
    ctx.setReturn({ total: 0, startAt: 0, maxResults: 50, issues: [] });
    await dispatchTool(jiraSearch, operations, ctx.client, {
      action: "issues",
      jql: "project = PROJ",
      maxResults: 25,
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/search/jql",
      query: { jql: "project = PROJ", maxResults: 25 },
    });
  });

  it("jqlAutocompleteData → GET /jql/autocompletedata", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraSearch, operations, ctx.client, {
      action: "jqlAutocompleteData",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/jql/autocompletedata",
    });
  });

  it("jqlSuggestions → GET /jql/autocompletedata/suggestions", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraSearch, operations, ctx.client, {
      action: "jqlSuggestions",
      fieldName: "status",
      fieldValue: "In",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/jql/autocompletedata/suggestions",
      query: { fieldName: "status", fieldValue: "In" },
    });
  });
});

// --- jira_comment ------------------------------------------------------

describe("jira_comment", () => {
  it("list → GET /issue/{key}/comment", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraComment, operations, ctx.client, {
      action: "list",
      issueIdOrKey: "PROJ-1",
      maxResults: 100,
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/issue/PROJ-1/comment",
      query: { maxResults: 100 },
    });
  });

  it("add → POST /issue/{key}/comment", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraComment, operations, ctx.client, {
      action: "add",
      issueIdOrKey: "PROJ-1",
      body: { type: "doc", version: 1, content: [] },
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue/PROJ-1/comment",
      body: { body: { type: "doc", version: 1, content: [] } },
    });
  });

  it("update → PUT /issue/{key}/comment/{commentId}", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraComment, operations, ctx.client, {
      action: "update",
      issueIdOrKey: "PROJ-1",
      commentId: "10001",
      body: "edited",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "put",
      path: "/issue/PROJ-1/comment/10001",
      body: { body: "edited" },
    });
  });

  it("delete → DELETE /issue/{key}/comment/{commentId}", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraComment, operations, ctx.client, {
      action: "delete",
      issueIdOrKey: "PROJ-1",
      commentId: "10001",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "delete",
      path: "/issue/PROJ-1/comment/10001",
    });
  });
});

// --- jira_user ---------------------------------------------------------

describe("jira_user", () => {
  it("myself → GET /myself", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraUser, operations, ctx.client, { action: "myself" });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/myself" });
  });

  it("get → GET /user with accountId query", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraUser, operations, ctx.client, {
      action: "get",
      accountId: "acc1",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/user",
      query: { accountId: "acc1" },
    });
  });

  it("search → GET /user/search", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraUser, operations, ctx.client, {
      action: "search",
      query: "alice",
      maxResults: 10,
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/user/search",
      query: { query: "alice", maxResults: 10 },
    });
  });

  it("assignable → GET /user/assignable/search", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraUser, operations, ctx.client, {
      action: "assignable",
      project: "PROJ",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/user/assignable/search",
      query: { project: "PROJ" },
    });
  });

  it("bulkGet → GET /user/bulk with array accountId joined by comma", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraUser, operations, ctx.client, {
      action: "bulkGet",
      accountId: ["a", "b", "c"],
    });
    // The dispatcher joins arrays with commas (Jira convention).
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/user/bulk",
      query: { accountId: "a,b,c" },
    });
  });
});

// =====================================================================
// Tools added in PR #7c
// =====================================================================
//
// These cover the trickiest action of each new tool plus one verb
// variant. The manifest-coverage test above already guarantees every
// action references a valid operation; these tests verify the
// dispatch layer's request shape for the more interesting paths.

// --- jira_project ------------------------------------------------------

describe("jira_project", () => {
  it("get → GET /project/{idOrKey}", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraProject, operations, ctx.client, {
      action: "get",
      projectIdOrKey: "PROJ",
    });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/project/PROJ" });
  });

  it("create → POST /project with body", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraProject, operations, ctx.client, {
      action: "create",
      key: "NEW",
      name: "New Project",
      projectTypeKey: "software",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/project",
      body: { key: "NEW", name: "New Project", projectTypeKey: "software" },
    });
  });

  it("createVersion → POST /version (not /project/.../versions)", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraProject, operations, ctx.client, {
      action: "createVersion",
      projectId: "10000",
      name: "v1.0",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/version",
      body: { projectId: "10000", name: "v1.0" },
    });
  });
});

// --- jira_board (Agile) -----------------------------------------------

describe("jira_board", () => {
  it("get → agileGet /board/{id}", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraBoard, operations, ctx.client, {
      action: "get",
      boardId: 42,
    });
    expect(ctx.calls[0]).toMatchObject({ api: "agileGet", path: "/board/42" });
  });

  it("backlog → agileGet /board/{id}/backlog", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraBoard, operations, ctx.client, {
      action: "backlog",
      boardId: 42,
      jql: "status = 'To Do'",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "agileGet",
      path: "/board/42/backlog",
      query: { jql: "status = 'To Do'" },
    });
  });
});

// --- jira_sprint (Agile) ----------------------------------------------

describe("jira_sprint", () => {
  it("listForBoard → agileGet /board/{id}/sprint with state filter", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraSprint, operations, ctx.client, {
      action: "listForBoard",
      boardId: 7,
      state: "active",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "agileGet",
      path: "/board/7/sprint",
      query: { state: "active" },
    });
  });

  it("moveIssues → agilePost /sprint/{id}/issue", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraSprint, operations, ctx.client, {
      action: "moveIssues",
      sprintId: 100,
      issues: ["PROJ-1", "PROJ-2"],
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "agilePost",
      path: "/sprint/100/issue",
      body: { issues: ["PROJ-1", "PROJ-2"] },
    });
  });

  it("moveIssuesToBacklog → agilePost /backlog/issue", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraSprint, operations, ctx.client, {
      action: "moveIssuesToBacklog",
      issues: ["PROJ-1"],
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "agilePost",
      path: "/backlog/issue",
      body: { issues: ["PROJ-1"] },
    });
  });
});

// --- jira_epic (Agile) ------------------------------------------------

describe("jira_epic", () => {
  it("get → agileGet /epic/{key}", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraEpic, operations, ctx.client, {
      action: "get",
      epicIdOrKey: "PROJ-EP-1",
    });
    expect(ctx.calls[0]).toMatchObject({ api: "agileGet", path: "/epic/PROJ-EP-1" });
  });

  it("removeFromCurrent → agilePost /epic/none/issue (no path param)", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraEpic, operations, ctx.client, {
      action: "removeFromCurrent",
      issues: ["PROJ-1", "PROJ-2"],
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "agilePost",
      path: "/epic/none/issue",
      body: { issues: ["PROJ-1", "PROJ-2"] },
    });
  });
});

// --- jira_worklog ------------------------------------------------------

describe("jira_worklog", () => {
  it("add → POST with mixed body and query (adjustEstimate is query)", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraWorklog, operations, ctx.client, {
      action: "add",
      issueIdOrKey: "PROJ-1",
      timeSpent: "2h",
      adjustEstimate: "auto",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue/PROJ-1/worklog",
      body: { timeSpent: "2h" },
      query: { adjustEstimate: "auto" },
    });
  });

  it("delete → DELETE with increaseBy query", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraWorklog, operations, ctx.client, {
      action: "delete",
      issueIdOrKey: "PROJ-1",
      worklogId: "10001",
      increaseBy: "1h",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "delete",
      path: "/issue/PROJ-1/worklog/10001",
      query: { increaseBy: "1h" },
    });
  });
});

// --- jira_attachment ---------------------------------------------------

describe("jira_attachment", () => {
  it("get → GET /attachment/{id}", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraAttachment, operations, ctx.client, {
      action: "get",
      attachmentId: "5001",
    });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/attachment/5001" });
  });

  it("meta → GET /attachment/meta", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraAttachment, operations, ctx.client, { action: "meta" });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/attachment/meta" });
  });
});

// --- jira_filter -------------------------------------------------------

describe("jira_filter", () => {
  it("create → POST /filter with body", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraFilter, operations, ctx.client, {
      action: "create",
      name: "My Bugs",
      jql: "assignee = currentUser() AND issuetype = Bug",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/filter",
      body: { name: "My Bugs", jql: "assignee = currentUser() AND issuetype = Bug" },
    });
  });

  it("listFavourite → GET /filter/favourite", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraFilter, operations, ctx.client, { action: "listFavourite" });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/filter/favourite" });
  });
});

// --- jira_link ---------------------------------------------------------

describe("jira_link", () => {
  it("create → POST /issueLink", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraLink, operations, ctx.client, {
      action: "create",
      type: { name: "Blocks" },
      inwardIssue: { key: "PROJ-1" },
      outwardIssue: { key: "PROJ-2" },
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issueLink",
      body: {
        type: { name: "Blocks" },
        inwardIssue: { key: "PROJ-1" },
        outwardIssue: { key: "PROJ-2" },
      },
    });
  });

  it("types → GET /issueLinkType", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraLink, operations, ctx.client, { action: "types" });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/issueLinkType" });
  });
});

// --- jira_watcher ------------------------------------------------------

describe("jira_watcher", () => {
  it("add → POST /issue/{key}/watchers with rawString body", async () => {
    // Regression test for the manifest's bodyShape: "rawString" — the
    // dispatcher must forward the accountId string, not wrap it.
    const ctx = makeMockClient();
    await dispatchTool(jiraWatcher, operations, ctx.client, {
      action: "add",
      issueIdOrKey: "PROJ-1",
      accountId: "acc123",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue/PROJ-1/watchers",
      body: "acc123",
    });
  });

  it("remove → DELETE /issue/{key}/watchers with accountId in query", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraWatcher, operations, ctx.client, {
      action: "remove",
      issueIdOrKey: "PROJ-1",
      accountId: "acc123",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "delete",
      path: "/issue/PROJ-1/watchers",
      query: { accountId: "acc123" },
    });
  });

  it("addVote → POST /issue/{key}/votes (no body)", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraWatcher, operations, ctx.client, {
      action: "addVote",
      issueIdOrKey: "PROJ-1",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue/PROJ-1/votes",
    });
  });
});

// --- jira_field --------------------------------------------------------

describe("jira_field", () => {
  it("list → GET /field", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraField, operations, ctx.client, { action: "list" });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/field" });
  });

  it("createMeta → GET /issue/createmeta with query", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraField, operations, ctx.client, {
      action: "createMeta",
      projectKeys: "PROJ",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/issue/createmeta",
      query: { projectKeys: "PROJ" },
    });
  });
});

// --- jira_group --------------------------------------------------------

describe("jira_group", () => {
  it("members → GET /group/member with groupId", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraGroup, operations, ctx.client, {
      action: "members",
      groupId: "g-1",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/group/member",
      query: { groupId: "g-1" },
    });
  });

  it("myPermissions → GET /mypermissions (cross-category: maps to permissions.mine)", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraGroup, operations, ctx.client, {
      action: "myPermissions",
      projectKey: "PROJ",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/mypermissions",
      query: { projectKey: "PROJ" },
    });
  });
});

// --- jira_server -------------------------------------------------------

describe("jira_server", () => {
  it("info → GET /serverInfo", async () => {
    const ctx = makeMockClient();
    await dispatchTool(jiraServer, operations, ctx.client, { action: "info" });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/serverInfo" });
  });
});
