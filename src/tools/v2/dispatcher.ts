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

// Build the input schema the MCP tool listing exposes. Uses oneOf so
// the agent's tool-use renderer constrains output per action.
//
// We don't go through zod-to-json-schema because (a) we want full
// control over the wire shape, (b) it'd add a dep, and (c) the action
// schemas are small enough that hand-shaped JSON is clearer.
export function buildInputSchema(tool: ConsolidatedTool): unknown {
  const oneOf: unknown[] = [];
  for (const [actionName, def] of Object.entries(tool.actions)) {
    oneOf.push({
      type: "object",
      title: actionName,
      description: def.description,
      properties: zodToProperties(def.schema, actionName),
      required: zodRequired(def.schema, actionName),
      additionalProperties: false,
    });
  }
  return {
    type: "object",
    description: tool.description,
    oneOf,
  };
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

// Pull the property descriptors out of a Zod object schema and
// inject `{ action: { const: <actionName> } }` so MCP's discriminator
// works.
function zodToProperties(schema: ZodType, actionName: string): Record<string, unknown> {
  const props: Record<string, unknown> = {
    action: { type: "string", const: actionName },
  };
  const shape = zodShape(schema);
  if (shape) {
    for (const [key, sub] of Object.entries(shape)) {
      props[key] = zodFieldToJsonSchema(sub);
    }
  }
  return props;
}

function zodRequired(schema: ZodType, _actionName: string): string[] {
  const req = ["action"];
  const shape = zodShape(schema);
  if (shape) {
    for (const [key, sub] of Object.entries(shape)) {
      if (!isOptionalZod(sub)) req.push(key);
    }
  }
  return req;
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
  const inner = unwrap(schema);
  const kind = zodKind(inner);
  const description = (inner as unknown as { description?: string }).description;
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
