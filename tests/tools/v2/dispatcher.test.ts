import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { JiraClient } from "../../../src/auth/jira-client.js";
import type { Manifest } from "../../../src/core/manifest.js";
import {
  buildInputSchema,
  dispatchTool,
  ToolError,
  type ConsolidatedTool,
} from "../../../src/tools/v2/dispatcher.js";
import { getV2Tools } from "../../../src/tools/v2/index.js";

// --- Mock infra --------------------------------------------------------

function makeMockClient() {
  const calls: Array<{ api: string; path: string; query?: unknown; body?: unknown }> = [];
  let ret: unknown = {};
  const record = (api: string) =>
    vi.fn((path: string, bodyOrQuery?: unknown, maybeQuery?: unknown) => {
      if (api === "get" || api === "delete" || api === "agileGet" || api === "agileDelete") {
        calls.push({ api, path, query: bodyOrQuery });
      } else {
        calls.push({ api, path, body: bodyOrQuery, query: maybeQuery });
      }
      return Promise.resolve(ret);
    });
  const client = {
    get: record("get"),
    post: record("post"),
    put: record("put"),
    delete: record("delete"),
    agileGet: record("agileGet"),
    agilePost: record("agilePost"),
    agilePut: record("agilePut"),
    agileDelete: record("agileDelete"),
  } as unknown as JiraClient;
  return { client, calls, setReturn: (v: unknown) => { ret = v; } };
}

const fixtureManifest: Manifest = [
  {
    name: "fx.get",
    description: "",
    verb: "GET",
    pathTemplate: "/x/{id}",
    params: [
      { name: "id", role: "path", required: true },
      { name: "expand", role: "query" },
    ],
  },
  {
    name: "fx.create",
    description: "",
    verb: "POST",
    pathTemplate: "/x",
    params: [{ name: "name", role: "body", required: true }],
  },
  {
    name: "fx.list",
    description: "",
    verb: "GET",
    pathTemplate: "/x",
    params: [],
    // Use bareList so the test can distinguish trimmed (count
    // wrapper) from raw (the underlying array).
    trim: "bareList",
  },
];

const fixtureTool: ConsolidatedTool = {
  name: "jira_fx",
  description: "",
  actions: {
    get: {
      description: "Get one",
      schema: z.object({
        id: z.string(),
        expand: z.string().optional(),
      }),
      operation: "fx.get",
    },
    create: {
      description: "Create one",
      schema: z.object({
        name: z.string(),
      }),
      operation: "fx.create",
    },
    list: {
      description: "List many",
      schema: z.object({}),
      operation: "fx.list",
    },
  },
};

// --- dispatch tests ---------------------------------------------------

describe("dispatchTool", () => {
  it("rejects when action is missing", async () => {
    const { client } = makeMockClient();
    await expect(dispatchTool(fixtureTool, fixtureManifest, client, {})).rejects.toBeInstanceOf(ToolError);
    await expect(dispatchTool(fixtureTool, fixtureManifest, client, {})).rejects.toThrow(/requires.*action/);
  });

  it("rejects unknown actions with the list of known ones", async () => {
    const { client } = makeMockClient();
    await expect(
      dispatchTool(fixtureTool, fixtureManifest, client, { action: "nope" }),
    ).rejects.toThrow(/Unknown action.*Known: get, create/);
  });

  it("rejects when args fail Zod validation", async () => {
    const { client } = makeMockClient();
    await expect(
      // missing required `id`
      dispatchTool(fixtureTool, fixtureManifest, client, { action: "get" }),
    ).rejects.toThrow(/Invalid args.*jira_fx\.get/);
  });

  it("strips `action` before passing args to invokeOperation", async () => {
    const ctx = makeMockClient();
    await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "get",
      id: "42",
      expand: "transitions",
    });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/x/42",
      query: { expand: "transitions" },
    });
  });

  it("dispatches POST + body for write actions", async () => {
    const ctx = makeMockClient();
    await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "create",
      name: "thing",
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/x",
      body: { name: "thing" },
    });
  });

  it("applies the trim projection by default", async () => {
    // bareList collapses an array to {count, truncated}. Without
    // `full`, the dispatcher must surface the trimmed shape.
    const ctx = makeMockClient();
    ctx.setReturn([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const result = await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "list",
    });
    expect(result).toEqual({ count: 3, truncated: true });
  });

  it("returns the raw response when `full: true` is passed", async () => {
    // The escape hatch: agent opts into the un-trimmed body when the
    // summary drops content it needs. `full` is a meta-arg the
    // dispatcher peels off before per-action Zod validation, so it
    // works on every consolidated tool without per-action plumbing.
    const ctx = makeMockClient();
    const raw = [{ id: "a" }, { id: "b" }, { id: "c" }];
    ctx.setReturn(raw);
    const result = await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "list",
      full: true,
    });
    expect(result).toEqual(raw);
  });

  it("treats `full: false` and a missing `full` identically (still trimmed)", async () => {
    const ctx = makeMockClient();
    ctx.setReturn([{ id: "a" }]);
    const result = await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "list",
      full: false,
    });
    expect(result).toEqual({ count: 1, truncated: true });
  });

  it("does not pass `full` through to the underlying request", async () => {
    // Otherwise Jira would receive ?full=true as a query param.
    const ctx = makeMockClient();
    ctx.setReturn([]);
    await dispatchTool(fixtureTool, fixtureManifest, ctx.client, {
      action: "list",
      full: true,
    });
    expect(ctx.calls[0]).toMatchObject({ api: "get", path: "/x" });
    const query = (ctx.calls[0] as { query?: Record<string, unknown> }).query;
    expect(query ?? {}).not.toHaveProperty("full");
  });

  it("wraps OperationError as ToolError so callers see a tool-shaped failure", async () => {
    const ctx = makeMockClient();
    // Operation that doesn't exist — invokeOperation throws OperationError.
    const badTool: ConsolidatedTool = {
      name: "jira_bad",
      description: "",
      actions: {
        go: {
          description: "",
          schema: z.object({}),
          operation: "missing.op",
        },
      },
    };
    const err = await dispatchTool(badTool, fixtureManifest, ctx.client, { action: "go" }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).action).toBe("go");
    expect((err as ToolError).tool).toBe("jira_bad");
  });
});

// --- buildInputSchema tests -------------------------------------------

describe("buildInputSchema", () => {
  it("emits a flat object schema with action as a string enum", () => {
    // Top-level oneOf/allOf/anyOf is rejected by the Anthropic
    // tool-use API. The schema must stay flat; per-action arg
    // validation happens in dispatchTool against the Zod schema.
    const schema = buildInputSchema(fixtureTool) as {
      type: string;
      properties: {
        action: { type: string; enum: string[] };
        [key: string]: unknown;
      };
      required: string[];
      additionalProperties: boolean;
      oneOf?: unknown;
      allOf?: unknown;
      anyOf?: unknown;
    };
    expect(schema.type).toBe("object");
    expect(schema.oneOf).toBeUndefined();
    expect(schema.allOf).toBeUndefined();
    expect(schema.anyOf).toBeUndefined();
    expect(schema.properties.action.type).toBe("string");
    expect(schema.properties.action.enum.sort()).toEqual(["create", "get", "list"]);
    expect(schema.required).toEqual(["action"]);
    // Permissive: per-action Zod validation is the authoritative gate
    // and strips unknowns. A strict top-level schema would reject
    // per-action fields the merge couldn't represent (e.g. an action
    // schema declaring its own `action`-named query param).
    expect(schema.additionalProperties).toBe(true);
  });

  it("exposes the `full` meta-arg on every tool's schema", () => {
    // Agents need to see `full` in the schema to discover the
    // bypass-trim escape hatch. Per-action plumbing isn't needed —
    // dispatcher handles it once for every tool.
    const schema = buildInputSchema(fixtureTool) as {
      properties: { full?: { type?: string; description?: string } };
      description: string;
    };
    expect(schema.properties.full?.type).toBe("boolean");
    expect(schema.properties.full?.description).toMatch(/raw Jira API/);
    expect(schema.description).toMatch(/full: true/);
  });

  it("merges fields from all actions into a single property bag", () => {
    const schema = buildInputSchema(fixtureTool) as {
      properties: Record<string, unknown>;
    };
    // `id` is from get, `name` is from create — both must be present
    // so the agent can construct a valid call for either action.
    expect(schema.properties.id).toBeDefined();
    expect(schema.properties.name).toBeDefined();
    expect(schema.properties.expand).toBeDefined();
  });

  it("surfaces per-action required/optional fields in the description", () => {
    // Since the JSON Schema can't encode "required only when
    // action=X", the description has to carry that signal so the
    // agent doesn't have to guess.
    const schema = buildInputSchema(fixtureTool) as { description: string };
    expect(schema.description).toContain("get:");
    expect(schema.description).toContain("Get one");
    expect(schema.description).toContain("requires id");
    expect(schema.description).toContain("optional expand");
    expect(schema.description).toContain("create:");
    expect(schema.description).toContain("requires name");
  });

  it("emits oneOf for ZodUnion fields so agents see the variant types", () => {
    // Regression test for PR #174 review: previously ZodUnion fell
    // through to the default branch and produced { description } only,
    // leaving the wire shape unconstrained. oneOf nested under a
    // property is fine — only top-level oneOf is rejected.
    const tool: ConsolidatedTool = {
      name: "jira_u",
      description: "",
      actions: {
        do: {
          description: "",
          schema: z.object({
            picky: z
              .union([z.string(), z.array(z.string()), z.number()])
              .describe("string, array of strings, or number"),
          }),
          operation: "fx.get",
        },
      },
    };
    const schema = buildInputSchema(tool) as {
      properties: Record<string, unknown>;
    };
    const picky = schema.properties.picky as {
      oneOf?: Array<{ type?: string; items?: { type?: string } }>;
      description?: string;
    };
    expect(picky?.description).toBe("string, array of strings, or number");
    expect(picky?.oneOf).toHaveLength(3);
    expect(picky?.oneOf?.[0]).toEqual({ type: "string" });
    expect(picky?.oneOf?.[1]).toEqual({
      type: "array",
      items: { type: "string" },
    });
    expect(picky?.oneOf?.[2]).toEqual({ type: "number" });
  });

  it("preserves descriptions when describe() is on the optional wrapper", () => {
    // Zod 4 attaches describe() metadata to whichever node it's
    // called on. The common idiom in v2 is
    // `z.string().optional().describe(...)` — describe on the
    // outer optional. The schema-builder used to read .description
    // only after unwrapping, silently dropping every description
    // attached to an optional/nullable wrapper.
    const tool: ConsolidatedTool = {
      name: "jira_desc",
      description: "",
      actions: {
        a: {
          description: "",
          schema: z.object({
            outer: z.string().optional().describe("on the wrapper"),
            inner: z.string().describe("on the inner").optional(),
          }),
          operation: "fx.get",
        },
      },
    };
    const schema = buildInputSchema(tool) as {
      properties: {
        outer: { description?: string };
        inner: { description?: string };
      };
    };
    expect(schema.properties.outer.description).toBe("on the wrapper");
    expect(schema.properties.inner.description).toBe("on the inner");
  });

  it("emits a property-level oneOf when a field has different types across actions", () => {
    // Regression: jira_issue.fields is z.string() in `get` (CSV
    // list) but z.record(...) in `create`/`update`/`transition`.
    // The original flat-merge took first-wins, so create/update
    // saw `{ type: "string" }` and the agent would send a string
    // that failed Zod validation. Property-level oneOf lets the
    // agent see both variants.
    const tool: ConsolidatedTool = {
      name: "jira_collide",
      description: "",
      actions: {
        get: {
          description: "",
          schema: z.object({ fields: z.string().optional() }),
          operation: "fx.get",
        },
        create: {
          description: "",
          schema: z.object({
            fields: z.record(z.string(), z.unknown()),
          }),
          operation: "fx.create",
        },
      },
    };
    const schema = buildInputSchema(tool) as {
      properties: { fields: { oneOf?: Array<{ type?: string }> } };
    };
    const fields = schema.properties.fields;
    expect(fields.oneOf).toBeDefined();
    const types = fields.oneOf!.map((v) => v.type).sort();
    expect(types).toEqual(["object", "string"]);
  });

  it("does not let an action-named field clobber the discriminator", () => {
    // Regression: jira_project.list has `action: z.string().optional()`
    // (a Jira API filter param). The original spread put the
    // discriminator first and `...merged` last, so merged.action
    // overwrote the enum. Now merged is spread first AND `action`
    // is skipped during merge — the discriminator must survive
    // intact.
    const tool: ConsolidatedTool = {
      name: "jira_collide_action",
      description: "",
      actions: {
        list: {
          description: "",
          schema: z.object({
            action: z.string().optional(),
            query: z.string().optional(),
          }),
          operation: "fx.get",
        },
        get: {
          description: "",
          schema: z.object({ id: z.string() }),
          operation: "fx.get",
        },
      },
    };
    const schema = buildInputSchema(tool) as {
      properties: {
        action: { type: string; enum?: string[] };
        query?: unknown;
      };
    };
    expect(schema.properties.action.type).toBe("string");
    expect(schema.properties.action.enum?.sort()).toEqual(["get", "list"]);
  });
});

// --- Real-tool invariants ---------------------------------------------
//
// Loop over every consolidated v2 tool and assert the schema
// invariants the Anthropic tool-use API requires. The synthetic
// fixtureTool above can't catch tool-specific collisions; this
// integration-style sweep does.

describe("buildInputSchema across all consolidated tools", () => {
  it("emits no top-level oneOf/allOf/anyOf and a real action enum for any tool", () => {
    for (const tool of getV2Tools()) {
      const schema = tool.inputSchema as Record<string, unknown> & {
        properties?: { action?: { type?: string; enum?: string[] } };
      };
      expect(schema.oneOf, `${tool.name} top-level oneOf`).toBeUndefined();
      expect(schema.allOf, `${tool.name} top-level allOf`).toBeUndefined();
      expect(schema.anyOf, `${tool.name} top-level anyOf`).toBeUndefined();

      const action = schema.properties?.action;
      expect(action?.type, `${tool.name} action discriminator type`).toBe(
        "string",
      );
      expect(
        Array.isArray(action?.enum) && action!.enum!.length > 0,
        `${tool.name} action enum non-empty`,
      ).toBe(true);
    }
  });
});
