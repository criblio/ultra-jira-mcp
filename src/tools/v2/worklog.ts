// Consolidated tool: jira_worklog
//
// Replaces v1's jira_get_worklogs, jira_add_worklog, jira_update_worklog,
// jira_delete_worklog.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const ListSchema = z.object({
  issueIdOrKey: z.string(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  startedAfter: z.string().optional().describe("ISO 8601 timestamp"),
  startedBefore: z.string().optional(),
  expand: z.string().optional(),
});

const AddSchema = z.object({
  issueIdOrKey: z.string(),
  timeSpent: z.string().optional().describe("e.g. '1h 30m' — required if timeSpentSeconds isn't given"),
  timeSpentSeconds: z.number().optional(),
  comment: z.unknown().optional().describe("ADF body or string"),
  started: z.string().optional().describe("ISO 8601 timestamp"),
  visibility: z.record(z.string(), z.unknown()).optional(),
  // Query knobs that affect remaining estimate. Mutually exclusive
  // semantics enforced by Jira; we forward the caller's choice.
  adjustEstimate: z.string().optional(),
  newEstimate: z.string().optional(),
  reduceBy: z.string().optional(),
});

const UpdateSchema = z.object({
  issueIdOrKey: z.string(),
  worklogId: z.string(),
  timeSpent: z.string().optional(),
  timeSpentSeconds: z.number().optional(),
  comment: z.unknown().optional(),
  started: z.string().optional(),
  visibility: z.record(z.string(), z.unknown()).optional(),
  adjustEstimate: z.string().optional(),
  newEstimate: z.string().optional(),
});

const DeleteSchema = z.object({
  issueIdOrKey: z.string(),
  worklogId: z.string(),
  adjustEstimate: z.string().optional(),
  newEstimate: z.string().optional(),
  increaseBy: z.string().optional(),
});

export const jiraWorklog: ConsolidatedTool = {
  name: "jira_worklog",
  description: "List, add, update, and delete worklogs on an issue. Supports remaining-estimate adjustment.",
  actions: {
    list: { description: "List worklogs on an issue.", schema: ListSchema, operation: "worklog.list" },
    add: { description: "Add a worklog.", schema: AddSchema, operation: "worklog.add" },
    update: { description: "Update a worklog.", schema: UpdateSchema, operation: "worklog.update" },
    delete: { description: "Delete a worklog.", schema: DeleteSchema, operation: "worklog.delete" },
  },
};
