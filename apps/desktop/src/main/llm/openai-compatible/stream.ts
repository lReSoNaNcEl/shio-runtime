import { APIConnectionTimeoutError, APIUserAbortError } from 'openai'
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions'

import type {
  CharacterStreamDeadlines,
  CharacterStreamEvent,
  CharacterStreamFinishReason,
  CharacterStreamUsage,
} from '../../../shared/character-stream'
import type { LlmProviderId } from '../../../shared/llm'
import { mainLog } from '../../logging/safeLogger'
import {
  classifyHttpFailure,
  LlmResponseError,
  networkErrorMessage,
  normalizeHttpErrorMessage,
} from '../errors'
import type { LlmStreamOptions } from '../types'
import { type ChatRunConfig, createChatCompletionBody, sdkHttpFailure } from './request'
import { normalizeFinishReason } from './response'

export const DEFAULT_STREAM_DEADLINES: CharacterStreamDeadlines = Object.freeze({
  connectionMs: 12_000,
  firstByteMs: 20_000,
  idleMs: 20_000,
  totalMs: 120_000,
})

interface PendingToolCall {
  id: string
  name: string
  argumentsJson: string
}

interface OpenAIChunkStream extends AsyncIterable<ChatCompletionChunk> {
  controller: AbortController
}

class StreamDeadlineError extends Error {
  constructor(readonly stage: keyof CharacterStreamDeadlines) {
    super(`LLM stream ${stage} deadline exceeded`)
    this.name = 'StreamDeadlineError'
  }
}

class StreamProtocolError extends Error {
  constructor(readonly code: 'EMPTY_STREAM' | 'INVALID_STREAM_CHUNK' | 'INCOMPLETE_TOOL_CALL') {
    super(code)
    this.name = 'StreamProtocolError'
  }
}

interface ParsedStreamChunk {
  events: CharacterStreamEvent[]
  meaningful: boolean
  invalid: boolean
}

function safeTraceId(value: string | undefined): string {
  return value && /^[A-Za-z0-9_.:-]{1,100}$/u.test(value) ? value : 'untracked'
}

function resolvedDeadlines(options: LlmStreamOptions): CharacterStreamDeadlines {
  const requestedTotal = options.timeoutMs ?? options.deadlines?.totalMs
  const totalMs = finitePositive(requestedTotal, DEFAULT_STREAM_DEADLINES.totalMs)
  return {
    connectionMs: Math.min(
      totalMs,
      finitePositive(options.deadlines?.connectionMs, DEFAULT_STREAM_DEADLINES.connectionMs),
    ),
    firstByteMs: Math.min(
      totalMs,
      finitePositive(options.deadlines?.firstByteMs, DEFAULT_STREAM_DEADLINES.firstByteMs),
    ),
    idleMs: Math.min(
      totalMs,
      finitePositive(options.deadlines?.idleMs, DEFAULT_STREAM_DEADLINES.idleMs),
    ),
    totalMs,
  }
}

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
}

export async function* runChatCompletionStream(
  config: ChatRunConfig,
  options: LlmStreamOptions = {},
): AsyncGenerator<CharacterStreamEvent> {
  const traceId = safeTraceId(options.traceId)
  const deadlines = resolvedDeadlines(options)
  const body = createChatCompletionBody(config, options, true)
  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const totalTimer = setTimeout(
    () => controller.abort(new StreamDeadlineError('totalMs')),
    deadlines.totalMs,
  )
  const startedAt = Date.now()
  let terminalResult = 'failure'
  let terminalCode = 'UNKNOWN'
  let stream: OpenAIChunkStream | null = null
  const pendingTools = new Map<number, PendingToolCall>()
  let finishReason: CharacterStreamFinishReason = 'unknown'
  let meaningfulEvents = 0
  let invalidChunkCount = 0

  mainLog.info('[LLMTransportTrace] request_started', {
    traceId,
    provider: config.provider,
    model: config.model,
    streaming: true,
    connectionDeadlineMs: deadlines.connectionMs,
    firstByteDeadlineMs: deadlines.firstByteMs,
    idleDeadlineMs: deadlines.idleMs,
    totalDeadlineMs: deadlines.totalMs,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
  })

  try {
    stream = (await withDeadline(
      config.client.chat.completions.create(
        body as unknown as ChatCompletionCreateParamsStreaming,
        { signal: controller.signal, maxRetries: 0 },
      ),
      deadlines.connectionMs,
      'connectionMs',
      controller,
    )) as unknown as OpenAIChunkStream
    yield { type: 'connected', at: Date.now() }
    const iterator = stream[Symbol.asyncIterator]()
    let receivedFirstByte = false
    while (true) {
      const item = await withDeadline(
        iterator.next(),
        receivedFirstByte ? deadlines.idleMs : deadlines.firstByteMs,
        receivedFirstByte ? 'idleMs' : 'firstByteMs',
        controller,
      )
      if (item.done) break
      if (!receivedFirstByte) {
        receivedFirstByte = true
        yield { type: 'first-byte', at: Date.now() }
      }
      const parsed = parseStreamChunk(item.value, pendingTools)
      if (parsed.invalid) invalidChunkCount += 1
      if (parsed.meaningful) meaningfulEvents += 1
      for (const event of parsed.events) {
        if (event.type === 'completed') finishReason = event.finishReason
        else yield event
      }
    }
    if (meaningfulEvents === 0) {
      throw new StreamProtocolError(invalidChunkCount > 0 ? 'INVALID_STREAM_CHUNK' : 'EMPTY_STREAM')
    }
    if (invalidChunkCount > 0) {
      mainLog.warn('[LLMTransportTrace] ignored bounded protocol anomalies', {
        traceId,
        invalidChunkCount,
      })
    }
    yield* completePendingTools(pendingTools)
    yield { type: 'completed', at: Date.now(), finishReason }
    terminalResult = 'success'
    terminalCode = 'OK'
  } catch (error) {
    const normalized = normalizeStreamError(error, config, options, controller)
    terminalCode = normalized.code
    throw normalized
  } finally {
    clearTimeout(totalTimer)
    options.signal?.removeEventListener('abort', abortFromCaller)
    stream?.controller.abort(controller.signal.reason)
    mainLog.info('[LLMTransportTrace] request_terminal', {
      traceId,
      provider: config.provider,
      model: config.model,
      result: terminalResult,
      code: terminalCode,
      elapsedMs: Date.now() - startedAt,
      streaming: true,
    })
  }
}

async function* completePendingTools(
  pendingTools: Map<number, PendingToolCall>,
): AsyncGenerator<CharacterStreamEvent> {
  for (const [index, call] of [...pendingTools].sort(([left], [right]) => left - right)) {
    if (!call.name || !call.argumentsJson || !isJsonObject(call.argumentsJson)) {
      throw new StreamProtocolError('INCOMPLETE_TOOL_CALL')
    }
    yield {
      type: 'tool-call-complete',
      at: Date.now(),
      index,
      call: { id: call.id, name: call.name, argumentsJson: call.argumentsJson },
    }
  }
  pendingTools.clear()
}

function parseStreamChunk(
  raw: unknown,
  pendingTools: Map<number, PendingToolCall>,
): ParsedStreamChunk {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { events: [], meaningful: false, invalid: true }
  }
  const root = raw as Record<string, unknown>
  const output: CharacterStreamEvent[] = []
  const usage = parseUsage(root.usage)
  if (usage) output.push({ type: 'usage', at: Date.now(), usage })
  const choice = Array.isArray(root.choices) ? root.choices[0] : undefined
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    return { events: output, meaningful: false, invalid: !usage }
  }
  const choiceRecord = choice as Record<string, unknown>
  const delta =
    choiceRecord.delta &&
    typeof choiceRecord.delta === 'object' &&
    !Array.isArray(choiceRecord.delta)
      ? (choiceRecord.delta as Record<string, unknown>)
      : undefined
  let meaningful = false
  let invalid = !delta && choiceRecord.finish_reason === undefined
  if (typeof delta?.content === 'string' && delta.content) {
    output.push({ type: 'text-delta', at: Date.now(), text: delta.content })
    meaningful = true
  } else if (delta?.content !== undefined && typeof delta.content !== 'string') {
    invalid = true
  }
  if (Array.isArray(delta?.tool_calls)) {
    for (const rawTool of delta.tool_calls) {
      if (!rawTool || typeof rawTool !== 'object' || Array.isArray(rawTool)) {
        invalid = true
        continue
      }
      const tool = rawTool as Record<string, unknown>
      const index = Number.isInteger(tool.index) && Number(tool.index) >= 0 ? Number(tool.index) : 0
      const fn =
        tool.function && typeof tool.function === 'object' && !Array.isArray(tool.function)
          ? (tool.function as Record<string, unknown>)
          : undefined
      let pending = pendingTools.get(index)
      const id = typeof tool.id === 'string' && tool.id ? tool.id : (pending?.id ?? `call-${index}`)
      const nameDelta = typeof fn?.name === 'string' ? fn.name : undefined
      const argumentsDelta = typeof fn?.arguments === 'string' ? fn.arguments : undefined
      if (!pending) {
        pending = { id, name: '', argumentsJson: '' }
        pendingTools.set(index, pending)
        output.push({ type: 'tool-call-start', at: Date.now(), index, id, name: nameDelta ?? '' })
      }
      pending.id = id
      if (nameDelta) pending.name += nameDelta
      if (argumentsDelta) pending.argumentsJson += argumentsDelta
      output.push({
        type: 'tool-call-delta',
        at: Date.now(),
        index,
        id,
        nameDelta,
        argumentsDelta,
      })
      meaningful = true
    }
  } else if (delta?.tool_calls !== undefined) {
    invalid = true
  }
  if (choiceRecord.finish_reason !== null && choiceRecord.finish_reason !== undefined) {
    const normalized = normalizeFinishReason(String(choiceRecord.finish_reason))
    output.push({
      type: 'completed',
      at: Date.now(),
      finishReason: normalized,
    })
    if (normalized === 'unknown') invalid = true
    else meaningful = true
  }
  return { events: output, meaningful, invalid }
}

function isJsonObject(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value)
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

function parseUsage(value: unknown): CharacterStreamUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const usage = value as Record<string, unknown>
  const token = (key: string): number | undefined => {
    const candidate = usage[key]
    return Number.isInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : undefined
  }
  return {
    promptTokens: token('prompt_tokens'),
    completionTokens: token('completion_tokens'),
    totalTokens: token('total_tokens'),
  }
}

async function withDeadline<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  stage: keyof CharacterStreamDeadlines,
  controller: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener = (): void => undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new StreamDeadlineError(stage)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = (): void => reject(controller.signal.reason ?? new Error('ABORTED'))
    if (controller.signal.aborted) {
      rejectAbort()
      return
    }
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    removeAbortListener = () => controller.signal.removeEventListener('abort', rejectAbort)
  })
  try {
    return await Promise.race([Promise.resolve(promise), timeout, aborted])
  } finally {
    if (timer) clearTimeout(timer)
    removeAbortListener()
  }
}

function normalizeStreamError(
  error: unknown,
  config: ChatRunConfig,
  options: LlmStreamOptions,
  controller: AbortController,
): LlmResponseError {
  if (error instanceof LlmResponseError) return error
  const reason = controller.signal.reason
  if (error instanceof StreamProtocolError || reason instanceof StreamProtocolError) {
    const protocolError = error instanceof StreamProtocolError ? error : reason
    return new LlmResponseError({
      provider: config.provider,
      code: protocolError.code,
      recoverable: false,
      message: `${config.displayName}: поток ответа модели нарушил ожидаемый протокол.`,
    })
  }
  if (
    error instanceof StreamDeadlineError ||
    reason instanceof StreamDeadlineError ||
    error instanceof APIConnectionTimeoutError
  ) {
    return new LlmResponseError({
      provider: config.provider,
      code: 'TIMEOUT',
      recoverable: true,
      message: `${config.displayName}: превышено время ожидания потока ответа.`,
    })
  }
  if (options.signal?.aborted || error instanceof APIUserAbortError) {
    return new LlmResponseError({
      provider: config.provider,
      code: 'CANCELLED',
      recoverable: true,
      message: `${config.displayName}: запрос отменён.`,
    })
  }
  const httpFailure = sdkHttpFailure(error)
  if (httpFailure) {
    const failure = classifyHttpFailure(httpFailure.status, httpFailure.data)
    return new LlmResponseError({
      provider: config.provider,
      ...failure,
      message: normalizeHttpErrorMessage(config.displayName, httpFailure.status, httpFailure.data),
    })
  }
  if (error instanceof SyntaxError) {
    return providerRejected(config.provider, config.displayName, 'invalid SSE JSON')
  }
  return new LlmResponseError({
    provider: config.provider,
    code: 'NETWORK_ERROR',
    recoverable: true,
    message: networkErrorMessage(config.displayName),
  })
}

function providerRejected(
  provider: LlmProviderId,
  displayName: string,
  detail: string,
): LlmResponseError {
  mainLog.warn('[LLM] stream rejected', { provider, detail })
  return new LlmResponseError({
    provider,
    code: 'PROVIDER_REJECTED',
    recoverable: false,
    message: `${displayName}: не удалось разобрать поток ответа модели.`,
  })
}
