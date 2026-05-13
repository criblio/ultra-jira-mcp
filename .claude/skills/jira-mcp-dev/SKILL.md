---
name: jira-mcp-dev
description: >-
  Contributor guidance for the jira-mcp repo itself — how to add a new
  Jira operation, where the toolkit boundary sits, which layer owns
  which concern, how to run tests and benchmarks. Use when modifying
  files under src/ or tests/ in this repo, NOT when calling Jira from
  another project (that's the `jira` skill).
---
# jira-mcp contributor skill

You are working inside the `jira-mcp` repo — the source of the
`jira-mcp` MCP server and `jira-cli` standalone CLI. This skill
teaches the architecture and the toolkit boundary so you don't have
to re-derive them on every task.

For a longer prose version, see [CLAUDE.md](../../../CLAUDE.md).

## The three layers

Every Jira call flows through the same three layers — internalize this
before touching anything in `src/`:

1. **Manifest** — `src/core/operations.ts` declares the endpoint
   (path, HTTP verb, param roles, optional `trim` key, optional
   `isAgile: true`).
2. **Dispatcher** — `src/core/manifest.ts` (`invokeOperation`) reads
   the manifest entry, builds the HTTP call via `JiraClient`,
   sandboxes the full response, and applies the trim.
3. **Surface** — either a consolidated classic tool
   (`src/tools/v2/<category>.ts` — one per category, each a `oneOf`
   dispatcher) or the single code-api tool (`src/codeapi/tool.ts`),
   which hands the agent a path to `jira-cli` and a unix socket.

The CLI (`src/cli/index.ts`) is a fourth surface that reads the same
manifest — same dispatcher, same trims, no MCP server required.

## Adding a new Jira operation

The common case. Steps, in order:

1. **Add a manifest entry** in `src/core/operations.ts`. Keep entries
   grouped by category section comment. Naming is `category.verb`
   where verb is logical, not HTTP (so `issue.transition`, not
   `issue.post`).
2. **Add a trim** if the response is bulky. Trims live in
   `src/core/trim.ts`; register the key in `trim-registry.ts`. The
   trim's job is to produce the small object the agent sees on
   stdout — everything else gets written to disk and referenced
   via `ref: /path`.
3. **Route the action** from the relevant
   `src/tools/v2/<category>.ts` dispatcher so classic-mode users get
   it. Code-api mode picks it up automatically from the manifest.
4. **Tests:** add a fixture-based test under `tests/core/` for the
   trim and a smoke test under `tests/tools/` for the dispatcher
   path. Live Jira calls are not allowed in unit tests.
5. If the operation changes the **tool-list** size meaningfully
   (new category, large new schema), run `npm run benchmark` and
   note the new numbers in `docs/BENCHMARK.md`.

## The toolkit boundary — stay on the right side

Generic MCP plumbing lives in `@scottlepper/mcp-toolkit`. This repo
owns Jira-shaped logic only. Concretely:

- **In the toolkit, do not duplicate here:** stdio server setup, the
  generic `Operation` type, manifest dispatcher (`invokeOperation`,
  path interpolation, query coercion), CLI builder (`createCli`),
  argv parsing, help rendering, bridge socket protocol, response
  sandboxing, install-skill writer.
- **In this repo, do not push to the toolkit:** the operations
  manifest itself, Jira trims, ADF (Atlassian Document Format)
  conversion, JQL parsing/validation, issue-type validation, the
  Jira HTTP client, anything that knows the shape of a Jira issue.

If you find yourself writing something generic in `src/`, stop and
check whether it belongs in the toolkit. If you need a toolkit
change, change it in the toolkit repo and bump the dep here.

Never patch files under `node_modules/@scottlepper/mcp-toolkit/`.

## Commands

```bash
npm install
npm run build           # tsc → build/
npm test                # vitest, ~400 tests, no live Jira
npm run test:watch      # iterate on one file
npm run inspector       # MCP inspector against build/index.js
npm run benchmark       # tool-list + per-call bytes; needs .env.local
npm run install-skill   # writes ~/.claude/skills/jira/SKILL.md from this checkout
```

The benchmark needs `.env.local` with `JIRA_HOST`, `JIRA_EMAIL`,
`JIRA_API_TOKEN`, plus `JIRA_BENCH_TICKET_RICH` and
`JIRA_BENCH_TICKET_SIMPLE` keys.

## Two install paths for the user-facing skill

The user-facing skill (`name: jira`, written to
`~/.claude/skills/jira/SKILL.md`) has two install paths and they must
stay in sync:

- `npm run install-skill` from a local checkout (this repo).
- `npx -y -p github:scottlepper/jira-mcp#codeapi jira-cli install-skill`
  from anywhere.

Both call the same `installSkill()` in `src/cli/install-skill.ts`
with the same `SKILL_CONTENT` constant. If you edit the skill body,
edit it there — the install-skill tests
(`tests/cli/install-skill.test.ts`) pin the frontmatter shape and a
few load-bearing sentences, so they'll catch accidental drift.

## Imports

NodeNext module resolution — local imports must use the `.js`
extension even though the source is `.ts`:

```ts
import { trimRegistry } from "./trim-registry.js";  // correct
import { trimRegistry } from "./trim-registry";     // breaks at runtime
```

## Comments

Prefer fewer, denser comments. The valuable comment is the one that
explains a non-obvious design choice (why this layer, why this
boundary, why we rejected the alternative). The harmful comment is
the one that restates what the code already says.

When you remove or rewrite code, remove its now-obsolete comments
too — stale comments are worse than no comments.

## Don't add features the task didn't ask for

A bug fix doesn't need surrounding cleanup. A new operation doesn't
need a refactor of its neighbors. New abstractions only appear when
the third use case demands them — not the second. Match the diff to
the request.
