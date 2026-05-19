import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  resolveSafePath,
  verifyResolvedRealpath,
  isProtectedPath,
} from 'ultra-mcp-toolkit/agent-safety';

// These tests exercise the toolkit's path resolver through the same import
// path the agent uses. We treat it as part of jira-mcp's security contract:
// if a toolkit upgrade weakens any of these guarantees, this suite must
// catch it before the change rolls in.

let wd: string;

beforeEach(async () => {
  wd = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-path-test-'));
});

afterEach(async () => {
  await fs.rm(wd, { recursive: true, force: true });
});

describe('resolveSafePath', () => {
  it('accepts a simple relative path', () => {
    const r = resolveSafePath(wd, 'src/foo.ts');
    expect(r.safe).toBe(true);
    expect(r.resolved).toBe(path.join(wd, 'src/foo.ts'));
  });

  it('rejects an absolute path', () => {
    const r = resolveSafePath(wd, '/etc/passwd');
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/absolute/i);
  });

  it('rejects ../ traversal that escapes the working dir', () => {
    expect(resolveSafePath(wd, '../etc/passwd').safe).toBe(false);
    expect(resolveSafePath(wd, '../../etc/passwd').safe).toBe(false);
    expect(resolveSafePath(wd, 'a/../../etc/passwd').safe).toBe(false);
  });

  it('rejects ../ even when it cancels out (defense in depth)', () => {
    expect(resolveSafePath(wd, 'foo/../../bar').safe).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(resolveSafePath(wd, '').safe).toBe(false);
  });

  it('rejects a path that resolves to the working dir itself', () => {
    expect(resolveSafePath(wd, '.').safe).toBe(false);
  });

  it('rejects protected paths at the root', () => {
    expect(resolveSafePath(wd, '.env').safe).toBe(false);
    expect(resolveSafePath(wd, '.env.local').safe).toBe(false);
    expect(resolveSafePath(wd, 'package-lock.json').safe).toBe(false);
  });

  it('rejects protected paths nested inside the tree', () => {
    expect(resolveSafePath(wd, '.github/workflows/anything.yml').safe).toBe(false);
    expect(resolveSafePath(wd, 'scripts/agents/src/foo.ts').safe).toBe(false);
    expect(resolveSafePath(wd, 'some/dir/.env').safe).toBe(false);
    expect(resolveSafePath(wd, 'a/b/credentials.json').safe).toBe(false);
  });

  it('allows non-protected paths in non-protected dirs', () => {
    expect(resolveSafePath(wd, 'src/index.ts').safe).toBe(true);
    expect(resolveSafePath(wd, 'docs/README.md').safe).toBe(true);
    expect(resolveSafePath(wd, 'tests/foo.test.ts').safe).toBe(true);
  });
});

describe('verifyResolvedRealpath', () => {
  it('passes when realpath resolves inside workingDir', async () => {
    const target = path.join(wd, 'allowed.txt');
    await fs.writeFile(target, 'hi', 'utf-8');
    const r = await verifyResolvedRealpath(wd, target);
    expect(r.safe).toBe(true);
  });

  it('rejects a symlink whose target is outside workingDir', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-path-outside-'));
    const outsideTarget = path.join(outside, 'secret.txt');
    await fs.writeFile(outsideTarget, 'top secret', 'utf-8');
    try {
      const linkPath = path.join(wd, 'shortcut.txt');
      await fs.symlink(outsideTarget, linkPath);
      const r = await verifyResolvedRealpath(wd, linkPath);
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/symlink/i);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlink whose target is a protected path inside workingDir', async () => {
    const protectedTarget = path.join(wd, '.env');
    await fs.writeFile(protectedTarget, 'SECRET=1', 'utf-8');
    const link = path.join(wd, 'config.txt');
    await fs.symlink(protectedTarget, link);
    const r = await verifyResolvedRealpath(wd, link);
    expect(r.safe).toBe(false);
  });

  it('returns safe=true for a non-existent path (nothing to symlink yet)', async () => {
    const ghost = path.join(wd, 'does-not-exist.txt');
    const r = await verifyResolvedRealpath(wd, ghost);
    expect(r.safe).toBe(true);
  });
});

describe('isProtectedPath', () => {
  it('matches protected basenames', () => {
    expect(isProtectedPath('.env')).toBe(true);
    expect(isProtectedPath('id_rsa')).toBe(true);
    expect(isProtectedPath('package-lock.json')).toBe(true);
  });

  it('matches protected directory segments', () => {
    expect(isProtectedPath('.github/workflows/foo.yml')).toBe(true);
    expect(isProtectedPath('scripts/agents/bug-fix.ts')).toBe(true);
    expect(isProtectedPath('a/b/.git/HEAD')).toBe(true);
  });

  it('lets ordinary paths through', () => {
    expect(isProtectedPath('src/index.ts')).toBe(false);
    expect(isProtectedPath('README.md')).toBe(false);
    expect(isProtectedPath('tests/foo.test.ts')).toBe(false);
  });
});
