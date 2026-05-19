import {
  createGitTools as createGitToolsBase,
  type CreateGitToolsOptions,
} from 'ultra-mcp-toolkit/agent-tools';

/**
 * Git tools backed by the toolkit's argv-based git wrapper.
 *
 * Every git invocation in the toolkit uses `execFile("git", [...])` — no
 * shell, no string interpolation, no model-supplied content reaching a
 * shell-parsable position. Branch names and commit messages are also
 * filtered by `SafetyChecker.checkPRMetadata()` for shell metacharacters,
 * known secret shapes, and harmful patterns before the git call runs.
 *
 * If you find yourself reaching for `child_process.execSync` here, stop:
 * that's the pattern v2.2.0 removed.
 */
export function createGitTools(workingDir: string, options: CreateGitToolsOptions = {}) {
  return createGitToolsBase(workingDir, options);
}
