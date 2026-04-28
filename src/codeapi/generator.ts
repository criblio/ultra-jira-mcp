// Code-API generator (Layer 3, PR #8).
//
// Walks the manifest and emits one TypeScript stub per operation
// under `${outDir}/api/`. Output is deterministic: same manifest +
// same outDir = byte-identical files. That property lets us
// golden-snapshot the result in tests and lets the runtime skip
// regeneration when the manifest hasn't changed.
//
// PR #9 will plug a real IPC bridge into the emitted `_client.ts`.
// PR #10 will call `generateApi()` from the MCP server's startup
// path, pointing outDir at the session cache directory.

import * as fsp from "node:fs/promises";
import * as path from "node:path";

import type { Manifest, Operation } from "../core/manifest.js";
import {
  renderCategoryIndex,
  renderClientFile,
  renderRootIndex,
  renderStub,
  renderTypesFile,
  splitOperationName,
  type RenderedStub,
} from "./templates.js";

export interface GenerateApiOptions {
  manifest: Manifest;
  // Directory to emit into. Created (recursively) if absent. Existing
  // files are overwritten; stale files from a previous run are NOT
  // pruned (deferred to PR #10 where we own the lifecycle).
  outDir: string;
  // Module specifier the generated `types.ts` imports `Ref` from.
  // Resolution happens in the agent's execution context, NOT here, so
  // the caller must pass a value that resolves *from the stubs' final
  // location*. Two common shapes:
  //   - bare specifier (e.g. "jira-mcp/build/types/refs.js") only
  //     works if the agent's working dir has jira-mcp on its node
  //     module path
  //   - absolute path (e.g. "/usr/local/lib/.../build/types/refs.js")
  //     always works but is install-specific
  // PR #10 owns picking the right value at server-startup time;
  // there's no safe default the generator can synthesize on its own.
  refsImportPath: string;
}

export interface GeneratedFile {
  // Absolute path of the file written.
  path: string;
  // Bytes written. Useful for the runtime to log / sanity-check.
  size: number;
}

export interface GenerateApiResult {
  outDir: string;
  files: GeneratedFile[];
  operationCount: number;
  categories: string[];
}

// Group operations by their category prefix. Returns a Map so iteration
// order is stable (insertion-ordered by first occurrence in the manifest).
function groupByCategory(manifest: Manifest): Map<string, Operation[]> {
  const groups = new Map<string, Operation[]>();
  for (const op of manifest) {
    const { category } = splitOperationName(op.name);
    const existing = groups.get(category);
    if (existing) {
      existing.push(op);
    } else {
      groups.set(category, [op]);
    }
  }
  return groups;
}

// Pure planning step: compute every file we'd write, without touching
// disk. The runtime calls this to compare against an existing tree;
// tests use it to assert structure.
export interface PlannedFile {
  relativePath: string;
  contents: string;
}

export function planApi(
  manifest: Manifest,
  refsImportPath: string,
): PlannedFile[] {
  const groups = groupByCategory(manifest);
  const out: PlannedFile[] = [];

  // Static support files first so they appear at the top of any
  // sorted listing — easier on humans browsing the directory.
  out.push({ relativePath: "_client.ts", contents: renderClientFile() });
  out.push({
    relativePath: "types.ts",
    contents: renderTypesFile(refsImportPath),
  });
  out.push({
    relativePath: "index.ts",
    contents: renderRootIndex([...groups.keys()]),
  });

  // Track stub paths so we fail loudly on a manifest where two
  // operations would emit to the same file. Today's manifest has no
  // collisions, but a future entry like a second "issue.get" (perhaps
  // imported from a different category split) would silently shadow
  // the first one without this check — and the integration test that
  // counts plan entries would still pass, since one stub gets emitted
  // per operation either way.
  const stubPaths = new Map<string, string>();
  for (const [category, ops] of groups) {
    out.push({
      relativePath: `${category}/index.ts`,
      contents: renderCategoryIndex(category, ops),
    });
    for (const op of ops) {
      const stub: RenderedStub = renderStub(op);
      const collidesWith = stubPaths.get(stub.relativePath);
      if (collidesWith) {
        throw new Error(
          `Operation '${op.name}' would overwrite stub for '${collidesWith}' at ${stub.relativePath}. ` +
            `Two operations cannot share the same category/verb path.`,
        );
      }
      stubPaths.set(stub.relativePath, op.name);
      out.push({
        relativePath: stub.relativePath,
        contents: stub.contents,
      });
    }
  }

  // Sort the result so the planning output is order-stable regardless
  // of category insertion order. Keeps golden snapshots small and
  // diffable.
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

export async function generateApi(
  opts: GenerateApiOptions,
): Promise<GenerateApiResult> {
  const planned = planApi(opts.manifest, opts.refsImportPath);

  const written: GeneratedFile[] = [];
  // Create directories breadth-first so we don't redundantly mkdir for
  // every stub in a category. Tracking via a Set keeps it cheap.
  const ensuredDirs = new Set<string>();
  ensuredDirs.add(opts.outDir);
  await fsp.mkdir(opts.outDir, { recursive: true });

  for (const file of planned) {
    const abs = path.join(opts.outDir, file.relativePath);
    const dir = path.dirname(abs);
    if (!ensuredDirs.has(dir)) {
      await fsp.mkdir(dir, { recursive: true });
      ensuredDirs.add(dir);
    }
    await fsp.writeFile(abs, file.contents, "utf8");
    written.push({ path: abs, size: Buffer.byteLength(file.contents, "utf8") });
  }

  const categories = [...groupByCategory(opts.manifest).keys()].sort();

  return {
    outDir: opts.outDir,
    files: written,
    operationCount: opts.manifest.length,
    categories,
  };
}
