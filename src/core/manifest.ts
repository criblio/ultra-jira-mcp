// Central operation manifest.
//
// Single declaration of every Jira operation this server exposes. Two
// consumers read this at runtime:
//
//   - Layer 2 (classic MCP tools, PR #7): a consolidated tool like
//     `jira_issue` takes `{ action, ...args }` and dispatches through
//     `invokeOperation` against the manifest entry whose name matches.
//
//   - Layer 3 (code-api stubs, PR #8): on server startup we emit one
//     TypeScript file per operation under `${sessionCacheDir}/api/…`.
//     Each stub is ~20 lines — a typed signature + a thin body that
//     forwards to the running server via the local IPC bridge. The
//     generator walks the manifest to produce these.
//
// The manifest is deliberately stringly-typed: operations declare
// their params by name + role (path/query/body), not by a static
// TypeScript shape. Type-safe wrappers are the *generator's* job in
// Layer 3. Keeping the manifest shape small means we can iterate it
// generically without type gymnastics.

import type { JiraClient } from "../auth/jira-client.js";
import { trimRegistry, type TrimKey } from "./trim-registry.js";

// --- Types ------------------------------------------------------------

export type HttpVerb = "GET" | "POST" | "PUT" | "DELETE";

export type ParamRole = "path" | "query" | "body";

export interface ParamSpec {
  name: string;
  role: ParamRole;
  required?: boolean;
  description?: string;
}

// How the request body is shaped on the wire.
//
//   "object"    (default) — body params are wrapped into a single
//                JSON object: { paramA: ..., paramB: ... }. This is
//                what 99% of Jira endpoints expect.
//   "rawString" — the operation must declare exactly one body param.
//                That param's value is sent as a raw JSON string body
//                (e.g. `"acc123"`, with quotes). Required by the
//                handful of Jira endpoints that take a bare scalar
//                rather than an object — most notably
//                POST /issue/{key}/watchers, which expects the
//                accountId as a JSON-encoded string.
export type BodyShape = "object" | "rawString";

export interface Operation {
  // Stable identifier — stable across v2 minor versions. Layer 3
  // stubs are named after this (`issue.get` → `api/issues/getIssue.ts`).
  name: string;
  // Human-readable single-line summary. Surfaces in generated stubs'
  // JSDoc and in Layer 2 tool schemas.
  description: string;
  verb: HttpVerb;
  // Path template with `{paramName}` placeholders. Every placeholder
  // must appear in `params` with `role: "path"`.
  pathTemplate: string;
  // Agile API vs Platform API — affects base URL selection. Mirrors
  // the existing `isAgile` boolean in JiraClient.
  isAgile?: boolean;
  params: ParamSpec[];
  // How body params are serialized on the wire. Defaults to "object".
  bodyShape?: BodyShape;
  // Optional: trim projection applied to the response before returning.
  // Looked up by key in the trim registry; the generator and the
  // dispatcher both resolve it at call time.
  trim?: TrimKey;
}

export type Manifest = readonly Operation[];

// --- Path templating ---------------------------------------------------

// Extract all `{name}` placeholders from a template. Exported for the
// generator so it can emit the right parameter list on stubs.
export function extractPathParams(template: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (const match of template.matchAll(re)) out.push(match[1]);
  return out;
}

// Substitute `{name}` placeholders with URI-encoded values from args.
// Throws if a required placeholder is missing — callers should have
// validated already, but the dispatcher double-checks.
export function interpolatePath(
  template: string,
  args: Record<string, unknown>,
): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const value = args[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing required path parameter: ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}

// --- Argument partitioning ---------------------------------------------

// Split a flat args bag into path/query/body buckets based on the
// operation's param spec. Unknown args are collected separately so the
// dispatcher can decide whether to reject or ignore them.
export interface SplitArgs {
  pathParams: Record<string, unknown>;
  queryParams: Record<string, unknown>;
  body: Record<string, unknown> | undefined;
  unknown: string[];
  missingRequired: string[];
}

export function splitArgs(
  op: Operation,
  args: Record<string, unknown>,
): SplitArgs {
  const pathParams: Record<string, unknown> = {};
  const queryParams: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};
  const known = new Set<string>();
  const missingRequired: string[] = [];
  let hasBody = false;

  for (const spec of op.params) {
    known.add(spec.name);
    const raw = args[spec.name];
    // Treat explicit null the same as undefined: it can't satisfy a
    // required param, and it'd be wrong to forward as a path segment
    // or JSON body value. Falling through would produce a plain Error
    // from interpolatePath instead of the OperationError callers
    // expect.
    if (raw === undefined || raw === null) {
      if (spec.required) missingRequired.push(spec.name);
      continue;
    }
    switch (spec.role) {
      case "path":
        pathParams[spec.name] = raw;
        break;
      case "query":
        queryParams[spec.name] = raw;
        break;
      case "body":
        body[spec.name] = raw;
        hasBody = true;
        break;
    }
  }

  const unknown = Object.keys(args).filter((k) => !known.has(k));

  return {
    pathParams,
    queryParams,
    body: hasBody ? body : undefined,
    unknown,
    missingRequired,
  };
}

// --- Dispatcher --------------------------------------------------------

export class OperationError extends Error {
  constructor(message: string, public readonly operationName: string) {
    super(message);
    this.name = "OperationError";
  }
}

// Executes an operation by name against a JiraClient. Returns the
// (optionally trimmed) response. This is the single entry point both
// Layer 2 (classic tools) and Layer 3 (bridge handler) use — no Jira
// call should go around it.
export async function invokeOperation(
  manifest: Manifest,
  client: JiraClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const op = manifest.find((o) => o.name === name);
  if (!op) {
    throw new OperationError(`Unknown operation: ${name}`, name);
  }

  const split = splitArgs(op, args);
  if (split.missingRequired.length > 0) {
    throw new OperationError(
      `Missing required param(s) for ${name}: ${split.missingRequired.join(", ")}`,
      name,
    );
  }

  const path = interpolatePath(op.pathTemplate, split.pathParams);
  // Normalize query params into the Record<string, string|number|boolean>
  // shape JiraClient expects.
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(split.queryParams)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      // Jira's convention for list params is comma-separated.
      query[k] = v.map((x) => String(x)).join(",");
    } else if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      query[k] = v;
    } else {
      query[k] = JSON.stringify(v);
    }
  }

  // Reshape the body if the operation uses a non-default shape.
  // For "rawString", the operation must declare exactly one body
  // param; we forward its raw value so JiraClient.post (which calls
  // JSON.stringify on whatever it receives) emits a JSON-encoded
  // string like `"acc123"` rather than `{"accountId":"acc123"}`.
  let bodyToSend: unknown = split.body;
  if (op.bodyShape === "rawString") {
    const bodyParamSpecs = op.params.filter((p) => p.role === "body");
    if (bodyParamSpecs.length !== 1) {
      throw new OperationError(
        `Operation ${op.name} declared bodyShape="rawString" but has ${bodyParamSpecs.length} body params (must be exactly 1)`,
        op.name,
      );
    }
    const onlyName = bodyParamSpecs[0].name;
    bodyToSend =
      split.body && Object.prototype.hasOwnProperty.call(split.body, onlyName)
        ? split.body[onlyName]
        : undefined;
  }

  let response: unknown;
  if (op.isAgile) {
    switch (op.verb) {
      case "GET":
        response = await client.agileGet(path, query);
        break;
      case "POST":
        response = await client.agilePost(path, bodyToSend, query);
        break;
      case "PUT":
        response = await client.agilePut(path, bodyToSend, query);
        break;
      case "DELETE":
        response = await client.agileDelete(path, query);
        break;
    }
  } else {
    switch (op.verb) {
      case "GET":
        response = await client.get(path, query);
        break;
      case "POST":
        response = await client.post(path, bodyToSend, query);
        break;
      case "PUT":
        response = await client.put(path, bodyToSend, query);
        break;
      case "DELETE":
        response = await client.delete(path, query);
        break;
    }
  }

  if (op.trim) {
    const projection = trimRegistry[op.trim];
    return projection(response);
  }
  return response;
}
