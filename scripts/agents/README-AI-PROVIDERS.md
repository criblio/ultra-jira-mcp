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

**Why OpenRouter?** OpenRouter is particularly useful because it provides access to 200+ AI models through a single API key, including many with free tiers (marked with `:free`). This means you get access to models from Google, Meta, Anthropic, and others without needing separate API keys for each.

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

The router tries providers in this order (fastest/cheapest first):

1. Google Gemini Flash (gemini-2.0-flash-exp)
2. Groq (llama-3.3-70b-versatile)
3. DeepSeek (deepseek-chat)
4. OpenAI (gpt-4o-mini)
5. Mistral (mistral-small-latest)
6. Perplexity (llama-3.1-sonar-small-128k-online)
7. OpenRouter (google/gemini-2.0-flash-exp:free)
8. Anthropic Claude (claude-3-haiku-20240307)

### Automatic Fallback

When an API call fails due to:
- Rate limits
- Quota exhaustion
- HTTP 429 errors
- "Too many requests" errors

The router automatically switches to the next available provider and retries. It will attempt **all configured providers** before failing, so if you have 5 providers configured, you get 5 attempts automatically.

### Example Flow

If you have 5 providers configured (Google, Groq, DeepSeek, OpenRouter, Mistral):

```
1. Try Google Gemini → Rate limit hit
2. Switch to Groq → Rate limit hit
3. Switch to DeepSeek → Rate limit hit
4. Switch to OpenRouter → Rate limit hit
5. Switch to Mistral → Success! ✓
```

The system will try **every configured provider** before giving up, maximizing your chances of success.

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
- **DeepSeek**: Very affordable pricing, essentially free for small usage
- **OpenAI**: Limited free tier available
- **Mistral AI**: Limited free tier
- **Perplexity**: Limited free tier
- **OpenRouter**: Free tier available for select models (marked with :free)
- **Anthropic**: Pay-as-you-go with promotional credits

### Recommended Setup for Free Usage

1. Start with: `GOOGLE_API_KEY` + `GROQ_API_KEY` + `OPENROUTER_API_KEY`
2. Add more as needed: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`
3. Keep Anthropic as a premium fallback: `ANTHROPIC_API_KEY`

This gives you multiple free options before hitting paid providers. OpenRouter is especially useful as it provides access to many models through one API.

## Advanced Configuration

### Customize Model Selection

Edit [model-router.ts](src/model-router.ts) to change which models are used:

```typescript
// Change the model for a provider
google('gemini-2.0-flash-exp')  // Change to 'gemini-pro' etc
openai('gpt-4o-mini')           // Change to 'gpt-4' etc
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
