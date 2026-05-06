// Consolidated tool: jira_comment
//
// Replaces the v1 comment tools (jira_get_comments, jira_add_comment,
// jira_update_comment, jira_delete_comment).

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const ListSchema = z.object({
  issueIdOrKey: z.string(),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  orderBy: z.string().optional(),
  expand: z.string().optional(),
});

// `body` here is the ADF document (or a plain-text-style fallback).
// Validating the full ADF shape is out of scope; we accept any
// object/string and let Jira reject malformed payloads.
const AddSchema = z.object({
  issueIdOrKey: z.string(),
  body: z.unknown().describe("ADF document or plain-text-shaped body"),
  visibility: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSchema = z.object({
  issueIdOrKey: z.string(),
  commentId: z.string(),
  body: z.unknown(),
  visibility: z.record(z.string(), z.unknown()).optional(),
});

const DeleteSchema = z.object({
  issueIdOrKey: z.string(),
  commentId: z.string(),
});

export const jiraComment: ConsolidatedTool = {
  name: "jira_comment",
  description:
    "List, add, update, and delete comments on a Jira issue. Bodies are ADF documents.",
  actions: {
    list: { description: "List comments.", schema: ListSchema, operation: "comment.list" },
    add: { description: "Add a comment.", schema: AddSchema, operation: "comment.add" },
    update: { description: "Update a comment.", schema: UpdateSchema, operation: "comment.update" },
    delete: { description: "Delete a comment.", schema: DeleteSchema, operation: "comment.delete" },
  },
};
