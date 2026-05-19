import {
  createGitHubTools as createGitHubToolsBase,
  type CreateGitHubToolsOptions,
} from 'ultra-mcp-toolkit/agent-tools';
import { getConfig } from '../config.js';

/**
 * GitHub tools backed by the toolkit. The toolkit runs every
 * model-authored string that hits a public surface (PR title, PR body,
 * review body, commit message, branch name) through
 * `SafetyChecker.checkPRMetadata` first.
 *
 * The toolkit takes a single options object including the GitHub token —
 * we keep the two-arg `(repoOwner, repoName)` shape here so existing call
 * sites in the agents don't have to thread the token through. The token
 * still comes from `getConfig()`, not from env-reads inside the toolkit.
 *
 * Auto-merge defaults to false. The bug-fix workflow also pins
 * `AUTO_MERGE=false` at the workflow level so a human reviewer must
 * approve the PR — both layers must say yes.
 */
export function createGitHubTools(
  repoOwner: string,
  repoName: string,
  extra: Omit<CreateGitHubToolsOptions, 'repoOwner' | 'repoName' | 'githubToken'> = {},
) {
  const config = getConfig();
  return createGitHubToolsBase({
    repoOwner,
    repoName,
    githubToken: config.githubToken,
    allowAutoMerge: false,
    ...extra,
  });
}
