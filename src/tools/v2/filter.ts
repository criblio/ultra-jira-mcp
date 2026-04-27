// Consolidated tool: jira_filter
//
// Replaces v1's jira_list_filters, jira_get_filter, jira_create_filter,
// jira_update_filter, jira_delete_filter, jira_get_favourite_filters.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const ListSchema = z.object({
  filterName: z.string().optional(),
  accountId: z.string().optional(),
  owner: z.string().optional(),
  groupId: z.string().optional().describe("groupname is deprecated; use groupId"),
  projectId: z.string().optional(),
  id: z.string().optional(),
  orderBy: z.string().optional(),
  maxResults: z.number().optional(),
  startAt: z.number().optional(),
  expand: z.string().optional(),
});

const GetSchema = z.object({
  filterId: z.string(),
  expand: z.string().optional(),
});

const CreateSchema = z.object({
  name: z.string(),
  jql: z.string(),
  description: z.string().optional(),
  favourite: z.boolean().optional(),
  sharePermissions: z.array(z.unknown()).optional(),
});

const UpdateSchema = z.object({
  filterId: z.string(),
  name: z.string().optional(),
  jql: z.string().optional(),
  description: z.string().optional(),
  favourite: z.boolean().optional(),
  sharePermissions: z.array(z.unknown()).optional(),
});

const DeleteSchema = z.object({
  filterId: z.string(),
});

const FavouriteSchema = z.object({
  expand: z.string().optional(),
});

export const jiraFilter: ConsolidatedTool = {
  name: "jira_filter",
  description: "Manage saved JQL filters: list/get/create/update/delete plus the current user's favourites.",
  actions: {
    list: { description: "Paginated filter search.", schema: ListSchema, operation: "filter.list" },
    get: { description: "Get one filter.", schema: GetSchema, operation: "filter.get" },
    create: { description: "Create a filter.", schema: CreateSchema, operation: "filter.create" },
    update: { description: "Update a filter.", schema: UpdateSchema, operation: "filter.update" },
    delete: { description: "Delete a filter.", schema: DeleteSchema, operation: "filter.delete" },
    listFavourite: { description: "Filters favourited by the current user.", schema: FavouriteSchema, operation: "filter.listFavourite" },
  },
};
