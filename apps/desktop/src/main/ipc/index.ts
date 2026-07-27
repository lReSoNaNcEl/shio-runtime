import { readFileSync } from 'node:fs'

import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'

import type { AppSettings } from '../../shared/config'
import {
  type AttachmentDisposition,
  deriveTurnRecoveryCapabilities,
} from '../../shared/conversation'
import type { LlmTurnErrorCode } from '../../shared/llm'
import { translate } from '../../shared/localization'
import type { RuntimeEventInput } from '../../shared/runtime'
import type { ScreenContextErrorCode } from '../../shared/screen-context'
import { ActionRuntime } from '../action/ActionRuntime'
import { getConfig, getRendererConfig, saveConfig } from '../config'
import {
  createLLMProvider,
  createModelCatalog,
  enrichModelCatalog,
  isLlmProviderId,
  type LlmCredentialStore,
  type LlmGateway,
  ModelFetchError,
  type ModelInfo,
  PROVIDER_PROFILES,
} from '../llm'
import { mainLog } from '../logging/safeLogger'
import type { CharacterReplyInput, Orchestrator } from '../orchestrator'
import type { ProjectAwarenessRuntime, ProjectCredentialStore } from '../project-awareness'
import { ScreenContextError, type ScreenContextService } from '../screen-context'
import type { SpeechClient } from '../speech/speechClient'
import { registerAvatarIpc } from './registerAvatarIpc'
import { registerConfigIpc } from './registerConfigIpc'
import { registerLlmIpc } from './registerLlmIpc'
import { registerProjectAwarenessIpc } from './registerProjectAwarenessIpc'
import { registerScreenContextIpc } from './registerScreenContextIpc'
import { registerSpeechIpc } from './registerSpeechIpc'
import { registerSystemIpc } from './registerSystemIpc'

const screenContextErrorCode = (error: unknown): ScreenContextErrorCode =>
  error instanceof ScreenContextError ? error.code : 'UNKNOWN'

export function registerIpcHandlers(
  orchestrator: () => Orchestrator,
  llm: () => LlmGateway,
  llmCredentialStore: () => LlmCredentialStore,
  projectAwareness: () => ProjectAwarenessRuntime,
  projectCredentialStore: () => ProjectCredentialStore,
  speech: () => SpeechClient,
  screenContext: ScreenContextService,
  win: BrowserWindow,
): void {
  const sendActionEvent = (event: RuntimeEventInput): void => {
    if (win.isDestroyed()) return
    win.webContents.send('action-runtime:event', event)
  }
  const actions = new ActionRuntime(sendActionEvent)
  let backlogArbitrationInFlight = false
  let activeCharacterGenerationTurnId: string | null = null
  let activeSynthesisTurnId: string | null = null
  const cancelledTurns = new Set<string>()
  const replyAbortControllers = new Map<string, AbortController>()
  const replySettlements = new Map<string, Promise<void>>()
  const visionTurns = new Set<string>()

  actions.register({
    name: 'speech.health',
    description: 'Check local speech service health.',
    execute: async () => speech().health(),
  })
  actions.register<ArrayBuffer, { text: string }>({
    name: 'speech.recognize',
    description: 'Recognize WAV audio through the local speech service.',
    execute: async (wavBuffer) => {
      const result = await speech().recognize(wavBuffer)
      return { text: result.text }
    },
  })
  actions.register<
    {
      turnId: string
      input: CharacterReplyInput
      signal: AbortSignal
    },
    Awaited<ReturnType<Orchestrator['createReply']>>
  >({
    name: 'speech.createReply',
    description: 'Create a character reply through the current LLM orchestration.',
    execute: async ({ turnId, input, signal }) => {
      if (cancelledTurns.has(turnId)) {
        throw new Error(`Conversation interrupted turnId=${turnId}`)
      }
      if (activeCharacterGenerationTurnId) {
        throw new Error(
          `Character generation overlap: activeTurnId=${activeCharacterGenerationTurnId} requestedTurnId=${turnId}`,
        )
      }
      activeCharacterGenerationTurnId = turnId
      try {
        const result = await orchestrator().createReply(input, { signal })
        return result
      } finally {
        if (activeCharacterGenerationTurnId === turnId) activeCharacterGenerationTurnId = null
      }
    },
  })
  actions.register<
    { turnId: string; replyText: string; emotionKey: string },
    Awaited<ReturnType<Orchestrator['synthesizeReply']>>
  >({
    name: 'speech.synthesizeReply',
    description: 'Synthesize speech audio for an assistant reply.',
    execute: async ({ turnId, replyText, emotionKey }) => {
      if (activeSynthesisTurnId) {
        throw new Error(
          `TTS synthesis overlap: activeTurnId=${activeSynthesisTurnId} requestedTurnId=${turnId}`,
        )
      }
      activeSynthesisTurnId = turnId
      try {
        const result = await orchestrator().synthesizeReply(replyText, emotionKey)
        if (cancelledTurns.has(turnId)) throw new Error(`Conversation interrupted turnId=${turnId}`)
        return result
      } finally {
        if (activeSynthesisTurnId === turnId) activeSynthesisTurnId = null
      }
    },
  })
  actions.register({
    name: 'memory.clear',
    description: 'Clear current conversation memory.',
    execute: async () => {
      await orchestrator().clearHistory()
      return { ok: true }
    },
  })
  actions.register<Partial<AppSettings>, { ok: boolean }>({
    name: 'config.save',
    description: 'Persist application configuration.',
    execute: (partial) => {
      const { projectAwareness: _projectAwareness, ...settings } = partial
      saveConfig(settings)
      win.webContents.send('config:updated', getRendererConfig())
      return { ok: true }
    },
  })
  actions.register<
    { provider: string },
    { ok: boolean; models?: ModelInfo[]; error?: string; kind?: string }
  >({
    name: 'llm.fetchModels',
    description: 'Load the available model catalog for an LLM provider.',
    execute: async ({ provider }) => {
      if (!isLlmProviderId(provider)) {
        return {
          ok: false,
          error: translate(getConfig().uiLocale, 'main.error.unknownProvider', { provider }),
          kind: 'invalid_response',
        }
      }
      const { apiKey } = llmCredentialStore().resolve(provider)
      try {
        const catalog = createModelCatalog(provider)
        const models = enrichModelCatalog(provider, await catalog.fetchModels(apiKey))
        return { ok: true, models }
      } catch (e) {
        if (e instanceof ModelFetchError) {
          return { ok: false, error: e.message, kind: e.kind }
        }
        const message = e instanceof Error ? e.message : String(e)
        return { ok: false, error: message, kind: 'unknown' }
      }
    },
  })
  actions.register({
    name: 'vrm.pick',
    description: 'Open a native file dialog for selecting a VRM model.',
    execute: async () => {
      const result = await dialog.showOpenDialog(win, {
        title: translate(getConfig().uiLocale, 'main.dialog.vrm.title'),
        filters: [
          { name: translate(getConfig().uiLocale, 'main.dialog.vrm.filter'), extensions: ['vrm'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false }
      const vrmPath = result.filePaths[0]
      saveConfig({ vrmPath })
      return { ok: true, vrmPath }
    },
  })
  actions.register<string, { ok: boolean; buffer?: ArrayBuffer; error?: string }>({
    name: 'vrm.read',
    description: 'Read a VRM model file from disk.',
    execute: (filePath) => {
      const buf = readFileSync(filePath)
      return { ok: true, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
    },
  })
  actions.register({
    name: 'vrma.pick',
    description: 'Open a native file dialog for selecting and reading a VRM animation.',
    execute: async () => {
      const result = await dialog.showOpenDialog(win, {
        title: translate(getConfig().uiLocale, 'main.dialog.vrma.title'),
        filters: [
          {
            name: translate(getConfig().uiLocale, 'main.dialog.vrma.filter'),
            extensions: ['vrma'],
          },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false }
      const animPath = result.filePaths[0]
      const buf = readFileSync(animPath)
      return {
        ok: true,
        animPath,
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      }
    },
  })

  registerSpeechIpc({
    actions,
    speech,
    cancelSynthesis: (turnId) => {
      cancelledTurns.add(turnId)
      if (activeSynthesisTurnId === turnId) activeSynthesisTurnId = null
    },
  })

  registerLlmIpc({ actions, llm, credentials: llmCredentialStore, window: win })
  registerScreenContextIpc(screenContext)

  const replyPayloadSchema = z.object({
    turnId: z.string().trim().min(1).max(100),
    userText: z.string().trim().min(1).max(20_000),
    screenContextId: z.string().trim().min(1).max(100).optional(),
  })
  ipcMain.handle('llm:reply', async (event, payload: unknown) => {
    const parsed = replyPayloadSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: 'Invalid LLM reply request' }
    const { turnId, userText, screenContextId } = parsed.data
    cancelledTurns.delete(turnId)
    const llmConfig = getRendererConfig().llm
    const activeProfile = PROVIDER_PROFILES.find(
      (profile) => profile.id === llmConfig.activeProvider,
    )
    if (
      activeProfile?.requiresApiKey !== false &&
      !llmConfig.providers[llmConfig.activeProvider].credential.configured
    ) {
      return { ok: false, errorCode: 'LLM_CREDENTIAL_MISSING' as const }
    }

    let pendingCapture: ReturnType<ScreenContextService['acquireForTurn']> | undefined
    if (screenContextId) {
      const capabilities = llm().getActiveCapabilities()
      if (!capabilities.supportsVision) {
        return {
          ok: false,
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
        pendingCapture = screenContext.acquireForTurn(event.sender.id, screenContextId, turnId)
      } catch (error) {
        const errorCode = screenContextErrorCode(error)
        return {
          ok: false,
          failure: {
            domain: 'screen-context' as const,
            code: errorCode,
            attachmentDisposition: screenContextFailureDisposition(errorCode),
            retrySameRequest: false,
            canResubmitWithoutImage: true,
          },
        }
      }
    }

    const abortController = new AbortController()
    replyAbortControllers.set(turnId, abortController)
    let settleReply!: () => void
    replySettlements.set(
      turnId,
      new Promise<void>((resolve) => {
        settleReply = resolve
      }),
    )
    if (pendingCapture) {
      visionTurns.add(turnId)
      mainLog.info('Vision Request Started', { turnId })
    }
    try {
      const action = await actions.execute<
        {
          turnId: string
          input: CharacterReplyInput
          signal: AbortSignal
        },
        Awaited<ReturnType<Orchestrator['createReply']>>
      >({
        name: 'speech.createReply',
        payload: {
          turnId,
          input: {
            userText,
            screenContext: pendingCapture
              ? {
                  mimeType: pendingCapture.mimeType,
                  bytes: pendingCapture.bytes,
                  sourceName: pendingCapture.sourceName,
                }
              : undefined,
          },
          signal: abortController.signal,
        },
      })
      if (action.status === 'success' && action.result) {
        if (pendingCapture && screenContextId) {
          screenContext.completeTurn(event.sender.id, screenContextId, turnId)
          mainLog.info('Vision Request Completed', { turnId })
        }
        const { replyText, emotionKey } = action.result
        return { ok: true, replyText, emotionKey }
      }
      const code = (action.errorCode as LlmTurnErrorCode | undefined) ?? 'UNKNOWN'
      const recoverable = action.recoverable ?? false
      let attachmentDisposition: AttachmentDisposition = 'released'
      if (pendingCapture && screenContextId) {
        if (recoverable || code === 'CANCELLED') {
          screenContext.rollbackTurn(event.sender.id, screenContextId, turnId)
          attachmentDisposition = 'retained'
        } else {
          screenContext.completeTurn(event.sender.id, screenContextId, turnId)
        }
      }
      mainLog.warn('LLM Turn Failed', {
        provider: action.providerId ?? llmConfig.activeProvider,
        turnId,
        code,
        vision: Boolean(pendingCapture),
        recoverable,
      })
      const recovery = deriveTurnRecoveryCapabilities({
        code,
        transportRecoverable: recoverable,
        hadImage: Boolean(screenContextId),
        attachmentDisposition,
      })
      return {
        ok: false,
        failure: {
          domain: 'llm' as const,
          code,
          providerId: action.providerId ?? llmConfig.activeProvider,
          attachmentDisposition,
          ...recovery,
        },
      }
    } finally {
      replyAbortControllers.delete(turnId)
      cancelledTurns.delete(turnId)
      visionTurns.delete(turnId)
      pendingCapture = undefined
      settleReply()
      replySettlements.delete(turnId)
    }
  })
  ipcMain.handle('llm:cancel-reply', async (_event, turnId: string) => {
    const abortController = replyAbortControllers.get(turnId)
    if (!abortController) return { ok: true }
    cancelledTurns.add(turnId)
    abortController.abort()
    if (visionTurns.has(turnId)) mainLog.info('Vision Request Cancelled', { turnId })
    await replySettlements.get(turnId)
    return { ok: true }
  })

  const backlogResultSchema = z
    .object({
      action: z.enum(['select', 'merge', 'discard_all']),
      selectedIds: z.array(z.string()).max(10),
      text: z.string().max(600).optional(),
      reason: z.string().max(200),
      confidence: z.number().min(0).max(1),
      backlogVersion: z.number().int().nonnegative(),
    })
    .superRefine((value, context) => {
      if (
        value.action !== 'discard_all' &&
        (!value.text?.trim() || value.selectedIds.length === 0)
      ) {
        context.addIssue({ code: 'custom', message: 'Selection requires text and selectedIds' })
      }
    })

  ipcMain.handle(
    'llm:arbitrate-backlog',
    async (
      _event,
      payload: {
        items?: Array<{
          id: string
          text: string
          priorityClass: string
          attentionScore: number
          createdAt: number
        }>
        backlogVersion?: number
        providerId?: string
        model?: string
      },
    ) => {
      if (
        !payload ||
        !Array.isArray(payload.items) ||
        !isLlmProviderId(payload.providerId ?? '') ||
        typeof payload.model !== 'string' ||
        !payload.model ||
        !Number.isInteger(payload.backlogVersion)
      ) {
        return { ok: false, error: translate(getConfig().uiLocale, 'main.error.invalidBacklog') }
      }
      const config = getConfig()
      const role = config.llm.roles.backlogSelector
      if (!role.enabled || role.providerId !== payload.providerId || role.model !== payload.model) {
        return {
          ok: false,
          error: translate(getConfig().uiLocale, 'main.error.selectorDisabled'),
        }
      }
      if (!role.providerId)
        return {
          ok: false,
          error: translate(getConfig().uiLocale, 'main.error.selectorProviderMissing'),
        }
      const providerId = role.providerId
      const credential = llmCredentialStore().resolve(providerId)
      if (!credential.apiKey)
        return {
          ok: false,
          error: translate(getConfig().uiLocale, 'main.error.selectorKeyMissing'),
        }
      if (backlogArbitrationInFlight)
        return {
          ok: false,
          error: translate(getConfig().uiLocale, 'main.error.arbitrationActive'),
        }
      const prompt = [
        'You are a conversation backlog arbitration classifier.',
        'You inspect completed user utterances captured through continuous microphone listening while the assistant was busy.',
        'Do not answer the user, roleplay, or invent wording. Select, merge, or discard only.',
        'Prefer direct corrections, direct questions, direct follow-ups, then recent relevant continuation.',
        'Reject self-echo, duplicates, stale utterances, filler, and unrelated background speech.',
        'Return valid JSON only with action, selectedIds, optional text, reason, confidence, backlogVersion.',
        'Select at most one next user turn. When merging, preserve the user wording and meaning.',
      ].join(' ')
      try {
        backlogArbitrationInFlight = true
        const provider = createLLMProvider({
          provider: providerId,
          apiKey: credential.apiKey,
          model: role.model,
        })
        const raw = await provider.chat([
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: JSON.stringify({
              backlogVersion: payload.backlogVersion,
              items: payload.items,
            }),
          },
        ])
        const json = JSON.parse(
          raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
        ) as unknown
        return { ok: true, result: backlogResultSchema.parse(json) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        backlogArbitrationInFlight = false
      }
    },
  )

  ipcMain.handle('memory:clear', async () => {
    const action = await actions.execute<void, { ok: boolean }>({
      name: 'memory.clear',
      payload: undefined,
    })
    return action.status === 'success' ? { ok: true } : { ok: false, error: action.error }
  })

  registerProjectAwarenessIpc({
    runtime: projectAwareness,
    credentials: projectCredentialStore,
    window: win,
  })

  registerConfigIpc(actions)
  registerAvatarIpc(actions, win)

  registerSystemIpc()
}

function screenContextFailureDisposition(code: ScreenContextErrorCode): AttachmentDisposition {
  if (code === 'CAPTURE_EXPIRED') return 'expired'
  if (code === 'CAPTURE_NOT_OWNED') return 'released'
  return 'retained'
}
