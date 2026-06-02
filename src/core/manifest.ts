// Jira-specific manifest helpers.
//
// All generic manifest plumbing (Operation type, splitArgs,
// interpolatePath, findOperation, query-param coercion, rawString body
// handling, executor hook) lives in `@scottlepper/mcp-toolkit/manifest`.
// This module:
//
//   1. Extends `Operation` with `isAgile?: boolean` so existing entries
//      in `operations.ts` keep their top-level `isAgile: true` field.
//   2. Routes calls to `client.agileGet/Post/Put/Delete` when the op is
//      marked agile, falling back to platform `get/post/put/delete`.
//   3. Bakes the Jira trim registry into the high-level
//      `invokeOperation` so consumers don't pass it on every call.
//
// Layer 2 (consolidated classic tools) calls `invokeOperation`.
// Layer 3 (bridge handler) calls `invokeOperationRaw` so it can
// sandbox the full response and only apply the trim to the summary.

import {
  type ExecuteFn,
  type Operation as ToolkitOperation,
  invokeOperation as toolkitInvokeOperation,
  invokeOperationRaw as toolkitInvokeOperationRaw,
} from "@scottlepper/mcp-toolkit/manifest";

import type { JiraClient } from "../auth/jira-client.js";
import type { JiraAttachment } from "../types/jira.js";
import { uploadAttachment } from "./attachments.js";
import { coerceBody } from "./body-coerce.js";
import { trimRegistry, type TrimKey } from "./trim-registry.js";

// --- Re-exports -------------------------------------------------------

export {
  OperationError,
  extractPathParams,
  interpolatePath,
  splitArgs,
  findOperation,
  defaultExecute,
} from "@scottlepper/mcp-toolkit/manifest";

import { OperationError } from "@scottlepper/mcp-toolkit/manifest";

// Override the toolkit's generic "Operation X is disabled." message
// with one that names the env var the user needs to edit. The bridge
// dispatcher calls this directly, and integration tests assert on the
// JIRA_DISABLED_ACTIONS hint to confirm the right knob is documented.
export function assertOperationEnabled(
  name: string,
  disabledActions: readonly string[] | undefined,
): void {
  if (!disabledActions || disabledActions.length === 0) return;
  if (disabledActions.includes(name)) {
    throw new OperationError(
      `Operation ${name} is disabled by JIRA_DISABLED_ACTIONS.`,
      name,
    );
  }
}

export type {
  HttpVerb,
  ParamRole,
  ParamSpec,
  BodyShape,
  SplitArgs,
  ExecuteContext,
  ExecuteFn,
  InvokeOptions,
} from "@scottlepper/mcp-toolkit/manifest";

// --- Jira extensions --------------------------------------------------

// `isAgile` lives at the top level (rather than under `meta`) because
// the existing operations.ts declares hundreds of entries with
// `isAgile: true`. Moving it under `meta` would be churn for no benefit.
// `trim` is narrowed to the typed TrimKey so the registry lookup is
// type-safe at the call site.
export interface Operation extends Omit<ToolkitOperation, "trim"> {
  isAgile?: boolean;
  trim?: TrimKey;
}

export type Manifest = readonly Operation[];

// Factory for an executor closure that runs the
// JIRA_DISABLED_ACTIONS-aware disabled check before delegating to
// `executeJiraOp`. Both the bridge and the consolidated-tool
// dispatcher use this with the toolkit's generic dispatch, which
// otherwise would throw a generic "Operation X is disabled." message
// that doesn't name the env var users need to edit.
//
// `disabledActions` is captured in the closure and checked at the
// top of every dispatched op — the toolkit's own check is bypassed
// by callers passing `undefined` for the toolkit's `disabledActions`
// option.
export function makeJiraExecutor(
  disabledActions?: readonly string[],
): ExecuteFn {
  return async (ctx) => {
    assertOperationEnabled(ctx.op.name, disabledActions);
    return executeJiraOp(ctx);
  };
}

// Routes a fully-resolved operation call to the right JiraClient method.
// Inspects `op.isAgile` to pick between `client.agile*` and `client.*`.
// Exported so the bridge can compose it with `assertOperationEnabled`
// to surface the JIRA_DISABLED_ACTIONS-aware message before any HTTP
// call.
export const executeJiraOp: ExecuteFn = async (ctx) => {
  const op = ctx.op as Operation;
  const client = ctx.client as JiraClient;
  const { path, queryParams } = ctx;
  // Coerce body before dispatch: JSON-parse string values that arrived
  // from the CLI's `--fields=@<file>` (which resolves to file contents
  // as a string, not a parsed object), and convert markdown strings in
  // known rich-text fields (description, body, environment) to ADF
  // documents — Jira v3 rejects plain strings for those fields with
  // "Operation value must be an Atlassian Document".
  const body = coerceBody(ctx.body);

  // Attachment upload can't ride the JSON dispatch below: Jira's
  // endpoint wants multipart/form-data + `X-Atlassian-Token: no-check`,
  // and `client.post` JSON-stringifies the body — which Jira rejects
  // with HTTP 415. The classic-tool path intercepts this in
  // `handleV2Tool` before it ever reaches here, but the code-api /
  // bridge path routes every op through this executor, so without this
  // branch agents in code-api mode get a 415 on every upload. Route to
  // the multipart side-channel, mirroring the classic handler.
  if (op.name === "attachment.add") {
    return uploadViaAttachmentSideChannel(client, path, body);
  }

  if (op.isAgile) {
    switch (op.verb) {
      case "GET":
        return client.agileGet(path, queryParams);
      case "POST":
        return client.agilePost(path, body, queryParams);
      case "PUT":
        return client.agilePut(path, body, queryParams);
      case "DELETE":
        return client.agileDelete(path, queryParams);
    }
  }
  switch (op.verb) {
    case "GET":
      return client.get(path, queryParams);
    case "POST":
      return client.post(path, body, queryParams);
    case "PUT":
      return client.put(path, body, queryParams);
    case "DELETE":
      return client.delete(path, queryParams);
  }
};

// `attachment.add`'s `filePath` param has `role: "body"`, so the
// coerced body is `{ filePath: string | string[] }`; `issueIdOrKey` is a
// path param already interpolated into the operation path
// (`/issue/<key>/attachments`). Pull the key back out of the path and
// upload each file via the multipart side-channel, returning the array
// of created attachments — the same shape Jira's JSON endpoint would
// return, so the `attachment` trim applies unchanged.
const ATTACHMENT_PATH_RE = /\/issue\/([^/]+)\/attachments$/;

async function uploadViaAttachmentSideChannel(
  client: JiraClient,
  path: string,
  body: unknown,
): Promise<JiraAttachment[]> {
  const match = ATTACHMENT_PATH_RE.exec(path);
  if (!match) {
    throw new OperationError(
      `attachment.add: could not extract issue key from path "${path}".`,
      "attachment.add",
    );
  }
  const issueIdOrKey = decodeURIComponent(match[1]);

  const filePath = (body as { filePath?: unknown })?.filePath;
  const filePaths = Array.isArray(filePath) ? filePath : [filePath];
  const paths = filePaths.filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (paths.length === 0) {
    throw new OperationError(
      "attachment.add: filePath must name at least one file.",
      "attachment.add",
    );
  }

  const url = await client.attachmentUploadUrl(issueIdOrKey);
  const authorizationHeader = client.getAuthorizationHeader();

  const created: JiraAttachment[] = [];
  for (const p of paths) {
    const uploaded = await uploadAttachment(
      { filePath: p },
      { url, authorizationHeader },
    );
    created.push(...uploaded);
  }
  return created;
}

// --- Dispatcher wrappers ----------------------------------------------

export async function invokeOperationRaw(
  manifest: Manifest,
  client: JiraClient,
  name: string,
  args: Record<string, unknown>,
  disabledActions?: readonly string[],
): Promise<{ op: Operation; response: unknown }> {
  // Check disabled actions ourselves so the OperationError message
  // names JIRA_DISABLED_ACTIONS. The toolkit's internal check (which
  // would throw a generic message) becomes a no-op once we've
  // filtered out disabled ops here.
  assertOperationEnabled(name, disabledActions);
  const result = await toolkitInvokeOperationRaw(
    manifest,
    client,
    name,
    args,
    { execute: executeJiraOp },
  );
  return { op: result.op as Operation, response: result.response };
}

export async function invokeOperation(
  manifest: Manifest,
  client: JiraClient,
  name: string,
  args: Record<string, unknown>,
  disabledActions?: readonly string[],
): Promise<unknown> {
  assertOperationEnabled(name, disabledActions);
  return toolkitInvokeOperation(manifest, client, name, args, trimRegistry, {
    execute: executeJiraOp,
  });
}
