// Consolidated tool: jira_group
//
// Replaces v1's jira_search_groups, jira_get_group_members,
// jira_get_my_permissions. (group.* and permissions.* live under one
// MCP tool because they're conceptually the same access-control surface
// for an agent.)

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const SearchSchema = z.object({
  query: z.string().optional(),
  accountId: z.string().optional(),
  caseInsensitive: z.boolean().optional(),
  maxResults: z.number().optional(),
});

const MembersSchema = z.object({
  groupId: z.string().describe("Use the new groupId param (groupname is deprecated)"),
  includeInactiveUsers: z.boolean().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

const MyPermissionsSchema = z.object({
  projectKey: z.string().optional(),
  projectId: z.string().optional(),
  issueKey: z.string().optional(),
  issueId: z.string().optional(),
  permissions: z.string().optional().describe("Comma-separated permission keys"),
});

export const jiraGroup: ConsolidatedTool = {
  name: "jira_group",
  description:
    "Search groups, list group members, and inspect the current user's permissions.",
  actions: {
    search: { description: "Search groups.", schema: SearchSchema, operation: "group.search" },
    members: { description: "List members of a group.", schema: MembersSchema, operation: "group.members" },
    myPermissions: {
      description: "Permissions the current user has.",
      schema: MyPermissionsSchema,
      operation: "permissions.mine",
    },
  },
};
