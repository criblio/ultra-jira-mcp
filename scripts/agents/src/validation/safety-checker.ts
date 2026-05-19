import {
  SafetyChecker as ToolkitSafetyChecker,
  type SafetyCheckResult as ToolkitSafetyCheckResult,
  type SafetyCheckerOptions,
} from 'ultra-mcp-toolkit/agent-safety';
import { AgentContext, ProposedChange } from '../agents/types.js';

/**
 * Safety checker for validating agent actions and proposed changes.
 *
 * Backed by `ultra-mcp-toolkit/agent-safety` — the same checker every
 * server in the family uses. The toolkit owns the canonical patterns
 * (harmful content, shell metacharacters, known secret shapes,
 * protected-path globs); this adapter only bridges the local
 * `ProposedChange`/`AgentContext` shapes and keeps the call surface
 * unchanged for `BaseAgent`.
 *
 * Do not extend the harmful/secret/shell pattern lists here — push those
 * into the toolkit so every downstream server gets the improvement. The
 * only thing worth localizing is jira-mcp-specific protected paths.
 */
export type SafetyCheckResult = ToolkitSafetyCheckResult;

export class SafetyChecker {
  private readonly inner: ToolkitSafetyChecker;

  constructor(options: SafetyCheckerOptions = {}) {
    this.inner = new ToolkitSafetyChecker(options);
  }

  /** Check if a tool call is safe to execute. Context is unused by the toolkit but kept for call-site compatibility. */
  async checkToolCall(
    toolName: string,
    args: Record<string, unknown>,
    _context?: AgentContext,
  ): Promise<SafetyCheckResult> {
    return this.inner.checkToolCall(toolName, args);
  }

  /** Check if a proposed change is safe to apply. Translates the local ProposedChange shape into the toolkit's. */
  async checkChange(change: ProposedChange): Promise<SafetyCheckResult> {
    return this.inner.checkChange({
      filePath: change.filePath,
      content: change.newContent,
    });
  }

  /**
   * Validate an issue body for auto-fix eligibility. Secondary content
   * filter — the load-bearing trust gate is the `auto-fix-approved` label
   * enforced at the workflow level.
   */
  validateIssueForAutoFix(title: string, body: string): SafetyCheckResult {
    return this.inner.validateIssueForAutoFix(title, body);
  }

  /** Scan model-authored text before it lands on a public surface. */
  checkPRMetadata(parts: {
    title?: string;
    body?: string;
    commitMessage?: string;
    branchName?: string;
  }): SafetyCheckResult {
    return this.inner.checkPRMetadata(parts);
  }
}
