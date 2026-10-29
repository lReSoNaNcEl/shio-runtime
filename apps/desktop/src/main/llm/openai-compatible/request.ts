import {
  APICallError,
  generateText,
  jsonSchema,
  type LanguageModel,
  Output,
  ToolChoiceViolationError,
  tool,
} from 'ai'

import type { LlmProviderId } from '../../../shared/llm'
import { mainLog } from '../../logging/safeLogger'
import { llmDebug } from '../diagnostics'
import {
  classifyHttpFailure,
  LlmResponseError,
  networkErrorMessage,
  normalizeHttpErrorMessage,
} from '../errors'
import type {
  ChatMessage,
  LlmCapabilities,
  LlmCompletionOptions,
  LlmRequestOptions,
  LlmToolDefinition,
} from '../types'
import { prepareMessages } from './messageCompatibility'
import { normalizeFinishReason, type ParsedCompletion } from './response'

export interface ChatRunConfig {
  provider: LlmProviderId
  displayName: string
  client: LanguageModel
  model: string
  capabilities: LlmCapabilities
  messages: readonly ChatMessage[]
  singleLeadingSystemMessage?: boolean
  temperature?: number
  maxTokensOverride?: number
  requestTimeoutMs?: number
  tools?: readonly LlmToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required'
}

export function sdkOptions(config: ChatRunConfig, options: LlmCompletionOptions) {
  const definitions = options.tools ?? config.tools ?? []
  const tools =
    config.capabilities.supportsToolCalling && definitions.length
      ? Object.fromEntries(
          definitions.map((definition) => [
            definition.name,
            tool({
              description: definition.description,
              inputSchema: jsonSchema<Record<string, unknown>>(definition.parameters),
            }),
          ]),
        )
      : undefined
  const requested =
    options.maxTokens ?? config.maxTokensOverride ?? config.capabilities.recommendedMaxTokens
  return {
    model: config.client,
    messages: prepareMessages(
      config.messages,
      config.capabilities,
      config.singleLeadingSystemMessage,
    ),
    allowSystemInMessages: true,
    maxOutputTokens: Number.isFinite(requested)
      ? Math.max(1, Math.floor(requested))
      : config.capabilities.recommendedMaxTokens,
    ...(config.capabilities.supportsTemperature ? { temperature: config.temperature ?? 0.7 } : {}),
    tools,
    toolChoice: tools ? (options.toolChoice ?? config.toolChoice ?? ('auto' as const)) : undefined,
    maxRetries: 0,
    ...(options.responseSchema
      ? {
          output: Output.object({
            name: options.responseSchema.name,
            schema: jsonSchema<Record<string, unknown>>(options.responseSchema.schema),
          }),
        }
      : {}),
  }
}

export function normalizeSdkError(
  error: unknown,
  config: ChatRunConfig,
  signal?: AbortSignal,
  timedOut = false,
): LlmResponseError {
  if (error instanceof LlmResponseError) return error
  const errorKind =
    error instanceof Error &&
    [
      'AI_APICallError',
      'AI_TypeValidationError',
      'AI_JSONParseError',
      'AI_InvalidResponseDataError',
      'AI_InvalidToolInputError',
      'AI_ToolChoiceViolationError',
      'AI_InvalidArgumentError',
      'AI_NoSuchToolError',
      'AI_InvalidPromptError',
      'AI_NoOutputGeneratedError',
      'AI_NoObjectGeneratedError',
      'AI_NoContentGeneratedError',
      'TypeError',
      'AbortError',
    ].includes(error.name)
      ? error.name
      : 'other'
  mainLog.warn('[LLM] sdk_failure', {
    provider: config.provider,
    kind: errorKind,
    status: APICallError.isInstance(error) ? error.statusCode : undefined,
  })
  if (timedOut)
    return new LlmResponseError({
      provider: config.provider,
      code: 'TIMEOUT',
      recoverable: true,
      message: `${config.displayName}: превышено время ожидания ответа.`,
    })
  if (signal?.aborted)
    return new LlmResponseError({
      provider: config.provider,
      code: 'CANCELLED',
      recoverable: true,
      message: `${config.displayName}: запрос отменён.`,
    })
  if (ToolChoiceViolationError.isInstance(error))
    return new LlmResponseError({
      provider: config.provider,
      code: 'INCOMPLETE_TOOL_CALL',
      recoverable: false,
      message: `${config.displayName}: модель не вернула обязательный вызов инструмента.`,
    })
  if (APICallError.isInstance(error) && error.statusCode) {
    let data: unknown
    try {
      data = error.responseBody ? JSON.parse(error.responseBody) : undefined
    } catch {
      data = undefined
    }
    return new LlmResponseError({
      provider: config.provider,
      ...classifyHttpFailure(error.statusCode, data),
      message: normalizeHttpErrorMessage(config.displayName, error.statusCode, data),
    })
  }
  const name = error instanceof Error ? error.name : ''
  const rejected = /Invalid|Validation|NoOutput|NoObject|NoContent|Tool|JSONParse/.test(name)
  return new LlmResponseError({
    provider: config.provider,
    code: rejected ? 'PROVIDER_REJECTED' : 'NETWORK_ERROR',
    recoverable: !rejected,
    message: rejected
      ? `${config.displayName}: не удалось разобрать ответ модели.`
      : networkErrorMessage(config.displayName),
  })
}

export async function runChatCompletion(
  config: ChatRunConfig,
  options: LlmRequestOptions = {},
): Promise<string> {
  return (await runChatCompletionDetailed(config, options)).content
}

export async function runChatCompletionDetailed(
  config: ChatRunConfig,
  options: LlmCompletionOptions = {},
): Promise<ParsedCompletion> {
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  const timeout = options.timeoutMs ?? config.requestTimeoutMs ?? 60_000
  const timer = setTimeout(
    () => {
      timedOut = true
      controller.abort()
    },
    Number.isFinite(timeout) ? Math.max(1, timeout) : 60_000,
  )
  const started = Date.now()
  let code = 'UNKNOWN'
  mainLog.info('[LLMTransportTrace] request_started', {
    provider: config.provider,
    model: config.model,
    messageCount: config.messages.length,
    streaming: false,
  })
  try {
    const result = await generateText({
      ...sdkOptions(config, options),
      abortSignal: controller.signal,
    })
    // Reading output invokes the SDK JSON parser; the domain owner validates its typed schema.
    if (options.responseSchema) void result.output
    const calls = result.toolCalls.map((call) => {
      if (call.invalid)
        throw new LlmResponseError({
          provider: config.provider,
          code: 'INCOMPLETE_TOOL_CALL',
          message: `${config.displayName}: некорректный вызов инструмента.`,
        })
      return { id: call.toolCallId, name: call.toolName, argumentsJson: JSON.stringify(call.input) }
    })
    if (!result.text && !calls.length)
      throw new LlmResponseError({
        provider: config.provider,
        recoverable: result.finishReason !== 'content-filter',
        message:
          result.finishReason === 'length'
            ? `${config.displayName}: лимит генерации исчерпан до финального ответа.`
            : `${config.displayName}: модель вернула пустой ответ.`,
      })
    const usage = {
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    }
    const completion = {
      content: result.text,
      toolCalls: Object.freeze(calls),
      finishReason: normalizeFinishReason(result.finishReason),
      hadReasoning: result.reasoning.length > 0,
      usage,
    }
    llmDebug({
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - started,
      contentEmpty: !result.text,
      finishReason: completion.finishReason,
      hadReasoning: completion.hadReasoning,
      usage,
    })
    code = 'OK'
    return completion
  } catch (error) {
    const failure = normalizeSdkError(error, config, options.signal, timedOut)
    code = failure.code
    throw failure
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    controller.abort()
    mainLog.info('[LLMTransportTrace] request_terminal', {
      provider: config.provider,
      model: config.model,
      result: code === 'OK' ? 'success' : 'failure',
      code,
      elapsedMs: Date.now() - started,
      streaming: false,
    })
  }
}
