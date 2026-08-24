import axios, { type AxiosInstance } from 'axios'

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
import { type ParsedCompletion, parseChatCompletion } from './response'

export interface ChatRunConfig {
  provider: LlmProviderId
  displayName: string
  http: AxiosInstance
  chatPath: string
  apiKey: string
  model: string
  capabilities: LlmCapabilities
  messages: readonly ChatMessage[]
  extraHeaders?: Record<string, string>
  singleLeadingSystemMessage?: boolean
  temperature?: number
  maxTokensOverride?: number
  requestTimeoutMs?: number
  tools?: readonly LlmToolDefinition[]
  toolChoice?: 'auto' | 'none'
}

const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

function safeTraceId(value: string | undefined): string {
  return value && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : 'untracked'
}

function requestDeadline(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal
  didTimeOut: () => boolean
  dispose: () => void
} {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = (): void => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) abortFromCaller()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(
    () => {
      timedOut = true
      controller.abort(new Error('LLM request deadline exceeded'))
    },
    Math.max(1, timeoutMs),
  )
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    },
  }
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
  const started = Date.now()
  const requestedTimeoutMs =
    options.timeoutMs ?? config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1, requestedTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS
  const requestedMaxTokens =
    options.maxTokens ?? config.maxTokensOverride ?? config.capabilities.recommendedMaxTokens
  const maxTokens = Number.isFinite(requestedMaxTokens)
    ? Math.max(1, Math.floor(requestedMaxTokens))
    : config.capabilities.recommendedMaxTokens
  const deadline = requestDeadline(options.signal, timeoutMs)
  const preparedMessages = prepareMessages(
    config.messages,
    config.capabilities,
    config.singleLeadingSystemMessage,
  )
  const body: Record<string, unknown> = {
    model: config.model,
    messages: preparedMessages,
    max_tokens: maxTokens,
    stream: false,
  }
  if (config.capabilities.supportsTemperature) {
    body.temperature = config.temperature ?? DEFAULT_TEMPERATURE
  }
  const tools = options.tools ?? config.tools
  if (tools && tools.length > 0 && config.capabilities.supportsToolCalling) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
    body.tool_choice = options.toolChoice ?? config.toolChoice ?? 'auto'
    body.parallel_tool_calls = false
  }
  const traceId = safeTraceId(options.traceId)
  const toolCount = Array.isArray(body.tools) ? body.tools.length : 0
  let terminalResult = 'failure'
  let terminalCode = 'UNKNOWN'
  mainLog.info('[LLMTransportTrace] request_started', {
    traceId,
    provider: config.provider,
    model: config.model,
    messageCount: preparedMessages.length,
    serializedRequestCharacters: JSON.stringify(body).length,
    systemMessageCount: preparedMessages.filter((message) => message.role === 'system').length,
    toolCount,
    toolChoice: toolCount > 0 ? body.tool_choice : undefined,
    streaming: false,
    deadlineMs: timeoutMs,
    maxTokens,
  })

  try {
    const response = await config.http.post(config.chatPath, body, {
      headers: { Authorization: `Bearer ${config.apiKey}`, ...config.extraHeaders },
      signal: deadline.signal,
      timeout: timeoutMs,
    })
    const parsed = parseChatCompletion(config.provider, config.displayName, response.data)
    llmDebug({
      provider: config.provider,
      model: config.model,
      finishReason: parsed.finishReason,
      latencyMs: Date.now() - started,
      hadReasoning: parsed.hadReasoning,
      contentEmpty: false,
      usage: parsed.usage,
    })
    terminalResult = 'success'
    terminalCode = 'OK'
    return parsed
  } catch (error) {
    if (error instanceof LlmResponseError) {
      terminalCode = error.code
      llmDebug({
        provider: config.provider,
        model: config.model,
        finishReason: 'error',
        latencyMs: Date.now() - started,
        hadReasoning: false,
        contentEmpty: true,
        error: error.message,
      })
      throw error
    }
    if (axios.isAxiosError(error) && error.response) {
      const message = normalizeHttpErrorMessage(config.displayName, error.response.status)
      const failure = classifyHttpFailure(error.response.status)
      terminalCode = failure.code
      llmDebug({
        provider: config.provider,
        model: config.model,
        finishReason: 'error',
        latencyMs: Date.now() - started,
        hadReasoning: false,
        contentEmpty: true,
        status: error.response.status,
        error: message,
      })
      throw new LlmResponseError({
        provider: config.provider,
        ...failure,
        message,
      })
    }
    if (deadline.didTimeOut()) {
      terminalCode = 'TIMEOUT'
      throw new LlmResponseError({
        provider: config.provider,
        code: 'TIMEOUT',
        recoverable: true,
        message: `${config.displayName}: превышено время ожидания ответа.`,
      })
    }
    if (options.signal?.aborted || axios.isCancel(error)) {
      terminalCode = 'CANCELLED'
      throw new LlmResponseError({
        provider: config.provider,
        code: 'CANCELLED',
        recoverable: true,
        message: `${config.displayName}: запрос отменён.`,
      })
    }
    if (
      axios.isAxiosError(error) &&
      (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
    ) {
      terminalCode = 'TIMEOUT'
      throw new LlmResponseError({
        provider: config.provider,
        code: 'TIMEOUT',
        recoverable: true,
        message: `${config.displayName}: превышено время ожидания ответа.`,
      })
    }
    if (axios.isAxiosError(error)) {
      const cause = error.cause as { code?: unknown; name?: unknown; syscall?: unknown } | undefined
      mainLog.warn('[LLM] transport failure', {
        provider: config.provider,
        model: config.model,
        code: error.code ?? 'unknown',
        causeCode: typeof cause?.code === 'string' ? cause.code : undefined,
        causeName: typeof cause?.name === 'string' ? cause.name : undefined,
        causeSyscall: typeof cause?.syscall === 'string' ? cause.syscall : undefined,
      })
    }
    const message = networkErrorMessage(config.displayName)
    terminalCode = 'NETWORK_ERROR'
    llmDebug({
      provider: config.provider,
      model: config.model,
      finishReason: 'error',
      latencyMs: Date.now() - started,
      hadReasoning: false,
      contentEmpty: true,
      error: message,
    })
    throw new LlmResponseError({
      provider: config.provider,
      code: 'NETWORK_ERROR',
      recoverable: true,
      message,
    })
  } finally {
    deadline.dispose()
    mainLog.info('[LLMTransportTrace] request_terminal', {
      traceId,
      provider: config.provider,
      model: config.model,
      result: terminalResult,
      code: terminalCode,
      elapsedMs: Date.now() - started,
      streaming: false,
    })
  }
}
