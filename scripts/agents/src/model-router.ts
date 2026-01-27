import { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createMistral } from '@ai-sdk/mistral';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getConfig } from './config.js';

export interface ModelProvider {
  name: string;
  createModel: () => LanguageModel | null;
  priority: number;
}

/**
 * Model Router - Automatically falls back to different providers when API limits are hit
 *
 * Supports providers with free/unpaid tiers:
 * - Google Gemini (flash models)
 * - Groq (fast inference)
 * - OpenAI (with free tier)
 * - Anthropic Claude (with free tier)
 * - Mistral AI
 * - DeepSeek
 * - Perplexity
 * - OpenRouter (access to many models)
 */
export class ModelRouter {
  private providers: ModelProvider[] = [];
  private currentProviderIndex = 0;

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const config = getConfig();

    // Priority order: faster/cheaper models first, more capable as fallback
    const providerConfigs: ModelProvider[] = [
      // 1. Google Gemini Flash - Fast and has good free tier
      {
        name: 'google-gemini',
        priority: 1,
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

      // 2. Groq - Very fast inference, generous free tier
      {
        name: 'groq',
        priority: 2,
        createModel: () => {
          if (!config.groqApiKey) return null;
          try {
            const groq = createOpenAI({
              apiKey: config.groqApiKey,
              baseURL: 'https://api.groq.com/openai/v1',
            });
            return groq('llama-3.3-70b-versatile');
          } catch {
            return null;
          }
        },
      },

      // 3. DeepSeek - Very affordable, good performance
      {
        name: 'deepseek',
        priority: 3,
        createModel: () => {
          if (!config.deepseekApiKey) return null;
          try {
            const deepseek = createOpenAI({
              apiKey: config.deepseekApiKey,
              baseURL: 'https://api.deepseek.com',
            });
            return deepseek('deepseek-chat');
          } catch {
            return null;
          }
        },
      },

      // 4. OpenAI - Reliable but can be rate limited
      {
        name: 'openai',
        priority: 4,
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

      // 5. Mistral AI - Good balance of speed and quality
      {
        name: 'mistral',
        priority: 5,
        createModel: () => {
          if (!config.mistralApiKey) return null;
          try {
            const mistral = createMistral({ apiKey: config.mistralApiKey });
            return mistral('mistral-small-latest');
          } catch {
            return null;
          }
        },
      },

      // 6. Perplexity - Good for reasoning tasks
      {
        name: 'perplexity',
        priority: 6,
        createModel: () => {
          if (!config.perplexityApiKey) return null;
          try {
            const perplexity = createOpenAI({
              apiKey: config.perplexityApiKey,
              baseURL: 'https://api.perplexity.ai',
            });
            return perplexity('llama-3.1-sonar-small-128k-online');
          } catch {
            return null;
          }
        },
      },

      // 7. OpenRouter - Access to many models through one API
      {
        name: 'openrouter',
        priority: 7,
        createModel: () => {
          if (!config.openrouterApiKey) return null;
          try {
            const openrouter = createOpenAI({
              apiKey: config.openrouterApiKey,
              baseURL: 'https://openrouter.ai/api/v1',
            });
            // Use a free/affordable model on OpenRouter
            return openrouter('google/gemini-2.0-flash-exp:free');
          } catch {
            return null;
          }
        },
      },

      // 8. Anthropic Claude - High quality fallback
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
