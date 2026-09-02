// Side-channel handler for `jira_attachment add`.
//
// Attachment upload can't ride the JSON manifest dispatcher: Jira's
// endpoint wants multipart/form-data + `X-Atlassian-Token: no-check`,
// and the classic dispatcher (tools/v2/dispatcher.ts) JSON-stringifies
// every body. So `handleV2Tool` intercepts the `add` action and routes
// it here, mirroring how the download path side-channels around the
// same constraint.
//
// Token-efficiency contract (ultra-jira-mcp): the agent passes a disk
// path; the server reads the bytes (core/attachments.ts:uploadAttachment)
// and returns only the trimmed summary on stdout, with the full Jira
// response written to disk and referenced by `ref:` — identical to the
// shape every other op emits via the toolkit sandbox.

import { z } from "zod";

import type { JiraClient } from "../../auth/jira-client.js";
import { uploadAttachment } from "../../core/attachments.js";
import { jiraSandbox } from "../../core/sandbox.js";
import { attachmentSummary, type AttachmentSummary } from "../../core/trim.js";
import type { JiraAttachment } from "../../types/jira.js";
import type { SandboxResult } from "../../types/refs.js";
import { AddSchema } from "./attachment.js";
import { ToolError } from "./dispatcher.js";

// Validate against the same schema the tool listing advertises, then
// strip the discriminator. A failure becomes a ToolError so the MCP
// server's error path renders it the same way a dispatcher validation
// failure would.
function parseArgs(raw: Record<string, unknown>): {
  issueIdOrKey: string;
  filePaths: string[];
} {
  const { action: _drop, ...rest } = raw;
  const parsed = AddSchema.safeParse(rest);
  if (!parsed.success) {
    throw new ToolError(
      `jira_attachment.add: invalid args:\n${z.prettifyError(parsed.error)}`,
      "add",
      "jira_attachment",
    );
  }
  const { issueIdOrKey, filePath } = parsed.data;
  const filePaths = Array.isArray(filePath) ? filePath : [filePath];
  if (filePaths.length === 0) {
    throw new ToolError(
      "jira_attachment.add: filePath must name at least one file.",
      "add",
      "jira_attachment",
    );
  }
  return { issueIdOrKey, filePaths };
}

// Upload one or more local files to an issue and return a sandboxed
// result: a trimmed summary array on stdout, the full Jira response on
// disk behind a ref. Each `add` call uploads sequentially — attachment
// uploads are rare and the per-file response is small, so parallelism
// would only add failure-ordering complexity for no real gain.
export async function handleAttachmentAdd(
  client: JiraClient,
  rawArgs: Record<string, unknown>,
): Promise<SandboxResult<AttachmentSummary[]>> {
  const { issueIdOrKey, filePaths } = parseArgs(rawArgs);

  const url = await client.attachmentUploadUrl(issueIdOrKey);
  const authorizationHeader = client.getAuthorizationHeader();

  const created: JiraAttachment[] = [];
  for (const p of filePaths) {
    const uploaded = await uploadAttachment(
      { filePath: p },
      { url, authorizationHeader },
    );
    created.push(...uploaded);
  }

  return jiraSandbox.sandbox<JiraAttachment[], AttachmentSummary[]>(created, {
    kind: "attachment",
    summarize: (full) => full.map(attachmentSummary),
  });
}
