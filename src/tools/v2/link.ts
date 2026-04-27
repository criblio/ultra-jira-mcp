// Consolidated tool: jira_link
//
// Replaces v1's jira_create_issue_link, jira_get_issue_link,
// jira_delete_issue_link, jira_get_issue_link_types.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const CreateSchema = z.object({
  type: z.record(z.string(), z.unknown()).describe("Link type, e.g. { name: 'Blocks' }"),
  inwardIssue: z.record(z.string(), z.unknown()).describe("e.g. { key: 'PROJ-1' }"),
  outwardIssue: z.record(z.string(), z.unknown()).describe("e.g. { key: 'PROJ-2' }"),
  comment: z.record(z.string(), z.unknown()).optional(),
});

const GetSchema = z.object({
  linkId: z.string(),
});

const DeleteSchema = z.object({
  linkId: z.string(),
});

const TypesSchema = z.object({});

export const jiraLink: ConsolidatedTool = {
  name: "jira_link",
  description: "Create, fetch, delete issue links, and list available link types.",
  actions: {
    create: { description: "Create a link between two issues.", schema: CreateSchema, operation: "issueLink.create" },
    get: { description: "Fetch a single link.", schema: GetSchema, operation: "issueLink.get" },
    delete: { description: "Delete a link.", schema: DeleteSchema, operation: "issueLink.delete" },
    types: { description: "List available link types.", schema: TypesSchema, operation: "issueLink.types" },
  },
};
