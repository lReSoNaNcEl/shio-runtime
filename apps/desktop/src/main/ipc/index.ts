import { readFileSync } from 'node:fs'

import { type BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'

import {
  actionConfirmationRequestSchema,
  actionRuntimeSnapshotSchema,
  type DesktopWorkflowExecution,
  type DesktopWorkflowRequest,
  desktopWorkflowRequestSchema,
} from '../../shared/actions'
import type { AppSettings } from '../../shared/config'
import {
  type AttachmentDisposition,
  deriveTurnRecoveryCapabilities,
} from '../../shared/conversation'
import type { LlmTurnErrorCode } from '../../shared/llm'
import { translate } from '../../shared/localization'
import type { RuntimeEventInput } from '../../shared/runtime'
import type { ScreenContextErrorCode } from '../../shared/screen-context'
import { ActionConfirmationBroker, ActionPermissionGuard, ActionRuntime } from '../action'
import { vrmAssetRegistry } from '../assets/VrmAssetRegistry'
import type { CapabilityCatalog } from '../capabilities'
import { getConfig, getRendererConfig, saveConfig } from '../config'
import type { DesktopControlPlugin } from '../desktop-control'
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
import type { PluginRuntime } from '../plugins'
import type { ProjectAwarenessPlugin } from '../project-awareness'
import { ScreenContextError, type ScreenContextService } from '../screen-context'
import type { SpeechClientManager } from '../speech/SpeechClientManager'
import { SpeechServiceError } from '../speech/speechErrors'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { configSaveSchema, vrmAssetHandleSchema } from './payloadSchemas'
import { registerActionIpc } from './registerActionIpc'
import { registerAvatarIpc } from './registerAvatarIpc'
import { registerCapabilitiesIpc } from './registerCapabilitiesIpc'
import { registerConfigIpc } from './registerConfigIpc'
import { registerDesktopControlIpc } from './registerDesktopControlIpc'
import { registerLlmIpc } from './registerLlmIpc'
import { registerNetworkDiagnosticsIpc } from './registerNetworkDiagnosticsIpc'
import { registerPluginIpc } from './registerPluginIpc'
import { registerProjectAwarenessIpc } from './registerProjectAwarenessIpc'
import { registerScreenContextIpc } from './registerScreenContextIpc'
import { registerSpeechIpc } from './registerSpeechIpc'
import { registerSystemIpc } from './registerSystemIpc'

const screenContextErrorCode = (error: unknown): ScreenContextErrorCode =>
  error instanceof ScreenContextError ? error.code : 'UNKNOWN'

const synthesisCancelled = (turnId: string): SpeechServiceError =>
  new SpeechServiceError({
    code: 'CANCELLED',
    operation: 'synthesis',
    recoverable: false,
    technicalMessage: `Conversation interrupted turnId=${turnId}`,
  })

export function registerIpcHandlers(
  orchestrator: () => Orchestrator,
  llm: () => LlmGateway,
  llmCredentialStore: () => LlmCredentialStore,
  plugins: () => PluginRuntime,
  projectAwareness: () => ProjectAwarenessPlugin,
  desktopControl: () => DesktopControlPlugin,
  speech: () => SpeechClientManager,
  screenContext: ScreenContextService,
  capabilityCatalog: CapabilityCatalog,
  win: BrowserWindow,
  authorization: IpcAuthorization,
): ActionRuntime {
  const sendActionEvent = (event: RuntimeEventInput): void => {
    if (win.isDestroyed()) return
    win.webContents.send('action-runtime:event', event)
    if (
      event.type === 'ToolCompleted' &&
      ['config.save', 'speech.health', 'vrm.pick'].includes(String(event.metadata?.action))
    ) {
      capabilityCatalog.invalidate()
    }
  }
  const sendToMainRenderer = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const confirmations = new ActionConfirmationBroker(
    (request) => sendToMainRenderer('action-runtime:confirmation-requested', request),
    (request) => sendToMainRenderer('action-runtime:authority-change-requested', request),
  )
  const permissionGuard = new ActionPermissionGuard({
    authorityMode: () => getConfig().desktopAuthorityMode,
    requestConfirmation: (request) => confirmations.requestAction(request),
  })
  const actions = new ActionRuntime({
    permissionGuard,
    authorityMode: () => getConfig().desktopAuthorityMode,
    cancelPendingConfirmations: () => confirmations.cancelAll(),
    onEvent: sendActionEvent,
    onChanged: (snapshot) =>
      sendToMainRenderer(
        'action-runtime:changed',
        actionRuntimeSnapshotSchema.parse({
          ...snapshot,
          pendingAuthorityChange: confirmations.pendingAuthority(),
        }),
      ),
  })
  let backlogArbitrationInFlight = false
  let activeCharacterGenerationTurnId: string | null = null
  let activeSynthesisTurnId: string | null = null
  const cancelledTurns = new Set<string>()
  const replyAbortControllers = new Map<string, AbortController>()
  const replySettlements = new Map<string, Promise<void>>()
  const synthesisAbortControllers = new Map<string, AbortController>()
  const synthesisSettlements = new Map<string, Promise<void>>()
  const visionTurns = new Set<string>()

  actions.register<DesktopWorkflowRequest, DesktopWorkflowExecution>({
    name: 'desktop.workflow',
    description: 'Execute a validated, bounded desktop automation workflow.',
    validate: (payload) => desktopWorkflowRequestSchema.parse(payload),
    authority: 'desktop-workflow',
    confirmation: (actionId, payload) =>
      actionConfirmationRequestSchema.parse({
        schemaVersion: 1,
        actionId,
        tool: 'desktop.workflow',
        goal: payload.goal,
        shellCommand: payload.shellCommand,
        browserUrl: payload.browserUrl,
        browserOperation: payload.browserOperation,
        requestedCapabilities: payload.requestedCapabilities,
        risk: payload.risk,
      }),
    timeoutMs: 120_000,
    singleFlight: true,
    adapter: 'desktop-control',
    execute: (request, context) => desktopControl().executeWorkflow(request, context.signal),
  })
  actions.onEmergencyStop(() => desktopControl().emergencyStop())

  actions.register({
    name: 'speech.health',
    description: 'Check local speech service health.',
    validate: (payload) => z.undefined().parse(payload),
    execute: async (_payload, context) => speech().health(context.signal),
  })
  actions.register<ArrayBuffer, { text: string }>({
    name: 'speech.recognize',
    description: 'Recognize WAV audio through the local speech service.',
    validate: (payload) => z.instanceof(ArrayBuffer).parse(payload),
    execute: async (wavBuffer, context) => {
      const result = await speech().transcribe(wavBuffer, context.signal)
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
    validate: (payload) =>
      z
        .object({
          turnId: z.string().min(1).max(200),
          input: z.custom<CharacterReplyInput>(
            (value) => typeof value === 'object' && value !== null,
          ),
          signal: z.instanceof(AbortSignal),
        })
        .strict()
        .parse(payload),
    timeoutMs: 240_000,
    execute: async ({ turnId, input, signal }, context) => {
      if (cancelledTurns.has(turnId)) {
        throw new Error(`Conversation interrupted turnId=${turnId}`)
      }
      if (activeCharacterGenerationTurnId) {
        throw new Error(
          `Character generation overlap: activeTurnId=${activeCharacterGenerationTurnId} requestedTurnId=${turnId}`,
        )
      }
      activeCharacterGenerationTurnId = turnId
      const combinedAbort = new AbortController()
      const abortCombined = (): void => combinedAbort.abort()
      signal.addEventListener('abort', abortCombined, { once: true })
      context.signal.addEventListener('abort', abortCombined, { once: true })
      if (signal.aborted || context.signal.aborted) combinedAbort.abort()
      try {
        const result = await orchestrator().createReply(input, {
          signal: combinedAbort.signal,
          traceId: turnId,
        })
        return result
      } finally {
        signal.removeEventListener('abort', abortCombined)
        context.signal.removeEventListener('abort', abortCombined)
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
    validate: (payload) =>
      z
        .object({
          turnId: z.string().min(1).max(200),
          replyText: z.string().max(200_000),
          emotionKey: z.string().min(1).max(100),
        })
        .strict()
        .parse(payload),
    execute: async ({ turnId, replyText, emotionKey }, context) => {
      if (cancelledTurns.has(turnId)) {
        cancelledTurns.delete(turnId)
        throw synthesisCancelled(turnId)
      }
      if (activeSynthesisTurnId) {
        throw new Error(
          `TTS synthesis overlap: activeTurnId=${activeSynthesisTurnId} requestedTurnId=${turnId}`,
        )
      }
      activeSynthesisTurnId = turnId
      const abortController = new AbortController()
      const abortFromAction = (): void => abortController.abort(context.signal.reason)
      context.signal.addEventListener('abort', abortFromAction, { once: true })
      if (context.signal.aborted) abortFromAction()
      synthesisAbortControllers.set(turnId, abortController)
      let settleSynthesis!: () => void
      synthesisSettlements.set(
        turnId,
        new Promise<void>((resolve) => {
          settleSynthesis = resolve
        }),
      )
      try {
        const result = await orchestrator().synthesizeReply(
          replyText,
          emotionKey,
          abortController.signal,
        )
        if (cancelledTurns.has(turnId)) throw synthesisCancelled(turnId)
        return result
      } finally {
        context.signal.removeEventListener('abort', abortFromAction)
        synthesisAbortControllers.delete(turnId)
        synthesisSettlements.delete(turnId)
        cancelledTurns.delete(turnId)
        if (activeSynthesisTurnId === turnId) activeSynthesisTurnId = null
        settleSynthesis()
      }
    },
  })
  actions.register({
    name: 'memory.clear',
    description: 'Clear current conversation memory.',
    validate: (payload) => z.undefined().parse(payload),
    execute: async () => {
      await orchestrator().clearHistory()
      return { ok: true }
    },
  })
  actions.register<Partial<AppSettings>, { ok: boolean }>({
    name: 'config.save',
    description: 'Persist application configuration.',
    validate: (payload) => configSaveSchema.parse(payload) as Partial<AppSettings>,
    execute: (partial) => {
      saveConfig(partial)
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
    validate: (payload) =>
      z
        .object({ provider: z.string().min(1).max(100) })
        .strict()
        .parse(payload),
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
    validate: (payload) => z.undefined().parse(payload),
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
      const asset = vrmAssetRegistry.registerSelectedAsset(vrmPath)
      saveConfig({ vrmPath })
      return { ok: true, ...asset }
    },
  })
  actions.register<string, { ok: boolean; buffer?: ArrayBuffer; error?: string }>({
    name: 'vrm.read',
    description: 'Read a registered VRM model asset.',
    validate: (payload) => vrmAssetHandleSchema.parse(payload),
    execute: (assetHandle) => ({ ok: true, buffer: vrmAssetRegistry.readAsset(assetHandle) }),
  })
  actions.register({
    name: 'vrma.pick',
    description: 'Open a native file dialog for selecting and reading a VRM animation.',
    validate: (payload) => z.undefined().parse(payload),
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
    cancelSynthesis: async (turnId) => {
      cancelledTurns.add(turnId)
      synthesisAbortControllers.get(turnId)?.abort(new Error('Conversation interrupted'))
      await synthesisSettlements.get(turnId)
    },
    onCapabilitiesProbe: (probe) => capabilityCatalog.reportSpeechCapabilities(probe),
    authorization,
  })

  registerLlmIpc({
    actions,
    llm,
    credentials: llmCredentialStore,
    window: win,
    authorization,
    onCapabilitiesChanged: () => capabilityCatalog.invalidate(),
  })
  registerCapabilitiesIpc(capabilityCatalog, win, authorization)
  registerScreenContextIpc(screenContext, authorization)

  const replyPayloadSchema = z.object({
    turnId: z.string().trim().min(1).max(100),
    userText: z.string().trim().min(1).max(20_000),
    screenContextId: z.string().trim().min(1).max(100).optional(),
  })
  ipcMain.handle(
    'llm:reply',
    authorization.handlePayload('llm:reply', IPC_ONE_PAYLOAD, async (event, payload: unknown) => {
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
      const turnStartedAt = Date.now()
      let terminalResult = 'failure'
      let terminalCode = 'UNKNOWN'
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
          terminalResult = 'success'
          terminalCode = 'OK'
          if (pendingCapture && screenContextId) {
            screenContext.completeTurn(event.sender.id, screenContextId, turnId)
            mainLog.info('Vision Request Completed', { turnId })
          }
          const { replyText, emotionKey, embodimentIntent, grounding } = action.result
          return { ok: true, replyText, emotionKey, embodimentIntent, grounding }
        }
        const code = (action.errorCode as LlmTurnErrorCode | undefined) ?? 'UNKNOWN'
        terminalCode = code
        terminalResult = code === 'CANCELLED' ? 'cancelled' : 'failure'
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
        mainLog.info('[ConversationTrace] turn_terminal', {
          traceId: turnId,
          result: terminalResult,
          code: terminalCode,
          elapsedMs: Date.now() - turnStartedAt,
        })
        replyAbortControllers.delete(turnId)
        cancelledTurns.delete(turnId)
        visionTurns.delete(turnId)
        pendingCapture = undefined
        settleReply()
        replySettlements.delete(turnId)
      }
    }),
  )
  ipcMain.handle(
    'llm:cancel-reply',
    authorization.handlePayload(
      'llm:cancel-reply',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const turnId = z.string().trim().min(1).max(100).parse(payload)
        const abortController = replyAbortControllers.get(turnId)
        if (!abortController) return { ok: true }
        cancelledTurns.add(turnId)
        abortController.abort()
        if (visionTurns.has(turnId)) mainLog.info('Vision Request Cancelled', { turnId })
        await replySettlements.get(turnId)
        return { ok: true }
      },
    ),
  )

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
    authorization.handlePayload(
      'llm:arbitrate-backlog',
      IPC_ONE_PAYLOAD,
      async (_event, rawPayload: unknown) => {
        const payloadSchema = z
          .object({
            items: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(100),
                    text: z.string().min(1).max(2_000),
                    priorityClass: z.string().min(1).max(50),
                    attentionScore: z.number().finite(),
                    createdAt: z.number().finite(),
                  })
                  .strict(),
              )
              .max(10),
            backlogVersion: z.number().int().nonnegative(),
            providerId: z.string().refine(isLlmProviderId),
            model: z.string().trim().min(1).max(500),
          })
          .strict()
        const parsed = payloadSchema.safeParse(rawPayload)
        if (!parsed.success) {
          return { ok: false, error: translate(getConfig().uiLocale, 'main.error.invalidBacklog') }
        }
        const payload = parsed.data
        const config = getConfig()
        const role = config.llm.roles.backlogSelector
        if (
          !role.enabled ||
          role.providerId !== payload.providerId ||
          role.model !== payload.model
        ) {
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
    ),
  )

  ipcMain.handle(
    'memory:clear',
    authorization.handle('memory:clear', async () => {
      const action = await actions.execute<void, { ok: boolean }>({
        name: 'memory.clear',
        payload: undefined,
      })
      return action.status === 'success' ? { ok: true } : { ok: false, error: action.error }
    }),
  )

  registerProjectAwarenessIpc({
    plugin: projectAwareness,
    actions,
    authorization,
  })
  registerDesktopControlIpc(desktopControl, authorization)
  registerPluginIpc(plugins, authorization)
  registerNetworkDiagnosticsIpc(authorization)

  registerActionIpc({
    actions,
    confirmations,
    window: win,
    capabilityCatalog,
    authorization,
  })

  registerConfigIpc(actions, authorization)
  registerAvatarIpc(actions, win, authorization)

  registerSystemIpc(authorization)
  return actions
}

function screenContextFailureDisposition(code: ScreenContextErrorCode): AttachmentDisposition {
  if (code === 'CAPTURE_EXPIRED') return 'expired'
  if (code === 'CAPTURE_NOT_OWNED') return 'released'
  return 'retained'
}
