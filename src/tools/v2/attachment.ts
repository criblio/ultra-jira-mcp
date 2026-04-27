// Consolidated tool: jira_attachment
//
// Replaces v1's jira_get_attachment, jira_delete_attachment,
// jira_get_attachment_meta. Note: jira_get_attachment_content was a
// URL-returning op replaced by the streaming downloader in
// src/core/attachments.ts; it has no manifest entry and so no v2
// action.

import { z } from "zod";

import type { ConsolidatedTool } from "./dispatcher.js";

const GetSchema = z.object({
  attachmentId: z.string(),
});

const DeleteSchema = z.object({
  attachmentId: z.string(),
});

const MetaSchema = z.object({});

export const jiraAttachment: ConsolidatedTool = {
  name: "jira_attachment",
  description:
    "Inspect or delete attachment metadata. To download bytes, use the streaming downloader (returns a local path).",
  actions: {
    get: { description: "Get attachment metadata.", schema: GetSchema, operation: "attachment.get" },
    delete: { description: "Delete an attachment.", schema: DeleteSchema, operation: "attachment.delete" },
    meta: { description: "Global attachment settings.", schema: MetaSchema, operation: "attachment.meta" },
  },
};
