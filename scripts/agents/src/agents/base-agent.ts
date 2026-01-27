import { generateText, LanguageModel, Tool, ToolSet, stepCountIs } from 'ai';
import { getModel, getModelRouter } from '../model.js';
import { SafetyChecker } from '../validation/safety-checker.js';
import { ChangeValidator } from '../validation/change-validator.js';
import {
  AgentContext,
  AgentResult,
  ProposedChange,
  ValidationResult,
} from './types.js';

/**
 * Abstract base class for all agents
 * Provides common functionality for tool execution, safety checks, and validation
 */
export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly description: string;

  protected model: LanguageModel;
  protected safetyChecker: SafetyChecker;
  protected changeValidator: ChangeValidator;

  /** Maximum number of tool execution steps */
  protected maxSteps = 15;

  constructor(model?: LanguageModel) {
    this.model = model || getModel();
    this.safetyChecker = new SafetyChecker();
    this.changeValidator = new ChangeValidator();
  }

  /**
   * Execute the agent's main task
   */
  abstract execute(
    input: TInput,
    context: AgentContext
  ): Promise<AgentResult<TOutput>>;

  /**
   * Get tools available to this agent
   */
  abstract getTools(context: AgentContext): ToolSet;

  /**
   * Get the system prompt for this agent
   */
  abstract getSystemPrompt(input: TInput, context: AgentContext): string;

  /**
   * Get the user prompt for this agent
   */
  abstract getUserPrompt(input: TInput, context: AgentContext): string;

  /**
   * Validate that the agent can run with given input
   */
  async validate(
    input: TInput,
    context: AgentContext
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!context.workingDir) {
      errors.push('Working directory is required');
    }

    if (!context.repoOwner || !context.repoName) {
      errors.push('Repository owner and name are required');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Run the agent loop with tool execution
   */
  protected async runAgentLoop(
    input: TInput,
    context: AgentContext
  ): Promise<{
    text: string;
    proposedChanges: ProposedChange[];
    toolCalls: { name: string; args: unknown; result: unknown }[];
  }> {
    const tools = this.getTools(context);
    const systemPrompt = this.getSystemPrompt(input, context);
    const userPrompt = this.getUserPrompt(input, context);
    const proposedChanges: ProposedChange[] = [];
    const toolCalls: { name: string; args: unknown; result: unknown }[] = [];

    // Wrap tools to track proposed changes and tool calls
    const wrappedTools: ToolSet = {};
    for (const [name, originalTool] of Object.entries(tools)) {
      const tool = originalTool as Tool<any, any>;
      wrappedTools[name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args: unknown) => {
          // Safety check before execution
          const safetyResult = await this.safetyChecker.checkToolCall(
            name,
            args as Record<string, unknown>,
            context
          );

          if (!safetyResult.safe) {
            const errorResult = {
              error: `Safety check failed: ${safetyResult.reason}`,
            };
            toolCalls.push({ name, args, result: errorResult });
            return errorResult;
          }

          // Execute the original tool
          const result = tool.execute
            ? await tool.execute(args, { toolCallId: '', messages: [], abortSignal: undefined })
            : undefined;
          toolCalls.push({ name, args, result });

          // Track proposed changes if the tool creates them
          if (
            result &&
            typeof result === 'object' &&
            'proposedChange' in result
          ) {
            proposedChanges.push(result.proposedChange as ProposedChange);
          }

          return result;
        },
      } as Tool<any, any>;
    }

    // Try with automatic provider fallback on API errors
    let lastError: Error | null = null;
    const router = getModelRouter();
    // Try all configured providers - each provider gets one attempt
    const maxRetries = router.getProviderCount();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const { text } = await generateText({
          model: this.model,
          tools: wrappedTools,
          stopWhen: stepCountIs(this.maxSteps),
          system: systemPrompt,
          prompt: userPrompt,
        });

        return { text, proposedChanges, toolCalls };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if it's an API limit/rate limit/balance error that should trigger fallback
        const isRateLimitError =
          errorMessage.includes('rate limit') ||
          errorMessage.includes('quota') ||
          errorMessage.includes('429') ||
          errorMessage.includes('402') ||
          errorMessage.includes('too many requests') ||
          errorMessage.includes('resource exhausted') ||
          errorMessage.includes('Insufficient Balance') ||
          errorMessage.includes('insufficient_quota');

        if (isRateLimitError && router.hasMoreProviders() && attempt < maxRetries - 1) {
          this.log('warn', `API limit hit with ${router.getCurrentProviderName()}, switching to next provider`, { error: errorMessage });
          this.model = router.switchToNextProvider();
          continue;
        }

        // Not a rate limit error or no more providers, throw
        throw error;
      }
    }

    // All retries exhausted
    throw lastError || new Error('Failed to generate text after retries');
  }

  /**
   * Validate proposed changes before applying
   */
  protected async validateChanges(
    changes: ProposedChange[],
    context: AgentContext
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const change of changes) {
      // Check for harmful patterns
      const safetyResult = await this.safetyChecker.checkChange(change);
      if (!safetyResult.safe) {
        errors.push(`${change.filePath}: ${safetyResult.reason}`);
        continue;
      }

      // Validate the change
      const validationResult = await this.changeValidator.validate(
        change,
        context
      );
      if (!validationResult.valid) {
        errors.push(
          ...validationResult.errors.map((e) => `${change.filePath}: ${e}`)
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Create an error result
   */
  protected errorResult(
    code: string,
    message: string,
    recoverable = false
  ): AgentResult<TOutput> {
    return {
      success: false,
      errors: [{ code, message, recoverable }],
      validated: false,
    };
  }

  /**
   * Log agent activity
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const logEntry: Record<string, unknown> = {
      timestamp,
      agent: this.name,
      level,
      message,
    };
    if (data !== undefined) {
      logEntry.data = data;
    }
    console.log(JSON.stringify(logEntry));
  }
}
