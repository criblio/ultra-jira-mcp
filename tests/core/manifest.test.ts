import { describe, expect, it, vi } from "vitest";

import type { JiraClient } from "../../src/auth/jira-client.js";
import {
  extractPathParams,
  interpolatePath,
  invokeOperation,
  OperationError,
  splitArgs,
  type Manifest,
  type Operation,
} from "../../src/core/manifest.js";

// --- Helpers -----------------------------------------------------------

function makeMockClient(): {
  client: JiraClient;
  calls: Array<{
    api: "get" | "post" | "put" | "delete" | "agileGet" | "agilePost" | "agilePut" | "agileDelete";
    path: string;
    body?: unknown;
    query?: unknown;
  }>;
  returns: unknown;
  setReturn(v: unknown): void;
} {
  const calls: any[] = [];
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

  return {
    client,
    calls,
    returns: ret,
    setReturn(v) {
      ret = v;
    },
  };
}

// --- extractPathParams -------------------------------------------------

describe("extractPathParams", () => {
  it("returns [] for templates with no placeholders", () => {
    expect(extractPathParams("/field")).toEqual([]);
  });

  it("finds a single placeholder", () => {
    expect(extractPathParams("/issue/{issueIdOrKey}")).toEqual(["issueIdOrKey"]);
  });

  it("finds multiple placeholders in order", () => {
    expect(
      extractPathParams("/board/{boardId}/sprint/{sprintId}/issue"),
    ).toEqual(["boardId", "sprintId"]);
  });
});

// --- interpolatePath ---------------------------------------------------

describe("interpolatePath", () => {
  it("substitutes a single placeholder", () => {
    expect(interpolatePath("/issue/{key}", { key: "PROJ-1" })).toBe("/issue/PROJ-1");
  });

  it("URI-encodes substituted values", () => {
    // Stretch: a key with characters that need encoding. In practice
    // Jira keys won't hit this, but boardId could be a numeric id
    // rendered from an attacker-controlled string.
    expect(interpolatePath("/q/{v}", { v: "a/b c" })).toBe("/q/a%2Fb%20c");
  });

  it("throws on missing required path param", () => {
    expect(() => interpolatePath("/issue/{key}", {})).toThrow(/Missing.*key/);
  });

  it("throws on null path param", () => {
    expect(() => interpolatePath("/issue/{key}", { key: null })).toThrow();
  });

  it("is a no-op for templates with no placeholders", () => {
    expect(interpolatePath("/field", {})).toBe("/field");
  });
});

// --- splitArgs ---------------------------------------------------------

function makeOp(params: Operation["params"]): Operation {
  return {
    name: "test.op",
    description: "",
    verb: "GET",
    pathTemplate: "/x",
    params,
  };
}

describe("splitArgs", () => {
  it("partitions path/query/body and reports unknowns", () => {
    const op = makeOp([
      { name: "a", role: "path", required: true },
      { name: "b", role: "query" },
      { name: "c", role: "body" },
    ]);
    const s = splitArgs(op, { a: "A", b: 2, c: { x: 1 }, d: "unknown" });
    expect(s.pathParams).toEqual({ a: "A" });
    expect(s.queryParams).toEqual({ b: 2 });
    expect(s.body).toEqual({ c: { x: 1 } });
    expect(s.unknown).toEqual(["d"]);
    expect(s.missingRequired).toEqual([]);
  });

  it("reports missing required params", () => {
    const op = makeOp([
      { name: "a", role: "path", required: true },
      { name: "b", role: "body", required: true },
    ]);
    const s = splitArgs(op, {});
    expect(s.missingRequired.sort()).toEqual(["a", "b"]);
  });

  it("sets body to undefined when no body params are supplied", () => {
    const op = makeOp([
      { name: "a", role: "path", required: true },
      { name: "b", role: "body" },
    ]);
    expect(splitArgs(op, { a: "A" }).body).toBeUndefined();
  });

  it("omits undefined values entirely so missing optionals don't leak into query string", () => {
    const op = makeOp([{ name: "fields", role: "query" }]);
    expect(splitArgs(op, { fields: undefined }).queryParams).toEqual({});
  });

  it("treats explicit null the same as undefined for required-param detection", () => {
    const op = makeOp([
      { name: "key", role: "path", required: true },
      { name: "fields", role: "query" },
    ]);
    const s = splitArgs(op, { key: null, fields: null });
    expect(s.missingRequired).toEqual(["key"]);
    expect(s.pathParams).toEqual({});
    expect(s.queryParams).toEqual({});
  });
});

// --- invokeOperation ---------------------------------------------------

const manifest: Manifest = [
  {
    name: "issue.get",
    description: "",
    verb: "GET",
    pathTemplate: "/issue/{key}",
    params: [
      { name: "key", role: "path", required: true },
      { name: "fields", role: "query" },
    ],
    trim: "issue",
  },
  {
    name: "issue.create",
    description: "",
    verb: "POST",
    pathTemplate: "/issue",
    params: [{ name: "fields", role: "body", required: true }],
  },
  {
    name: "issue.delete",
    description: "",
    verb: "DELETE",
    pathTemplate: "/issue/{key}",
    params: [{ name: "key", role: "path", required: true }],
  },
  {
    name: "board.get",
    description: "",
    verb: "GET",
    pathTemplate: "/board/{boardId}",
    isAgile: true,
    params: [{ name: "boardId", role: "path", required: true }],
  },
];

describe("invokeOperation", () => {
  it("throws OperationError for an unknown operation name", async () => {
    const { client } = makeMockClient();
    await expect(
      invokeOperation(manifest, client, "does.not.exist", {}),
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("throws OperationError for missing required params", async () => {
    const { client } = makeMockClient();
    await expect(
      invokeOperation(manifest, client, "issue.create", {}),
    ).rejects.toThrow(/Missing required param.*fields/);
  });

  it("throws OperationError (not plain Error) when a required param is explicit null", async () => {
    const { client } = makeMockClient();
    // Regression test for PR #172 review: previously null bypassed
    // splitArgs' required-check and bubbled through to
    // interpolatePath as a plain Error, breaking `instanceof OperationError`
    // handling at the caller.
    await expect(
      invokeOperation(manifest, client, "issue.get", { key: null }),
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("routes GET with path + query params through JiraClient.get", async () => {
    const ctx = makeMockClient();
    ctx.setReturn({ id: "1", key: "PROJ-1", fields: { summary: "hi" } });
    await invokeOperation(manifest, ctx.client, "issue.get", {
      key: "PROJ-1",
      fields: "summary,status",
    });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({
      api: "get",
      path: "/issue/PROJ-1",
      query: { fields: "summary,status" },
    });
  });

  it("routes POST with body through JiraClient.post", async () => {
    const ctx = makeMockClient();
    await invokeOperation(manifest, ctx.client, "issue.create", {
      fields: { summary: "New" },
    });
    expect(ctx.calls[0]).toMatchObject({
      api: "post",
      path: "/issue",
      body: { fields: { summary: "New" } },
    });
  });

  it("routes DELETE with path through JiraClient.delete", async () => {
    const ctx = makeMockClient();
    await invokeOperation(manifest, ctx.client, "issue.delete", { key: "PROJ-1" });
    expect(ctx.calls[0]).toMatchObject({
      api: "delete",
      path: "/issue/PROJ-1",
    });
  });

  it("routes Agile operations to agile* methods", async () => {
    const ctx = makeMockClient();
    await invokeOperation(manifest, ctx.client, "board.get", { boardId: 42 });
    expect(ctx.calls[0]).toMatchObject({
      api: "agileGet",
      path: "/board/42",
    });
  });

  it("joins array query params with commas (Jira convention)", async () => {
    const ctx = makeMockClient();
    ctx.setReturn({
      id: "1",
      key: "PROJ-1",
      fields: {
        summary: "",
        labels: [],
        description: null,
      },
    });
    await invokeOperation(manifest, ctx.client, "issue.get", {
      key: "PROJ-1",
      fields: ["summary", "status", "assignee"],
    });
    expect(ctx.calls[0].query).toEqual({ fields: "summary,status,assignee" });
  });

  it("applies trim projection when specified", async () => {
    const ctx = makeMockClient();
    // Minimal shape that issueSummary accepts — description and
    // comment/attachment wrappers can be absent (null/undefined).
    ctx.setReturn({
      id: "1",
      key: "PROJ-1",
      fields: {
        summary: "hi",
        labels: [],
        status: { id: "1", name: "To Do" },
        description: null,
      },
    });
    const result = (await invokeOperation(manifest, ctx.client, "issue.get", {
      key: "PROJ-1",
    })) as { key: string; status?: string; descriptionPreview: string };
    // Trimmed shape: flat fields, no raw ADF tree.
    expect(result.key).toBe("PROJ-1");
    expect(result.status).toBe("To Do");
    expect(result.descriptionPreview).toBe("");
  });
});
