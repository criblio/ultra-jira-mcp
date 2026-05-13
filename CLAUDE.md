# jira-mcp — agent guide

Token-efficient MCP server **and** CLI for Jira Cloud. Built on
`@scottlepper/mcp-toolkit` — generic MCP plumbing lives in the toolkit;
this repo owns Jira-specific code only.

## Layout

- `src/index.ts` — MCP stdio server entry. Wires the two modes
  (classic / code-api) to the toolkit's `startStdioServer`.
- `src/cli/index.ts` — `jira-cli` entry. Delegates argv parsing, help,
  bridge round-trip, and `install-skill` to `mcp-toolkit/cli`.
- `src/core/operations.ts` — the operation manifest. One entry per
  Jira REST/Agile endpoint. Both classic tools and code-api dispatch
  read from this single source of truth.
- `src/core/manifest.ts` — Jira extensions to the toolkit's generic
  manifest (the `isAgile` flag, agile-path routing, trim wiring).
- `src/core/trim.ts` + `trim-registry.ts` — response trimmers. Each
  Jira endpoint that returns bulky data has a trim that produces the
  `IssueSummary`-style object the agent reads on stdout; the full
  response is written to disk and referenced by `ref: /path`.
- `src/tools/v2/*.ts` — the 16 consolidated classic tools, one per
  category. Each is a thin `oneOf` dispatcher over a slice of the
  manifest.
- `src/codeapi/` — code-api mode. `boot.ts` starts the bridge,
  `bridge.ts` is the JSON-over-unix-socket transport between the CLI
  and the server, `tool.ts` is the single `jira_code_api` MCP tool.
- `src/auth/jira-client.ts` — the only place that opens HTTP
  connections to Jira. Anything else that needs to call Jira goes
  through this.
- `tests/` — vitest, ~400 unit tests, no live Jira required. Mirrors
  `src/` layout.
- `docs/BENCHMARK.md`, `docs/MIGRATION.md` — design rationale and
  numbers. Read these before changing the tool surface.

## Mental model

Three layers serve every request:

1. **Manifest** (`core/operations.ts`) — declarative description of the
   Jira call (path, verb, param roles, optional trim key).
2. **Dispatcher** (`core/manifest.ts` → `invokeOperation`) — turns a
   manifest entry + args into an HTTP call via `JiraClient`, then
   applies the trim and sandboxes the full response.
3. **Surface** — either a consolidated classic tool
   (`src/tools/v2/<category>.ts`) or the code-api `jira_code_api` tool
   (`src/codeapi/tool.ts`). Both call into layer 2.

If you need to add a Jira endpoint, the work is almost always: add a
manifest entry, add a trim if the response is bulky, route the new
action from the relevant `tools/v2/<category>.ts` dispatcher. The
toolkit handles schema generation, help rendering, and CLI flag
parsing for free.

## Two modes — pick the right one

- **classic** (default) — 16 MCP tools, each `oneOf` of actions.
  Right for tool-only MCP clients (no shell).
- **code-api** — one MCP tool that hands the agent a path to
  `jira-cli` and a unix socket. The agent then drives Jira from the
  shell. 76× smaller tool-list footprint; requires a shell-capable
  agent.

The CLI is also the **standalone surface** — set the JIRA env vars
and `npx jira-cli <op>` works without any MCP server in the picture.

## What lives where (toolkit vs. this repo)

This split was the entire point of [PR #210](https://github.com/scottlepp/jira-mcp/pull/210)
(toolkit migration). Don't blur it:

- **In `@scottlepper/mcp-toolkit`**: vendor-agnostic primitives —
  stdio transport, manifest type + dispatcher, generic CLI builder
  (`createCli`), bridge socket protocol, response sandboxing,
  install-skill writer.
- **In this repo**: anything Jira-shaped — operations manifest,
  trim functions, ADF (Atlassian Document Format) handling, JQL
  helpers, Jira client + auth, mode-specific server wiring.

If you find yourself writing something generic in `src/`, check
whether it belongs in the toolkit first. The reverse is also true: do
not push Jira-shaped logic (ADF, JQL parsing, issue-type validation)
into the toolkit.

## Workflows

```bash
npm install
npm run build           # tsc → build/
npm test                # vitest, no live Jira
npm run test:watch      # iterate on a file
npm run inspector       # @modelcontextprotocol/inspector against build/index.js
npm run benchmark       # measures tool-list + per-call bytes; needs .env.local
npm run install-skill   # installs the user-facing Jira skill from this checkout
```

For changes that touch the operation manifest, the consolidated tool
schemas, or the trim layer, run `npm run benchmark` and update
`docs/BENCHMARK.md` with the new numbers if they shifted materially.

## Skills

- **User-facing** (`src/cli/install-skill.ts` → `~/.claude/skills/jira/`):
  teaches any Claude Code session how to drive `jira-cli`. Installed
  via `npm run install-skill` from a local checkout or
  `npx -y -p github:scottlepp/jira-mcp#codeapi jira-cli install-skill`.
- **Contributor** (`.claude/skills/jira-mcp-dev/`): auto-loaded when
  working inside this repo. Teaches the layered architecture, the
  toolkit boundary, and where to add new operations.

## Conventions

- Imports use the `.js` extension (TypeScript NodeNext resolution).
- Comments explain **why**, not what. Lean toward fewer, denser
  comments — the explanation of a non-obvious design choice is worth
  preserving; restating the code in English is not.
- Tests sit next to the layer they cover (`tests/core/`, `tests/cli/`,
  `tests/codeapi/`, `tests/tools/`). New manifest entries get a
  smoke test that exercises the dispatcher path; new trims get a
  fixture-based unit test.
- Don't reach into `node_modules/@scottlepper/mcp-toolkit/` to patch
  toolkit code from this repo. If the toolkit needs a change, change
  it there.
