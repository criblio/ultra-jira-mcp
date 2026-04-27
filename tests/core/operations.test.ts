// Shape + consistency tests for the full operation manifest.
//
// Guards against whole classes of mistakes that caused PR #172's
// `search.issues` bug (wrong verb/path) and similar:
//   - A path template with a placeholder but no matching `role: "path"`
//     param → interpolatePath would throw at runtime.
//   - A `role: "path"` param that's somehow optional → the path can't
//     be built when it's missing.
//   - Duplicate operation names → the dispatcher's `find` picks one
//     arbitrarily, masking the ambiguity.
//   - Categories the plan promised are missing entirely.

import { describe, expect, it } from "vitest";

import { extractPathParams, type ParamSpec } from "../../src/core/manifest.js";
import { operations } from "../../src/core/operations.js";

describe("operations manifest — shape invariants", () => {
  it("has unique operation names", () => {
    const counts = new Map<string, number>();
    for (const op of operations) {
      counts.set(op.name, (counts.get(op.name) ?? 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n);
    expect(dupes).toEqual([]);
  });

  it("every path placeholder has a matching required path param", () => {
    const problems: string[] = [];
    for (const op of operations) {
      const placeholders = new Set(extractPathParams(op.pathTemplate));
      const pathSpecs = new Map<string, ParamSpec>();
      for (const p of op.params) {
        if (p.role === "path") pathSpecs.set(p.name, p);
      }
      for (const ph of placeholders) {
        const spec = pathSpecs.get(ph);
        if (!spec) {
          problems.push(`${op.name}: path placeholder {${ph}} has no matching param`);
        } else if (!spec.required) {
          problems.push(`${op.name}: path param ${ph} must be required`);
        }
      }
      // No orphan path params that aren't in the template either.
      for (const [name] of pathSpecs) {
        if (!placeholders.has(name)) {
          problems.push(`${op.name}: param ${name} declares role="path" but template has no {${name}}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("no duplicate param names within a single operation", () => {
    const problems: string[] = [];
    for (const op of operations) {
      const names = new Map<string, number>();
      for (const p of op.params) {
        names.set(p.name, (names.get(p.name) ?? 0) + 1);
      }
      for (const [n, c] of names) {
        if (c > 1) problems.push(`${op.name}: param "${n}" appears ${c} times`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("uses only supported verbs", () => {
    const allowed = new Set(["GET", "POST", "PUT", "DELETE"]);
    const bad = operations
      .filter((o) => !allowed.has(o.verb))
      .map((o) => `${o.name}: verb=${o.verb}`);
    expect(bad).toEqual([]);
  });

  it("body params only appear on verbs that carry a body", () => {
    const bodyOk = new Set(["POST", "PUT"]);
    const problems: string[] = [];
    for (const op of operations) {
      const hasBody = op.params.some((p) => p.role === "body");
      if (hasBody && !bodyOk.has(op.verb)) {
        problems.push(`${op.name}: has body params on ${op.verb}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("description is non-empty for every op (surfaces in generated JSDoc)", () => {
    const blanks = operations.filter((o) => !o.description?.trim()).map((o) => o.name);
    expect(blanks).toEqual([]);
  });

  it("operation name uses the form '<category>.<verb>' with a non-empty category", () => {
    // Layer 3's generator will route stubs to api/<category>/ based on
    // the name prefix; this guards against names that don't fit.
    const malformed = operations
      .filter((o) => {
        const idx = o.name.indexOf(".");
        return idx <= 0 || idx === o.name.length - 1;
      })
      .map((o) => o.name);
    expect(malformed).toEqual([]);
  });

  it("rawString-bodyShape ops declare exactly one body param", () => {
    // The dispatcher's contract requires this; catching it at the
    // manifest level prevents a runtime OperationError later.
    const problems: string[] = [];
    for (const op of operations) {
      if (op.bodyShape !== "rawString") continue;
      const bodyParams = op.params.filter((p) => p.role === "body");
      if (bodyParams.length !== 1) {
        problems.push(
          `${op.name}: bodyShape="rawString" requires exactly 1 body param, got ${bodyParams.length}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("operations manifest — category coverage", () => {
  // Minimum set of operations each category must expose. If any of
  // these disappear, a future PR consolidating tools would lose
  // functionality silently.
  const required: Record<string, string[]> = {
    issue: [
      "issue.get",
      "issue.create",
      "issue.update",
      "issue.delete",
      "issue.bulkCreate",
      "issue.listTransitions",
      "issue.transition",
      "issue.assign",
      "issue.changelog",
    ],
    search: ["search.issues", "search.jqlAutocompleteData", "search.jqlAutocompleteSuggestions"],
    comment: ["comment.list", "comment.add", "comment.update", "comment.delete"],
    attachment: ["attachment.get", "attachment.delete", "attachment.meta"],
    project: [
      "project.list",
      "project.get",
      "project.create",
      "project.update",
      "project.delete",
      "project.listComponents",
      "project.createComponent",
      "project.listVersions",
      "project.createVersion",
      "project.updateVersion",
      "project.statuses",
    ],
    user: ["user.myself", "user.search", "user.get", "user.assignable", "user.bulkGet"],
    board: [
      "board.list",
      "board.get",
      "board.create",
      "board.delete",
      "board.configuration",
      "board.issues",
      "board.backlog",
      "board.epics",
    ],
    sprint: [
      "sprint.listForBoard",
      "sprint.get",
      "sprint.create",
      "sprint.update",
      "sprint.delete",
      "sprint.issues",
      "sprint.moveIssues",
      "sprint.moveIssuesToBacklog",
    ],
    epic: ["epic.get", "epic.issues", "epic.moveIssuesIn", "epic.removeIssues"],
    worklog: ["worklog.list", "worklog.add", "worklog.update", "worklog.delete"],
    filter: [
      "filter.list",
      "filter.get",
      "filter.create",
      "filter.update",
      "filter.delete",
      "filter.listFavourite",
    ],
    issueLink: ["issueLink.create", "issueLink.get", "issueLink.delete", "issueLink.types"],
    watcher: ["watcher.list", "watcher.add", "watcher.remove"],
    vote: ["vote.list", "vote.add", "vote.remove"],
    field: [
      "field.list",
      "field.issueTypes",
      "field.priorities",
      "field.statuses",
      "field.resolutions",
      "field.createMeta",
    ],
    group: ["group.search", "group.members"],
    permissions: ["permissions.mine"],
    server: ["server.info"],
  };

  const declared = new Set(operations.map((o) => o.name));

  for (const [category, ops] of Object.entries(required)) {
    for (const opName of ops) {
      it(`${category}: declares ${opName}`, () => {
        expect(declared.has(opName)).toBe(true);
      });
    }
  }
});

describe("operations manifest — agile routing", () => {
  // Paths under /board, /sprint, /epic, /backlog must go through the
  // agile API. A misflagged op would hit the wrong base URL.
  const AGILE_ROOTS = /^\/(board|sprint|epic|backlog)(\/|$)/;
  it("all paths under agile roots declare isAgile: true", () => {
    const misflagged = operations
      .filter((o) => AGILE_ROOTS.test(o.pathTemplate) && !o.isAgile)
      .map((o) => `${o.name} (${o.pathTemplate})`);
    expect(misflagged).toEqual([]);
  });

  it("no platform-api paths are misflagged as agile", () => {
    const misflagged = operations
      .filter((o) => o.isAgile && !AGILE_ROOTS.test(o.pathTemplate))
      .map((o) => `${o.name} (${o.pathTemplate})`);
    expect(misflagged).toEqual([]);
  });
});
