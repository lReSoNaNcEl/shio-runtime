import type { LlmProviderId } from '../../src/shared/llm'

/** Live provider registry shared by every LLM qualification runner (data-driven). */
export interface LiveProvider {
  id: LlmProviderId
  displayName: string
  /** Env vars checked in order for the API key. */
  envKeys: string[]
  accountIdEnv?: string
  /** Stable, deterministic chat model (env-overridable). */
  chatModel: string
  chatModelEnv: string
  /** Optional reasoning model for the reasoning category. */
  reasoningModel?: string
  reasoningModelEnv: string
  /** When set, every dynamically discovered model must match this provider-owned namespace. */
  catalogModelPattern?: RegExp
  /** Groq is optional: total failure -> SKIPPED, never a suite failure. */
  optional?: boolean
}

export const PROVIDERS: LiveProvider[] = [
  {
    id: 'groq',
    displayName: 'Groq',
    envKeys: ['GROQ_API_KEY'],
    chatModel: 'llama-3.1-8b-instant',
    chatModelEnv: 'LLM_LIVE_MODEL_GROQ',
    reasoningModel: 'openai/gpt-oss-20b',
    reasoningModelEnv: 'LLM_LIVE_REASONING_GROQ',
    optional: true,
  },
  {
    id: 'cloudflare',
    displayName: 'Cloudflare Workers AI',
    envKeys: ['CLOUDFLARE_API_TOKEN'],
    accountIdEnv: 'CLOUDFLARE_ACCOUNT_ID',
    chatModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    chatModelEnv: 'LLM_LIVE_MODEL_CLOUDFLARE',
    reasoningModel: '@cf/qwen/qwen3.8-27b',
    reasoningModelEnv: 'LLM_LIVE_REASONING_CLOUDFLARE',
    catalogModelPattern: /^@cf\//,
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    envKeys: ['OPENROUTER_API_KEY'],
    chatModel: 'meta-llama/llama-3.3-70b-instruct:free',
    chatModelEnv: 'LLM_LIVE_MODEL_OPENROUTER',
    reasoningModel: 'qwen/qwen3-next-80b-a3b-instruct:free',
    reasoningModelEnv: 'LLM_LIVE_REASONING_OPENROUTER',
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    envKeys: ['MISTRAL_API_KEY'],
    chatModel: 'mistral-small-latest',
    chatModelEnv: 'LLM_LIVE_MODEL_MISTRAL',
    reasoningModel: 'magistral-medium-2509',
    reasoningModelEnv: 'LLM_LIVE_REASONING_MISTRAL',
    optional: true,
  },
]

export function readApiKey(lp: LiveProvider): string | null {
  for (const k of lp.envKeys) {
    const v = process.env[k]
    if (v?.trim()) return v.trim()
  }
  return null
}

export function connectionFor(lp: LiveProvider) {
  return { accountId: lp.accountIdEnv ? process.env[lp.accountIdEnv]?.trim() : undefined }
}
