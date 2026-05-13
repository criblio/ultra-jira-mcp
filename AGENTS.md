# AGENTS.md

Agent guidance for this repo lives in [CLAUDE.md](./CLAUDE.md). It
covers layout, the three-layer mental model (manifest → dispatcher →
surface), the toolkit boundary, and contributor workflows.

This file exists so non-Claude agents (Codex, Cursor, OpenHands,
Aider, etc.) that follow the `AGENTS.md` convention find the same
guidance. Treat the two files as one source of truth — edits go in
`CLAUDE.md`.

## Quick reference

- **What is this?** Token-efficient MCP server + CLI for Jira Cloud.
- **Build / test:** `npm install && npm run build && npm test`.
- **Run the MCP server:** `npm start` (after build), or `npm run inspector`.
- **Run the CLI directly:** `node build/cli/index.js --help`.
- **Install the user-facing skill:** `npm run install-skill`.
- **Contributor skill:** auto-loaded from `.claude/skills/jira-mcp-dev/`
  when working in this repo (skill `name:` is `ultra-jira-mcp-dev`).
