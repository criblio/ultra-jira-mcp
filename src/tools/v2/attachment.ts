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

export const AddSchema = z.object({
  issueIdOrKey: z.string().describe("Issue key or id to attach the file(s) to."),
  filePath: z
    .union([z.string(), z.array(z.string())])
    .describe(
      "Local filesystem path(s) to upload. The server reads the bytes; do not pass file contents.",
    ),
});

export const jiraAttachment: ConsolidatedTool = {
  name: "jira_attachment",
  description:
    "Add, inspect, or delete attachments. `add` uploads local file(s) by path (server reads the bytes — never pass contents). To download bytes, use the streaming downloader (returns a local path).",
  actions: {
    // `add` is handled by a side-channel in tools/v2/index.ts (multipart
    // upload can't go through the JSON manifest dispatcher), so its
    // `operation` is a stub name the dispatcher never reaches.
    add: { description: "Upload local file(s) as attachment(s).", schema: AddSchema, operation: "attachment.add" },
    get: { description: "Get attachment metadata.", schema: GetSchema, operation: "attachment.get" },
    delete: { description: "Delete an attachment.", schema: DeleteSchema, operation: "attachment.delete" },
    meta: { description: "Global attachment settings.", schema: MetaSchema, operation: "attachment.meta" },
  },
};
