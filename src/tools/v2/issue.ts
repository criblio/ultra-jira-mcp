// Consolidated tool: jira_issue
//
// Replaces the v1 issue tools (jira_get_issue, jira_create_issue,
// jira_update_issue, jira_delete_issue, jira_bulk_create_issues,
// jira_get_issue_transitions, jira_transition_issue,
// jira_assign_issue, jira_get_issue_changelogs).

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

// Action: get
const GetSchema = z.object({
  issueIdOrKey: z.string().describe("Issue key (PROJ-123) or numeric id"),
  fields: z.string().optional().describe("Comma-separated field list, '*' for all"),
  expand: z.string().optional().describe("Comma-separated expand list (e.g. changelog,transitions)"),
});

// Action: create
const CreateSchema = z.object({
  fields: z.record(z.string(), z.unknown()).describe("Field map (project, issuetype, summary, ...)"),
  update: z.record(z.string(), z.unknown()).optional(),
  historyMetadata: z.record(z.string(), z.unknown()).optional(),
  properties: z.array(z.unknown()).optional(),
  transition: z.record(z.string(), z.unknown()).optional(),
});

// Action: update
const UpdateSchema = z.object({
  issueIdOrKey: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
  update: z.record(z.string(), z.unknown()).optional(),
  notifyUsers: z.boolean().optional(),
});

// Action: delete
const DeleteSchema = z.object({
  issueIdOrKey: z.string(),
  deleteSubtasks: z.boolean().optional(),
});

// Action: bulkCreate
const BulkCreateSchema = z.object({
  issueUpdates: z.array(z.record(z.string(), z.unknown())).describe("Up to 50 issue update payloads"),
});

// Action: listTransitions
const ListTransitionsSchema = z.object({
  issueIdOrKey: z.string(),
});

// Action: transition
const TransitionSchema = z.object({
  issueIdOrKey: z.string(),
  transition: z.record(z.string(), z.unknown()).describe("Transition selector, e.g. { id: '31' }"),
  fields: z.record(z.string(), z.unknown()).optional(),
  update: z.record(z.string(), z.unknown()).optional(),
});

// Action: assign
const AssignSchema = z.object({
  issueIdOrKey: z.string(),
  // Note: Jira accepts null here to unassign — we forward the value
  // through, and the dispatcher's null-handling drops it from
  // missing-required calculations only when not supplied at all.
  accountId: z.string().nullable().optional(),
});

// Action: changelog
const ChangelogSchema = z.object({
  issueIdOrKey: z.string(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

export const jiraIssue: ConsolidatedTool = {
  name: "jira_issue",
  description:
    "Manage Jira issues: get, create, update, delete, bulk-create, list/perform transitions, assign, and read changelog. Returns trimmed summaries with refs to full payloads on disk.",
  actions: {
    get: { description: "Fetch a single issue.", schema: GetSchema, operation: "issue.get" },
    create: { description: "Create a new issue.", schema: CreateSchema, operation: "issue.create" },
    update: { description: "Update an existing issue.", schema: UpdateSchema, operation: "issue.update" },
    delete: { description: "Delete an issue.", schema: DeleteSchema, operation: "issue.delete" },
    bulkCreate: { description: "Create up to 50 issues in one request.", schema: BulkCreateSchema, operation: "issue.bulkCreate" },
    listTransitions: { description: "List workflow transitions available.", schema: ListTransitionsSchema, operation: "issue.listTransitions" },
    transition: { description: "Perform a workflow transition.", schema: TransitionSchema, operation: "issue.transition" },
    assign: { description: "Assign or unassign an issue.", schema: AssignSchema, operation: "issue.assign" },
    changelog: { description: "Paginated changelog for an issue.", schema: ChangelogSchema, operation: "issue.changelog" },
  },
};
