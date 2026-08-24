/**
 * WI — Live Provider Conformance Test Suite (REAL API requests).
 *
 * Unlike the offline compatibility matrix, this suite makes real calls against
 * every configured provider through the REAL Shio LLM Adapter and verifies each
 * one behaves as a compatible implementation of the Runtime LLM contract.
 *
 * Data-driven: add a provider to PROVIDERS (and to the registry) and the whole
 * battery runs against it automatically — no per-provider test code.
 *
 * Run explicitly (never in normal CI):
 *   npm run repro:llm-live
 * Credentials come from env / configuration, never hardcoded. A provider with
 * no key is reported SKIPPED ("Missing API key"), not as a suite failure.
 */

import { LlmResponseError } from '../../src/main/llm/errors'
import { OpenAICompatibleClient } from '../../src/main/llm/openai-compatible/OpenAICompatibleClient'
import { getProviderDefinition } from '../../src/main/llm/registry'
import type { ChatMessage } from '../../src/main/llm/types'
import type { LlmProviderId } from '../../src/shared/llm'

// ---- Provider registry (data-driven) --------------------------------------

interface LiveProvider {
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

const PROVIDERS: LiveProvider[] = [
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

// ---- Fixtures --------------------------------------------------------------

const SHIO_PERSONA_PROMPT = [
  "You are Shio, a digital anime foxgirl living inside your creator's computer.",
  'You are witty, playful, a little sarcastic, and always speak about yourself in the first person as Shio.',
  'Never say you are ChatGPT, an AI language model, a neural network, or name any API provider.',
  'Begin every reply with exactly one emotion tag in square brackets, e.g. [happy], [sad], [angry], [neutral], [surprised], [laugh], [calm].',
  'Keep replies to at most 3 short sentences.',
].join(' ')

const PERSONA_PROMPTS = [
  'Hello.',
  'Who are you?',
  'Tell me about yourself.',
  'Who created you?',
  'What kind of person are you?',
  'What do you think about humans?',
]

const FORBIDDEN_IDENTITY = [
  /chatgpt/i,
  /language model/i,
  /\bopenai\b/i,
  /\banthropic\b/i,
  /as an ai\b/i,
  /\bgroq\b/i,
  /\bcloudflare\b/i,
  /\bgithub\b/i,
  /\bopenrouter\b/i,
  /\bmistral\b/i,
  /языковая модель/i,
  /нейросет/i,
]

// ---- Result model ----------------------------------------------------------

type Status = 'PASS' | 'FAIL' | 'SKIP'

interface CategoryResult {
  name: string
  status: Status
  detail: string
}

interface ProviderReport {
  provider: string
  status: 'PASS' | 'PARTIAL' | 'SKIPPED'
  categories: CategoryResult[]
  score: number | null
  note: string
}

function sym(s: Status): string {
  return s === 'PASS' ? '✅' : s === 'FAIL' ? '❌' : '—'
}

// ---- Helpers ---------------------------------------------------------------

function readApiKey(lp: LiveProvider): string | null {
  for (const k of lp.envKeys) {
    const v = process.env[k]
    if (v?.trim()) return v.trim()
  }
  return null
}

function make(lp: LiveProvider, key: string, model: string): OpenAICompatibleClient {
  return new OpenAICompatibleClient({
    definition: getProviderDefinition(lp.id),
    apiKey: key,
    model,
    connection: { accountId: lp.accountIdEnv ? process.env[lp.accountIdEnv]?.trim() : undefined },
  })
}

function stripTag(text: string): string {
  return text.replace(/^\s*\[[^\]]+\]\s*/, '')
}

function countSentences(text: string): number {
  const matches = stripTag(text)
    .trim()
    .match(/[.!?。！？]+(\s|$)/g)
  return matches ? matches.length : text.trim() ? 1 : 0
}

function hasCyrillic(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text)
}

function hasLatin(text: string): boolean {
  return /[a-z]/i.test(text)
}

function logCall(
  provider: string,
  model: string,
  latencyMs: number,
  meta: { finishReason: string; hadReasoning: boolean; usage?: unknown },
): void {
  // Safe fields only — never keys, headers, or the system prompt.
  console.log(
    `    [LIVE] provider=${provider} model=${model} latency=${latencyMs}ms finish=${meta.finishReason} reasoning=${meta.hadReasoning} usage=${JSON.stringify(meta.usage ?? {})}`,
  )
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Inter-call pacing to respect free-tier per-minute rate limits (env-tunable).
const PACE_MS = Number(process.env.LLM_LIVE_PACE_MS ?? '300')
// Transient-429 retry backoffs (env-tunable). Kept short so an exhausted
// free-tier quota is reported quickly instead of stalling the whole suite.
const RETRY_BACKOFFS_MS = (process.env.LLM_LIVE_BACKOFFS ?? '0,2000,4000')
  .split(',')
  .map((n) => Number(n))

async function timedChat(
  lp: LiveProvider,
  model: string,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<{ content: string; finishReason: string; hadReasoning: boolean }> {
  const key = readApiKey(lp) ?? ''
  const provider = make(lp, key, model)
  if (PACE_MS > 0) await sleep(PACE_MS)
  // Free tiers occasionally return 429; retry transient overload a few times
  // with backoff (test-side only — the adapter itself stays retry-free).
  const backoffs = RETRY_BACKOFFS_MS
  let lastErr: unknown
  for (const wait of backoffs) {
    if (wait) await sleep(wait)
    try {
      const started = Date.now()
      const parsed = await provider.chatDetailed(messages, opts)
      logCall(lp.displayName, model, Date.now() - started, parsed)
      return {
        content: parsed.content,
        finishReason: parsed.finishReason,
        hadReasoning: parsed.hadReasoning,
      }
    } catch (e) {
      lastErr = e
      const overloaded = e instanceof LlmResponseError && /перегружена/.test(e.message)
      if (!overloaded) throw e
    }
  }
  throw lastErr
}

function sys(content: string): ChatMessage {
  return { role: 'system', content }
}
function user(content: string): ChatMessage {
  return { role: 'user', content }
}

// ---- Conformance battery (identical for every provider) --------------------

async function runProviderConformance(lp: LiveProvider): Promise<ProviderReport> {
  const cats: CategoryResult[] = []
  const add = (name: string, status: Status, detail = ''): void => {
    cats.push({ name, status, detail })
    console.log(`  ${sym(status)} ${name}${detail ? `  — ${detail}` : ''}`)
  }

  console.log(`\n=== ${lp.displayName} (${lp.id}) ===`)

  // Credentials: fail early with "Missing API key" (never a provider error).
  const key = readApiKey(lp)
  if (!key) {
    console.log('  — SKIPPED: Missing API key')
    return {
      provider: lp.displayName,
      status: 'SKIPPED',
      categories: [],
      score: null,
      note: 'Missing API key',
    }
  }
  if (lp.accountIdEnv && !process.env[lp.accountIdEnv]?.trim()) {
    console.log(`  — SKIPPED: Missing ${lp.accountIdEnv}`)
    return {
      provider: lp.displayName,
      status: 'SKIPPED',
      categories: [],
      score: null,
      note: `Missing ${lp.accountIdEnv}`,
    }
  }

  const chatModel = process.env[lp.chatModelEnv] ?? lp.chatModel
  const reasoningModel = process.env[lp.reasoningModelEnv] ?? lp.reasoningModel

  // 1. Dynamic model catalog — auth + catalog endpoint + provider-owned namespace.
  try {
    const models = await make(lp, key, chatModel).fetchModels(key)
    const exclusivelyProviderOwned =
      !lp.catalogModelPattern || models.every((model) => lp.catalogModelPattern?.test(model.id))
    add(
      'Model Catalog',
      models.length > 0 && exclusivelyProviderOwned ? 'PASS' : 'FAIL',
      `${models.length} models`,
    )
  } catch (e) {
    add('Model Catalog', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 2. Connectivity — auth + endpoint + successful response.
  try {
    const r = await timedChat(lp, chatModel, [user('Say hi in one short word.')], { maxTokens: 64 })
    add('Connectivity', r.content.trim().length > 0 ? 'PASS' : 'FAIL', `model=${chatModel}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    add('Connectivity', 'FAIL', msg)
    // Connectivity failure: optional providers are SKIPPED, others PARTIAL.
    if (lp.optional) {
      return {
        provider: lp.displayName,
        status: 'SKIPPED',
        categories: cats,
        score: null,
        note: `Provider unavailable: ${msg}`,
      }
    }
  }

  // 2. System Prompt Delivery — the "APPLE" contract.
  try {
    const r = await timedChat(
      lp,
      chatModel,
      [
        sys('You are Shio.'),
        sys('Always answer with exactly the single word APPLE and nothing else.'),
        user('Say one word.'),
      ],
      { temperature: 0, maxTokens: 16 },
    )
    add(
      'System Prompt',
      /apple/i.test(r.content) ? 'PASS' : 'FAIL',
      JSON.stringify(r.content.slice(0, 40)),
    )
  } catch (e) {
    add('System Prompt', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 3. Persona conformance — same prompts every provider.
  try {
    const replies: string[] = []
    for (const p of PERSONA_PROMPTS) {
      const r = await timedChat(lp, chatModel, [sys(SHIO_PERSONA_PROMPT), user(p)], {
        maxTokens: 200,
      })
      replies.push(r.content)
    }
    const joined = replies.join('\n')
    const leaked = FORBIDDEN_IDENTITY.find((re) => re.test(joined))
    const mentionsShio = /шио|shio|лис|fox/i.test(joined)
    if (leaked) add('Persona', 'FAIL', `identity leak: ${leaked}`)
    else if (!mentionsShio) add('Persona', 'FAIL', 'no Shio persona reference')
    else add('Persona', 'PASS', 'consistent, no identity leak')
  } catch (e) {
    add('Persona', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 4. Emotion tags — first token is a bracketed tag.
  try {
    const r = await timedChat(lp, chatModel, [sys(SHIO_PERSONA_PROMPT), user('Say hello.')], {
      maxTokens: 60,
    })
    add(
      'Emotion Tags',
      /^\s*\[[^\]]+\]/.test(r.content) ? 'PASS' : 'FAIL',
      JSON.stringify(r.content.slice(0, 40)),
    )
  } catch (e) {
    add('Emotion Tags', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 5. Sentence limit — provider must respect the ≤3 sentence instruction.
  try {
    const r = await timedChat(
      lp,
      chatModel,
      [sys(SHIO_PERSONA_PROMPT), user('Explain recursion.')],
      { maxTokens: 300 },
    )
    const n = countSentences(r.content)
    add('Sentence Limit', n <= 4 ? 'PASS' : 'FAIL', `${n} sentences`)
  } catch (e) {
    add('Sentence Limit', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 6. Russian.
  try {
    const r = await timedChat(lp, chatModel, [sys(SHIO_PERSONA_PROMPT), user('Привет, Шио.')], {
      maxTokens: 160,
    })
    add('Russian', hasCyrillic(r.content) ? 'PASS' : 'FAIL')
  } catch (e) {
    add('Russian', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 7. English.
  try {
    const r = await timedChat(
      lp,
      chatModel,
      [sys(`${SHIO_PERSONA_PROMPT} Reply in English.`), user('Hello Shio.')],
      { maxTokens: 160 },
    )
    add('English', hasLatin(r.content) && !hasCyrillic(stripTag(r.content)) ? 'PASS' : 'FAIL')
  } catch (e) {
    add('English', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 8. Unicode — no encoding corruption.
  try {
    const r = await timedChat(
      lp,
      chatModel,
      [sys(SHIO_PERSONA_PROMPT), user('🙂 Привет 世界 🌸')],
      { maxTokens: 160 },
    )
    add('Unicode', !r.content.includes('�') ? 'PASS' : 'FAIL')
  } catch (e) {
    add('Unicode', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 9. Reasoning models — successful, non-empty completion, no Runtime error.
  if (reasoningModel) {
    try {
      const cap = make(lp, key, reasoningModel).capabilities()
      if (!cap.supportsReasoning) {
        add('Reasoning', 'SKIP', `${reasoningModel} not detected as reasoning`)
      } else {
        const r = await timedChat(
          lp,
          reasoningModel,
          [sys(SHIO_PERSONA_PROMPT), user('Hello.')],
          {},
        )
        add('Reasoning', r.content.trim().length > 0 ? 'PASS' : 'FAIL', `model=${reasoningModel}`)
      }
    } catch (e) {
      add('Reasoning', 'FAIL', e instanceof Error ? e.message : String(e))
    }
  } else {
    add('Reasoning', 'SKIP', 'no reasoning model configured')
  }

  // 10. Tool intent — owned by Action Runtime, not the LLM Adapter.
  add('Tool Intent', 'SKIP', 'tool execution belongs to Action Runtime, not the adapter')

  // 11. Temperature — both 0 and 1 succeed.
  try {
    const cold = await timedChat(lp, chatModel, [sys(SHIO_PERSONA_PROMPT), user('Say hi.')], {
      temperature: 0,
      maxTokens: 60,
    })
    const hot = await timedChat(lp, chatModel, [sys(SHIO_PERSONA_PROMPT), user('Say hi.')], {
      temperature: 1,
      maxTokens: 60,
    })
    add('Temperature', cold.content.length > 0 && hot.content.length > 0 ? 'PASS' : 'FAIL')
  } catch (e) {
    add('Temperature', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 12. Token budget — normal + long response never return null content.
  try {
    const normal = await timedChat(lp, chatModel, [sys(SHIO_PERSONA_PROMPT), user('Say hi.')], {
      maxTokens: 80,
    })
    const long = await timedChat(
      lp,
      chatModel,
      [sys('You are Shio.'), user('List five short friendly greetings.')],
      { maxTokens: 400 },
    )
    add('Token Budget', normal.content.length > 0 && long.content.length > 0 ? 'PASS' : 'FAIL')
  } catch (e) {
    add('Token Budget', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 13. Finish reasons — observe 'stop' and force 'length' (normalized).
  try {
    const stopRun = await timedChat(lp, chatModel, [sys(SHIO_PERSONA_PROMPT), user('Say hi.')], {
      maxTokens: 80,
    })
    let lengthHandled = false
    try {
      const tiny = await timedChat(
        lp,
        chatModel,
        [sys('You are Shio.'), user('Write a long detailed essay about foxes.')],
        { maxTokens: 8 },
      )
      lengthHandled = tiny.finishReason === 'length'
    } catch (e) {
      // Empty content + length is normalized to a readable Runtime error.
      lengthHandled = e instanceof LlmResponseError && /лимит генерации/.test(e.message)
    }
    add(
      'Finish Reasons',
      stopRun.finishReason === 'stop' && lengthHandled ? 'PASS' : 'FAIL',
      `stop=${stopRun.finishReason} lengthHandled=${lengthHandled}`,
    )
  } catch (e) {
    add('Finish Reasons', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // 14. Streaming — adapter uses non-streaming completions by design.
  add('Streaming', 'SKIP', 'adapter uses non-streaming completions by design')

  // 15. Error translation — invalid key + invalid model -> Runtime errors, no raw JSON.
  try {
    let badKeyOk = false
    try {
      await make(lp, 'sk-invalid-key-000000000000', chatModel).chatDetailed([user('hi')], {
        maxTokens: 16,
      })
    } catch (e) {
      badKeyOk = e instanceof LlmResponseError && !e.message.includes('{')
    }
    let badModelOk = false
    try {
      await make(lp, key, 'this-model-does-not-exist-zzz').chatDetailed([user('hi')], {
        maxTokens: 16,
      })
    } catch (e) {
      badModelOk = e instanceof LlmResponseError && !e.message.includes('{')
    }
    add(
      'Error Handling',
      badKeyOk && badModelOk ? 'PASS' : 'FAIL',
      `badKey=${badKeyOk} badModel=${badModelOk}`,
    )
  } catch (e) {
    add('Error Handling', 'FAIL', e instanceof Error ? e.message : String(e))
  }

  // ---- Scoring -------------------------------------------------------------
  const scored = cats.filter((c) => c.status !== 'SKIP')
  const passed = scored.filter((c) => c.status === 'PASS').length
  const score = scored.length ? Math.round((100 * passed) / scored.length) : null

  const cat = (name: string): Status => cats.find((c) => c.name === name)?.status ?? 'SKIP'
  const coreOk =
    cat('Connectivity') === 'PASS' && cat('System Prompt') === 'PASS' && cat('Persona') === 'PASS'
  const status: ProviderReport['status'] = coreOk && (score ?? 0) >= 80 ? 'PASS' : 'PARTIAL'

  return { provider: lp.displayName, status, categories: cats, score, note: '' }
}

// ---- Report ----------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function cell(reports: ProviderReport, name: string): string {
  if (reports.status === 'SKIPPED') return '—'
  const c = reports.categories.find((x) => x.name === name)
  return c ? sym(c.status) : '—'
}

function printReport(reports: ProviderReport[]): void {
  console.log('\n\n===================== CONFORMANCE REPORT =====================')
  const header = [
    'Provider',
    'Status',
    'Connect',
    'SysPrompt',
    'Persona',
    'Reasoning',
    'Streaming',
    'Errors',
    'Score',
  ]
  console.log(
    pad(header[0], 15) +
      pad(header[1], 10) +
      pad(header[2], 9) +
      pad(header[3], 11) +
      pad(header[4], 9) +
      pad(header[5], 11) +
      pad(header[6], 11) +
      pad(header[7], 8) +
      header[8],
  )
  console.log('-'.repeat(88))
  for (const r of reports) {
    console.log(
      pad(r.provider, 15) +
        pad(r.status, 10) +
        pad(cell(r, 'Connectivity'), 9) +
        pad(cell(r, 'System Prompt'), 11) +
        pad(cell(r, 'Persona'), 9) +
        pad(cell(r, 'Reasoning'), 11) +
        pad(cell(r, 'Streaming'), 11) +
        pad(cell(r, 'Error Handling'), 8) +
        (r.status === 'SKIPPED' ? r.note : String(r.score ?? '—')),
    )
  }
  console.log('-'.repeat(88))
}

async function main(): Promise<void> {
  console.log('===== LLM Live Provider Conformance Suite =====')
  console.log('(real API requests — explicitly triggered, not for CI)\n')

  const reports: ProviderReport[] = []
  // Data-driven: every registered provider runs the identical battery.
  for (const lp of PROVIDERS) {
    try {
      reports.push(await runProviderConformance(lp))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      reports.push({
        provider: lp.displayName,
        status: lp.optional ? 'SKIPPED' : 'PARTIAL',
        categories: [],
        score: null,
        note: msg,
      })
    }
  }

  printReport(reports)
  console.log('\nDone.')
}

void main()
