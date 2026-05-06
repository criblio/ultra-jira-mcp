// Consolidated tool: jira_board
//
// Replaces v1's jira_list_boards, jira_get_board, jira_create_board,
// jira_delete_board, jira_get_board_configuration, jira_get_board_issues,
// jira_get_board_backlog, jira_get_board_epics.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const ListSchema = z.object({
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  type: z.string().optional().describe("scrum, kanban, simple"),
  name: z.string().optional(),
  projectKeyOrId: z.string().optional(),
});

const GetSchema = z.object({
  boardId: z.number(),
});

const CreateSchema = z.object({
  name: z.string(),
  type: z.string().describe("scrum, kanban, or simple"),
  filterId: z.number(),
  location: z.record(z.string(), z.unknown()).optional(),
});

const DeleteSchema = z.object({
  boardId: z.number(),
});

const ConfigurationSchema = z.object({
  boardId: z.number(),
});

const IssuesSchema = z.object({
  boardId: z.number(),
  jql: z.string().optional(),
  fields: z.string().optional(),
  expand: z.string().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

const BacklogSchema = z.object({
  boardId: z.number(),
  jql: z.string().optional(),
  fields: z.string().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

const EpicsSchema = z.object({
  boardId: z.number(),
  done: z.boolean().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

export const jiraBoard: ConsolidatedTool = {
  name: "jira_board",
  description: "Manage Agile boards: list/get/create/delete, fetch configuration, list board issues, backlog, and epics.",
  actions: {
    list: { description: "List boards.", schema: ListSchema, operation: "board.list" },
    get: { description: "Fetch a board.", schema: GetSchema, operation: "board.get" },
    create: { description: "Create a board.", schema: CreateSchema, operation: "board.create" },
    delete: { description: "Delete a board.", schema: DeleteSchema, operation: "board.delete" },
    configuration: { description: "Get a board's configuration.", schema: ConfigurationSchema, operation: "board.configuration" },
    issues: { description: "List issues on a board.", schema: IssuesSchema, operation: "board.issues" },
    backlog: { description: "List issues in a board's backlog.", schema: BacklogSchema, operation: "board.backlog" },
    epics: { description: "List epics associated with a board.", schema: EpicsSchema, operation: "board.epics" },
  },
};
