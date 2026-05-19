/**
 * Agent execution context
 */
export interface AgentContext {
  /** Working directory for file operations */
  workingDir: string;
  /** GitHub repository owner */
  repoOwner: string;
  /** GitHub repository name */
  repoName: string;
  /** Pull request number if applicable */
  prNumber?: number;
  /** Issue number if applicable */
  issueNumber?: number;
  /** Branch name */
  branch?: string;
  /** Commit SHA */
  commitSha?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of an agent task
 */
export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: AgentError[];
  warnings?: string[];
  /** Changes proposed by the agent */
  proposedChanges?: ProposedChange[];
  /** Whether changes were validated */
  validated: boolean;
  /** Test results if tests were run */
  testResults?: TestResult[];
}

/**
 * A proposed code change
 */
export interface ProposedChange {
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  originalContent?: string;
  newContent?: string;
  diff?: string;
  description: string;
  /** Risk level of this change */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Test execution result
 */
export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  coverage?: number;
}

/**
 * Error from agent execution
 */
export interface AgentError {
  code: string;
  message: string;
  details?: unknown;
  recoverable: boolean;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Security agent input
 */
export interface SecurityAgentInput {
  /** Path to package.json */
  manifestPath?: string;
  /** Minimum severity to report (alias: severityThreshold) */
  auditLevel?: 'low' | 'moderate' | 'high' | 'critical';
  /** Minimum severity to report (alias: auditLevel) */
  severityThreshold?: 'low' | 'moderate' | 'high' | 'critical';
  /** Include dev dependencies */
  includeDevDependencies?: boolean;
  /** Whether to automatically fix vulnerabilities */
  autoFix?: boolean;
}

/**
 * Security agent output
 */
export interface SecurityAgentOutput {
  vulnerabilities: VulnerabilityReport[];
  riskScore: number;
  recommendations: string[];
  fixableCount: number;
  updatesApplied: string[];
  /** Summary of the security scan */
  summary: string;
}

/**
 * Vulnerability report
 */
export interface VulnerabilityReport {
  id: string;
  package: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  title: string;
  description: string;
  fixAvailable: boolean;
  fixedIn?: string;
}

/**
 * Bug fix agent input
 */
export interface BugFixAgentInput {
  /** Issue number to fix */
  issueNumber?: number;
  /** Issue title — pre-fetched by the workflow so the model never causes a fresh API roundtrip on untrusted content */
  issueTitle?: string;
  /** Issue body — pre-fetched, truncated, and wrapped in <UNTRUSTED_ISSUE> tags before reaching the model */
  issueBody?: string;
  /** Maximum issues to process */
  maxIssues?: number;
  /** Labels to filter by */
  labels?: string[];
  /** Whether to create PRs for fixes */
  createPR?: boolean;
}

/**
 * Bug fix agent output
 */
export interface BugFixAgentOutput {
  issuesProcessed: IssueProcessResult[];
  issuesFixed: number;
  issuesSkipped: number;
  pullRequestsCreated: PullRequestInfo[];
  /** Summary of the bug fix run */
  summary: string;
}

/**
 * Result of processing a single issue
 */
export interface IssueProcessResult {
  issueNumber: number;
  status: 'fixed' | 'skipped' | 'rejected' | 'failed';
  reason?: string;
  prNumber?: number;
}

/**
 * Pull request info
 */
export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  issueNumber: number;
}

/**
 * PR review agent input
 */
export interface PRReviewAgentInput {
  /** PR number to review */
  prNumber: number;
  /** Focus areas for review */
  focusAreas?: ('security' | 'performance' | 'style' | 'logic' | 'tests')[];
  /** Whether to suggest tests */
  suggestTests?: boolean;
  /** The full PR diff/patch as text */
  diff?: string;
}

/**
 * PR review agent output
 */
export interface PRReviewAgentOutput {
  summary: string;
  issues: ReviewIssue[];
  suggestions: ReviewSuggestion[];
  suggestedTests?: string[];
  approval: 'approve' | 'request_changes' | 'comment';
}

/**
 * Review issue
 */
export interface ReviewIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

/**
 * Review suggestion
 */
export interface ReviewSuggestion {
  file: string;
  line?: number;
  originalCode?: string;
  suggestedCode: string;
  explanation: string;
}
