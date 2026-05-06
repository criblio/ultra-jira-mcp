# jira-mcp v2 token-budget benchmark

How much smaller does v2 make an agent's context footprint compared to v1?
This is what `npm run benchmark` measures: bytes of JSON delivered into
the agent's context window for a fixed sequence of Jira calls, run
against a real Jira instance.

Token figures use bytes/4 — close enough across Anthropic and OpenAI
tokenizers for a relative comparison.

## Headline

**Per-call response size: ~17× smaller** on the typical "fetch a ticket"
and "investigate a rich ticket" flows. The trim projection plus list
endpoint trims (the body of the work in v2) collapse 50–270 KB Jira
payloads into 1–16 KB summaries that still preserve the description,
comments, subtasks, and links inline.

**Tool listing: 1.5× smaller unfiltered, 100× smaller in code-api mode.**
The classic-mode listing is similar to v1 in size, since 16 fatter
consolidated tools sit in roughly the same space as 85 thinner v1 tools.
The bigger lever is `JIRA_ENABLED_CATEGORIES` filtering or the optional
`code-api` mode (single tool).

## Tool-list cost (paid every conversation)

| mode         | bytes  | ~tokens |
| ------------ | ------ | ------- |
| v1           | 38.9KB | 9,947   |
| v2 classic   | 25.1KB | 6,427   |
| v2 code-api  | 378B   | 95      |

- **v2 classic vs v1: 1.5× smaller**
- **v2 code-api vs v1: 105× smaller**

Filtering with `JIRA_ENABLED_CATEGORIES` cuts classic further (a 3-category
filter lands around 6 KB — see `CHANGELOG.md`).

## Per-call cost

The three scenarios cover the common shapes of agent–Jira interaction:
one ticket fetch, one investigation flow (ticket + comments), and a JQL
search returning a small page of results.

| scenario                  | v1      | v2 classic | v2 code-api summary | v2 code-api +full | classic vs v1     |
| ------------------------- | ------- | ---------- | ------------------- | ----------------- | ----------------- |
| fetch 1 simple ticket     | 20.3KB  | 1.2KB      | 1.3KB               | 43.4KB            | **17.5× smaller** |
| investigate rich ticket   | 270.7KB | 15.5KB     | 15.8KB              | 430.6KB           | **17.5× smaller** |
| JQL search ~10 tickets    | 20.5KB  | 3.5KB      | 3.7KB               | 29.1KB            | **5.8× smaller**  |

`v2 code-api summary` is what the agent sees if it never reads a `ref`
file. `v2 code-api +full` is the upper bound where the agent reads
every ref. Real sessions land somewhere between based on how much
detail the agent actually needs.

The `investigate rich ticket` row is the headline: v1 dumps **270 KB**
(~67k tokens) into the context window for a single ticket-with-comments
investigation; v2 classic returns **15.5 KB** (~3,900 tokens) preserving
the same content via the trim projection.

## Why v2 wins per call

Three changes do most of the work:

1. **Trim projection.** Each Jira response runs through a per-resource
   projection that keeps the fields agents actually need (key, summary,
   status, description, comments, subtasks, links) and drops the
   verbose Jira plumbing (`self` URLs, status `iconUrl`, redundant
   nested `fields` objects, schema metadata, etc.).
2. **List endpoint trims.** Paginated list responses (`comment.list`,
   `worklog.list`, `board.issues`, `sprint.issues`, …) emit
   `{total, startAt, maxResults, truncated}` only. The full body lives
   in the on-disk `ref` (code-api mode) or is fetchable with a
   targeted `get` (classic mode).
3. **ADF flattening.** Atlassian Document Format trees flatten to
   plain text on the way out, so a 500-byte rich-text comment doesn't
   show up as a 4 KB nested AST.

## Reproducing the numbers

Set up the v1 worktree once (the script reads it as a sibling
directory):

```bash
git worktree add ../jira-mcp-v1 v1.0.0
(cd ../jira-mcp-v1 && npm install && npm run build)
```

Then point the benchmark at two tickets — a "simple" one (no comments)
and a "rich" one (lots of comments and attachments). Both must be
readable by your Jira credentials:

```bash
# .env.local
JIRA_HOST=https://your.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=...
JIRA_BENCH_TICKET_SIMPLE=PROJ-1
JIRA_BENCH_TICKET_RICH=PROJ-2
```

Run it:

```bash
npm run benchmark
```

The script spawns three MCP servers in sequence (v1 from the worktree,
v2 classic, v2 code-api), runs each scenario against each, and prints
a markdown table to stdout. No fixtures — every byte measured is one
the agent would actually receive in production.

## Caveats

- **Numbers are instance-dependent.** Per-call sizes scale with how
  much content your tickets carry. The *ratios* are the stable signal:
  on any Jira instance, the v2 trim collapses raw Jira payloads to a
  small fraction.
- **Bytes are not tokens.** Bytes/4 is a reasonable approximation
  across both Anthropic and OpenAI tokenizers for English-flavored JSON,
  but real tokenizer counts will differ by a few percent in either
  direction.
- **Tool-list cost amortizes.** v1's 9.9k-token listing is paid once
  per conversation. The per-call savings dominate any session with
  more than a handful of Jira calls.
