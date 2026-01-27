import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, streamText, tool, LanguageModel } from 'ai';
import { getConfig } from './config.js';
import { getModelWithFallback, getModelRouter } from './model-router.js';

// Default model - Gemini Flash Latest
const DEFAULT_MODEL_ID = 'gemini-flash-latest';

/**
 * Get the configured AI model with automatic fallback support
 * Uses Vercel AI SDK for unified multi-provider abstraction
 *
 * Will automatically try multiple providers in order:
 * 1. Google Gemini (fast, good free tier)
 * 2. Groq (very fast, generous free tier)
 * 3. DeepSeek (affordable)
 * 4. OpenAI (reliable)
 * 5. Mistral (balanced)
 * 6. Perplexity (reasoning)
 * 7. OpenRouter (access to many models)
 * 8. Anthropic Claude (high quality)
 */
export function getModel(): LanguageModel {
  // Use router if USE_MODEL_ROUTER is enabled (default: true)
  const useRouter = process.env.USE_MODEL_ROUTER !== 'false';

  if (useRouter) {
    return getModelWithFallback();
  }

  // Legacy single-provider mode
  const config = getConfig();
  const modelId = config.modelId || DEFAULT_MODEL_ID;

  // Create Google AI provider with explicit API key
  const google = createGoogleGenerativeAI({
    apiKey: config.googleApiKey,
  });

  return google(modelId);
}

/**
 * Re-export AI SDK utilities for convenience
 */
export { generateText, streamText, tool };

/**
 * Re-export model router utilities
 */
export { getModelRouter, getModelWithFallback } from './model-router.js';

/**
 * Example usage:
 *
 * import { model, generateText, tool } from './model.js';
 * import { z } from 'zod';
 *
 * const result = await generateText({
 *   model,
 *   tools: {
 *     readFile: tool({
 *       description: 'Read a file from the repository',
 *       parameters: z.object({
 *         path: z.string().describe('Path to the file'),
 *       }),
 *       execute: async ({ path }) => {
 *         // implementation
 *       },
 *     }),
 *   },
 *   maxSteps: 10,
 *   system: 'You are a helpful assistant.',
 *   prompt: 'Analyze this code.',
 * });
 */
