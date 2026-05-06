// Consolidated tool: jira_sprint
//
// Replaces v1's jira_list_sprints, jira_get_sprint, jira_create_sprint,
// jira_update_sprint, jira_delete_sprint, jira_get_sprint_issues,
// jira_move_issues_to_sprint, jira_move_issues_to_backlog.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const ListForBoardSchema = z.object({
  boardId: z.number(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  state: z.string().optional().describe("active, closed, future"),
});

const GetSchema = z.object({
  sprintId: z.number(),
});

const CreateSchema = z.object({
  name: z.string(),
  originBoardId: z.number(),
  goal: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const UpdateSchema = z.object({
  sprintId: z.number(),
  name: z.string().optional(),
  state: z.string().optional(),
  goal: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  completeDate: z.string().optional(),
});

const DeleteSchema = z.object({
  sprintId: z.number(),
});

const IssuesSchema = z.object({
  sprintId: z.number(),
  jql: z.string().optional(),
  fields: z.string().optional(),
  expand: z.string().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

const MoveIssuesSchema = z.object({
  sprintId: z.number(),
  issues: z.array(z.string()),
  rankBeforeIssue: z.string().optional(),
  rankAfterIssue: z.string().optional(),
  rankCustomFieldId: z.number().optional(),
});

const MoveIssuesToBacklogSchema = z.object({
  issues: z.array(z.string()),
});

export const jiraSprint: ConsolidatedTool = {
  name: "jira_sprint",
  description: "Manage Jira sprints: list/get/create/update/delete, list sprint issues, and move issues in or out.",
  actions: {
    listForBoard: { description: "List sprints for a board.", schema: ListForBoardSchema, operation: "sprint.listForBoard" },
    get: { description: "Get a sprint.", schema: GetSchema, operation: "sprint.get" },
    create: { description: "Create a sprint.", schema: CreateSchema, operation: "sprint.create" },
    update: { description: "Update a sprint.", schema: UpdateSchema, operation: "sprint.update" },
    delete: { description: "Delete a sprint.", schema: DeleteSchema, operation: "sprint.delete" },
    issues: { description: "List issues in a sprint.", schema: IssuesSchema, operation: "sprint.issues" },
    moveIssues: { description: "Move issues into a sprint.", schema: MoveIssuesSchema, operation: "sprint.moveIssues" },
    moveIssuesToBacklog: { description: "Move issues out of any sprint and back to the backlog.", schema: MoveIssuesToBacklogSchema, operation: "sprint.moveIssuesToBacklog" },
  },
};
