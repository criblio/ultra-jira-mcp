# AI Provider Configuration

The agents support multiple AI providers with automatic fallback. When one provider hits API limits, the system automatically switches to the next available provider.

## Supported Providers

All providers listed below have free or unpaid tiers:

1. **Google Gemini** (Recommended) - Fast, good free tier
2. **Groq** - Very fast inference, generous free tier
3. **DeepSeek** - Very affordable, good performance
4. **OpenAI** - Reliable with free tier available
5. **Mistral AI** - Good balance of speed and quality
6. **Perplexity** - Good for reasoning tasks
7. **OpenRouter** (Recommended) - Unified API for 200+ models, many with free tier
8. **Anthropic Claude** - High quality fallback

**Why OpenRouter?** OpenRouter is particularly useful because it provides access to 300+ AI models through a single API key, including many with free tiers (marked with `:free`). This means you get access to models from Google, Meta, DeepSeek, and others without needing separate API keys for each. Plus, OpenRouter supports internal model fallback, so if one free model is rate-limited, it automatically tries the next one in your fallback chain.

## Setup

### 1. Get API Keys

You only need **at least one** API key. The more you configure, the more fallback options you have:

- **Google Gemini**: https://ai.google.dev/
- **Groq**: https://console.groq.com/
- **DeepSeek**: https://platform.deepseek.com/
- **OpenAI**: https://platform.openai.com/
- **Mistral AI**: https://console.mistral.ai/
- **Perplexity**: https://www.perplexity.ai/settings/api
- **OpenRouter**: https://openrouter.ai/
- **Anthropic**: https://console.anthropic.com/

### 2. Configure Environment Variables

Add your API keys to your `.env.local` file in the `scripts/agents` directory:

```bash
# Required: At least one AI provider API key
GOOGLE_API_KEY=your_google_api_key_here

# Optional: Additional providers for fallback
GROQ_API_KEY=your_groq_api_key_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
MISTRAL_API_KEY=your_mistral_api_key_here
PERPLEXITY_API_KEY=your_perplexity_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Required: GitHub token
GITHUB_TOKEN=your_github_token_here
```

### 3. Configure GitHub Secrets (for workflows)

Add the same API keys as GitHub repository secrets:

1. Go to your repository Settings → Secrets and variables → Actions
2. Add secrets for each provider you want to use:
   - `GOOGLE_API_KEY`
   - `GROQ_API_KEY`
   - `DEEPSEEK_API_KEY`
   - `OPENAI_API_KEY`
   - `MISTRAL_API_KEY`
   - `PERPLEXITY_API_KEY`
   - `OPENROUTER_API_KEY`
   - `ANTHROPIC_API_KEY`

**Note**: The workflows will automatically use any configured secrets. If a secret is not set, that provider will be skipped.

## How It Works

### Priority Order

The router tries providers in this order (best for code first):

1. **Groq** (`llama-3.3-70b-versatile`) ✅ FREE - Fastest inference, generous free tier
2. **Google Gemini Flash** (`gemini-2.0-flash-exp`) ✅ FREE - Fast and versatile
3. **OpenRouter** (with internal fallback) ✅ FREE - Access to multiple models:
   - Primary: `qwen/qwen3-coder:free` (480B MoE coding model)
   - Fallback 1: `deepseek/deepseek-coder:free` (via OpenRouter credits)
   - Fallback 2: `google/gemini-2.0-flash-exp:free` (fast general-purpose)
4. **Codestral** (`codestral-latest`) ✅ FREE - Mistral's specialized coding model
5. **DeepSeek Coder** (`deepseek-coder`) 💰 PAID - Best for code review (~$0.14-0.27 per 1M tokens)
6. **OpenAI** (`gpt-4o-mini`) 💰 PAID - $5 trial credits only (~$0.15-0.60 per 1M tokens)
7. **Perplexity** (`llama-3.1-sonar-small-128k-online`) 💰 PAID - Good for reasoning (~$0.20-$5 per 1M tokens)
8. **Anthropic Claude** (`claude-3-haiku-20240307`) 💰 PAID - Pay-as-you-go

### Automatic Fallback

When an API call fails due to:
- Rate limits
- Quota exhaustion
- Insufficient balance
- HTTP 402 or 429 errors
- "Too many requests" errors

The router automatically switches to the next available provider and retries. It will attempt **all configured providers** before failing, so if you have 5 providers configured, you get 5 attempts automatically.

### Example Flow

If you have 8 providers configured (DeepSeek, Groq, Google, OpenRouter, OpenAI, Mistral, Perplexity, Anthropic):

```
1. Try Groq (direct API) → Rate limit hit
2. Switch to Google Gemini (direct API) → Rate limit hit
3. Switch to OpenRouter → Tries internal fallback chain:
   a. Try Qwen 3 Coder → Rate limit hit
   b. Try DeepSeek Coder → Rate limit hit
   c. Try Gemini Flash → Rate limit hit
   → All OpenRouter models failed
4. Switch to Codestral → Rate limit hit
5. Switch to DeepSeek Coder (direct API) → Insufficient balance (out of credits)
6. Switch to OpenAI → Insufficient balance (trial credits expired)
7. Switch to Perplexity → Rate limit hit
8. Switch to Anthropic → Success! ✓
```

With OpenRouter's internal fallback, you effectively get **11 model attempts** (3 direct free APIs + 3 OpenRouter free models + 5 other providers) before giving up, maximizing your chances of success.

**Note:** DeepSeek and Perplexity APIs are paid ($0.14-0.27 and $0.20-$5 per million tokens respectively). OpenRouter provides DeepSeek models using their free tier credits.

## Installation

Install the required dependencies:

```bash
cd scripts/agents
npm install
```

This will install:
- `@ai-sdk/google` - Google Gemini support
- `@ai-sdk/openai` - OpenAI and OpenAI-compatible APIs (Groq, DeepSeek, Perplexity)
- `@ai-sdk/anthropic` - Anthropic Claude support
- `@ai-sdk/mistral` - Mistral AI support

## Usage

### With Router (Default)

The router is enabled by default. Just run any agent:

```bash
npm run bug-fix
npm run pr-review
```

### Without Router (Single Provider)

To disable the router and use only one provider:

```bash
USE_MODEL_ROUTER=false npm run bug-fix
```

## Testing

To test your provider configuration:

```bash
# Run a simple agent to verify API keys work
ISSUE_NUMBER=123 npm run bug-fix
```

Check the logs for:
```
[ModelRouter] Initialized 3 providers: google-gemini, groq, deepseek
[ModelRouter] Using provider: google-gemini
```

## Troubleshooting

### "No AI providers configured" Error

This means none of your API keys are set. Add at least one API key to your `.env.local` file.

### Provider Not Showing Up

If a provider doesn't appear in the initialization log:
1. Check that the API key is set correctly
2. Verify there are no typos in the environment variable name
3. Make sure the `.env.local` file is in the correct location

### All Providers Rate Limited

If you see repeated rate limit errors across all providers:
- Consider spreading out your requests over time
- Add more provider API keys
- Check your usage on each provider's dashboard

## Cost Optimization

### Free Tiers (as of 2026)

- **Google Gemini**: Generous free tier with Flash models
- **Groq**: Very generous free tier, fast inference
- **OpenRouter**: Free tier available for select models (marked with :free), includes DeepSeek and other models
- **Codestral**: Mistral's free coding model (specialized for code, no billing required)
- **DeepSeek**: Pay-as-you-go (very cheap: ~$0.14-0.27 per 1M tokens) - no free tier
- **OpenAI**: $5 trial credits only (expires after 3 months) - then $0.15-0.60 per 1M tokens
- **Perplexity**: Pay-as-you-go ($0.20-$5 per 1M tokens) - no free tier
- **Anthropic**: Pay-as-you-go with promotional credits

### Recommended Setup for Free Usage

**Minimal Setup** (best single provider):
- `OPENROUTER_API_KEY` - Single key gives you access to 3 free coding models with automatic fallback

**Recommended Free Setup** (maximum resilience without paying):
1. `GROQ_API_KEY` - Very fast inference, generous free tier
2. `GOOGLE_API_KEY` - Fast and generous free tier
3. `OPENROUTER_API_KEY` - Provides 3 additional free model fallbacks (Qwen Coder, DeepSeek Coder, Gemini)
4. `MISTRAL_API_KEY` - Codestral free tier (specialized for coding, no billing required)

**Low-Cost Paid Options** (add these for enhanced quality):
- `DEEPSEEK_API_KEY` - Best for code review, very cheap (~$0.14-0.27 per 1M tokens, direct API is faster than OpenRouter)
- `OPENAI_API_KEY` - Reliable, $5 trial credits then ~$0.15-0.60 per 1M tokens
- `PERPLEXITY_API_KEY` - Good for reasoning (~$0.20-$5 per 1M tokens)
- `ANTHROPIC_API_KEY` - High quality (pay-as-you-go)

With the free-only setup, you get **6 free model attempts** (Groq, Google direct, 3 OpenRouter models, Codestral) with no expiration or billing required.

**Note:** Codestral uses a separate endpoint (`codestral.mistral.ai`) and requires a Codestral-specific API key from [console.mistral.ai](https://console.mistral.ai).

## Advanced Configuration

### Customize Model Selection

Edit [model-router.ts](src/model-router.ts) to change which models are used:

```typescript
// Change the model for a provider
google('gemini-2.0-flash-exp')  // Change to 'gemini-pro' etc
openai('gpt-4o-mini')           // Change to 'gpt-4' etc

// Use Codestral with custom endpoint
const mistral = createMistral({
  apiKey: config.mistralApiKey,
  baseURL: 'https://codestral.mistral.ai/v1',
});
return mistral('codestral-latest');

// Customize OpenRouter's fallback chain
openrouter('qwen/qwen3-coder:free', {
  extraBody: {
    models: [
      'qwen/qwen3-coder:free',
      'deepseek/deepseek-coder:free',
      'google/gemini-2.0-flash-exp:free',
    ],
  },
})
```

### Change Priority Order

Edit the `priority` field in [model-router.ts](src/model-router.ts):

```typescript
{
  name: 'groq',
  priority: 1,  // Lower number = higher priority
  createModel: () => { ... }
}
```

### Disable Specific Providers

Simply don't set the API key for providers you don't want to use.
