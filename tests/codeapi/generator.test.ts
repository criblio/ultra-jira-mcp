import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { operations } from "../../src/core/operations.js";
import type { Manifest, Operation } from "../../src/core/manifest.js";
import { generateApi, planApi } from "../../src/codeapi/generator.js";
import {
  GENERATED_BANNER,
  renderCategoryIndex,
  renderClientFile,
  renderRootIndex,
  renderStub,
  renderTypesFile,
  splitOperationName,
} from "../../src/codeapi/templates.js";

// --- Fixture manifest --------------------------------------------------

// Stand-in for the refsImportPath the runtime will pass at server
// startup. Tests don't actually try to resolve this — the generator
// just embeds it in `types.ts`.
const TEST_REFS_IMPORT = "test:refs";

// Tiny synthetic manifest used by the structural tests so we don't
// have to update them every time a real operation is added. The real
// manifest is exercised by the integration test at the bottom.
const fixtureManifest: Manifest = [
  {
    name: "issue.get",
    description: "Fetch a single issue by key or id.",
    verb: "GET",
    pathTemplate: "/issue/{issueIdOrKey}",
    params: [
      { name: "issueIdOrKey", role: "path", required: true },
      { name: "fields", role: "query" },
      { name: "expand", role: "query" },
    ],
    trim: "issue",
  },
  {
    name: "issue.create",
    description: "Create a new issue.",
    verb: "POST",
    pathTemplate: "/issue",
    params: [
      { name: "fields", role: "body", required: true },
      { name: "update", role: "body" },
    ],
  },
  {
    name: "board.get",
    description: "Fetch a board by id.",
    verb: "GET",
    pathTemplate: "/board/{boardId}",
    isAgile: true,
    params: [{ name: "boardId", role: "path", required: true }],
  },
  {
    name: "server.info",
    description: "Server info.",
    verb: "GET",
    pathTemplate: "/serverInfo",
    params: [],
  },
];

// --- splitOperationName ------------------------------------------------

describe("splitOperationName", () => {
  it("splits at the first dot", () => {
    expect(splitOperationName("issue.get")).toEqual({
      category: "issue",
      verb: "get",
    });
  });

  it("preserves dots after the first", () => {
    expect(splitOperationName("issue.foo.bar")).toEqual({
      category: "issue",
      verb: "foo.bar",
    });
  });

  it("throws on names without a dot", () => {
    expect(() => splitOperationName("noDot")).toThrow(/category\.verb/);
  });
});

// --- renderStub --------------------------------------------------------

describe("renderStub", () => {
  it("emits a typed args interface and function for a GET with path + query", () => {
    const op: Operation = fixtureManifest[0];
    const { relativePath, contents } = renderStub(op);

    expect(relativePath).toBe("issue/get.ts");
    expect(contents.startsWith(GENERATED_BANNER)).toBe(true);
    expect(contents).toContain('import { invoke } from "../_client.js";');
    expect(contents).toContain('import type { Ref } from "../types.js";');
    expect(contents).toContain("export interface IssueGetArgs {");
    expect(contents).toContain("issueIdOrKey: string | number;");
    expect(contents).toContain(
      "fields?: string | number | boolean | Array<string | number>;",
    );
    expect(contents).toContain("export function get(args: IssueGetArgs)");
    expect(contents).toContain('return invoke("issue.get", args);');
    expect(contents).toContain("Operation: issue.get (GET /issue/{issueIdOrKey})");
    expect(contents).toContain("'issue' projection");
  });

  it("marks path params required even when manifest leaves required undeclared", () => {
    const op: Operation = {
      name: "thing.get",
      description: "x",
      verb: "GET",
      pathTemplate: "/thing/{id}",
      params: [{ name: "id", role: "path" }],
    };
    const { contents } = renderStub(op);
    // No `?` after the param name.
    expect(contents).toMatch(/^\s*id: string \| number;/m);
    expect(contents).not.toMatch(/id\?: /);
  });

  it("emits an empty-args function for operations with no params", () => {
    const op = fixtureManifest[3];
    const { contents } = renderStub(op);
    expect(contents).not.toContain("interface ServerInfoArgs");
    expect(contents).toContain(
      "export function info(args: Record<string, never> = {})",
    );
    expect(contents).toContain('return invoke("server.info", {});');
  });

  it("notes agile endpoints in the JSDoc", () => {
    const op = fixtureManifest[2];
    const { contents } = renderStub(op);
    expect(contents).toContain("(Agile API endpoint.)");
  });

  it("body params type as unknown", () => {
    const op = fixtureManifest[1];
    const { contents } = renderStub(op);
    expect(contents).toContain("fields: unknown;");
    expect(contents).toContain("update?: unknown;");
  });

  it("orders fields: required first, then by role, then alphabetic", () => {
    const op: Operation = {
      name: "x.y",
      description: "z",
      verb: "POST",
      pathTemplate: "/x/{id}",
      params: [
        { name: "id", role: "path", required: true },
        { name: "zebra", role: "query" },
        { name: "alpha", role: "query" },
        { name: "body1", role: "body", required: true },
        { name: "body2", role: "body" },
      ],
    };
    const { contents } = renderStub(op);
    const idIdx = contents.indexOf("id:");
    const body1Idx = contents.indexOf("body1:");
    const alphaIdx = contents.indexOf("alpha?:");
    const zebraIdx = contents.indexOf("zebra?:");
    const body2Idx = contents.indexOf("body2?:");

    expect(idIdx).toBeGreaterThan(0);
    expect(idIdx).toBeLessThan(body1Idx);
    expect(body1Idx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(zebraIdx);
    expect(zebraIdx).toBeLessThan(body2Idx);
  });
});

// --- renderCategoryIndex ----------------------------------------------

describe("renderCategoryIndex", () => {
  it("re-exports each verb from a sibling file", () => {
    const out = renderCategoryIndex("issue", [
      fixtureManifest[0],
      fixtureManifest[1],
    ]);
    expect(out).toContain('export { create } from "./create.js";');
    expect(out).toContain('export { get } from "./get.js";');
    // Alphabetic order — `create` before `get`.
    expect(out.indexOf("create")).toBeLessThan(out.indexOf("./get.js"));
  });
});

// --- renderRootIndex ---------------------------------------------------

describe("renderRootIndex", () => {
  it("re-exports each category as a namespace", () => {
    const out = renderRootIndex(["issue", "board", "server"]);
    expect(out).toContain('export * as board from "./board/index.js";');
    expect(out).toContain('export * as issue from "./issue/index.js";');
    expect(out).toContain('export * as server from "./server/index.js";');
  });
});

// --- renderClientFile / renderTypesFile -------------------------------

describe("renderClientFile", () => {
  it("emits an invoke function that throws (PR #9 placeholder)", () => {
    const out = renderClientFile();
    expect(out).toContain("export async function invoke(");
    expect(out).toContain("PR #9");
    expect(out).toContain("throw new Error");
  });
});

describe("renderTypesFile", () => {
  it("re-exports Ref from the configured import path", () => {
    const out = renderTypesFile("/abs/build/types/refs.js");
    expect(out).toContain(
      'export type { Ref, SandboxResult } from "/abs/build/types/refs.js";',
    );
  });
});

// --- planApi -----------------------------------------------------------

describe("planApi", () => {
  it("plans every operation plus support files, in deterministic order", () => {
    const plan = planApi(fixtureManifest, TEST_REFS_IMPORT);
    const paths = plan.map((p) => p.relativePath);

    expect(paths).toContain("_client.ts");
    expect(paths).toContain("types.ts");
    expect(paths).toContain("index.ts");
    expect(paths).toContain("issue/index.ts");
    expect(paths).toContain("issue/get.ts");
    expect(paths).toContain("issue/create.ts");
    expect(paths).toContain("board/get.ts");
    expect(paths).toContain("server/info.ts");

    // Deterministic — sorted by relativePath.
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
  });

  it("plans the real manifest without throwing and covers every operation", () => {
    const plan = planApi(operations, TEST_REFS_IMPORT);
    const stubPaths = plan
      .map((p) => p.relativePath)
      .filter((p) => p !== "_client.ts" && p !== "types.ts" && p !== "index.ts")
      .filter((p) => !p.endsWith("/index.ts"));

    // One stub per operation, no more, no less.
    expect(stubPaths.length).toBe(operations.length);
    // And no duplicates — confirms planApi's collision check holds
    // across every entry actually shipped.
    expect(new Set(stubPaths).size).toBe(stubPaths.length);
  });

  it("throws when two operations would emit to the same path", () => {
    const collidingManifest: Manifest = [
      {
        name: "issue.get",
        description: "First.",
        verb: "GET",
        pathTemplate: "/issue/{id}",
        params: [{ name: "id", role: "path", required: true }],
      },
      {
        name: "issue.get",
        description: "Duplicate.",
        verb: "GET",
        pathTemplate: "/v2/issue/{id}",
        params: [{ name: "id", role: "path", required: true }],
      },
    ];
    expect(() => planApi(collidingManifest, TEST_REFS_IMPORT)).toThrow(
      /would overwrite stub for 'issue\.get'/,
    );
  });

  it("renames reserved-word verbs in stub function and re-export", () => {
    const reservedManifest: Manifest = [
      {
        name: "thing.delete",
        description: "Delete a thing.",
        verb: "DELETE",
        pathTemplate: "/thing/{id}",
        params: [{ name: "id", role: "path", required: true }],
      },
    ];
    const plan = planApi(reservedManifest, TEST_REFS_IMPORT);
    const stub = plan.find((p) => p.relativePath === "thing/delete.ts");
    const index = plan.find((p) => p.relativePath === "thing/index.ts");
    expect(stub?.contents).toContain("export function delete_(");
    // Stub text still references the manifest-stable operation name.
    expect(stub?.contents).toContain('invoke("thing.delete"');
    // Re-export uses the renamed binding so the index file is valid TS.
    expect(index?.contents).toContain('export { delete_ } from "./delete.js"');
  });
});

// --- generateApi (writes to disk) -------------------------------------

describe("generateApi", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = path.join(
      os.tmpdir(),
      `jira-mcp-codeapi-test-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );
  });

  afterEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it("writes every planned file and reports counts", async () => {
    const result = await generateApi({
      manifest: fixtureManifest,
      outDir,
      refsImportPath: TEST_REFS_IMPORT,
    });

    expect(result.operationCount).toBe(fixtureManifest.length);
    expect(result.categories.sort()).toEqual(["board", "issue", "server"]);
    expect(result.files.length).toBe(
      planApi(fixtureManifest, TEST_REFS_IMPORT).length,
    );

    // Spot-check a few of the actual files on disk.
    const issueGet = await fs.readFile(
      path.join(outDir, "issue", "get.ts"),
      "utf8",
    );
    expect(issueGet).toContain("export function get(args: IssueGetArgs)");

    const rootIndex = await fs.readFile(
      path.join(outDir, "index.ts"),
      "utf8",
    );
    expect(rootIndex).toContain("export * as issue from");

    // types.ts uses the configured import path — verifies refsImportPath
    // is plumbed end-to-end through generateApi.
    const types = await fs.readFile(path.join(outDir, "types.ts"), "utf8");
    expect(types).toContain(`from "${TEST_REFS_IMPORT}"`);
  });

  it("is idempotent across consecutive runs", async () => {
    const first = await generateApi({
      manifest: fixtureManifest,
      outDir,
      refsImportPath: TEST_REFS_IMPORT,
    });
    const firstSnapshot: Record<string, string> = {};
    for (const f of first.files) {
      firstSnapshot[f.path] = await fs.readFile(f.path, "utf8");
    }

    const second = await generateApi({
      manifest: fixtureManifest,
      outDir,
      refsImportPath: TEST_REFS_IMPORT,
    });
    expect(second.files.length).toBe(first.files.length);
    for (const f of second.files) {
      const before = firstSnapshot[f.path];
      const after = await fs.readFile(f.path, "utf8");
      expect(after).toBe(before);
    }
  });

  it("can generate against the real manifest", async () => {
    const result = await generateApi({
      manifest: operations,
      outDir,
      refsImportPath: TEST_REFS_IMPORT,
    });
    expect(result.operationCount).toBe(operations.length);

    // Sanity: the file we know exists in the manifest renders to disk.
    const issueGet = await fs.readFile(
      path.join(outDir, "issue", "get.ts"),
      "utf8",
    );
    expect(issueGet).toContain('return invoke("issue.get", args);');

    // The real manifest has multiple `*.delete` operations — confirm
    // the reserved-word rename actually runs end-to-end on disk.
    const issueDelete = await fs.readFile(
      path.join(outDir, "issue", "delete.ts"),
      "utf8",
    );
    expect(issueDelete).toContain("export function delete_(");
  });
});
