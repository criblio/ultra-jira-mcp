// Unit tests for the install-skill subcommand.
//
// These cover the writer's contract directly — fresh install vs.
// refuse-existing vs. overwrite-on-force vs. print-to-stdout. The
// CLI integration (subcommand dispatch, flag parsing) is covered in
// cli.test.ts via subprocess; here we exercise installSkill() and
// SKILL_CONTENT in-process where assertions are cheap.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSkill, SKILL_CONTENT } from "../../src/cli/install-skill.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "install-skill-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe("installSkill", () => {
  it("writes SKILL.md to the target dir and reports `wrote`", async () => {
    const targetDir = path.join(tmpRoot, "skills", "jira");
    const result = await installSkill({ targetDir });
    expect(result.action).toBe("wrote");
    expect(result.path).toBe(path.join(targetDir, "SKILL.md"));
    const content = await fs.readFile(result.path, "utf8");
    expect(content).toBe(SKILL_CONTENT);
  });

  it("creates the parent dir if it doesn't exist", async () => {
    // The user's ~/.claude/skills/jira/ likely doesn't exist on a
    // fresh install — installSkill must `mkdir -p` the chain.
    const targetDir = path.join(tmpRoot, "deep", "nested", "skills", "jira");
    const result = await installSkill({ targetDir });
    expect(result.action).toBe("wrote");
    const stat = await fs.stat(targetDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("refuses to overwrite an existing SKILL.md without --force", async () => {
    const targetDir = path.join(tmpRoot, "skills", "jira");
    await fs.mkdir(targetDir, { recursive: true });
    const file = path.join(targetDir, "SKILL.md");
    await fs.writeFile(file, "user customizations", "utf8");

    const result = await installSkill({ targetDir });
    expect(result.action).toBe("exists");
    // The user's content must still be there, untouched.
    const content = await fs.readFile(file, "utf8");
    expect(content).toBe("user customizations");
  });

  it("overwrites with --force and reports `overwrote`", async () => {
    const targetDir = path.join(tmpRoot, "skills", "jira");
    await fs.mkdir(targetDir, { recursive: true });
    const file = path.join(targetDir, "SKILL.md");
    await fs.writeFile(file, "user customizations", "utf8");

    const result = await installSkill({ targetDir, force: true });
    expect(result.action).toBe("overwrote");
    const content = await fs.readFile(file, "utf8");
    expect(content).toBe(SKILL_CONTENT);
  });

  it("--print does not touch the filesystem", async () => {
    const targetDir = path.join(tmpRoot, "skills", "jira");
    const result = await installSkill({ targetDir, print: true });
    expect(result.action).toBe("printed");
    // Path is reported but no file is written.
    await expect(fs.access(result.path)).rejects.toThrow();
  });

  it("SKILL_CONTENT has the frontmatter the harness expects", async () => {
    // The harness keys on `name:` and `description:` in YAML
    // frontmatter. A future refactor that drops either field would
    // silently break skill discovery — this test catches that.
    expect(SKILL_CONTENT.startsWith("---\n")).toBe(true);
    expect(SKILL_CONTENT).toMatch(/^name:\s+jira$/m);
    expect(SKILL_CONTENT).toMatch(/^description:/m);
    // Body must mention the canonical npx invocation so the agent
    // learns the binary path from the skill alone.
    expect(SKILL_CONTENT).toContain("npx -y -p github:scottlepp/jira-mcp");
    expect(SKILL_CONTENT).toContain("jira-cli --help");
    // Subtasks gotcha is the same recurring issue we hit in real
    // sessions; its presence in the skill is load-bearing.
    expect(SKILL_CONTENT).toContain("parent =");
  });
});
