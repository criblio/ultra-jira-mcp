import { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createMistral } from '@ai-sdk/mistral';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getConfig } from './config.js';

// GitHub Models API endpoint
const GITHUB_MODELS_BASE_URL = 'https://models.github.ai/inference';

// GitHub Models provider - uses OpenAI-compatible API at models.github.ai
function createGitHubModels(githubToken: string) {
  return createOpenAICompatible({
    baseURL: GITHUB_MODELS_BASE_URL,
    apiKey: githubToken,
    name: 'github-models',
  });
}

/**
 * Get a list of available GitHub Models model IDs
 * See: https://github.com/marketplace/models
 */
export const GITHUB_MODELS_CATALOG = {
  // OpenAI models
  'openai/gpt-4o': 'General purpose, multimodal',
  'openai/gpt-4.1': 'Latest OpenAI, superior coding',
  'openai/gpt-4.1-mini': 'Balanced performance/cost',
  'openai/gpt-4.1-nano': 'Fastest, lowest cost',
  // Meta models
  'meta/llama-3.3-70b-instruct': 'Open source, high quality',
  'meta/llama-4-scout-17b-16e-instruct': '10M token context',
  // Mistral models
  'mistral-ai/codestral-2501': 'Specialized code generation',
  // DeepSeek models
  'deepseek/deepseek-r1': 'Reasoning tasks',
} as const;

export interface ModelProvider {
  name: string;
  createModel: () => any; // Accept any language model version (v1, v2, v3)
  priority: number;
}

/**
 * Model Router - Automatically falls back to different providers when API limits are hit
 *
 * Priority order: GitHub Models first (default), then free tiers, then paid options
 * - GitHub Models (default, uses GITHUB_TOKEN - no extra API key needed)
 * - Groq (generous free tier, fast inference)
 * - Google Gemini (generous free tier, flash models)
 * - OpenRouter (free tier for select models)
 * - Codestral (Mistral's free coding model)
 * - DeepSeek (paid: ~$0.14-0.27 per 1M tokens)
 * - OpenAI ($5 trial credits, then paid: ~$0.15-0.60 per 1M tokens)
 * - Perplexity (paid: ~$0.20-$5 per 1M tokens)
 * - Anthropic Claude (pay-as-you-go)
 */
export class ModelRouter {
  private providers: ModelProvider[] = [];
  private currentProviderIndex = 0;

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const config = getConfig();

    // Priority order: GitHub Models first (default), then free tiers, then paid options
    const providerConfigs: ModelProvider[] = [
      // 0. GitHub Models - Default provider, uses GITHUB_TOKEN for auth (no additional API key needed)
      // Note: Claude models are NOT available - use OpenAI, Meta, Mistral, xAI, or DeepSeek models
      {
        name: 'github-models',
        priority: 0,
        createModel: () => {
          if (!config.useGitHubModels || !config.githubToken) return null;
          try {
            const githubModels = createGitHubModels(config.githubToken);
            // Default to GPT-4o, can be overridden via GITHUB_MODELS_MODEL env var
            return githubModels(config.githubModelsModel || 'openai/gpt-4o');
          } catch {
            return null;
          }
        },
      },

      // 1. Groq - Very fast inference, generous free tier
      {
        name: 'groq',
        priority: 1,
        createModel: () => {
          if (!config.groqApiKey) return null;
          try {
            const groq = createGroq({ apiKey: config.groqApiKey });
            return groq('llama-3.3-70b-versatile');
          } catch {
            return null;
          }
        },
      },

      // 2. Google Gemini Flash - Fast and has good free tier
      {
        name: 'google-gemini',
        priority: 2,
        createModel: () => {
          if (!config.googleApiKey) return null;
          try {
            const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
            return google('gemini-2.0-flash-exp');
          } catch {
            return null;
          }
        },
      },

      // 3. OpenRouter - Access to 300+ models with internal fallback chain
      {
        name: 'openrouter',
        priority: 3,
        createModel: () => {
          if (!config.openrouterApiKey) return null;
          try {
            const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });
            // Primary: Qwen3 Coder (480B MoE), fallback to DeepSeek Coder, then Gemini
            return openrouter('qwen/qwen3-coder:free', {
              extraBody: {
                models: [
                  'qwen/qwen3-coder:free',           // Best free coding model
                  'deepseek/deepseek-coder:free',    // Excellent code-specific model
                  'google/gemini-2.0-flash-exp:free', // Fast general-purpose fallback
                ],
              },
            });
          } catch {
            return null;
          }
        },
      },

      // 4. Codestral - Mistral's specialized coding model (free tier for experimentation)
      {
        name: 'mistral',
        priority: 4,
        createModel: () => {
          if (!config.mistralApiKey) return null;
          try {
            const mistral = createMistral({
              apiKey: config.mistralApiKey,
              baseURL: 'https://codestral.mistral.ai/v1',
            });
            return mistral('codestral-latest');
          } catch {
            return null;
          }
        },
      },

      // 5. DeepSeek Coder - Best for code review, trained specifically for code (PAID but very cheap)
      {
        name: 'deepseek',
        priority: 5,
        createModel: () => {
          if (!config.deepseekApiKey) return null;
          try {
            const deepseek = createDeepSeek({ apiKey: config.deepseekApiKey });
            return deepseek('deepseek-coder');
          } catch {
            return null;
          }
        },
      },

      // 6. OpenAI - Reliable but can be rate limited ($5 trial credits, then PAID: ~$0.15-0.60 per 1M tokens)
      {
        name: 'openai',
        priority: 6,
        createModel: () => {
          if (!config.openaiApiKey) return null;
          try {
            const openai = createOpenAI({ apiKey: config.openaiApiKey });
            return openai('gpt-4o-mini');
          } catch {
            return null;
          }
        },
      },

      // 7. Perplexity - Good for reasoning tasks (PAID: $0.20-$5 per 1M tokens)
      {
        name: 'perplexity',
        priority: 7,
        createModel: () => {
          if (!config.perplexityApiKey) return null;
          try {
            const perplexity = createPerplexity({ apiKey: config.perplexityApiKey });
            return perplexity('llama-3.1-sonar-small-128k-online');
          } catch {
            return null;
          }
        },
      },

      // 8. Anthropic Claude - High quality fallback (pay-as-you-go)
      {
        name: 'anthropic',
        priority: 8,
        createModel: () => {
          if (!config.anthropicApiKey) return null;
          try {
            const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });
            return anthropic('claude-3-haiku-20240307');
          } catch {
            return null;
          }
        },
      },
    ];

    // Filter to only providers with API keys configured and sort by priority
    this.providers = providerConfigs
      .map(config => {
        const model = config.createModel();
        return model ? config : null;
      })
      .filter((p): p is ModelProvider => p !== null)
      .sort((a, b) => a.priority - b.priority);

    console.log(`[ModelRouter] Initialized ${this.providers.length} providers: ${this.providers.map(p => p.name).join(', ')}`);
  }

  /**
   * Get the current model, with automatic fallback on API errors
   */
  getModel(): LanguageModel {
    if (this.providers.length === 0) {
      throw new Error('No AI providers configured. Please set at least one API key (GOOGLE_API_KEY, GROQ_API_KEY, etc.)');
    }

    const provider = this.providers[this.currentProviderIndex];
    const model = provider.createModel();

    if (!model) {
      // Try next provider
      this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
      return this.getModel();
    }

    console.log(`[ModelRouter] Using provider: ${provider.name}`);
    return model;
  }

  /**
   * Switch to the next provider (call this when API limits are hit)
   */
  switchToNextProvider(): LanguageModel {
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
    console.log(`[ModelRouter] Switching to next provider (${this.currentProviderIndex + 1}/${this.providers.length})`);
    return this.getModel();
  }

  /**
   * Get current provider name for logging
   */
  getCurrentProviderName(): string {
    return this.providers[this.currentProviderIndex]?.name || 'none';
  }

  /**
   * Check if there are more providers to try
   */
  hasMoreProviders(): boolean {
    return this.providers.length > 1;
  }

  /**
   * Reset to first provider
   */
  reset(): void {
    this.currentProviderIndex = 0;
  }

  /**
   * Get the total number of configured providers
   */
  getProviderCount(): number {
    return this.providers.length;
  }
}

// Singleton instance
let routerInstance: ModelRouter | null = null;

/**
 * Get or create the model router instance
 */
export function getModelRouter(): ModelRouter {
  if (!routerInstance) {
    routerInstance = new ModelRouter();
  }
  return routerInstance;
}

/**
 * Get a model with automatic fallback support
 */
export function getModelWithFallback(): LanguageModel {
  return getModelRouter().getModel();
}
