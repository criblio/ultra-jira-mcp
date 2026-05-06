// Consolidated tool: jira_user
//
// Replaces the v1 user tools (jira_get_current_user, jira_search_users,
// jira_get_user, jira_get_assignable_users, jira_bulk_get_users).

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const MyselfSchema = z.object({
  expand: z.string().optional(),
});

const SearchSchema = z.object({
  query: z.string().optional().describe("Free-text user search"),
  accountId: z.string().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  property: z.string().optional(),
});

const GetSchema = z.object({
  accountId: z.string(),
  expand: z.string().optional(),
});

const AssignableSchema = z.object({
  query: z.string().optional(),
  sessionId: z.string().optional(),
  username: z.string().optional(),
  accountId: z.string().optional(),
  project: z.string().optional().describe("Project key — restricts to assignable for this project"),
  issueKey: z.string().optional().describe("Issue key — restricts to assignable for this issue"),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  actionDescriptorId: z.number().optional(),
  recommend: z.boolean().optional(),
});

const BulkGetSchema = z.object({
  accountId: z.union([z.string(), z.array(z.string())]).describe("One or more accountIds"),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
});

export const jiraUser: ConsolidatedTool = {
  name: "jira_user",
  description:
    "Look up Jira users: current authenticated user, search by query/accountId, list assignable users for a project or issue, or bulk-fetch by accountId.",
  actions: {
    myself: { description: "Current authenticated user.", schema: MyselfSchema, operation: "user.myself" },
    search: { description: "Search users.", schema: SearchSchema, operation: "user.search" },
    get: { description: "Fetch a single user by accountId.", schema: GetSchema, operation: "user.get" },
    assignable: { description: "List users assignable to a project/issue.", schema: AssignableSchema, operation: "user.assignable" },
    bulkGet: { description: "Get multiple users by accountId.", schema: BulkGetSchema, operation: "user.bulkGet" },
  },
};
