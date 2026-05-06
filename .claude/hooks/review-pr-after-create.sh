#!/usr/bin/env bash
# PostToolUse hook: when the agent successfully runs `gh pr create`,
# inject a reminder into the next turn so the agent runs /review-pr.
#
# Wired in .claude/settings.local.json (personal only; not shared with
# other contributors).
#
# Hook payload on stdin is JSON; see Claude Code hooks docs for schema.
# Relevant fields:
#   .tool_name          → "Bash"
#   .tool_input.command → the shell command that was run
#   .tool_response      → varies by tool; for Bash, includes stdout/stderr/
#                         and often an exit code depending on Claude Code
#                         version. Treat its presence loosely.

set -euo pipefail

payload=$(cat)

# Only react to Bash tool calls — the matcher in settings should
# already restrict this, but belt-and-suspenders in case the matcher
# ever broadens.
tool_name=$(jq -r '.tool_name // ""' <<<"$payload")
[[ "$tool_name" == "Bash" ]] || exit 0

# Only react when the command *starts with* `gh pr create` (after any
# leading env-var assignments and whitespace). Substring matching was
# too loose — it fired on things like `echo "… gh pr create …"` and on
# `gh api` calls that merely mentioned the phrase in a body argument.
cmd=$(jq -r '.tool_input.command // ""' <<<"$payload")
# Strip leading env assignments like `FOO=bar BAZ=qux gh pr create ...`
stripped=$(sed -E 's/^([[:space:]]*[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|[^[:space:]]+)[[:space:]]+)+//' <<<"$cmd")
# Trim leading whitespace
stripped="${stripped#"${stripped%%[![:space:]]*}"}"
[[ "$stripped" == "gh pr create"* ]] || exit 0

# Respect exit code when present.
exit_code=$(jq -r '.tool_response.exit_code // empty' <<<"$payload")
if [[ -n "$exit_code" && "$exit_code" != "0" ]]; then
  exit 0
fi

# Require the tool response to contain a PR URL — this is what `gh pr
# create` prints on success. Belt-and-suspenders: blocks dry-runs,
# validation failures that exit 0, and any remaining edge cases.
stdout=$(jq -r '.tool_response.stdout // .tool_response.content // ""' <<<"$payload")
[[ "$stdout" =~ https://github\.com/[^/[:space:]]+/[^/[:space:]]+/pull/[0-9]+ ]] || exit 0

# Inject a system-reminder–style message for the next turn. The agent
# sees this as a hook-provided instruction and can act on it.
jq -n '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: "A new PR was just created with `gh pr create`. Invoke the pr-reviewer subagent (via the Agent tool, subagent_type: \"pr-reviewer\") to review the newly created PR and post findings as GitHub comments. Use the PR number or URL from the gh pr create output."
  }
}'
