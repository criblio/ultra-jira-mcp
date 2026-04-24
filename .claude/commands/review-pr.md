---
description: Run the pr-reviewer subagent against an open PR and post findings as GitHub comments. Usage: /review-pr [PR_NUMBER]. Without a number, reviews the PR for the current branch.
---

Invoke the `pr-reviewer` subagent via the Agent tool with `subagent_type: "pr-reviewer"`. Pass through the user's argument as the PR identifier.

- If the user supplied a PR number in `$ARGUMENTS`, tell the subagent: "Review PR #<N>."
- If `$ARGUMENTS` is empty, tell the subagent: "Review the PR associated with the current branch. Use `gh pr view --json number,url` to discover it. If there isn't one, report that back and stop."

After the subagent returns, relay its terse report to the user verbatim (PR URL, counts of findings posted). Do not re-summarize or second-guess the subagent's findings — it already posted the review to GitHub.

$ARGUMENTS
