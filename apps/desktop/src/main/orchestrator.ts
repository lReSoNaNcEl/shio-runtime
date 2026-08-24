import { createHash } from 'node:crypto'

import type {
  ActionReplyGrounding,
  DesktopWorkflowActionResult,
  DesktopWorkflowRequest,
} from '../shared/actions'
import type { ShioCapabilityProvider, ShioCapabilitySnapshot } from '../shared/capabilities'
import {
  type CharacterEmbodimentIntent,
  parseCharacterEmbodimentResponse,
} from '../shared/character-response'
import type { AppSettings } from '../shared/config'
import type { ReplyGrounding } from '../shared/conversation'
import type { BrowserContextProviderResolver } from '../shared/desktop-control'
import { normalizeEmotionTag, parseEmotionalReply, parseLeadingEmotionTag } from '../shared/emotion'
import { normalizeUiLocale } from '../shared/localization'
import type { ProjectContextProviderResolver } from '../shared/plugins'
import type {
  ProjectContextPacket,
  ProjectEvidenceSource,
  ProjectReplyProvenance,
} from '../shared/project-awareness'
import type { ScreenContextImageMimeType } from '../shared/screen-context'
import type {
  SpeechAudioBoundaryTelemetry,
  SpeechTextNormalizationTelemetry,
} from '../shared/speech'
import { containsCharacterProtocol } from './character/compatibility/LegacyDirectiveContainment'
import { presentActionResult } from './character/presentation/ActionResultPresenter'
import {
  memoryLoopFailure,
  verifiedToolOutcomeFallback,
} from './character/presentation/MemoryResultPresenter'
import {
  CAPABILITY_CONTEXT_UNAVAILABLE_PROMPT,
  characterCapabilityPrompt,
} from './character/prompting/CapabilityPromptProjection'
import {
  embodimentContractPrompt,
  emotionContractPrompt,
  SYSTEM_PROMPT,
} from './character/prompting/CharacterPrompt'
import { memoryCapabilityPrompt } from './character/prompting/MemoryPromptPolicy'
import { responsePolicyPrompt } from './character/prompting/ResponsePolicyPrompt'
import {
  CharacterToolDispatcher,
  CharacterToolLoop,
  CharacterToolRegistry,
} from './character-tools'
import type { BrowserAgentCoordinator } from './desktop-control/browser-agent'
import {
  type ChatMessage,
  type LLMProvider,
  type LlmRequestOptions,
  LlmResponseError,
  LlmTurnCancelledError,
} from './llm'
import { mainLog } from './logging/safeLogger'
import type { MemoryStore, MemoryToolBroker } from './memory'
import type { SpeechSynthesisClient } from './speech/speechClient'
import { classifySpeechUtterance, normalizeSpeechText } from './speech/text-normalization'

export { presentActionResult as actionResultFallback }

const SESSION_ID = 'default'
const TTS_VOICE_ID = 'animevox_makima'
const TTS_ENGINE = 'f5'

export interface CharacterReplyInput {
  userText: string
  screenContext?: {
    mimeType: ScreenContextImageMimeType
    bytes: Uint8Array
    sourceName: string
  }
}

function safeTraceId(value: string | undefined): string {
  return value && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : 'untracked'
}

function messageSize(messages: readonly ChatMessage[]): {
  textCharacters: number
  imageBytes: number
} {
  let textCharacters = 0
  let imageBytes = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      textCharacters += message.content.length
      continue
    }
    for (const part of message.content) {
      if (part.type === 'text') textCharacters += part.text.length
      else imageBytes += part.bytes.byteLength
    }
  }
  return { textCharacters, imageBytes }
}

function errorCode(error: unknown): string {
  if (error instanceof LlmResponseError || error instanceof LlmTurnCancelledError) return error.code
  return 'UNKNOWN'
}

function safeEvidenceSource(
  item: ProjectContextPacket['evidence'][number],
): ProjectEvidenceSource | null {
  const path = item.path.replaceAll('\\', '/').trim()
  const segments = path.split('/')
  if (
    !path ||
    path.length > 500 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    segments.some((segment) => segment === '..' || segment === '')
  ) {
    return null
  }
  const startLine =
    Number.isInteger(item.startLine) && item.startLine > 0 ? item.startLine : undefined
  const endLine = Number.isInteger(item.endLine) && item.endLine > 0 ? item.endLine : undefined
  return {
    path,
    ...(startLine ? { startLine } : {}),
    ...(startLine && endLine && endLine >= startLine ? { endLine } : {}),
  }
}

export function projectReplyProvenance(packet: ProjectContextPacket): ProjectReplyProvenance {
  const seen = new Set<string>()
  const sources = packet.evidence.flatMap((item) => {
    const source = safeEvidenceSource(item)
    if (!source) return []
    const key = `${source.path}:${source.startLine ?? ''}:${source.endLine ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    return [Object.freeze(source)]
  })
  return Object.freeze({
    pluginId: 'project-awareness',
    repository: packet.repository,
    branch: packet.branch,
    snapshotCommit: packet.snapshotSha,
    freshnessAtGeneration: packet.freshness,
    sources: Object.freeze(sources.slice(0, 20)),
  })
}

export function actionReplyGrounding(result: DesktopWorkflowActionResult): ActionReplyGrounding {
  const reportedOutcome = result.execution?.reportedOutcome
  const groundedResult = Object.freeze({
    outcome: result.outcome,
    ...(result.authorization ? { authorization: result.authorization } : {}),
    ...(result.execution
      ? {
          runtimeCompleted: result.execution.runtimeCompleted,
          verification: result.execution.verification,
          ...(result.execution.browser ? { browser: result.execution.browser } : {}),
          ...(result.execution.presentationFacts
            ? {
                presentationFacts: result.execution.presentationFacts.filter(
                  (fact) => fact.sensitivity === 'safe',
                ),
              }
            : {}),
        }
      : {}),
    ...(reportedOutcome
      ? {
          reportedOutcomeSha256: createHash('sha256').update(reportedOutcome).digest('hex'),
          reportedOutcomeCharacters: reportedOutcome.length,
        }
      : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  })
  return Object.freeze({
    actionId: result.actionId,
    tool: result.tool,
    result: groundedResult,
  })
}

function replyGrounding(
  project: ProjectReplyProvenance | undefined,
  action: ActionReplyGrounding | undefined,
): ReplyGrounding | undefined {
  if (!project && !action) return undefined
  return Object.freeze({
    ...(project ? { project } : {}),
    ...(action ? { action } : {}),
  })
}

export class Orchestrator {
  private nativeCharacterToolsRejected = false

  constructor(
    private llm: LLMProvider,
    private memory: MemoryStore,
    private speech: SpeechSynthesisClient,
    private settings: () => AppSettings,
    private projectContext?: ProjectContextProviderResolver,
    private capabilityContext?: ShioCapabilityProvider,
    private executeDesktopWorkflow?: (
      request: DesktopWorkflowRequest,
      signal: AbortSignal,
      authorizationScopeId?: string,
    ) => Promise<DesktopWorkflowActionResult>,
    private browserContext?: BrowserContextProviderResolver,
    private browserAgent?: BrowserAgentCoordinator,
    private semanticMemory?: MemoryToolBroker,
  ) {}

  async createReply(
    input: CharacterReplyInput,
    options: LlmRequestOptions = {},
  ): Promise<{
    replyText: string
    emotionKey: string
    embodimentIntent?: CharacterEmbodimentIntent
    grounding?: ReplyGrounding
  }> {
    const { userText, screenContext } = input
    const traceId = safeTraceId(options.traceId)
    const history = await this.memory.getHistory(SESSION_ID)

    let capabilityContext: ShioCapabilitySnapshot | null = null
    let capabilityContextUnavailable = false
    try {
      capabilityContext = (await this.capabilityContext?.snapshot()) ?? null
    } catch (error) {
      capabilityContextUnavailable = true
      mainLog.warn('[PluginRuntime] capability snapshot failed; continuing without it', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    let projectAvailable = false
    try {
      projectAvailable = Boolean(this.projectContext?.())
    } catch (error) {
      mainLog.warn('[PluginRuntime] project-context availability failed; continuing without it', {
        traceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    const locale = normalizeUiLocale(this.settings().uiLocale)
    const semanticMemoryStatus = this.semanticMemory?.status() ?? null
    const semanticMemoryPrompt = semanticMemoryStatus
      ? memoryCapabilityPrompt(semanticMemoryStatus)
      : null
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'system' as const, content: responsePolicyPrompt() },
      { role: 'system' as const, content: emotionContractPrompt() },
      { role: 'system' as const, content: embodimentContractPrompt() },
      ...(semanticMemoryPrompt ? [{ role: 'system' as const, content: semanticMemoryPrompt }] : []),
      ...(capabilityContext
        ? [
            {
              role: 'system' as const,
              content: characterCapabilityPrompt(capabilityContext, locale),
            },
          ]
        : []),
      ...(capabilityContextUnavailable
        ? [{ role: 'system' as const, content: CAPABILITY_CONTEXT_UNAVAILABLE_PROMPT }]
        : []),
      ...history,
      {
        role: 'user' as const,
        content: screenContext
          ? [
              { type: 'text' as const, text: userText },
              {
                type: 'image' as const,
                mimeType: screenContext.mimeType,
                bytes: screenContext.bytes,
              },
            ]
          : userText,
      },
    ]

    const promptSize = messageSize(messages)
    const providerStartedAt = Date.now()
    mainLog.info('[ConversationTrace] provider_request_started', {
      traceId,
      messageCount: messages.length,
      promptCharacters: promptSize.textCharacters,
      estimatedPromptLlmUnits: Math.ceil(promptSize.textCharacters / 4),
      imageBytes: promptSize.imageBytes,
    })
    let rawReplyText: string
    let projectContext: ProjectContextPacket | null = null
    let actionGrounding: ActionReplyGrounding | undefined
    try {
      let dispatcher: CharacterToolDispatcher | undefined
      const registry = (): CharacterToolRegistry =>
        new CharacterToolRegistry({
          projectAvailable,
          capabilityContext,
          browserObservation: dispatcher?.selectedBrowserObservation() ?? null,
          memory: this.semanticMemory,
          actionsAvailable: Boolean(this.executeDesktopWorkflow),
        })
      const toolResult = await new CharacterToolLoop().run({
        llm: this.llm,
        messages,
        registry,
        createDispatcher: (signal) => {
          dispatcher = new CharacterToolDispatcher({
            registry,
            traceId,
            userGoal: userText,
            signal,
            projectContext: this.projectContext,
            semanticMemory: this.semanticMemory,
            executeDesktopWorkflow: this.executeDesktopWorkflow,
            browserContext: this.browserContext,
            browserAgent: this.browserAgent,
          })
          return dispatcher
        },
        traceId,
        signal: options.signal,
        requestOptions: options,
        nativeToolsRejected: this.nativeCharacterToolsRejected,
        failureReply: (latestActionResult, latestVerifiedOutcome) =>
          latestActionResult
            ? presentActionResult(
                latestActionResult,
                locale,
                Boolean(latestActionResult.execution?.browser),
              )
            : (verifiedToolOutcomeFallback(latestVerifiedOutcome, locale) ??
              (locale === 'ru'
                ? '[calm]Не смогла безопасно завершить работу с инструментами в этом запросе.'
                : '[calm]I could not safely finish the tool work for this request.')),
        limitReply:
          locale === 'ru'
            ? '[calm]Не смогла закончить задачу в пределах текущего лимита действий.'
            : '[calm]I could not finish the task within the current action limit.',
      })
      this.nativeCharacterToolsRejected = toolResult.nativeToolsRejected
      rawReplyText = toolResult.replyText
      projectContext = toolResult.projectContext ?? null
      actionGrounding = toolResult.latestActionResult
        ? actionReplyGrounding(toolResult.latestActionResult)
        : undefined
      if (options.signal?.aborted) throw new LlmTurnCancelledError()
      mainLog.info('[ConversationTrace] provider_request_terminal', {
        traceId,
        result: 'success',
        elapsedMs: Date.now() - providerStartedAt,
        responseCharacters: rawReplyText.length,
        toolRounds: toolResult.rounds,
        toolCalls: toolResult.calls,
        projectEvidenceCount: projectContext?.evidence.length ?? 0,
      })
    } catch (error) {
      mainLog.warn('[ConversationTrace] provider_request_terminal', {
        traceId,
        result: 'failure',
        code: errorCode(error),
        elapsedMs: Date.now() - providerStartedAt,
      })
      throw error
    }
    if (containsCharacterProtocol(rawReplyText)) {
      mainLog.warn('[CharacterToolLoop] repeated or malformed protocol contained', { traceId })
      rawReplyText = memoryLoopFailure(locale)
    }

    const { replyText, embodimentIntent } = parseCharacterEmbodimentResponse(rawReplyText)
    const visibleReplyText = parseEmotionalReply(replyText).visibleText
    await this.memory.appendTurn(SESSION_ID, {
      user: { role: 'user', content: userText },
      assistant: {
        role: 'assistant',
        content: visibleReplyText,
      },
    })

    const emotionKey = parseLeadingEmotionTag(replyText)
    mainLog.info('[emotion] LLM reply tag', { emotionKey, replyCharacters: replyText.length })
    return {
      replyText,
      emotionKey,
      embodimentIntent,
      grounding: replyGrounding(
        projectContext ? projectReplyProvenance(projectContext) : undefined,
        actionGrounding,
      ),
    }
  }

  async synthesizeReply(
    replyText: string,
    emotionKey: string,
    signal?: AbortSignal,
  ): Promise<{
    audioBuffer: ArrayBuffer
    emotionKey: string
    requestedEmotion?: string
    textEmotion?: string
    vrmEmotion?: string
    latencyMs?: string
    generatedLatencyMs?: string
    cache?: string
    normalization?: SpeechTextNormalizationTelemetry
    audioBoundaries?: SpeechAudioBoundaryTelemetry
  }> {
    const cfg = this.settings()
    const normalization = normalizeSpeechText({
      text: replyText,
      language: cfg.ttsLanguage,
    })
    if (normalization.diagnostics.fallbackReason) {
      mainLog.warn('[speech-polish] text normalization fallback', {
        category: normalization.diagnostics.fallbackReason,
        inputCharacters: normalization.diagnostics.inputCharacters,
        outputCharacters: normalization.diagnostics.outputCharacters,
      })
    }
    const utteranceKind = classifySpeechUtterance(
      normalization.text,
      emotionKey,
      normalization.utteranceKind === 'technical',
    )
    const speechResult = await this.speech.synthesize(
      {
        text: normalization.text,
        language: cfg.ttsLanguage,
        voiceId: TTS_VOICE_ID,
        engine: TTS_ENGINE,
        emotion: emotionKey,
        utteranceKind,
      },
      signal,
    )
    mainLog.info('[emotion] TTS result', {
      requestedEmotion: emotionKey,
      ttsRequestedEmotion: speechResult.requestedEmotion,
      ttsTextEmotion: speechResult.textEmotion,
      returnedEmotion: speechResult.emotion,
      latencyMs: speechResult.latencyMs,
      rtf: speechResult.rtf,
    })

    return {
      audioBuffer: speechResult.audioBuffer,
      emotionKey: normalizeEmotionTag(speechResult.emotion ?? emotionKey),
      requestedEmotion: speechResult.requestedEmotion,
      textEmotion: speechResult.textEmotion,
      vrmEmotion: speechResult.vrmEmotion,
      latencyMs: speechResult.latencyMs,
      generatedLatencyMs: speechResult.generatedLatencyMs,
      cache: speechResult.cache,
      normalization: {
        version: normalization.diagnostics.version,
        changed: normalization.diagnostics.changed,
        inputCharacters: normalization.diagnostics.inputCharacters,
        outputCharacters: normalization.diagnostics.outputCharacters,
        appliedRuleCount: normalization.diagnostics.appliedRuleIds.length,
        categories: normalization.diagnostics.categories,
      },
      audioBoundaries: speechResult.audioBoundaries,
    }
  }

  async ask(userText: string): Promise<{
    replyText: string
    audioBuffer: ArrayBuffer
    emotionKey: string
    vrmEmotion?: string
    latencyMs?: string
    generatedLatencyMs?: string
    cache?: string
    grounding?: ReplyGrounding
  }> {
    const { replyText, emotionKey, grounding } = await this.createReply({ userText })
    const speechResult = await this.synthesizeReply(replyText, emotionKey)

    return {
      replyText,
      audioBuffer: speechResult.audioBuffer,
      emotionKey: speechResult.emotionKey,
      vrmEmotion: speechResult.vrmEmotion,
      latencyMs: speechResult.latencyMs,
      generatedLatencyMs: speechResult.generatedLatencyMs,
      cache: speechResult.cache,
      grounding,
    }
  }

  async clearHistory(): Promise<void> {
    await this.memory.clear(SESSION_ID)
  }
}
