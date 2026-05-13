#!/usr/bin/env node
// jira-cli — shell client for Jira.
//
// All argv parsing, help rendering, bridge round-trip, install-skill
// dispatch, and the trimmed-summary + `ref:` stdout layout live in
// `@scottlepper/mcp-toolkit/cli`. This file wires in the Jira-specific
// bits: the operation manifest, the direct-mode handler (which builds
// a JiraClient in-process when no socket is configured), the SKILL.md
// content, and the env vars to mention in the help text.

import { createCli } from "@scottlepper/mcp-toolkit/cli";

import { operations } from "../core/operations.js";
import { callDirect } from "./direct.js";
import { SKILL_CONTENT } from "./install-skill.js";

const cli = createCli({
  cliName: "jira-cli",
  socketEnvVar: "JIRA_MCP_SOCKET",
  manifest: operations,
  callDirect,
  skillContent: SKILL_CONTENT,
  skillSlug: "jira",
  directModeEnvVars: ["JIRA_HOST", "JIRA_EMAIL", "JIRA_API_TOKEN"],
});

void cli.run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `jira-cli: unexpected error: ${(err as Error).stack ?? err}\n`,
    );
    process.exit(1);
  },
);
