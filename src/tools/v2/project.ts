// Consolidated tool: jira_project
//
// Replaces v1's jira_list_projects, jira_get_project, jira_create_project,
// jira_update_project, jira_delete_project, jira_get_project_components,
// jira_create_component, jira_get_project_versions, jira_create_version,
// jira_update_version, jira_get_project_statuses.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

// --- Project shell -----------------------------------------------------

const ListSchema = z.object({
  query: z.string().optional(),
  typeKey: z.string().optional(),
  categoryId: z.string().optional(),
  action: z.string().optional(),
  expand: z.string().optional(),
  status: z.string().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  orderBy: z.string().optional(),
});

const GetSchema = z.object({
  projectIdOrKey: z.string(),
  expand: z.string().optional(),
});

const CreateSchema = z.object({
  key: z.string().describe("e.g. PROJ"),
  name: z.string(),
  projectTypeKey: z.string().describe("software, business, service_desk"),
  projectTemplateKey: z.string().optional(),
  description: z.string().optional(),
  leadAccountId: z.string().optional(),
  assigneeType: z.string().optional(),
  categoryId: z.string().optional(),
});

const UpdateSchema = z.object({
  projectIdOrKey: z.string(),
  key: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  leadAccountId: z.string().optional(),
  assigneeType: z.string().optional(),
  categoryId: z.string().optional(),
});

const DeleteSchema = z.object({
  projectIdOrKey: z.string(),
});

// --- Components --------------------------------------------------------

const ListComponentsSchema = z.object({
  projectIdOrKey: z.string(),
});

const CreateComponentSchema = z.object({
  project: z.string().describe("Project key the component belongs to"),
  name: z.string(),
  description: z.string().optional(),
  leadAccountId: z.string().optional(),
  assigneeType: z.string().optional(),
});

// --- Versions ----------------------------------------------------------

const ListVersionsSchema = z.object({
  projectIdOrKey: z.string(),
  expand: z.string().optional(),
});

const CreateVersionSchema = z.object({
  projectId: z.string().describe("Numeric project id (not key)"),
  name: z.string(),
  description: z.string().optional(),
  startDate: z.string().optional(),
  releaseDate: z.string().optional(),
  released: z.boolean().optional(),
  archived: z.boolean().optional(),
});

const UpdateVersionSchema = z.object({
  versionId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  startDate: z.string().optional(),
  releaseDate: z.string().optional(),
  released: z.boolean().optional(),
  archived: z.boolean().optional(),
});

// --- Statuses ----------------------------------------------------------

const StatusesSchema = z.object({
  projectIdOrKey: z.string(),
});

export const jiraProject: ConsolidatedTool = {
  name: "jira_project",
  description: "Manage Jira projects, their components, versions, and per-issue-type statuses.",
  actions: {
    list: { description: "Paginated project search.", schema: ListSchema, operation: "project.list" },
    get: { description: "Fetch a project.", schema: GetSchema, operation: "project.get" },
    create: { description: "Create a project.", schema: CreateSchema, operation: "project.create" },
    update: { description: "Update a project.", schema: UpdateSchema, operation: "project.update" },
    delete: { description: "Delete a project.", schema: DeleteSchema, operation: "project.delete" },
    listComponents: { description: "List components.", schema: ListComponentsSchema, operation: "project.listComponents" },
    createComponent: { description: "Create a component.", schema: CreateComponentSchema, operation: "project.createComponent" },
    listVersions: { description: "List versions.", schema: ListVersionsSchema, operation: "project.listVersions" },
    createVersion: { description: "Create a version.", schema: CreateVersionSchema, operation: "project.createVersion" },
    updateVersion: { description: "Update a version.", schema: UpdateVersionSchema, operation: "project.updateVersion" },
    statuses: { description: "List statuses for each issue type.", schema: StatusesSchema, operation: "project.statuses" },
  },
};
