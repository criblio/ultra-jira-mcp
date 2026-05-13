# Ultra Jira MCP Server/CLI

A Token Efficient, Low Context, Model Context Protocol (MCP) server or CLI that gives AI agents access to Jira Cloud via the REST API v3 and Agile API 1.0.

## Installation

```bash
npx jira-mcp
```

Or globally:

```bash
npm install -g jira-mcp
```

## Configuration

Set these environment variables on the server process. With Claude Desktop or Claude Code that means the `env` block on the MCP server config.

| Variable | Description | Required |
|---|---|---|
| `JIRA_HOST` | Jira instance URL (e.g. `https://yourcompany.atlassian.net`) | Yes |
| `JIRA_EMAIL` | Atlassian account email | Yes |
| `JIRA_API_TOKEN` | API token from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens) | Yes |
| `JIRA_CLOUD_ID` | Cloud ID for scoped (ATATT/ATSTT) tokens; auto-fetched if omitted | No |
| `JIRA_TOOL_MODE` | `"classic"` (default — 16 consolidated tools) or `"code-api"` (one tool, agent drives via the bundled `jira-cli` shell binary) | No |
| `JIRA_ENABLED_CATEGORIES` | Comma-separated category whitelist. Empty = all 16 categories enabled. | No |
| `JIRA_DISABLED_ACTIONS` | Comma-separated `category.action` blacklist. Enforced at the dispatch layer in **both** modes. | No |

### Claude Desktop / Claude Code setup

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or your `~/.claude.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-mcp"],
      "env": {
        "JIRA_HOST": "https://yourcompany.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Tool surface

Default mode is **classic**: 16 consolidated MCP tools, each taking an `action` argument plus action-specific args. For example `jira_issue` covers `get`, `create`, `update`, `delete`, `bulkCreate`, `listTransitions`, `transition`, `assign`, `changelog` — discriminated by `action: "..."`.

### The 16 tools and their actions

| Tool | Actions |
|---|---|
| `jira_issue` | get, create, update, delete, bulkCreate, listTransitions, transition, assign, changelog |
| `jira_search` | issues, jqlAutocompleteData, jqlSuggestions |
| `jira_comment` | list, add, update, delete |
| `jira_user` | myself, search, get, assignable, bulkGet |
| `jira_project` | list, get, create, update, delete, listComponents, createComponent, listVersions, createVersion, updateVersion, statuses |
| `jira_board` | list, get, create, delete, configuration, issues, backlog, epics |
| `jira_sprint` | listForBoard, get, create, update, delete, issues, moveIssues, moveIssuesToBacklog |
| `jira_epic` | get, issues, moveIn, removeFromCurrent |
| `jira_worklog` | list, add, update, delete |
| `jira_attachment` | get, delete, meta |
| `jira_filter` | list, get, create, update, delete, listFavourite |
| `jira_link` | create, get, delete, types |
| `jira_watcher` | list, add, remove, listVotes, addVote, removeVote |
| `jira_field` | list, issueTypes, priorities, statuses, resolutions, createMeta |
| `jira_group` | search, members, myPermissions |
| `jira_server` | info |

Every action returns a trimmed summary (e.g. `IssueSummary` with key, status, assignee, recent comments, attachment list) plus the full untrimmed body written to disk under `${TMPDIR}/jira-mcp/${session}/`. Agents read the full response only when they need the detail.

### Tool filtering

Two env vars cut the tool-list cost paid every conversation:

```json
"env": {
  "JIRA_ENABLED_CATEGORIES": "issue,search,comment",
  "JIRA_DISABLED_ACTIONS": "issue.delete,project.delete"
}
```

- `JIRA_ENABLED_CATEGORIES` — whitelist of consolidated tool categories (the part after `jira_`). Tools outside the whitelist drop from the listing.
- `JIRA_DISABLED_ACTIONS` — `category.action` pairs (manifest operation names like `issue.delete`, `permissions.mine`, `vote.add`). Disabled actions are stripped from each tool's `oneOf` schema **and** rejected at dispatch time, so they're blocked even in code-api mode.

Concrete numbers from a recent benchmark run on a real Jira instance:

| filter | tool-list bytes | ~tokens | factor |
|---|---|---|---|
| none (16 tools) | 30.6KB | ~7,800 | 1× |
| 3 categories | 6.3KB | ~1,600 | 5× |
| 3 cats + 5 disabled actions | 4.6KB | ~1,200 | 6.6× |
| code-api mode (1 tool) | 0.4KB | ~100 | 76× |

For the full v1-vs-v2 picture (per-call cost, three scenarios, ratios) see [docs/BENCHMARK.md](docs/BENCHMARK.md).

### code-api mode (recommended for shell-capable agents)

If your agent can run shell commands (Claude Code, etc.), set `JIRA_TOOL_MODE=code-api` for a ~76× smaller tool-list footprint paid on every conversation. Per-call cost is essentially the same as classic, so the savings are pure win once your agent is making more than a few Jira calls.

Set `JIRA_TOOL_MODE=code-api` to expose a single MCP tool, `jira_code_api`. Calling it returns the path to the bundled `jira-cli` binary plus the `JIRA_MCP_SOCKET` address. The agent then drives Jira from a shell:

```bash
JIRA_MCP_SOCKET=/tmp/jira-mcp/${session}/ipc.sock \
  node <cli-path> issue.get --issueIdOrKey=PROJ-1
# stdout: trimmed summary as JSON, then a final `ref: /path` line
# pointing at the full response on disk (`cat` it for detail).
```

Discovery: `node <cli-path> --help` lists every operation; `node <cli-path> <op> --help` lists its flags.

Stays as `classic` by default because tool-only MCP clients (no shell access) can't drive `jira-cli`. See [docs/MIGRATION.md](docs/MIGRATION.md#code-api-mode) for the full flow.

### Standalone CLI (no MCP server)

The same `jira-cli` binary works without an MCP server. Set `JIRA_HOST` / `JIRA_EMAIL` / `JIRA_API_TOKEN` in your shell (or a `.env.local` in the cwd) and invoke it directly:

```bash
export JIRA_HOST=https://yourcompany.atlassian.net
export JIRA_EMAIL=you@example.com
export JIRA_API_TOKEN=...
npx -y -p github:scottlepp/jira-mcp#codeapi jira-cli issue.get --issueIdOrKey=PROJ-1
```

The CLI auto-selects between **bridge mode** (`JIRA_MCP_SOCKET` set, talks to a running server) and **direct mode** (no socket, builds a `JiraClient` in-process). Same trim + ref output either way; credentials never leave the CLI's `process.env`, so they don't enter the agent's context.

For Claude Code users, install the skill once so the agent discovers the CLI on its own:

```bash
npx -y -p github:scottlepp/jira-mcp#codeapi jira-cli install-skill
```

This writes `~/.claude/skills/jira/SKILL.md`. The skill loads on demand whenever the user mentions Jira and teaches the agent the canonical invocation, common operations, and `--help` discovery. Re-run with `--force` to update; `--print` dumps the rendered SKILL.md to stdout without writing.

## Resources

The server also exposes Jira data via MCP resources:

- `jira://projects` — list of accessible projects
- `jira://project/{key}` — project details
- `jira://issue/{key}` — issue details
- `jira://boards` — all boards
- `jira://board/{id}` — board details
- `jira://sprint/{id}` — sprint details
- `jira://myself` — current user

## Development

```bash
npm install
npm run build           # tsc → build/
npm test                # vitest, ~400 unit tests, no live Jira
npm run benchmark       # measures tool-list + per-call bytes against live Jira
npm run inspector       # @modelcontextprotocol/inspector against build/index.js
```

The benchmark requires `.env.local` with the regular `JIRA_*` vars plus `JIRA_BENCH_TICKET_RICH` and `JIRA_BENCH_TICKET_SIMPLE` keys. To include v1 in the comparison, set up a sibling worktree once: `git worktree add ../jira-mcp-v1 v1.0.0 && (cd ../jira-mcp-v1 && npm install && npm run build)`. See [docs/BENCHMARK.md](docs/BENCHMARK.md) for the latest numbers.

## License

MIT
