// Consolidated tool: jira_epic
//
// Replaces v1's jira_get_epic, jira_get_epic_issues, jira_move_issues_to_epic,
// jira_remove_issues_from_epic.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const GetSchema = z.object({
  epicIdOrKey: z.string(),
});

const IssuesSchema = z.object({
  epicIdOrKey: z.string(),
  jql: z.string().optional(),
  fields: z.string().optional(),
  expand: z.string().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

const MoveInSchema = z.object({
  epicIdOrKey: z.string(),
  issues: z.array(z.string()).describe("Issue keys to move into this epic"),
});

const RemoveSchema = z.object({
  issues: z.array(z.string()).describe("Issue keys to remove from their current epic"),
});

export const jiraEpic: ConsolidatedTool = {
  name: "jira_epic",
  description: "Inspect epics, list issues under an epic, and move issues into or out of epics.",
  actions: {
    get: { description: "Fetch an epic.", schema: GetSchema, operation: "epic.get" },
    issues: { description: "List issues under an epic.", schema: IssuesSchema, operation: "epic.issues" },
    moveIn: { description: "Move issues into an epic.", schema: MoveInSchema, operation: "epic.moveIssuesIn" },
    removeFromCurrent: { description: "Remove issues from their current epic.", schema: RemoveSchema, operation: "epic.removeIssues" },
  },
};
