import { type CharacterReplyStreamEvent, characterRequestId } from '../../shared/character-stream'
import type { AppSettings } from '../../shared/config'
import type { AttachmentDisposition, CharacterReplyOrigin } from '../../shared/conversation'
import { deriveTurnRecoveryCapabilities } from '../../shared/conversation'
import type { LlmTurnErrorCode } from '../../shared/llm'
import type { RecentRuntimeIncident, RuntimeIncidentCode } from '../../shared/system'
import { latencyTelemetry } from '../diagnostics/latencyTelemetry'
import type { LlmGateway } from '../llm'
import { LlmTurnCancelledError } from '../llm/errors'
import { PROVIDER_PROFILES } from '../llm/registry'
import { mainLog } from '../logging/safeLogger'
import type { CharacterReplyInput, Orchestrator } from '../orchestrator'
import { ScreenContextError, type ScreenContextService } from '../screen-context'

export interface CharacterReplyRequest {
  turnId: string
  userText: string
  screenContextId?: string
  origin?: CharacterReplyOrigin
}

const TURN_ERROR_CODES = new Set<LlmTurnErrorCode>([
  'NETWORK_ERROR',
  'TIMEOUT',
  'AUTH_ERROR',
  'ACCESS_DENIED',
  'RATE_LIMITED',
  'PROVIDER_REJECTED',
  'REQUEST_TOO_LARGE',
  'VISION_UNSUPPORTED',
  'CANCELLED',
  'EMPTY_STREAM',
  'INVALID_STREAM_CHUNK',
  'INCOMPLETE_TOOL_CALL',
  'UNKNOWN',
])
const TRANSIENT_INCIDENT_TTL_MS = 120_000

function isRuntimeIncidentCode(code: LlmTurnErrorCode): code is RuntimeIncidentCode {
  return code === 'RATE_LIMITED' || code === 'TIMEOUT' || code === 'NETWORK_ERROR'
}

function normalizeFailure(error: unknown, fallbackProvider: string) {
  const candidate = error as {
    code?: unknown
    recoverable?: unknown
    providerId?: unknown
    technicalMessage?: unknown
  }
  const code =
    typeof candidate?.code === 'string' && TURN_ERROR_CODES.has(candidate.code as LlmTurnErrorCode)
      ? (candidate.code as LlmTurnErrorCode)
      : 'UNKNOWN'
  return {
    code,
    recoverable: candidate?.recoverable === true,
    providerId: typeof candidate?.providerId === 'string' ? candidate.providerId : fallbackProvider,
    message:
      typeof candidate?.technicalMessage === 'string'
        ? candidate.technicalMessage
        : error instanceof Error
          ? error.message
          : 'Character generation failed',
  }
}

function screenContextFailureDisposition(code: string): AttachmentDisposition {
  if (code === 'CAPTURE_EXPIRED') return 'expired'
  if (code === 'CAPTURE_NOT_OWNED') return 'released'
  return 'retained'
}

export class MainConversationTurnService {
  private activeTurnId: string | null = null
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly settlements = new Map<string, Promise<void>>()
  private readonly visionTurns = new Set<string>()
  private recentLlmIncident: RecentRuntimeIncident | null = null

  constructor(
    private readonly orchestrator: () => Orchestrator,
    private readonly llm: () => LlmGateway,
    private readonly screenContext: ScreenContextService,
    private readonly llmSettings: () => AppSettings['llm'],
  ) {}

  isIdle(): boolean {
    return this.activeTurnId === null
  }

  recentIncidents(now = Date.now()): readonly RecentRuntimeIncident[] {
    if (this.recentLlmIncident && this.recentLlmIncident.expiresAt <= now) {
      this.recentLlmIncident = null
    }
    return this.recentLlmIncident ? [Object.freeze({ ...this.recentLlmIncident })] : []
  }

  private recordLlmIncident(
    provider: RecentRuntimeIncident['provider'],
    code: RuntimeIncidentCode,
    occurredAt = Date.now(),
  ): void {
    this.recentLlmIncident = Object.freeze({
      id: `llm:${code.toLowerCase()}`,
      owner: 'llm',
      code,
      provider,
      occurredAt,
      expiresAt: occurredAt + TRANSIENT_INCIDENT_TTL_MS,
    })
  }

  async createReply(
    rendererId: number,
    request: CharacterReplyRequest,
    emitStreamEvent?: (event: CharacterReplyStreamEvent) => void,
  ) {
    const { turnId, userText, screenContextId, origin = 'user' } = request
    const llmConfig = this.llmSettings()
    const activeProfile = PROVIDER_PROFILES.find(
      (profile) => profile.id === llmConfig.activeProvider,
    )
    if (
      activeProfile?.requiresAccountId === true &&
      !llmConfig.providers[llmConfig.activeProvider].accountId?.trim()
    ) {
      return { ok: false as const, errorCode: 'LLM_CREDENTIAL_MISSING' as const }
    }
    if (
      activeProfile?.requiresApiKey !== false &&
      !llmConfig.providers[llmConfig.activeProvider].credential.configured
    ) {
      return { ok: false as const, errorCode: 'LLM_CREDENTIAL_MISSING' as const }
    }
    if (!llmConfig.providers[llmConfig.activeProvider].model.trim()) {
      return { ok: false as const, errorCode: 'LLM_MODEL_MISSING' as const }
    }
    if (this.activeTurnId) {
      return {
        ok: false as const,
        failure: {
          domain: 'llm' as const,
          code: 'UNKNOWN' as const,
          providerId: llmConfig.activeProvider,
          attachmentDisposition: 'released' as const,
          retrySameRequest: false,
          canResubmitWithoutImage: Boolean(screenContextId),
        },
      }
    }

    let pendingCapture: ReturnType<ScreenContextService['acquireForTurn']> | undefined
    if (screenContextId) {
      if (!this.llm().getActiveCapabilities().supportsVision) {
        return {
          ok: false as const,
          failure: {
            domain: 'screen-context' as const,
            code: 'VISION_UNSUPPORTED' as const,
            attachmentDisposition: 'retained' as const,
            retrySameRequest: false,
            canResubmitWithoutImage: true,
          },
        }
      }
      try {
        pendingCapture = this.screenContext.acquireForTurn(rendererId, screenContextId, turnId)
      } catch (error) {
        const code = error instanceof ScreenContextError ? error.code : 'UNKNOWN'
        return {
          ok: false as const,
          failure: {
            domain: 'screen-context' as const,
            code,
            attachmentDisposition: screenContextFailureDisposition(code),
            retrySameRequest: false,
            canResubmitWithoutImage: true,
          },
        }
      }
    }

    const abortController = new AbortController()
    this.activeTurnId = turnId
    this.abortControllers.set(turnId, abortController)
    let settle!: () => void
    this.settlements.set(
      turnId,
      new Promise<void>((resolve) => {
        settle = resolve
      }),
    )
    if (pendingCapture) {
      this.visionTurns.add(turnId)
      mainLog.info('Vision Request Started', { turnId })
    }
    const startedAt = Date.now()
    const correlation = {
      turnId,
      requestId: characterRequestId(turnId),
      llmRound: 0,
    }
    latencyTelemetry.record({
      name: 'input_received',
      at: startedAt,
      correlation,
      status: 'started',
      provider: llmConfig.activeProvider,
      model: llmConfig.providers[llmConfig.activeProvider].model,
    })
    latencyTelemetry.record({
      name: 'llm_request_started',
      at: startedAt,
      correlation,
      status: 'started',
      provider: llmConfig.activeProvider,
      model: llmConfig.providers[llmConfig.activeProvider].model,
    })
    let terminalResult = 'failure'
    let terminalCode = 'UNKNOWN'
    try {
      const input: CharacterReplyInput = {
        userText,
        origin,
        screenContext: pendingCapture
          ? {
              mimeType: pendingCapture.mimeType,
              bytes: pendingCapture.bytes,
              sourceName: pendingCapture.sourceName,
            }
          : undefined,
      }
      const result = await this.orchestrator().createReply(input, {
        signal: abortController.signal,
        traceId: turnId,
        onStreamEvent: (event) => {
          if (event.type === 'embodiment-intent') {
            emitStreamEvent?.({ ...event, turnId, requestId: characterRequestId(turnId) })
            return
          }
          const milestone =
            event.type === 'connected'
              ? 'llm_connected'
              : event.type === 'first-byte'
                ? 'llm_first_byte'
                : event.type === 'text-delta'
                  ? 'llm_first_text_delta'
                  : event.type === 'tool-round-started'
                    ? 'tool_round_started'
                    : 'tool_round_completed'
          latencyTelemetry.record({
            name: milestone,
            at: event.at,
            correlation: { ...correlation, llmRound: event.llmRound },
            status: event.type.endsWith('completed') ? 'success' : 'started',
            provider: llmConfig.activeProvider,
            model: llmConfig.providers[llmConfig.activeProvider].model,
          })
          emitStreamEvent?.({
            ...event,
            turnId,
            requestId: characterRequestId(turnId),
          })
        },
      })
      if (abortController.signal.aborted) throw new LlmTurnCancelledError()
      if (result.providerIncidentCode) {
        this.recordLlmIncident(llmConfig.activeProvider, result.providerIncidentCode)
      } else if (result.assistantTurnKind === 'character') {
        this.recentLlmIncident = null
      }
      terminalResult = 'success'
      terminalCode = 'OK'
      if (pendingCapture && screenContextId) {
        this.screenContext.completeTurn(rendererId, screenContextId, turnId)
        mainLog.info('Vision Request Completed', { turnId })
      }
      const { replyText, emotionKey, embodimentIntent, grounding } = result
      latencyTelemetry.record({
        name: 'llm_completed',
        at: Date.now(),
        correlation,
        status: 'success',
        provider: llmConfig.activeProvider,
        model: llmConfig.providers[llmConfig.activeProvider].model,
      })
      emitStreamEvent?.({
        type: 'completed',
        turnId,
        requestId: characterRequestId(turnId),
        at: Date.now(),
        llmRound: 0,
      })
      return { ok: true as const, replyText, emotionKey, embodimentIntent, grounding }
    } catch (error) {
      const failure = normalizeFailure(error, llmConfig.activeProvider)
      if (isRuntimeIncidentCode(failure.code)) {
        this.recordLlmIncident(llmConfig.activeProvider, failure.code)
      }
      terminalCode = failure.code
      terminalResult = failure.code === 'CANCELLED' ? 'cancelled' : 'failure'
      let attachmentDisposition: AttachmentDisposition = 'released'
      if (pendingCapture && screenContextId) {
        if (failure.recoverable || failure.code === 'CANCELLED') {
          this.screenContext.rollbackTurn(rendererId, screenContextId, turnId)
          attachmentDisposition = 'retained'
        } else {
          this.screenContext.completeTurn(rendererId, screenContextId, turnId)
        }
      }
      const recovery = deriveTurnRecoveryCapabilities({
        code: failure.code,
        transportRecoverable: failure.recoverable,
        hadImage: Boolean(screenContextId),
        attachmentDisposition,
      })
      mainLog.warn('LLM Turn Failed', {
        provider: failure.providerId,
        turnId,
        code: failure.code,
        vision: Boolean(pendingCapture),
        recoverable: failure.recoverable,
      })
      return {
        ok: false as const,
        failure: {
          domain: 'llm' as const,
          code: failure.code,
          providerId: failure.providerId,
          attachmentDisposition,
          ...recovery,
        },
      }
    } finally {
      mainLog.info('[ConversationTrace] ipc_turn_terminal', {
        traceId: turnId,
        result: terminalResult,
        code: terminalCode,
        elapsedMs: Date.now() - startedAt,
      })
      this.abortControllers.delete(turnId)
      this.visionTurns.delete(turnId)
      if (this.activeTurnId === turnId) this.activeTurnId = null
      settle()
      this.settlements.delete(turnId)
    }
  }

  async cancelReply(turnId: string): Promise<void> {
    const abortController = this.abortControllers.get(turnId)
    if (!abortController) return
    abortController.abort()
    if (this.visionTurns.has(turnId)) mainLog.info('Vision Request Cancelled', { turnId })
    await this.settlements.get(turnId)
  }

  async dispose(): Promise<void> {
    const activeTurnId = this.activeTurnId
    if (activeTurnId) await this.cancelReply(activeTurnId)
  }
}
