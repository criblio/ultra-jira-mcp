// `jira-cli install-skill` — write a Claude Code skill that teaches
// the agent how to call this CLI.
//
// Without a skill the agent has no in-band way to discover that the
// CLI exists in standalone (no-MCP) deployments. The MCP path
// teaches the agent via the `jira_code_api` tool's response; the
// standalone path needs an out-of-band hint, and a skill is the
// idiomatic shape — loaded on demand by the harness when the user
// mentions Jira, rather than burning context every session like a
// CLAUDE.md entry would.
//
// The subcommand is intentionally small: render a fixed SKILL.md
// string to ~/.claude/skills/jira/SKILL.md, refusing to overwrite
// unless --force is passed. --print dumps to stdout for users who
// want to inspect or hand-place the file.

import {
  installSkill as toolkitInstallSkill,
  type InstallSkillResult,
} from "@scottlepper/mcp-toolkit/cli";

// SKILL.md body. The trigger description is deliberately conservative:
// "explicit mention of Jira / JQL / ticket lookup" rather than "any
// PROJ-123 sighting" — non-Jira codebases use ticket-shaped strings
// for unrelated identifiers, and false-positive activations are more
// annoying than missed ones.
//
// The body teaches the *shape* of the CLI, not the operations:
// `jira-cli --help` is the source of truth for the operation list,
// and re-listing it here would rot fast. Naming a few common ops
// keeps first-call discovery cheap without setting up a maintenance
// burden.
export const SKILL_CONTENT = `---
name: jira
description: >-
  Query Jira tickets, comments, sprints, boards, and JQL searches via the
  bundled jira-cli shell binary. Use when the user mentions Jira/JIRA,
  asks to look up a ticket by key, references JQL, or asks about sprint
  or board state.
---
# Jira CLI

Query Jira from the shell via \`jira-cli\`. Run it with \`npx\`:

\`\`\`bash
npx -y -p github:scottlepp/ultra-jira-mcp#codeapi jira-cli <op> [--flag=value ...]
\`\`\`

## First call in a session

Run \`jira-cli --help\` once to see every operation. The list is stable
across calls — don't re-fetch it on every Jira task.

For a specific operation's flags: \`jira-cli <op> --help\`.

## Common operations

- \`issue.get --issueIdOrKey=KEY-123\` — fetch one ticket
- \`search.issues --jql='project = PROJ ORDER BY updated DESC' --fields=summary,status --maxResults=10\` — JQL search
- \`comment.list --issueIdOrKey=KEY-123 --maxResults=100\` — list comments
- \`issue.create --summary='...' --projectKey=PROJ --issueType=Task\` — create a ticket

## Subtasks

Subtasks aren't a JQL link type. To find children of KEY-123, use
\`parent = "KEY-123"\` in JQL on \`search.issues\`. The parent's own
\`fields.subtasks\` array (visible in \`issue.get\`'s response) is also fine.

## Output shape

Every successful call prints:

1. A trimmed summary as JSON on stdout (the fields agents usually need —
   key, summary, status, description, etc.)
2. A final line of the form \`ref: /path/to/full.json\` pointing at the
   complete untrimmed Jira response on disk. \`cat\` that file when the
   summary leaves out detail you need.

## Credentials

The CLI reads \`JIRA_HOST\`, \`JIRA_EMAIL\`, and \`JIRA_API_TOKEN\` from its
own environment (or a \`.env.local\` in the cwd). The agent never sees
these — the user exports them in their shell once. If a call fails with
"Missing required environment variables", ask the user to set them; do
not put them on the command line.

## Disabled actions

\`JIRA_DISABLED_ACTIONS\` (e.g. \`issue.delete,project.delete\`) is honored
end-to-end. Calls to disabled operations error before any HTTP request.
`;

export interface InstallSkillOpts {
  // Force overwrite if SKILL.md already exists. Without this, an
  // existing file aborts the install — protects the user from
  // accidentally clobbering customizations they made to the skill.
  force?: boolean;
  // Print the rendered SKILL.md to stdout instead of writing it.
  // Useful for piping into another location, or just inspecting
  // before installing.
  print?: boolean;
  // Override target dir. Production uses ~/.claude/skills/jira;
  // tests pass a tmpdir. Not a public CLI flag — the CLI builds the
  // production path from os.homedir().
  targetDir?: string;
}

export type { InstallSkillResult };

// Wraps the toolkit's generic skill installer with the Jira slug + the
// local SKILL_CONTENT pre-baked. Public surface unchanged so the test
// continues to call `installSkill({ targetDir })` and assert on
// SKILL_CONTENT roundtrip.
export async function installSkill(
  opts: InstallSkillOpts = {},
): Promise<InstallSkillResult> {
  return toolkitInstallSkill({
    content: SKILL_CONTENT,
    slug: "jira",
    force: opts.force,
    print: opts.print,
    targetDir: opts.targetDir,
  });
}
