// Consolidated tool: jira_search
//
// Replaces the v1 search tools (jira_search_issues,
// jira_get_jql_autocomplete).

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

// Action: issues — JQL search via GET /search/jql.
const IssuesSchema = z.object({
  jql: z.string().describe("JQL query"),
  fields: z.string().optional().describe("Comma-separated field list"),
  expand: z.string().optional(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  nextPageToken: z.string().optional(),
});

// Action: jqlAutocomplete — full autocomplete data dump (no params).
const JqlAutocompleteDataSchema = z.object({});

// Action: jqlSuggestions — suggestions for a specific field.
const JqlSuggestionsSchema = z.object({
  fieldName: z.string(),
  fieldValue: z.string().optional(),
});

export const jiraSearch: ConsolidatedTool = {
  name: "jira_search",
  description:
    "Search Jira issues with JQL or fetch JQL autocomplete metadata. Issue results come back as a trimmed list with refs.",
  actions: {
    issues: {
      description: "JQL search for issues.",
      schema: IssuesSchema,
      operation: "search.issues",
    },
    jqlAutocompleteData: {
      description: "All JQL fields and operators.",
      schema: JqlAutocompleteDataSchema,
      operation: "search.jqlAutocompleteData",
    },
    jqlSuggestions: {
      description: "Suggested values for a JQL field.",
      schema: JqlSuggestionsSchema,
      operation: "search.jqlAutocompleteSuggestions",
    },
  },
};
