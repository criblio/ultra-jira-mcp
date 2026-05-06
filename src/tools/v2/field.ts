// Consolidated tool: jira_field
//
// Replaces v1's jira_get_fields, jira_get_issue_types, jira_get_priorities,
// jira_get_statuses, jira_get_resolutions, jira_get_create_metadata.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const Empty = z.object({});

const CreateMetaSchema = z.object({
  projectIds: z.string().optional(),
  projectKeys: z.string().optional(),
  issuetypeIds: z.string().optional(),
  issuetypeNames: z.string().optional(),
  expand: z.string().optional(),
});

export const jiraField: ConsolidatedTool = {
  name: "jira_field",
  description:
    "List Jira metadata: fields, issue types, priorities, statuses, resolutions, and per-project createMeta.",
  actions: {
    list: { description: "All fields.", schema: Empty, operation: "field.list" },
    issueTypes: { description: "All issue types.", schema: Empty, operation: "field.issueTypes" },
    priorities: { description: "All priorities.", schema: Empty, operation: "field.priorities" },
    statuses: { description: "All statuses.", schema: Empty, operation: "field.statuses" },
    resolutions: { description: "All resolutions.", schema: Empty, operation: "field.resolutions" },
    createMeta: { description: "createIssue metadata.", schema: CreateMetaSchema, operation: "field.createMeta" },
  },
};
