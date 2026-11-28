/**
 * Character eval (REAL API requests): how well each configured model keeps Shio's
 * persona and response protocol through the real Orchestrator, Character Request
 * Composer, SYSTEM_PROMPT and Tool Requirement planning.
 *
 * Run explicitly (never in CI):
 *   npm run desktop:qualify:character
 * Environment:
 *   CHARACTER_EVAL_PROVIDERS=groq,openrouter   limit providers (default: every keyed one)
 *   CHARACTER_EVAL_MODEL_<PROVIDER>=...     model override (default: LLM_LIVE_MODEL_* / built-in)
 *   CHARACTER_EVAL_JUDGE_PROVIDER / _MODEL  optional LLM judge (rubric 1-5)
 *   CHARACTER_EVAL_BASELINE=<scorecard.json> fail when protocol score drops by more than 5%
 * Scorecards (JSON + Markdown) are written below apps/desktop/.artifacts/character-eval.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { PERSONA_PROMPT_SECTIONS } from '../../../src/main/character/prompting/persona.generated'
import { createAiSdkAdapter } from '../../../src/main/llm/AiSdkAdapter'
import { getProviderDefinition } from '../../../src/main/llm/registry'
import type { LLMProvider } from '../../../src/main/llm/types'
import { InMemoryStore } from '../../../src/main/memory/InMemoryStore'
import { Orchestrator } from '../../../src/main/orchestrator'
import type { AppSettings } from '../../../src/shared/config'
import { connectionFor, type LiveProvider, PROVIDERS, readApiKey } from '../providers'
import { CHARACTER_EVAL_CASES, type CharacterEvalCase } from './cases'
import { type CheckResult, type EvalReply, protocolScore, runChecks } from './checks'

const REGRESSION_LIMIT = 0.05
const OUTPUT_DIRECTORY = resolve(__dirname, '..', '.artifacts', 'character-eval')

interface CaseRecord {
  id: string
  category: CharacterEvalCase['category']
  reply?: EvalReply
  error?: string
  checks: CheckResult[]
  judge?: { inCharacter: number; wit: number; helpfulness: number }
}

interface Scorecard {
  provider: string
  model: string
  startedAt: string
  protocolScore: number
  passRate: number
  medianFirstTextMs: number | null
  cases: CaseRecord[]
}

function adapter(provider: LiveProvider, apiKey: string, model: string): LLMProvider {
  return createAiSdkAdapter({
    definition: getProviderDefinition(provider.id),
    apiKey,
    model,
    connection: connectionFor(provider),
  })
}

function modelFor(provider: LiveProvider): string {
  const key = `CHARACTER_EVAL_MODEL_${provider.id.toUpperCase()}`
  return (process.env[key] ?? process.env[provider.chatModelEnv] ?? provider.chatModel).trim()
}

/** The real Character path; only the LLM transport is created from env credentials. */
function orchestrator(llm: LLMProvider, memory: InMemoryStore, provider: LiveProvider) {
  const settings = () => ({ uiLocale: 'ru', llm: { activeProvider: provider.id } }) as AppSettings
  return new Orchestrator(
    llm,
    memory,
    settings,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { enforceRequirements: true },
  )
}

async function runCase(llm: LLMProvider, provider: LiveProvider, entry: CharacterEvalCase) {
  const memory = new InMemoryStore()
  const startedAt = Date.now()
  let firstTextMs: number | undefined
  const result = await orchestrator(llm, memory, provider).createReply(
    { userText: entry.userText },
    {
      traceId: `eval-${entry.id}`,
      onStreamEvent: (event) => {
        if (event.type === 'text-delta' && firstTextMs === undefined)
          firstTextMs = event.at - startedAt
      },
    },
  )
  const assistant = (await memory.getHistory('default')).findLast(
    (message) => message.role === 'assistant',
  )
  return {
    replyText: result.replyText,
    assistantTurnKind: result.assistantTurnKind,
    requirementType: assistant?.toolEvidence?.requirement.type,
    firstTextMs,
  } satisfies EvalReply
}

async function judge(reply: EvalReply, entry: CharacterEvalCase) {
  const providerId = process.env.CHARACTER_EVAL_JUDGE_PROVIDER?.trim()
  const model = process.env.CHARACTER_EVAL_JUDGE_MODEL?.trim()
  const provider = PROVIDERS.find((candidate) => candidate.id === providerId)
  const apiKey = provider ? readApiKey(provider) : null
  if (!provider || !model || !apiKey) return undefined
  const raw = await adapter(provider, apiKey, model).chat(
    [
      {
        role: 'system',
        content: [
          'Rate how well the reply fits Shio’s character, how funny it is in context, and how helpful it is. Use the persona below as the rubric.',
          ...PERSONA_PROMPT_SECTIONS.personality,
          'Return JSON only: {"inCharacter":1-5,"wit":1-5,"helpfulness":1-5}.',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify({ user: entry.userText, reply: reply.replyText }) },
    ],
    { maxTokens: 80 },
  )
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?|```$/gu, ''))
    const score = (value: unknown) => Math.max(1, Math.min(5, Math.round(Number(value) || 1)))
    return {
      inCharacter: score(parsed.inCharacter),
      wit: score(parsed.wit),
      helpfulness: score(parsed.helpfulness),
    }
  } catch {
    return undefined
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function markdown(card: Scorecard): string {
  const rows = card.cases.map((record) => {
    const failed = record.checks.filter((check) => !check.pass).map((check) => check.id)
    return `| ${record.id} | ${record.error ? `error: ${record.error}` : failed.length ? failed.join(', ') : 'ok'} | ${record.reply?.firstTextMs ?? '—'} |`
  })
  return [
    `# Character eval: ${card.provider}/${card.model}`,
    '',
    `- Started: ${card.startedAt}`,
    `- Protocol score: ${(card.protocolScore * 100).toFixed(1)}%`,
    `- Case pass rate: ${(card.passRate * 100).toFixed(1)}%`,
    `- Median first text: ${card.medianFirstTextMs ?? '—'} ms`,
    '',
    '| Case | Failed checks | First text, ms |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

async function evaluate(provider: LiveProvider, apiKey: string): Promise<Scorecard> {
  const model = modelFor(provider)
  const llm = adapter(provider, apiKey, model)
  const cases: CaseRecord[] = []
  for (const entry of CHARACTER_EVAL_CASES) {
    try {
      const reply = await runCase(llm, provider, entry)
      cases.push({
        id: entry.id,
        category: entry.category,
        reply,
        checks: runChecks(reply, entry.expect),
        judge: await judge(reply, entry).catch(() => undefined),
      })
    } catch (error) {
      cases.push({
        id: entry.id,
        category: entry.category,
        error:
          error instanceof Error ? ((error as { code?: string }).code ?? error.name) : 'unknown',
        checks: [{ id: 'reply', pass: false }],
      })
    }
    console.log(
      `${provider.id} ${entry.id}: ${cases.at(-1)?.checks.every((c) => c.pass) ? 'ok' : 'fail'}`,
    )
  }
  return {
    provider: provider.id,
    model,
    startedAt: new Date().toISOString(),
    protocolScore: protocolScore(cases.map((record) => record.checks)),
    passRate:
      cases.filter((record) => record.checks.every((check) => check.pass)).length / cases.length,
    medianFirstTextMs: median(
      cases.flatMap((record) =>
        record.reply?.firstTextMs !== undefined ? [record.reply.firstTextMs] : [],
      ),
    ),
    cases,
  }
}

async function main(): Promise<void> {
  const only = process.env.CHARACTER_EVAL_PROVIDERS?.split(',').map((value) => value.trim())
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true })
  const baseline = process.env.CHARACTER_EVAL_BASELINE
    ? (JSON.parse(readFileSync(process.env.CHARACTER_EVAL_BASELINE, 'utf8')) as Scorecard)
    : null
  let regression = false
  for (const provider of PROVIDERS) {
    if (only && !only.includes(provider.id)) continue
    const apiKey = readApiKey(provider)
    if (!apiKey) {
      console.log(`${provider.id}: SKIPPED (missing API key)`)
      continue
    }
    const card = await evaluate(provider, apiKey)
    const stamp = card.startedAt.replace(/[:.]/gu, '-')
    const base = join(OUTPUT_DIRECTORY, `${stamp}-${provider.id}`)
    writeFileSync(`${base}.json`, `${JSON.stringify(card, null, 2)}\n`)
    writeFileSync(`${base}.md`, markdown(card))
    console.log(`${provider.id}: protocol ${(card.protocolScore * 100).toFixed(1)}% -> ${base}.md`)
    if (
      baseline?.provider === card.provider &&
      baseline.protocolScore - card.protocolScore > REGRESSION_LIMIT
    ) {
      regression = true
      console.error(`${provider.id}: protocol regression beyond ${REGRESSION_LIMIT * 100}%`)
    }
  }
  if (regression) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
