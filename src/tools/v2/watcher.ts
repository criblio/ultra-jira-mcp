// Consolidated tool: jira_watcher
//
// Replaces v1's jira_get_watchers, jira_add_watcher, jira_remove_watcher,
// jira_get_votes, jira_add_vote, jira_remove_vote. (Watchers and votes
// share the same operational surface — both are per-issue
// presence/interest signals.)

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const ByIssueSchema = z.object({
  issueIdOrKey: z.string(),
});

const AddWatcherSchema = z.object({
  issueIdOrKey: z.string(),
  accountId: z.string(),
});

const RemoveWatcherSchema = z.object({
  issueIdOrKey: z.string(),
  accountId: z.string(),
});

export const jiraWatcher: ConsolidatedTool = {
  name: "jira_watcher",
  description: "List, add, and remove watchers on an issue. Also: list votes and toggle the current user's vote.",
  actions: {
    list: { description: "List watchers.", schema: ByIssueSchema, operation: "watcher.list" },
    add: { description: "Add a watcher.", schema: AddWatcherSchema, operation: "watcher.add" },
    remove: { description: "Remove a watcher.", schema: RemoveWatcherSchema, operation: "watcher.remove" },
    listVotes: { description: "List votes on an issue.", schema: ByIssueSchema, operation: "vote.list" },
    addVote: { description: "Vote on an issue (current user).", schema: ByIssueSchema, operation: "vote.add" },
    removeVote: { description: "Remove the current user's vote.", schema: ByIssueSchema, operation: "vote.remove" },
  },
};
