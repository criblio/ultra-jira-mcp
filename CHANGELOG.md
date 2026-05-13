# Changelog

All notable changes to ultra-jira-mcp are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased — code-api shifts from TypeScript stubs to a CLI

### Changed

- **code-api mode now ships a `jira-cli` shell binary instead of a directory of TypeScript stubs.** The MCP `jira_code_api` tool returns the binary's path and the `JIRA_MCP_SOCKET` address; the agent invokes Jira as `node <cli-path> <op> --flag=value` from any shell. Trim + ref behaviour and the IPC bridge protocol are unchanged.
- **Why**: real first-use sessions repeatedly tripped on `npx tsx -e '...'` quirks — top-level await unsupported under tsx's CJS target, and tsx's `.js` → `.ts` resolver skipping paths under `/node_modules/` (which is where every install lives). The CLI handoff collapses Bash → npx → tsx → esbuild → node → import resolution → IPC down to Bash → binary → IPC.
- **Tool-list cost**: ~95 tokens → ~100 tokens. Slight bump because the new usage string includes a discovery hint and the subtask-JQL gotcha. Per-call cost unchanged.

### Added

- **Direct mode** in `jira-cli`: when `JIRA_MCP_SOCKET` is unset, the CLI reads `JIRA_HOST` / `JIRA_EMAIL` / `JIRA_API_TOKEN` from its own environment (or `.env.local`), builds a `JiraClient` in-process, and dispatches through the same trim + sandbox helper the bridge uses on the server side. Lets users run `npx -y -p github:scottlepp/jira-mcp#codeapi jira-cli <op>` without standing up the MCP server.
- **`jira-cli install-skill`** writes `~/.claude/skills/jira/SKILL.md` so Claude Code agents discover the CLI in standalone (no-MCP) sessions. Refuses to clobber without `--force`; `--print` dumps the rendered SKILL.md to stdout.
- **`jira-cli` is published as a second `bin` entry** in `package.json`. `npm i -g jira-mcp` exposes both binaries.

### Removed

- **`build/api/` and the stub generator.** Replaced by the CLI; the stub-generation step is gone from `npm run build` (`tsc` only now). `apiDir` and `rootIndex` are dropped from the `jira_code_api` response in favor of `cli`.

## v2.0.0 — Context-efficient rewrite

**Breaking change.** v1 stays maintained on the [`1.x`](https://github.com/scottlepp/jira-mcp/tree/1.x) branch. See [docs/MIGRATION.md](docs/MIGRATION.md) for the upgrade path.

### Why

v1 loaded ~30KB / ~7,800 tokens of MCP tool definitions before the agent read a single user message, and individual tool calls dumped 50–100KB of raw Jira JSON straight into context. v2 is a clean rewrite around two patterns from Anthropic's MCP guidance: response sandboxing (write the full payload to disk, return a trimmed summary plus a `ref`) and an optional code-execution surface (one tool, an on-disk TypeScript API the agent drives via `tsx`).

### Token-budget benchmark

Numbers below are from a real Jira instance, measured by `npm run benchmark` against the same set of tickets in each mode. "Bytes" is JSON delivered to the agent's context window; tokens are bytes/4 (close enough across Anthropic and OpenAI tokenizers for a relative comparison). Full v1-vs-v2 head-to-head numbers (per-call ratios, three scenarios) live in [docs/BENCHMARK.md](docs/BENCHMARK.md).

**Tool listing (paid every conversation):**

| mode / filter | bytes | ~tokens |
|---|---|---|
| classic, no filter (16 tools) | 30.6KB | ~7,800 |
| classic + 3-category filter | 6.3KB | ~1,600 |
| classic + 3 categories + 5 disabled actions | 4.6KB | ~1,200 |
| code-api (1 tool) | 0.4KB | ~95 |

**Per-call (selected scenarios, both modes after PR #180's list trims):**

| scenario | classic | code-api `summary` | code-api `+full` |
|---|---|---|---|
| fetch 1 simple ticket | 1.1KB | 1.3KB | 43.4KB |
| investigate rich ticket (26 comments) | 2.8KB | 3.1KB | 418KB |
| JQL search ~10 tickets | 3.4KB | 3.6KB | 28.7KB |

`code-api +full` is the upper bound where the agent reads every `ref` file. Real sessions land between the `summary` and `+full` columns based on how much detail the agent actually needs.

### Added

- **Consolidated tool surface.** v1's 85 tools collapse into 16 action-discriminated tools (`jira_issue` with `action: "get"`, etc.). One tool per Jira category. See [docs/MIGRATION.md](docs/MIGRATION.md) for the full v1→v2 mapping.
- **Response sandbox.** Every Jira API response runs through `sandbox()`, which writes the full body to `${TMPDIR}/jira-mcp/${session}/<kind>/<hash>.json` and returns a `{summary, ref, hash, fullSize, fetchedAt}` envelope. Sessions older than 24 hours are swept on startup.
- **List endpoint trims.** Paginated list responses (`comment.list`, `worklog.list`, `board.issues`, `sprint.issues`, etc.) emit `{total, startAt, maxResults, truncated}` only — no inline items. The full body is in the ref. Reduced rich-ticket investigation from 84.8KB to 2.8KB classic / 3.1KB code-api summary on the benchmark.
- **`JIRA_TOOL_MODE` env var.** `"classic"` (default) keeps the 16 consolidated tools. `"code-api"` exposes a single `jira_code_api` tool that hands the agent the path to a generated TypeScript API on disk; the agent drives Jira from a shell using `tsx` and an IPC bridge. Useful for sessions that compose many calls.
- **`JIRA_DISABLED_ACTIONS` env var.** Comma-separated list of `category.action` operation names. Enforced at the manifest dispatch layer in **both** modes — a destructive op disabled here can't be reached through the bridge in code-api mode either.
- **`JIRA_ENABLED_CATEGORIES` (carried forward from v1).** Now matches the consolidated tool name suffixes; one rename from v1 (`issueLink` → `link`).
- **`scripts/benchmark.ts`** for measuring token-budget against live Jira. `npm run benchmark`.
- **Eager attachment download.** When an issue is fetched, attachments stream to `${TMPDIR}/jira-mcp/${session}/issues/<key>/attachments/<filename>`. Agents read with Claude Code's `Read` tool.
- **HTTP pooling and 429 backoff.** undici-backed connection pool replaces v1's per-call native `fetch`. Cloud-ID and metadata results are LRU-cached.

### Changed

- **Default `JIRA_TOOL_MODE` is `"classic"`.** Earlier v2 alphas defaulted to `"code-api"`; the benchmark showed classic ties or beats it on per-call cost once list trims landed (PR #180), so the simpler agent UX wins for the common case.
- **`JIRA_DISABLED_TOOLS` is renamed to `JIRA_DISABLED_ACTIONS`** and takes manifest operation names (`issue.delete`) instead of v1 tool names (`jira_delete_issue`).
- **Response shape**: tools no longer return raw Jira JSON. See "Added: Response sandbox" above and the migration guide.
- **Engine requirement bumped to Node ≥20.** v1's `>=18.0.0` was kept on the `1.x` branch.

### Removed

- **`jira_get_attachment_content`.** The binary downloader still runs (eagerly, on issue fetch) but isn't exposed as an MCP tool. Files land at `${TMPDIR}/jira-mcp/${session}/issues/<key>/attachments/<filename>`.

### Internal

- TypeScript moved to strict mode, `module: "Node16"`. New `src/codeapi/` directory housing the generator (`generator.ts`), the IPC bridge (`bridge.ts`), the bootstrap glue (`boot.ts`), and the consolidated MCP tool definition (`tool.ts`).
- 380+ unit tests. Integration tests run against live Jira with `npm run test:integration`.

---

## v1.x

For v1 release notes, see the [`1.x` branch's CHANGELOG or release tags](https://github.com/scottlepp/jira-mcp/releases).
