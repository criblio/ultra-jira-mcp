# Migrating from jira-mcp v1 to v2

v2 is a clean break, not a drop-in. Tools have new names, the response shape changed, and one env var got renamed. Most v1 users will spend a few minutes updating their MCP server config and then never need to think about it again. v1 is still maintained on the [`1.x` branch](https://github.com/scottlepp/jira-mcp/tree/1.x) if you'd rather stay there.

## What changed at a glance

- **85 tools → 16 consolidated tools.** Each v1 tool name like `jira_get_issue` becomes a `(tool, action)` pair: `jira_issue` with `action: "get"`. Tool-list cost drops from ~7,800 tokens to ~1,600–4,600 depending on how aggressively you filter (and to ~95 in the optional `code-api` mode).
- **Responses are now `{summary, ref, ...}` instead of raw Jira JSON.** The summary is a trimmed projection inline; the full untrimmed response is written to `${TMPDIR}/jira-mcp/${session}/` and the `ref` field points at it. Read the ref when you need detail. v1 returned the entire 50–100KB Jira payload.
- **`JIRA_DISABLED_TOOLS` is now `JIRA_DISABLED_ACTIONS`** and takes manifest operation names like `issue.delete` instead of v1 tool names like `jira_delete_issue`.
- **`JIRA_ENABLED_CATEGORIES` keeps working** with one rename: `issueLink` is now `link` (matches the v2 tool's name `jira_link`).
- **New optional env var: `JIRA_TOOL_MODE`** (`"classic"` default, `"code-api"` opt-in for power users). Most users should leave this unset.

## What you need to change

### Step 1: Tool calls

If you have any code, prompts, or stored sessions that name a v1 tool directly, update to the v2 shape.

**v1:**
```json
{ "name": "jira_get_issue", "arguments": { "issueIdOrKey": "PROJ-1" } }
```

**v2:**
```json
{ "name": "jira_issue", "arguments": { "action": "get", "issueIdOrKey": "PROJ-1" } }
```

The full mapping is at the bottom of this file. For most users this is a one-time edit if you've baked tool names into anything. For agents driving Jira through Claude, the agent reads the tool listing fresh each session and adapts automatically.

### Step 2: Update env vars

If you used `JIRA_DISABLED_TOOLS`, switch to `JIRA_DISABLED_ACTIONS` and translate the values:

| v1 (`JIRA_DISABLED_TOOLS`) | v2 (`JIRA_DISABLED_ACTIONS`) |
|---|---|
| `jira_delete_issue` | `issue.delete` |
| `jira_delete_project` | `project.delete` |
| `jira_delete_comment` | `comment.delete` |
| `jira_delete_attachment` | `attachment.delete` |
| `jira_delete_worklog` | `worklog.delete` |
| `jira_delete_issue_link` | `issueLink.delete` |

The format is `category.action`, where `category.action` is the **manifest operation name** — not the consolidated tool's category suffix. For most categories the two are the same (`issue.delete`, `project.delete`), but the `jira_link` tool is an exception:

- The consolidated tool is **`jira_link`**, so `JIRA_ENABLED_CATEGORIES` uses **`link`**.
- The underlying manifest operations are **`issueLink.create`**, **`issueLink.delete`**, etc., so `JIRA_DISABLED_ACTIONS` uses **`issueLink.delete`** — `link.delete` is silently ignored.

The same shape applies to operations folded into other tools: `JIRA_DISABLED_ACTIONS=permissions.mine` (exposed via `jira_group.myPermissions`), `JIRA_DISABLED_ACTIONS=vote.add` (exposed via `jira_watcher.addVote`). The full operation names live in [src/core/operations.ts](../src/core/operations.ts).

If you used `JIRA_ENABLED_CATEGORIES` with `issueLink`, change it to `link`. All other category names are unchanged.

### Step 3: Adjust to the new response shape (only if you wrote code that consumes the JSON)

For agents using Claude/Claude Code: nothing to do — Claude reads the new shape and adapts. For programmatic consumers:

**v1 response (raw Jira):**
```json
{ "id": "10001", "key": "PROJ-1", "fields": { "summary": "...", "status": {...}, "comment": { "comments": [...] }, ... } }
```

**v2 classic response (the default — what `jira_issue` etc. return through MCP):** the trim projection directly. No envelope, no `ref`. The full untrimmed body is *not* written to disk in classic mode.

```json
{
  "key": "PROJ-1",
  "id": "10001",
  "summary": "Login form crash on Safari",
  "status": "In Progress",
  "assignee": { "accountId": "...", "displayName": "..." },
  "priority": "High",
  "labels": [],
  "descriptionPreview": "...",
  "descriptionTruncated": false,
  "commentCount": 26,
  "recentComments": [...],
  "attachmentCount": 2,
  "attachments": [...]
}
```

Field names are stable across versions, so anything reading `result.key` / `result.status` keeps working with a smaller payload. List endpoints (e.g. `jira_comment.list`) return `{total, startAt, maxResults, truncated}` only — no inline items; rerun the call with different paging or use a more specific tool when you need the rows.

**v2 code-api response (only when `JIRA_TOOL_MODE=code-api`):** a `SandboxResult` envelope. Each call returns the trimmed projection in `summary` and a filesystem path to the full untrimmed body in `ref`.

```json
{
  "summary": { "key": "PROJ-1", "status": "In Progress", "assignee": {...}, ... },
  "ref": "/tmp/jira-mcp/abc123/issue-get/<hash>.json",
  "hash": "abc123def456...",
  "fullSize": 47823,
  "fetchedAt": "2026-05-05T12:34:56Z"
}
```

In code-api mode, `summary` carries the same shape as the classic top-level response. The agent reads `ref` (an absolute path to the full untrimmed Jira JSON) only when it needs fields the summary omits.

## Full tool name mapping

Source of truth: every v1 tool name in v1's README, mapped to its v2 equivalent.

### Issues → `jira_issue`

| v1 | v2 action |
|---|---|
| `jira_get_issue` | `get` |
| `jira_create_issue` | `create` |
| `jira_update_issue` | `update` |
| `jira_delete_issue` | `delete` |
| `jira_bulk_create_issues` | `bulkCreate` |
| `jira_get_issue_transitions` | `listTransitions` |
| `jira_transition_issue` | `transition` |
| `jira_assign_issue` | `assign` |
| `jira_get_issue_changelogs` | `changelog` |

### Search → `jira_search`

| v1 | v2 action |
|---|---|
| `jira_search_issues` | `issues` |
| `jira_get_jql_autocomplete` | `jqlAutocompleteData` *or* `jqlSuggestions` (v2 splits the two endpoints) |

### Projects → `jira_project`

| v1 | v2 action |
|---|---|
| `jira_list_projects` | `list` |
| `jira_get_project` | `get` |
| `jira_create_project` | `create` |
| `jira_update_project` | `update` |
| `jira_delete_project` | `delete` |
| `jira_get_project_components` | `listComponents` |
| `jira_create_component` | `createComponent` |
| `jira_get_project_versions` | `listVersions` |
| `jira_create_version` | `createVersion` |
| `jira_update_version` | `updateVersion` |
| `jira_get_project_statuses` | `statuses` |

### Users → `jira_user`

| v1 | v2 action |
|---|---|
| `jira_get_current_user` | `myself` |
| `jira_search_users` | `search` |
| `jira_get_user` | `get` |
| `jira_get_assignable_users` | `assignable` |
| `jira_bulk_get_users` | `bulkGet` |

### Boards → `jira_board`

| v1 | v2 action |
|---|---|
| `jira_list_boards` | `list` |
| `jira_get_board` | `get` |
| `jira_create_board` | `create` |
| `jira_delete_board` | `delete` |
| `jira_get_board_configuration` | `configuration` |
| `jira_get_board_issues` | `issues` |
| `jira_get_board_backlog` | `backlog` |
| `jira_get_board_epics` | `epics` |

### Sprints → `jira_sprint`

| v1 | v2 action |
|---|---|
| `jira_list_sprints` | `listForBoard` |
| `jira_get_sprint` | `get` |
| `jira_create_sprint` | `create` |
| `jira_update_sprint` | `update` |
| `jira_delete_sprint` | `delete` |
| `jira_get_sprint_issues` | `issues` |
| `jira_move_issues_to_sprint` | `moveIssues` |
| `jira_move_issues_to_backlog` | `moveIssuesToBacklog` |

### Epics → `jira_epic`

| v1 | v2 action |
|---|---|
| `jira_get_epic` | `get` |
| `jira_get_epic_issues` | `issues` |
| `jira_move_issues_to_epic` | `moveIn` |
| `jira_remove_issues_from_epic` | `removeFromCurrent` |

### Comments → `jira_comment`

| v1 | v2 action |
|---|---|
| `jira_get_comments` | `list` |
| `jira_add_comment` | `add` |
| `jira_update_comment` | `update` |
| `jira_delete_comment` | `delete` |

### Attachments → `jira_attachment`

| v1 | v2 action |
|---|---|
| `jira_get_attachment` | `get` |
| `jira_delete_attachment` | `delete` |
| `jira_get_attachment_meta` | `meta` |
| `jira_get_attachment_content` | *(removed — see note below)* |

`jira_get_attachment_content` (binary download) is no longer exposed as an MCP tool. The downloader still exists internally and runs eagerly when an issue is fetched: attachments land at `${TMPDIR}/jira-mcp/${session}/issues/${key}/attachments/${filename}`. Agents read them via Claude Code's `Read` tool when needed.

### Worklogs → `jira_worklog`

| v1 | v2 action |
|---|---|
| `jira_get_worklogs` | `list` |
| `jira_add_worklog` | `add` |
| `jira_update_worklog` | `update` |
| `jira_delete_worklog` | `delete` |

### Issue Links → `jira_link`

| v1 | v2 action |
|---|---|
| `jira_create_issue_link` | `create` |
| `jira_get_issue_link` | `get` |
| `jira_delete_issue_link` | `delete` |
| `jira_get_issue_link_types` | `types` |

(Note the tool renamed from `issueLink` in the manifest to `jira_link` for brevity.)

### Watchers and Voters → `jira_watcher`

| v1 | v2 action |
|---|---|
| `jira_get_watchers` | `list` |
| `jira_add_watcher` | `add` |
| `jira_remove_watcher` | `remove` |
| `jira_get_votes` | `listVotes` |
| `jira_add_vote` | `addVote` |
| `jira_remove_vote` | `removeVote` |

### Fields and Metadata → `jira_field`

| v1 | v2 action |
|---|---|
| `jira_get_fields` | `list` |
| `jira_get_issue_types` | `issueTypes` |
| `jira_get_priorities` | `priorities` |
| `jira_get_statuses` | `statuses` |
| `jira_get_resolutions` | `resolutions` |
| `jira_get_create_metadata` | `createMeta` |

### Filters → `jira_filter`

| v1 | v2 action |
|---|---|
| `jira_list_filters` | `list` |
| `jira_get_filter` | `get` |
| `jira_create_filter` | `create` |
| `jira_update_filter` | `update` |
| `jira_delete_filter` | `delete` |
| `jira_get_favourite_filters` | `listFavourite` |

### Groups and Permissions → `jira_group`

| v1 | v2 action |
|---|---|
| `jira_search_groups` | `search` |
| `jira_get_group_members` | `members` |
| `jira_get_my_permissions` | `myPermissions` |

### Server → `jira_server`

| v1 | v2 action |
|---|---|
| `jira_get_server_info` | `info` |

## code-api mode

`JIRA_TOOL_MODE=code-api` is an opt-in path that exposes a single MCP tool, `jira_code_api`, instead of the 16 consolidated tools. The agent calls it once to get the path of an on-disk TypeScript API and a shell snippet, then drives Jira through `tsx`:

```bash
JIRA_MCP_SOCKET=/tmp/jira-mcp/${session}/ipc.sock npx tsx -e '
  import * as jira from "/tmp/jira-mcp/${session}/api/index.js";
  const issue = await jira.issue.get({ issueIdOrKey: "PROJ-1" });
  console.log(issue.summary.status);
  // issue.ref is an absolute path to the full JSON; read it with fs when needed.
'
```

**When to use it:** sessions that compose many calls (jq filtering, multi-call investigations) where the per-call `JIRA_MCP_SOCKET=… npx tsx -e` overhead is amortized over many tool uses, or where the tool-list saving (~7,700 tokens vs classic) matters more than per-call simplicity.

**When not to:** one-off lookups. Classic mode is simpler for the agent and the trim/sandbox shape gives you most of the per-call savings anyway. Per the v2.0 [CHANGELOG](../CHANGELOG.md#v200) benchmark, classic and code-api summary modes land within ~10% of each other on per-call cost.

`JIRA_DISABLED_ACTIONS` is enforced in code-api mode too — disabled ops are blocked at the bridge dispatch layer before any HTTP call.

## Reporting issues with the migration

If you hit a v1 tool name that doesn't appear in the table above, or a v2 mapping that doesn't behave like its v1 ancestor, please file an issue at https://github.com/scottlepp/jira-mcp/issues with the v1 tool name and the args you were sending.
