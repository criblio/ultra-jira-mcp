import { ToolSet } from 'ai';
import { BaseAgent } from './base-agent.js';
import {
  AgentContext,
  AgentResult,
  PRReviewAgentInput,
  PRReviewAgentOutput,
  ReviewIssue,
  ReviewSuggestion,
  ValidationResult,
} from './types.js';
import { createFileTools } from '../tools/file-tools.js';
import { createGitTools } from '../tools/git-tools.js';
import { createTestTools } from '../tools/test-tools.js';
import { createGitHubTools } from '../tools/github-tools.js';
import { getConfig } from '../config.js';

/**
 * PR Review Agent - Reviews pull requests and suggests improvements
 */
export class PRReviewAgent extends BaseAgent<PRReviewAgentInput, PRReviewAgentOutput> {
  readonly name = 'pr-review-agent';
  readonly description = 'Reviews pull requests, identifies issues, and suggests improvements';

  async validate(
    input: PRReviewAgentInput,
    context: AgentContext
  ): Promise<ValidationResult> {
    const baseResult = await super.validate(input, context);
    const errors = [...baseResult.errors];
    const warnings = [...baseResult.warnings];

    if (!input.prNumber) {
      errors.push('PR number is required');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  getTools(context: AgentContext): ToolSet {
    // For security when reviewing fork PRs, we use API-only tools
    // File/git/test tools require local checkout and are optional
    const githubTools = createGitHubTools(context.repoOwner, context.repoName);

    // Only include local tools if we have a working directory checked out
    const hasLocalCheckout = context.workingDir && context.workingDir !== process.cwd();

    if (hasLocalCheckout) {
      return {
        ...createFileTools(context.workingDir),
        ...createGitTools(context.workingDir),
        ...createTestTools(context.workingDir),
        ...githubTools,
      };
    }

    // API-only mode (safe for fork PRs)
    return githubTools;
  }

  getSystemPrompt(input: PRReviewAgentInput, context: AgentContext): string {
    const focusAreasStr = input.focusAreas?.join(', ') || 'all areas';

    return `You are a code review AI agent. Your job is to review pull requests, provide helpful feedback, and ensure code quality.

Your workflow:
1. Get PR details using getPullRequest - this returns headSha (the commit SHA)
2. Get list of changed files using getPullRequestFiles (includes diffs/patches)
3. For each important changed file, use getFileContents with headSha as the ref parameter to read the full file
4. Analyze both the full file contents AND the diffs (patches)
5. ${input.suggestTests ? 'Check test coverage if local tools available, otherwise suggest tests based on file patterns' : 'Note any missing tests'}
6. Analyze code for issues in: ${focusAreasStr}
7. Submit a review with your findings using createReview WITH inline comments

CRITICAL: When calling getFileContents, you MUST use the headSha commit SHA from getPullRequest as the ref parameter.
NEVER use the branch name as ref - branches can be deleted after PRs are merged.
Example: getFileContents({ path: "...", ref: pr.headSha })

IMPORTANT: Use GitHub API tools (getFileContents, getPullRequestFiles) to read code.
These work without a local checkout and are safe for reviewing all PRs including forks.

INLINE COMMENTS:
When you find specific issues in the code, create inline comments using the comments array in createReview:
- Use the line number from the DIFF (not the absolute file line number)
- Each comment should reference a specific line in a specific file
- Be specific about what's wrong and how to fix it
- Example format:
  createReview({
    prNumber: 123,
    body: "Found 3 issues that need attention",
    event: "REQUEST_CHANGES",
    comments: [
      { path: "src/auth.ts", line: 15, body: "Security issue: This function is vulnerable to SQL injection. Use parameterized queries instead." },
      { path: "src/auth.ts", line: 42, body: "Missing error handling: Add try-catch to handle potential database errors." },
      { path: "tests/auth.test.ts", line: 5, body: "Test coverage: Add tests for the error cases." }
    ]
  })

REVIEW GUIDELINES:
- Be constructive, not harsh
- Explain WHY something is an issue
- Provide concrete suggestions for fixes
- Prioritize issues by severity
- Consider the context and purpose of the changes
- Acknowledge good patterns and improvements
- Leave inline comments for specific code issues
- Use the summary (body) for overall assessment

SEVERITY LEVELS:
- critical: Security vulnerabilities, data loss risks, breaking changes
- high: Bugs, significant performance issues, logic errors
- medium: Code quality issues, missing error handling
- low: Style issues, minor improvements
- info: Suggestions, nice-to-haves

WHAT TO LOOK FOR:
- Security vulnerabilities (injection, XSS, auth issues)
- Logic errors and edge cases
- Missing error handling
- Performance issues
- Test coverage gaps
- Code style and consistency
- Documentation gaps

Working directory: ${context.workingDir}
Repository: ${context.repoOwner}/${context.repoName}`;
  }

  getUserPrompt(input: PRReviewAgentInput, context: AgentContext): string {
    return `Review PR #${input.prNumber} in repository ${context.repoOwner}/${context.repoName}.

Focus areas: ${input.focusAreas?.join(', ') || 'all areas'}
Suggest tests: ${input.suggestTests !== false ? 'yes' : 'no'}

Steps:
1. Use getPullRequest to get the PR details - it returns headSha (commit SHA)
2. Use getPullRequestFiles to get the list of changed files and their diffs (patches)
3. For each important changed file, use getFileContents with the headSha as the ref parameter to read the full file
4. Analyze the changes in the patches (diffs) for:
   - Security issues (injection, XSS, auth bypass, etc.)
   - Logic errors and edge cases
   - Missing error handling
   - Performance concerns
   - Code quality and style
5. ${input.suggestTests !== false ? 'Suggest test files based on the changed files (e.g., src/foo.ts should have tests/foo.test.ts)' : 'Note any missing test coverage'}
6. For EACH specific issue you find, note:
   - The file path
   - The line number in the DIFF where the issue occurs
   - What the issue is and how to fix it
7. Use createReview to submit your review with:
   - body: Overall summary of your findings
   - event: APPROVE (no issues), REQUEST_CHANGES (critical/high issues), or COMMENT (minor suggestions)
   - comments: Array of inline comments for each specific issue found
     Example: [
       { path: "src/auth.ts", line: 15, body: "SQL injection vulnerability. Use parameterized queries." },
       { path: "src/utils.ts", line: 8, body: "Missing null check. Add validation for input parameter." }
     ]

IMPORTANT: Always include inline comments when you find specific issues. Don't just mention issues in the summary - point to the exact lines!

Use GitHub API tools for file access - they work without local checkout.`;
  }

  async execute(
    input: PRReviewAgentInput,
    context: AgentContext
  ): Promise<AgentResult<PRReviewAgentOutput>> {
    // Validate input
    const validation = await this.validate(input, context);
    if (!validation.valid) {
      return this.errorResult('VALIDATION_ERROR', validation.errors.join(', '), true);
    }

    if (!input.prNumber) {
      return this.errorResult('MISSING_PR', 'PR number is required', true);
    }

    // Add PR number to context
    const reviewContext: AgentContext = {
      ...context,
      prNumber: input.prNumber,
    };

    this.log('info', 'Starting PR review', { input });

    try {
      const { text, proposedChanges, toolCalls } = await this.runAgentLoop(
        input,
        reviewContext
      );

      // Extract results from the review
      const issues: ReviewIssue[] = [];
      const suggestions: ReviewSuggestion[] = [];
      const suggestedTests: string[] = [];
      let approval: PRReviewAgentOutput['approval'] = 'comment';
      let summary = '';

      // Parse the agent's response to extract structured data
      // The agent should format its findings in a structured way
      const reviewResult = this.parseReviewResponse(text, toolCalls);

      return {
        success: true,
        data: {
          summary: reviewResult.summary || 'Review completed',
          issues: reviewResult.issues,
          suggestions: reviewResult.suggestions,
          suggestedTests: reviewResult.suggestedTests,
          approval: reviewResult.approval,
        },
        proposedChanges,
        validated: true,
        warnings: validation.warnings,
      };
    } catch (error) {
      this.log('error', 'PR review failed', { error });
      return this.errorResult(
        'REVIEW_FAILED',
        error instanceof Error ? error.message : 'Unknown error',
        false
      );
    }
  }

  private parseReviewResponse(
    text: string,
    toolCalls: Array<{ name: string; args: unknown; result: unknown }>
  ): {
    summary: string;
    issues: ReviewIssue[];
    suggestions: ReviewSuggestion[];
    suggestedTests: string[];
    approval: PRReviewAgentOutput['approval'];
  } {
    const issues: ReviewIssue[] = [];
    const suggestions: ReviewSuggestion[] = [];
    const suggestedTests: string[] = [];
    let approval: PRReviewAgentOutput['approval'] = 'comment';

    // Check for review submission
    for (const call of toolCalls) {
      if (call.name === 'createReview') {
        const args = call.args as { event?: string };
        if (args.event === 'APPROVE') {
          approval = 'approve';
        } else if (args.event === 'REQUEST_CHANGES') {
          approval = 'request_changes';
        }
      }

      // Check for test coverage results
      if (call.name === 'checkTestCoverage') {
        const result = call.result as {
          hasTests?: boolean;
          suggestedTestPath?: string;
          filePath?: string;
        };
        if (!result.hasTests && result.suggestedTestPath) {
          suggestedTests.push(
            `Create tests at ${result.suggestedTestPath} for ${result.filePath}`
          );
        }
      }
    }

    // Extract issues from the text response
    // Look for patterns like "Issue:", "Problem:", "Bug:", etc.
    const issuePatterns = [
      /(?:issue|problem|bug|error|concern):\s*(.+?)(?=\n|$)/gi,
      /(?:critical|high|medium|low):\s*(.+?)(?=\n|$)/gi,
    ];

    for (const pattern of issuePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        issues.push({
          severity: 'medium',
          category: 'code-quality',
          file: '',
          message: match[1].trim(),
        });
      }
    }

    // Determine approval based on issues found
    if (issues.some((i) => i.severity === 'critical' || i.severity === 'high')) {
      approval = 'request_changes';
    } else if (issues.length === 0) {
      approval = 'approve';
    }

    // Generate summary
    const summary = this.generateSummary(issues, suggestedTests, approval);

    return {
      summary,
      issues,
      suggestions,
      suggestedTests,
      approval,
    };
  }

  private generateSummary(
    issues: ReviewIssue[],
    suggestedTests: string[],
    approval: PRReviewAgentOutput['approval']
  ): string {
    const parts: string[] = [];

    if (issues.length === 0) {
      parts.push('No significant issues found in this PR.');
    } else {
      const critical = issues.filter((i) => i.severity === 'critical').length;
      const high = issues.filter((i) => i.severity === 'high').length;
      const medium = issues.filter((i) => i.severity === 'medium').length;
      const low = issues.filter((i) => i.severity === 'low').length;

      parts.push(`Found ${issues.length} issue(s):`);
      if (critical > 0) parts.push(`- ${critical} critical`);
      if (high > 0) parts.push(`- ${high} high`);
      if (medium > 0) parts.push(`- ${medium} medium`);
      if (low > 0) parts.push(`- ${low} low`);
    }

    if (suggestedTests.length > 0) {
      parts.push(`\nTest coverage: ${suggestedTests.length} file(s) need tests.`);
    }

    parts.push(
      `\nRecommendation: ${approval === 'approve' ? 'Approve' : approval === 'request_changes' ? 'Request changes' : 'Comment only'}`
    );

    return parts.join('\n');
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = getConfig();

  const prNumber = process.env.PR_NUMBER
    ? parseInt(process.env.PR_NUMBER, 10)
    : undefined;

  if (!prNumber) {
    console.error('PR_NUMBER environment variable is required');
    process.exit(1);
  }

  const agent = new PRReviewAgent();
  const context: AgentContext = {
    workingDir: process.cwd(),
    repoOwner: config.repoOwner,
    repoName: config.repoName,
    prNumber,
  };

  const input: PRReviewAgentInput = {
    prNumber,
    suggestTests: true,
    focusAreas: ['security', 'logic', 'tests'],
  };

  agent.execute(input, context).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}
