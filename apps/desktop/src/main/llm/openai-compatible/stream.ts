import { streamText } from 'ai'

import type {
  CharacterStreamDeadlines,
  CharacterStreamEvent,
} from '../../../shared/character-stream'
import { mainLog } from '../../logging/safeLogger'
import { LlmResponseError } from '../errors'
import type { LlmStreamOptions } from '../types'
import { type ChatRunConfig, normalizeSdkError, sdkOptions } from './request'
import { normalizeFinishReason } from './response'

export const DEFAULT_STREAM_DEADLINES: CharacterStreamDeadlines = Object.freeze({
  connectionMs: 12_000,
  firstByteMs: 20_000,
  idleMs: 20_000,
  totalMs: 120_000,
})

/** Official SDK events into the existing Shio stream; no SSE parsing. */
export async function* runChatCompletionStream(
  config: ChatRunConfig,
  options: LlmStreamOptions = {},
): AsyncGenerator<CharacterStreamEvent> {
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  const positive = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
  const total = positive(
    options.timeoutMs ?? options.deadlines?.totalMs,
    DEFAULT_STREAM_DEADLINES.totalMs,
  )
  let timedOut = false
  let stageTimer: ReturnType<typeof setTimeout> | undefined
  const expire = () => {
    timedOut = true
    controller.abort()
  }
  const totalTimer = setTimeout(expire, total)
  const arm = (stage: keyof CharacterStreamDeadlines) => {
    clearTimeout(stageTimer)
    stageTimer = setTimeout(
      expire,
      Math.min(total, positive(options.deadlines?.[stage], DEFAULT_STREAM_DEADLINES[stage])),
    )
  }
  const tools = new Map<string, { index: number; name: string }>()
  let nextToolIndex = 0
  let firstTextAt: number | undefined
  let meaningful = false
  let first = false
  let code = 'UNKNOWN'
  const started = Date.now()
  arm('connectionMs')
  mainLog.info('[LLMTransportTrace] request_started', {
    provider: config.provider,
    model: config.model,
    streaming: true,
  })
  try {
    const result = streamText({
      ...sdkOptions(config, options),
      abortSignal: controller.signal,
      streamRetries: 0,
      onError: () => undefined,
    })
    for await (const part of result.fullStream) {
      if (controller.signal.aborted) throw controller.signal.reason
      if (part.type === 'start-step') {
        yield { type: 'connected', at: Date.now() }
        arm('firstByteMs')
      }
      if (part.type === 'error') throw part.error
      if (part.type === 'abort') throw controller.signal.reason ?? new Error('SDK stream aborted')
      if (
        [
          'text-delta',
          'reasoning-delta',
          'tool-input-start',
          'tool-input-delta',
          'tool-call',
        ].includes(part.type)
      ) {
        if (!first) {
          first = true
          yield { type: 'first-byte', at: Date.now() }
        }
        if (controller.signal.aborted) throw controller.signal.reason
        arm('idleMs')
      }
      if (part.type === 'text-delta') {
        firstTextAt ??= Date.now()
        meaningful ||= part.text.length > 0
        yield { type: 'text-delta', at: Date.now(), text: part.text }
      } else if (part.type === 'tool-input-start') {
        const index = nextToolIndex++
        if (index >= 8)
          throw new LlmResponseError({
            provider: config.provider,
            code: 'INCOMPLETE_TOOL_CALL',
            message: 'LLM tool call limit exceeded',
          })
        tools.set(part.id, { index, name: part.toolName })
        yield { type: 'tool-call-start', at: Date.now(), index, id: part.id, name: part.toolName }
      } else if (part.type === 'tool-input-delta') {
        const call = tools.get(part.id)
        if (call)
          yield {
            type: 'tool-call-delta',
            at: Date.now(),
            index: call.index,
            id: part.id,
            argumentsDelta: part.delta,
          }
      } else if (part.type === 'tool-call') {
        if (part.invalid)
          throw new LlmResponseError({
            provider: config.provider,
            code: 'INCOMPLETE_TOOL_CALL',
            message: 'Invalid model tool call',
          })
        const call = tools.get(part.toolCallId)
        meaningful = true
        yield {
          type: 'tool-call-complete',
          at: Date.now(),
          index: call?.index ?? tools.size,
          call: {
            id: part.toolCallId,
            name: part.toolName,
            argumentsJson: JSON.stringify(part.input),
          },
        }
        tools.delete(part.toolCallId)
      } else if (part.type === 'finish') {
        if (tools.size)
          throw new LlmResponseError({
            provider: config.provider,
            code: 'INCOMPLETE_TOOL_CALL',
            message: 'Incomplete model tool call',
          })
        if (!meaningful)
          throw new LlmResponseError({
            provider: config.provider,
            code: 'EMPTY_STREAM',
            recoverable: true,
            message: 'LLM returned no visible text or complete tool calls',
          })
        mainLog.info('[LLMTransportTrace] stream_statistics', {
          provider: config.provider,
          model: config.model,
          inputCount: part.totalUsage.inputTokens,
          outputCount: part.totalUsage.outputTokens,
          elapsedMs: Date.now() - started,
          firstTextMs: firstTextAt === undefined ? undefined : firstTextAt - started,
          outputPerSecond:
            firstTextAt !== undefined && part.totalUsage.outputTokens
              ? part.totalUsage.outputTokens / Math.max(0.001, (Date.now() - firstTextAt) / 1000)
              : undefined,
        })
        yield {
          type: 'usage',
          at: Date.now(),
          usage: {
            promptTokens: part.totalUsage.inputTokens,
            completionTokens: part.totalUsage.outputTokens,
            totalTokens: part.totalUsage.totalTokens,
          },
        }
        yield {
          type: 'completed',
          at: Date.now(),
          finishReason: normalizeFinishReason(part.finishReason),
        }
        code = 'OK'
      }
      // Reasoning never reaches Character text or speech.
    }
    if (timedOut || options.signal?.aborted) throw controller.signal.reason
    if (code !== 'OK')
      throw new LlmResponseError({
        provider: config.provider,
        code: 'INVALID_STREAM_CHUNK',
        message: 'Model stream ended without a terminal result',
      })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const protocolCode =
      name.includes('NoOutput') ||
      name.includes('NoContent') ||
      (name === 'AI_InvalidResponseDataError' && !meaningful && !tools.size)
        ? 'EMPTY_STREAM'
        : name.includes('TypeValidation')
          ? 'INVALID_STREAM_CHUNK'
          : undefined
    const failure =
      protocolCode && !timedOut && !options.signal?.aborted
        ? new LlmResponseError({
            provider: config.provider,
            code: protocolCode,
            recoverable: false,
            message: `${config.displayName}: некорректный поток модели.`,
          })
        : normalizeSdkError(error, config, options.signal, timedOut)
    code = failure.code
    throw failure
  } finally {
    clearTimeout(stageTimer)
    clearTimeout(totalTimer)
    options.signal?.removeEventListener('abort', cancel)
    controller.abort()
    mainLog.info('[LLMTransportTrace] request_terminal', {
      provider: config.provider,
      model: config.model,
      result: code === 'OK' ? 'success' : 'failure',
      code,
      elapsedMs: Date.now() - started,
      streaming: true,
    })
  }
}
