import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local from agents directory first, then fall back to root
config({ path: resolve(__dirname, '../.env.local') });
config({ path: resolve(__dirname, '../../../.env.local') });
config({ path: resolve(__dirname, '../.env') });

export interface AgentConfig {
  // Google AI
  googleApiKey?: string;

  // Multiple AI Provider Support (for model router)
  groqApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  mistralApiKey?: string;
  perplexityApiKey?: string;
  deepseekApiKey?: string;
  openrouterApiKey?: string;

  // GitHub Models (uses GITHUB_TOKEN for authentication)
  useGitHubModels?: boolean;
  githubModelsModel?: string;

  // GitHub
  githubToken: string;
  repoOwner: string;
  repoName: string;

  // Test configuration
  testRepoOwner?: string;
  testRepoName?: string;

  // Optional overrides
  modelId?: string;
}

export function getConfig(): AgentConfig {
  const googleApiKey = process.env.GOOGLE_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const mistralApiKey = process.env.MISTRAL_API_KEY;
  const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  // GitHub Models: enabled by default, uses GITHUB_TOKEN for auth (set USE_GITHUB_MODELS=false to disable)
  // Note: Claude models are NOT available on GitHub Models - use OpenAI, Meta, Mistral, or DeepSeek models
  const useGitHubModels = process.env.USE_GITHUB_MODELS !== 'false';
  const githubModelsModel = process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4o';

  // Require at least one AI provider (GitHub Models enabled by default, or an API key)
  if (!useGitHubModels && !googleApiKey && !groqApiKey && !openaiApiKey && !anthropicApiKey && !mistralApiKey && !perplexityApiKey && !deepseekApiKey && !openrouterApiKey) {
    throw new Error('At least one AI provider is required. GitHub Models is enabled by default (using GITHUB_TOKEN). To use other providers, set an API key (GOOGLE_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, MISTRAL_API_KEY, PERPLEXITY_API_KEY, DEEPSEEK_API_KEY, or OPENROUTER_API_KEY)');
  }

  if (!githubToken) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  // Parse repo from GITHUB_REPOSITORY (owner/repo format) or use individual vars
  let repoOwner = process.env.REPO_OWNER || '';
  let repoName = process.env.REPO_NAME || '';

  // If we don't have both owner and name from explicit vars, try parsing GITHUB_REPOSITORY
  if (process.env.GITHUB_REPOSITORY && (!repoOwner || !repoName)) {
    const [owner, name] = process.env.GITHUB_REPOSITORY.split('/');
    if (!repoOwner) repoOwner = owner;
    if (!repoName) repoName = name;
  }

  // Fall back to GITHUB_REPOSITORY_OWNER if still no owner
  if (!repoOwner && process.env.GITHUB_REPOSITORY_OWNER) {
    repoOwner = process.env.GITHUB_REPOSITORY_OWNER;
  }

  return {
    googleApiKey,
    groqApiKey,
    openaiApiKey,
    anthropicApiKey,
    mistralApiKey,
    perplexityApiKey,
    deepseekApiKey,
    openrouterApiKey,
    useGitHubModels,
    githubModelsModel,
    githubToken,
    repoOwner,
    repoName,
    testRepoOwner: process.env.TEST_REPO_OWNER || repoOwner,
    testRepoName: process.env.TEST_REPO_NAME || repoName,
    modelId: process.env.GOOGLE_MODEL_ID,
  };
}

export function getTestConfig(): AgentConfig {
  const config = getConfig();
  return {
    ...config,
    repoOwner: config.testRepoOwner || config.repoOwner,
    repoName: config.testRepoName || config.repoName,
  };
}
