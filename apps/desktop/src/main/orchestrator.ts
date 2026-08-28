import { createHash } from 'node:crypto'

import type {
  ActionAuthorization,
  ActionOutcome,
  ActionReplyGrounding,
  DesktopWorkflowActionResult,
  DesktopWorkflowRequest,
} from '../shared/actions'
import type {
  CreatePersistentGoal,
  ExperienceAppraisal,
  MoodState,
  PersistentGoal,
  PersistentGoalProvider,
  RevisePersistentGoal,
  WorldContextSnapshot,
} from '../shared/alive'
import type {
  BrowserComputerUseControlAction,
  BrowserComputerUseProvider,
  BrowserComputerUseSession,
  BrowserComputerUseStartRequest,
} from '../shared/browser-computer-use'
import type { BrowserContextProviderResolver } from '../shared/browser-control'
import type { ShioCapabilityProvider, ShioCapabilitySnapshot } from '../shared/capabilities'
import {
  type CharacterEmbodimentIntent,
  containInternalReasoning,
  parseCharacterEmbodimentResponse,
} from '../shared/character-response'
import type { CharacterToolRequirement, TurnToolEvidenceSummary } from '../shared/character-tools'
import type { AppSettings } from '../shared/config'
import type { CharacterReplyOrigin, ReplyGrounding } from '../shared/conversation'
import type {
  ConversationThread,
  ConversationThreadRuntimePort,
} from '../shared/conversation-threads'
import { normalizeEmotionTag, parseEmotionalReply, parseLeadingEmotionTag } from '../shared/emotion'
import { normalizeUiLocale, type UiLocale } from '../shared/localization'
import type { HabitRecord, RelationshipContext } from '../shared/memory'
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
import type { WebSearchProviderResolver } from '../shared/web-search'
import type { BrowserWorkflowCoordinator } from './browser-control/workflow'
import { containsCharacterProtocol } from './character/compatibility/LegacyDirectiveContainment'
import { presentActionResult } from './character/presentation/ActionResultPresenter'
import {
  memoryLoopFailure,
  verifiedToolOutcomeFallback,
} from './character/presentation/MemoryResultPresenter'
import {
  embodimentContractPrompt,
  emotionContractPrompt,
  SYSTEM_PROMPT,
} from './character/prompting/CharacterPrompt'
import { CharacterRequestComposer } from './character/prompting/CharacterRequestComposer'
import { unfinishedGoalSnapshot } from './character/prompting/GoalAwarenessPrompt'
import { memoryCapabilityPrompt } from './character/prompting/MemoryPromptPolicy'
import { responsePolicyPrompt } from './character/prompting/ResponsePolicyPrompt'
import {
  CharacterToolDispatcher,
  CharacterToolLoop,
  type CharacterToolLoopStreamEvent,
  CharacterToolRegistry,
} from './character-tools'
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

interface CharacterLivingContext {
  mood?: MoodState
  experience?: ExperienceAppraisal
  world?: WorldContextSnapshot
  relationship?: RelationshipContext
  habits?: readonly HabitRecord[]
}

const SESSION_ID = 'default'
const TTS_VOICE_ID = 'animevox_makima'
const TTS_ENGINE = 'f5'

export interface CharacterReplyInput {
  userText: string
  origin?: CharacterReplyOrigin
  screenContext?: {
    mimeType: ScreenContextImageMimeType
    bytes: Uint8Array
    sourceName: string
  }
}

export interface CharacterReplyOptions extends LlmRequestOptions {
  onStreamEvent?: (event: CharacterToolLoopStreamEvent) => void
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

function presentRecoverableProviderFailure(error: LlmResponseError, locale: UiLocale): string {
  if (locale === 'ru') {
    if (error.code === 'PROVIDER_REJECTED')
      return '[calm]Провайдер модели отклонил продолжение ответа. Попробуй ещё раз или выбери другую модель.'
    if (error.code === 'RATE_LIMITED')
      return '[calm]Я тебя слышу. Провайдер модели сейчас ограничил запросы — попробуй ещё раз через минуту.'
    if (error.code === 'TIMEOUT')
      return '[calm]Я тебя слышу, но ответ модели не успел прийти вовремя. Попробуй ещё раз.'
    if (error.code === 'NETWORK_ERROR')
      return '[calm]Я тебя слышу, но сейчас не могу связаться с моделью. Попробуй ещё раз чуть позже.'
    return '[calm]Я тебя слышу, но провайдер модели временно не отвечает. Попробуй ещё раз чуть позже.'
  }
  if (error.code === 'PROVIDER_REJECTED')
    return '[calm]The model provider rejected the continuation. Try again or select another model.'
  if (error.code === 'RATE_LIMITED')
    return '[calm]I hear you. The model provider is rate-limiting requests right now—try again in a minute.'
  if (error.code === 'TIMEOUT')
    return '[calm]I hear you, but the model reply did not arrive in time. Please try again.'
  if (error.code === 'NETWORK_ERROR')
    return '[calm]I hear you, but I cannot reach the model right now. Please try again shortly.'
  return '[calm]I hear you, but the model provider is temporarily unavailable. Please try again shortly.'
}

function presentToolRequirementFailure(
  requirement: CharacterToolRequirement | undefined,
  reason: 'classification-failed' | 'unavailable' | 'unfulfilled',
  locale: UiLocale,
): string {
  if (reason === 'classification-failed') {
    return locale === 'ru'
      ? '[calm]Не смогла надёжно определить обязательный источник для этого запроса, поэтому не буду отвечать наугад.'
      : '[calm]I could not reliably determine the required source for this request, so I will not guess.'
  }
  const target =
    requirement?.type === 'explicit-tool'
      ? requirement.tool
      : requirement?.type === 'required-source'
        ? requirement.source === 'web'
          ? locale === 'ru'
            ? 'веб-поиск'
            : 'web search'
          : requirement.source === 'project'
            ? locale === 'ru'
              ? 'поиск по проекту'
              : 'project search'
            : requirement.source === 'memory'
              ? locale === 'ru'
                ? 'долговременную память'
                : 'long-term memory'
              : locale === 'ru'
                ? 'состояние управляемого браузера'
                : 'the controlled browser state'
        : locale === 'ru'
          ? 'обязательный источник'
          : 'the required source'
  if (reason === 'unavailable') {
    return locale === 'ru'
      ? `[calm]Сейчас не могу использовать ${target}, поэтому не буду подменять проверку ответом из памяти.`
      : `[calm]I cannot use ${target} right now, so I will not replace the requested check with remembered knowledge.`
  }
  return locale === 'ru'
    ? `[calm]Не смогла выполнить обязательную работу через ${target}, поэтому не буду выдавать непроверенный ответ.`
    : `[calm]I could not complete the required work through ${target}, so I will not present an unverified answer.`
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
    private browserWorkflow?: BrowserWorkflowCoordinator,
    private semanticMemory?: MemoryToolBroker,
    private persistentGoals?: PersistentGoalProvider,
    private createPersistentGoal?: CreatePersistentGoal,
    private revisePersistentGoal?: RevisePersistentGoal,
    private livingContext?: () => CharacterLivingContext,
    private webSearch?: WebSearchProviderResolver,
    private browserComputerUse?: () => BrowserComputerUseProvider | undefined,
    private executeBrowserComputerUseAction?: (
      action: BrowserComputerUseStartRequest | BrowserComputerUseControlAction,
      signal: AbortSignal,
    ) => Promise<{
      outcome: ActionOutcome
      authorization?: ActionAuthorization
      session?: BrowserComputerUseSession
      errorCode?: string
    }>,
    private conversationThreads?: ConversationThreadRuntimePort,
    // Production composition enables this; the default preserves bounded legacy/test adapters.
    private toolPolicy: { enforceRequirements?: boolean } = {},
  ) {}

  async createReply(
    input: CharacterReplyInput,
    options: CharacterReplyOptions = {},
  ): Promise<{
    replyText: string
    emotionKey: string
    embodimentIntent?: CharacterEmbodimentIntent
    grounding?: ReplyGrounding
  }> {
    const { userText, screenContext, origin = 'user' } = input
    const autonomous = origin === 'autonomous'
    if (autonomous && screenContext) {
      throw new Error('Autonomous replies cannot attach screen context')
    }
    const traceId = safeTraceId(options.traceId)
    const history = await this.memory.getHistory(SESSION_ID)

    let capabilityContext: ShioCapabilitySnapshot | null = null
    let capabilityContextUnavailable = false
    if (!autonomous) {
      try {
        capabilityContext = (await this.capabilityContext?.snapshot()) ?? null
      } catch (error) {
        capabilityContextUnavailable = true
        mainLog.warn('[PluginRuntime] capability snapshot failed; continuing without it', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    let projectAvailable = false
    if (!autonomous) {
      try {
        projectAvailable = Boolean(this.projectContext?.())
      } catch (error) {
        mainLog.warn('[PluginRuntime] project-context availability failed; continuing without it', {
          traceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const locale = normalizeUiLocale(this.settings().uiLocale)
    const semanticMemoryStatus = autonomous ? null : (this.semanticMemory?.status() ?? null)
    const semanticMemoryPrompt = semanticMemoryStatus
      ? memoryCapabilityPrompt(semanticMemoryStatus)
      : null
    let goalAwareness: readonly PersistentGoal[] = []
    if (!autonomous) {
      try {
        if (this.persistentGoals) {
          goalAwareness = unfinishedGoalSnapshot(this.persistentGoals())
        }
      } catch (error) {
        mainLog.warn('[AliveRuntime] goal awareness unavailable; continuing without it', {
          traceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    let threadAwareness: readonly ConversationThread[] = []
    if (!autonomous) {
      try {
        threadAwareness = this.conversationThreads?.awareness() ?? []
      } catch (error) {
        mainLog.warn('[ConversationThreads] awareness unavailable; continuing without it', {
          traceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    let livingContext: CharacterLivingContext = {}
    try {
      livingContext = this.livingContext?.() ?? {}
    } catch (error) {
      mainLog.warn('[CharacterRequestComposer] living context unavailable', {
        traceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    const messages: ChatMessage[] = [
      ...new CharacterRequestComposer().compose({
        persona: SYSTEM_PROMPT,
        responsePolicy: [
          responsePolicyPrompt(),
          ...(autonomous
            ? [
                [
                  '## Runtime-originated proactive comment',
                  'This is a bounded Runtime event, not a user request or authorization.',
                  'Reply with at most one concise in-character comment about the event.',
                  'Do not request or invoke tools, create or update Memory or Goals, or claim that the user asked for an action.',
                ].join('\n'),
              ]
            : []),
          emotionContractPrompt(),
          embodimentContractPrompt(),
        ].join('\n\n'),
        mood: livingContext.mood,
        relationship: livingContext.relationship,
        habits: livingContext.habits,
        experience: livingContext.experience,
        goals: goalAwareness,
        foregroundGoalId: livingContext.world?.activeGoal?.id,
        thread: threadAwareness[0],
        memory: semanticMemoryPrompt,
        capabilities: capabilityContext,
        capabilityContextUnavailable,
        world: livingContext.world,
        locale,
      }),
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
    let turnToolEvidence: TurnToolEvidenceSummary | undefined
    try {
      let dispatcher: CharacterToolDispatcher | undefined
      const registry = (): CharacterToolRegistry =>
        new CharacterToolRegistry({
          projectAvailable,
          webAvailable:
            !autonomous &&
            (this.webSearch?.()?.status().availability ?? 'unavailable') !== 'unavailable',
          goalsAvailable: !autonomous && Boolean(this.persistentGoals),
          goalCreatesAvailable: !autonomous && Boolean(this.createPersistentGoal),
          goalUpdatesAvailable: !autonomous && Boolean(this.revisePersistentGoal),
          conversationThreadsAvailable: !autonomous && Boolean(this.conversationThreads),
          capabilityContext,
          browserObservation: dispatcher?.selectedBrowserObservation() ?? null,
          memory: autonomous ? undefined : this.semanticMemory,
          actionsAvailable: !autonomous && Boolean(this.executeDesktopWorkflow),
          browserComputerUseAvailable:
            !autonomous && Boolean(this.browserComputerUse && this.executeBrowserComputerUseAction),
        })
      const toolResult = await new CharacterToolLoop().run({
        llm: this.llm,
        // Some bounded internal/test adapters intentionally expose only the
        // legacy LLMProvider surface. Production settings always contain llm,
        // while the fallback keeps those adapters on the non-streaming path.
        providerId: this.settings().llm?.activeProvider ?? 'groq',
        messages,
        registry,
        createDispatcher: (signal) => {
          dispatcher = new CharacterToolDispatcher({
            registry,
            traceId,
            userGoal: userText,
            signal,
            projectContext: autonomous ? undefined : this.projectContext,
            webSearch: autonomous ? undefined : this.webSearch,
            semanticMemory: autonomous ? undefined : this.semanticMemory,
            executeDesktopWorkflow: autonomous ? undefined : this.executeDesktopWorkflow,
            browserContext: autonomous ? undefined : this.browserContext,
            browserWorkflow: autonomous ? undefined : this.browserWorkflow,
            browserComputerUse: autonomous ? undefined : this.browserComputerUse,
            executeBrowserComputerUseAction: autonomous
              ? undefined
              : this.executeBrowserComputerUseAction,
            persistentGoals: autonomous ? undefined : this.persistentGoals,
            goalAwareness,
            createPersistentGoal: autonomous ? undefined : this.createPersistentGoal,
            revisePersistentGoal: autonomous ? undefined : this.revisePersistentGoal,
            conversationThreads: autonomous ? undefined : this.conversationThreads,
            threadAwareness,
          })
          return dispatcher
        },
        traceId,
        signal: options.signal,
        requestOptions: options,
        nativeToolsRejected: this.nativeCharacterToolsRejected,
        enforceToolRequirements: !autonomous && this.toolPolicy.enforceRequirements,
        requirementFailureReply: (requirement, reason) =>
          presentToolRequirementFailure(requirement, reason, locale),
        onStreamEvent: options.onStreamEvent,
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
        providerFailureReply: autonomous
          ? undefined
          : (error) => presentRecoverableProviderFailure(error, locale),
        limitReply:
          locale === 'ru'
            ? '[calm]Не смогла закончить задачу в пределах текущего лимита действий.'
            : '[calm]I could not finish the task within the current action limit.',
      })
      this.nativeCharacterToolsRejected = toolResult.nativeToolsRejected
      rawReplyText = toolResult.replyText
      turnToolEvidence = toolResult.toolEvidence
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
        toolRequirement: toolResult.toolEvidence.requirement.type,
        webSearchUsed: toolResult.toolEvidence.web.used,
        webSearchSucceeded: toolResult.toolEvidence.web.succeeded,
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
    const reasoningContainment = containInternalReasoning(rawReplyText)
    if (reasoningContainment.contained) {
      mainLog.warn('[CharacterToolLoop] provider reasoning contained', { traceId })
      rawReplyText = reasoningContainment.text.trim()
    }
    if (containsCharacterProtocol(rawReplyText)) {
      mainLog.warn('[CharacterToolLoop] repeated or malformed protocol contained', { traceId })
      rawReplyText = memoryLoopFailure(locale)
    }

    const { replyText, embodimentIntent } = parseCharacterEmbodimentResponse(rawReplyText)
    const visibleReplyText = parseEmotionalReply(replyText).visibleText
    if (!autonomous) {
      await this.memory.appendTurn(SESSION_ID, {
        user: { role: 'user', content: userText },
        assistant: {
          role: 'assistant',
          content: visibleReplyText,
          toolEvidence: turnToolEvidence,
        },
      })
    }

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
