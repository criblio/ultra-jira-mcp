// Generic dispatcher for v2 consolidated tools.
//
// Every consolidated tool (jira_issue, jira_search, …) follows the
// same shape:
//   1. Args land here as `Record<string, unknown>`.
//   2. We pull `action` off, look up the operation name via the
//      tool's actionMap, then validate the rest with the action's
//      Zod schema.
//   3. The validated args go through `invokeOperation`, which
//      handles path interpolation, body shaping, agile vs platform
//      routing, and trim projections.
//
// All knowledge of *what* actions a tool exposes lives in the
// `ConsolidatedTool` definition. The dispatcher is the same for
// every tool.

import { z, ZodError, type ZodType } from "zod";

import type { JiraClient } from "../../auth/jira-client.js";
import {
  invokeOperation,
  OperationError,
  type Manifest,
} from "../../core/manifest.js";

// --- Tool definition shape --------------------------------------------

export interface ActionDefinition {
  // Human-readable single-line description of this action. Surfaces
  // in the MCP tool's JSON schema so agents pick the right action.
  description: string;
  // Zod schema for the action's inputs (excluding `action` itself).
  // Validated runtime; failures become OperationError-shaped responses.
  schema: ZodType;
  // The manifest operation invoked when this action is selected.
  operation: string;
}

export interface ConsolidatedTool {
  // The MCP tool name (e.g. "jira_issue").
  name: string;
  // Surfaces on the MCP tool listing.
  description: string;
  // Map from action key (e.g. "get") to its definition.
  actions: Record<string, ActionDefinition>;
}

// --- MCP-shaped JSON schema for the tool listing ----------------------

// Build the input schema the MCP tool listing exposes.
//
// Shape: a flat object schema with `action` as a string enum and a
// merged property bag containing every field across all actions. The
// previous shape used a top-level `oneOf` over per-action branches,
// which gave the agent tight per-action constraints — but the
// Anthropic tool-use API rejects top-level oneOf/allOf/anyOf in
// `input_schema`, so the consolidated v2 tools were unusable in
// classic mode.
//
// The flattening means the JSON Schema no longer encodes "this field
// is required only when action=X". That's enforced at runtime in
// dispatchTool via the per-action Zod schema, so a malformed call
// still fails fast — just after the call instead of at schema
// validation. Per-action requirements are surfaced in the tool's
// `description` so the agent still has the information it needs to
// construct a valid call without trial-and-error.
//
// We don't go through zod-to-json-schema because (a) we want full
// control over the wire shape, (b) it'd add a dep, and (c) the action
// schemas are small enough that hand-shaped JSON is clearer.
export function buildInputSchema(tool: ConsolidatedTool): unknown {
  // Per-field collected JSON Schemas keyed by field name. We collect
  // every action's contribution so that fields whose type differs
  // across actions (e.g. jira_issue.fields is a CSV string for `get`
  // but a record for `create`) are surfaced as a oneOf at the
  // property level instead of silently first-wins. Top-level oneOf
  // is what the Anthropic API rejects; nested oneOf under a property
  // is fine.
  const collected: Record<string, unknown[]> = {};
  const actionNames: string[] = [];
  const perActionLines: string[] = [];

  for (const [actionName, def] of Object.entries(tool.actions)) {
    actionNames.push(actionName);
    const shape = zodShape(def.schema) ?? {};
    const required: string[] = [];
    const optional: string[] = [];
    for (const [key, sub] of Object.entries(shape)) {
      // Skip any per-action field literally named `action` — it
      // would collide with the discriminator we add below. The
      // dispatcher strips `action` from rawArgs before Zod
      // validation, so an action schema declaring its own `action`
      // field would be unreachable anyway. (jira_project.list has
      // an `action` query param; this is the path that lets it
      // coexist with the discriminator. The list action loses
      // visibility of that param in the JSON Schema; agents can
      // still pass it, additionalProperties:false is what blocks
      // it — see below.)
      if (key === "action") continue;
      const js = zodFieldToJsonSchema(sub);
      const seen = collected[key];
      if (!seen) {
        collected[key] = [js];
      } else if (!seen.some((s) => deepEqual(s, js))) {
        seen.push(js);
      }
      (isOptionalZod(sub) ? optional : required).push(key);
    }
    const parts: string[] = [];
    if (required.length) parts.push(`requires ${required.join(", ")}`);
    if (optional.length) parts.push(`optional ${optional.join(", ")}`);
    const suffix = parts.length ? ` (${parts.join("; ")})` : "";
    perActionLines.push(`- ${actionName}: ${def.description}${suffix}`);
  }

  const merged: Record<string, unknown> = {};
  for (const [key, variants] of Object.entries(collected)) {
    merged[key] = variants.length === 1 ? variants[0] : { oneOf: variants };
  }

  const description = [tool.description, "Actions:", ...perActionLines].join("\n");

  // Spread `merged` first so a (defensively-skipped) collision can
  // never clobber the discriminator. additionalProperties is left
  // permissive: per-action Zod validation in dispatchTool is the
  // authoritative gate, and a strict top-level schema would reject
  // legitimate per-action fields the merge couldn't represent
  // (e.g. the `action` query param on jira_project.list).
  return {
    type: "object",
    description,
    properties: {
      ...merged,
      action: { type: "string", enum: actionNames },
    },
    required: ["action"],
    additionalProperties: true,
  };
}

// Structural equality for the small JSON Schema fragments produced
// by zodFieldToJsonSchema. Used to dedupe collected variants per
// field — two actions with the same shape contribute one entry, two
// with divergent shapes contribute a oneOf.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

// Reflect over a Zod schema using its constructor names + _def
// shape. This is Zod 4's introspection surface; v3's `_def.typeName`
// is gone. We deliberately limit ourselves to the shapes actually
// used by v2 tool actions — anything unrecognised falls through to a
// permissive `{}`.

interface ZodDef {
  type?: string;
  shape?: Record<string, ZodType>;
  element?: ZodType;
  innerType?: ZodType;
  valueType?: ZodType;
  // ZodUnion: array of constituent schemas.
  options?: ZodType[];
}

function zodKind(schema: ZodType): string {
  return schema.constructor.name;
}

function zodDef(schema: ZodType): ZodDef {
  return ((schema as unknown as { _def?: ZodDef })._def ?? {}) as ZodDef;
}

function zodShape(schema: ZodType): Record<string, ZodType> | undefined {
  // ZodObject exposes `shape` directly; the introspection seen via
  // `_def.shape` is the same record.
  return zodDef(schema).shape;
}

function isOptionalZod(schema: ZodType): boolean {
  const kind = zodKind(schema);
  return kind === "ZodOptional" || kind === "ZodDefault" || kind === "ZodNullable";
}

function unwrap(schema: ZodType): ZodType {
  const kind = zodKind(schema);
  if (kind === "ZodOptional" || kind === "ZodDefault" || kind === "ZodNullable") {
    const inner = zodDef(schema).innerType;
    if (inner) return unwrap(inner);
  }
  return schema;
}

function zodFieldToJsonSchema(schema: ZodType): unknown {
  // Zod 4 attaches `.describe()` metadata to whichever node it was
  // called on. Our action schemas use `z.string().optional().describe(...)`
  // (describe applied to the optional wrapper) far more often than
  // the inverse, so prefer the outer description and fall back to
  // the inner. Without this, every `.optional().describe()` field
  // silently dropped its description from the emitted JSON Schema.
  const outer = (schema as unknown as { description?: string }).description;
  const inner = unwrap(schema);
  const kind = zodKind(inner);
  const description =
    outer ?? (inner as unknown as { description?: string }).description;
  const tail = description ? { description } : {};
  switch (kind) {
    case "ZodString":
      return { type: "string", ...tail };
    case "ZodNumber":
      return { type: "number", ...tail };
    case "ZodBoolean":
      return { type: "boolean", ...tail };
    case "ZodArray": {
      const elem = zodDef(inner).element;
      return {
        type: "array",
        items: elem ? zodFieldToJsonSchema(elem) : {},
        ...tail,
      };
    }
    case "ZodRecord":
    case "ZodObject":
      return { type: "object", additionalProperties: true, ...tail };
    case "ZodUnion": {
      // Render each constituent as its own JSON Schema and combine
      // via oneOf. Without this case, fields like
      // z.union([z.string(), z.array(z.string())]) would emit only
      // their description with no type info, leaving agents unable
      // to satisfy the schema.
      const opts = zodDef(inner).options ?? [];
      return { oneOf: opts.map(zodFieldToJsonSchema), ...tail };
    }
    case "ZodAny":
    case "ZodUnknown":
      return tail;
    default:
      return tail;
  }
}

// --- Dispatch ----------------------------------------------------------

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly tool: string,
    public readonly action: string | undefined,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

const ActionKeySchema = z.object({ action: z.string() }).passthrough();

export async function dispatchTool(
  tool: ConsolidatedTool,
  manifest: Manifest,
  client: JiraClient,
  rawArgs: Record<string, unknown>,
  // Optional. Forwarded to invokeOperation so a JIRA_DISABLED_ACTIONS
  // entry blocks the call before any Jira HTTP request happens.
  disabledActions?: readonly string[],
): Promise<unknown> {
  // Pull off `action`. Anything missing or wrong-typed is a caller
  // error and stops here with a clear message.
  const parsed = ActionKeySchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new ToolError(
      `Tool ${tool.name} requires a string \`action\` arg. Got: ${JSON.stringify(rawArgs)}`,
      tool.name,
      undefined,
      parsed.error,
    );
  }
  const action = parsed.data.action;
  const def = tool.actions[action];
  if (!def) {
    const known = Object.keys(tool.actions).join(", ");
    throw new ToolError(
      `Unknown action "${action}" for tool ${tool.name}. Known: ${known}`,
      tool.name,
      action,
    );
  }

  // Validate the rest of the args against this action's schema.
  // Drop `action` from the input first so it doesn't show up in
  // strict schemas as an unknown field.
  const { action: _drop, ...rest } = rawArgs;
  const validated = def.schema.safeParse(rest);
  if (!validated.success) {
    throw new ToolError(
      `Invalid args for ${tool.name}.${action}: ${zodErrorMessage(validated.error)}`,
      tool.name,
      action,
      validated.error,
    );
  }

  try {
    return await invokeOperation(
      manifest,
      client,
      def.operation,
      validated.data as Record<string, unknown>,
      disabledActions,
    );
  } catch (err) {
    if (err instanceof OperationError) {
      throw new ToolError(err.message, tool.name, action, err);
    }
    throw err;
  }
}

function zodErrorMessage(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
