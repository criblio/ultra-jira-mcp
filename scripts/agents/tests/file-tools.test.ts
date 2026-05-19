import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Tool } from 'ai';
import { createFileTools } from '../src/tools/file-tools.js';

// These tests target jira-mcp's `createFileTools` wrapper, which delegates
// to the toolkit's hardened implementation. The point is to catch any
// regression at the same import path the agents use — if either the wrapper
// or the underlying toolkit silently loosens the rules, this suite must
// fail before the change lands.

let wd: string;
let tools: ReturnType<typeof createFileTools>;

beforeEach(async () => {
  wd = await fs.mkdtemp(path.join(os.tmpdir(), 'jira-file-tools-test-'));
  tools = createFileTools(wd);
});

afterEach(async () => {
  await fs.rm(wd, { recursive: true, force: true });
});

async function run<T = unknown>(t: Tool, args: unknown): Promise<T> {
  if (!t.execute) throw new Error('tool has no execute');
  return (await t.execute(args, {
    toolCallId: 't',
    messages: [],
    abortSignal: undefined,
  })) as T;
}

describe('readFile', () => {
  it('reads an ordinary file', async () => {
    await fs.writeFile(path.join(wd, 'hello.txt'), 'world', 'utf-8');
    const r = await run<{ success: boolean; content?: string }>(
      tools.readFile as Tool,
      { filePath: 'hello.txt' },
    );
    expect(r.success).toBe(true);
    expect(r.content).toBe('world');
  });

  it('refuses absolute paths', async () => {
    const r = await run<{ success: boolean; error?: string }>(
      tools.readFile as Tool,
      { filePath: '/etc/passwd' },
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/absolute/i);
  });

  it('refuses ../ traversal', async () => {
    const r = await run<{ success: boolean }>(tools.readFile as Tool, {
      filePath: '../../../etc/passwd',
    });
    expect(r.success).toBe(false);
  });

  it('refuses protected files (.env, lockfiles, .github)', async () => {
    expect(
      (await run<{ success: boolean }>(tools.readFile as Tool, { filePath: '.env' })).success,
    ).toBe(false);
    expect(
      (
        await run<{ success: boolean }>(tools.readFile as Tool, {
          filePath: 'package-lock.json',
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await run<{ success: boolean }>(tools.readFile as Tool, {
          filePath: '.github/workflows/foo.yml',
        })
      ).success,
    ).toBe(false);
  });

  it('refuses a symlink pointing outside the working dir', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'jira-file-tools-outside-'));
    try {
      const outsideTarget = path.join(outside, 'secret');
      await fs.writeFile(outsideTarget, 'NOPE', 'utf-8');
      await fs.symlink(outsideTarget, path.join(wd, 'shortcut.txt'));
      const r = await run<{ success: boolean }>(tools.readFile as Tool, {
        filePath: 'shortcut.txt',
      });
      expect(r.success).toBe(false);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe('writeFile', () => {
  it('writes an ordinary file and reports proposedChange', async () => {
    const r = await run<{ success: boolean; proposedChange?: unknown }>(
      tools.writeFile as Tool,
      { filePath: 'src/new.ts', content: 'export const x = 1;' },
    );
    expect(r.success).toBe(true);
    expect(r.proposedChange).toBeDefined();
    const written = await fs.readFile(path.join(wd, 'src/new.ts'), 'utf-8');
    expect(written).toBe('export const x = 1;');
  });

  it('refuses to write to .env', async () => {
    const r = await run<{ success: boolean }>(tools.writeFile as Tool, {
      filePath: '.env',
      content: 'X=1',
    });
    expect(r.success).toBe(false);
  });

  it('refuses to write to .github/workflows', async () => {
    const r = await run<{ success: boolean }>(tools.writeFile as Tool, {
      filePath: '.github/workflows/x.yml',
      content: 'on: push',
    });
    expect(r.success).toBe(false);
  });

  it('refuses to write a lockfile', async () => {
    expect(
      (
        await run<{ success: boolean }>(tools.writeFile as Tool, {
          filePath: 'package-lock.json',
          content: '{}',
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await run<{ success: boolean }>(tools.writeFile as Tool, {
          filePath: 'yarn.lock',
          content: '',
        })
      ).success,
    ).toBe(false);
  });

  it('refuses to write under scripts/ (agent self-modification protection)', async () => {
    const r = await run<{ success: boolean }>(tools.writeFile as Tool, {
      filePath: 'scripts/agents/src/sneaky.ts',
      content: '// nope',
    });
    expect(r.success).toBe(false);
  });
});

describe('listFiles', () => {
  it('lists files in the working dir', async () => {
    await fs.writeFile(path.join(wd, 'a.txt'), 'x');
    await fs.writeFile(path.join(wd, 'b.txt'), 'x');
    const r = await run<{ success: boolean; files: string[] }>(
      tools.listFiles as Tool,
      { dirPath: '.', recursive: false },
    );
    expect(r.success).toBe(true);
    expect(r.files.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('skips protected paths when walking recursively', async () => {
    await fs.mkdir(path.join(wd, '.github/workflows'), { recursive: true });
    await fs.writeFile(path.join(wd, '.github/workflows/secret.yml'), 'x');
    await fs.writeFile(path.join(wd, 'normal.txt'), 'x');
    const r = await run<{ files: string[] }>(tools.listFiles as Tool, {
      dirPath: '.',
      recursive: true,
    });
    expect(r.files).toContain('normal.txt');
    expect(r.files.join('|')).not.toMatch(/workflows/);
  });
});

describe('fileExists', () => {
  it('reports a file exists', async () => {
    await fs.writeFile(path.join(wd, 'yes.txt'), 'x');
    const r = await run<{ exists: boolean; isFile: boolean }>(
      tools.fileExists as Tool,
      { filePath: 'yes.txt' },
    );
    expect(r.exists).toBe(true);
    expect(r.isFile).toBe(true);
  });

  it('reports a non-existent file as exists=false', async () => {
    const r = await run<{ exists: boolean; success: boolean }>(
      tools.fileExists as Tool,
      { filePath: 'ghost.txt' },
    );
    expect(r.success).toBe(true);
    expect(r.exists).toBe(false);
  });

  it('refuses to probe a protected path', async () => {
    const r = await run<{ success: boolean }>(tools.fileExists as Tool, {
      filePath: '.env',
    });
    expect(r.success).toBe(false);
  });
});
