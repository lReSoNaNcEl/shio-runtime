import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'

import type { AppSettings } from '../shared/config'
import { translate } from '../shared/localization'
import type {
  ProjectAwarenessPublicConfig,
  ProjectReadFileInput,
  ProjectReadSymbolInput,
  ProjectRecentChangesInput,
  ProjectSearchInput,
} from '../shared/project-awareness'
import { isValidProjectBranch, isValidProjectRepository } from '../shared/project-awareness'
import type { RuntimeEventInput } from '../shared/runtime'
import {
  SCREEN_CONTEXT_IMPORT_LIMITS,
  type ScreenContextErrorCode,
  type ScreenContextImportRequest,
  type ScreenContextResult,
} from '../shared/screen-context'
import type { SpeechOperation, SpeechServiceErrorCode } from '../shared/speech'
import { ActionRuntime } from './action/ActionRuntime'
import { getConfig, getRendererConfig, saveConfig } from './config'
import {
  createLLMProvider,
  createModelCatalog,
  enrichModelCatalog,
  isLlmProviderId,
  type LlmCredentialStore,
  type LlmGateway,
  type LlmProviderId,
  ModelFetchError,
  type ModelInfo,
  PROVIDER_PROFILES,
  type ProviderProfile,
} from './llm'
import { mainLog } from './logging/safeLogger'
import type { CharacterReplyInput, Orchestrator } from './orchestrator'
import type {
  LoadedProjectCredential,
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
} from './project-awareness'
import { ScreenContextError, type ScreenContextService } from './screen-context'
import { deriveCapabilities, type SpeechClient } from './speech/speechClient'
import { logSpeechError, logSpeechRecovery } from './speech/speechErrors'

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
        if (cancelledTurns.has(turnId)) throw new Error(`Conversation interrupted turnId=${turnId}`)
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

  const logSpeechFailure = (
    operation: SpeechOperation,
    action: { error?: string; errorCode?: string },
  ): void => {
    logSpeechError({
      operation,
      code: (action.errorCode as SpeechServiceErrorCode | undefined) ?? 'UNKNOWN',
      recoverable: false,
      technicalMessage: action.error,
    })
  }

  ipcMain.handle('health:check', async () => {
    const action = await actions.execute<void, Awaited<ReturnType<SpeechClient['health']>>>({
      name: 'speech.health',
      payload: undefined,
    })
    if (action.status === 'success' && action.result) {
      logSpeechRecovery('health')
      return { ok: true, data: action.result, capabilities: deriveCapabilities(action.result) }
    }
    logSpeechFailure('health', action)
    return { ok: false, error: action.error, errorCode: action.errorCode }
  })

  ipcMain.handle('asr:recognize', async (_event, wavBuffer: ArrayBuffer) => {
    const action = await actions.execute<ArrayBuffer, { text: string }>({
      name: 'speech.recognize',
      payload: wavBuffer,
    })
    if (action.status === 'success') {
      logSpeechRecovery('recognition')
      return { ok: true, text: action.result?.text }
    }
    logSpeechFailure('recognition', action)
    return { ok: false, error: action.error, errorCode: action.errorCode }
  })

  const screenContextFailure = <T>(code: ScreenContextErrorCode): ScreenContextResult<T> => ({
    ok: false,
    error: { code },
  })
  const screenContextErrorCode = (error: unknown): ScreenContextErrorCode =>
    error instanceof ScreenContextError ? error.code : 'UNKNOWN'

  ipcMain.handle('llm:get-active-capabilities', async () => {
    try {
      return await llm().refreshActiveCapabilities()
    } catch (error) {
      mainLog.warn('LLM capability catalog refresh failed; using fallback resolution', {
        error: error instanceof Error ? error.message : String(error),
      })
      return llm().getActiveCapabilities()
    }
  })
  ipcMain.handle('screen-context:list-sources', async (event) => {
    try {
      return {
        ok: true,
        value: await screenContext.listSources(event.sender.id),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['listSources']>>>
    } catch (error) {
      return screenContextFailure(screenContextErrorCode(error))
    }
  })
  const screenContextOperationIdSchema = z.string().uuid()
  const screenContextCaptureSchema = z.object({
    operationId: screenContextOperationIdSchema,
    sourceId: z.string().trim().min(1).max(500),
  })
  ipcMain.handle('screen-context:capture', async (event, payload: unknown) => {
    const parsed = screenContextCaptureSchema.safeParse(payload)
    if (!parsed.success) return screenContextFailure('SOURCE_NOT_FOUND')
    try {
      return {
        ok: true,
        value: await screenContext.capture(
          event.sender.id,
          parsed.data.operationId,
          parsed.data.sourceId,
        ),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['capture']>>>
    } catch (error) {
      return screenContextFailure(screenContextErrorCode(error))
    }
  })
  const screenContextImportSchema = z.object({
    operationId: screenContextOperationIdSchema,
    bytes: z
      .instanceof(ArrayBuffer)
      .refine(
        (bytes) =>
          bytes.byteLength > 0 && bytes.byteLength <= SCREEN_CONTEXT_IMPORT_LIMITS.maxInputBytes,
      ),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sourceKind: z.enum(['clipboard', 'file']),
    sourceName: z.string().max(255).optional(),
  })
  ipcMain.handle('screen-context:import-image', async (event, payload: unknown) => {
    const parsed = screenContextImportSchema.safeParse(payload)
    if (!parsed.success) {
      if (typeof payload !== 'object' || payload === null) {
        return screenContextFailure('UNKNOWN')
      }
      const rawMimeType = 'mimeType' in payload ? payload.mimeType : undefined
      if (
        rawMimeType !== 'image/jpeg' &&
        rawMimeType !== 'image/png' &&
        rawMimeType !== 'image/webp'
      ) {
        return screenContextFailure('UNSUPPORTED_IMAGE_TYPE')
      }
      const rawBytes = 'bytes' in payload ? payload.bytes : undefined
      if (!(rawBytes instanceof ArrayBuffer) || rawBytes.byteLength === 0) {
        return screenContextFailure('CAPTURE_EMPTY')
      }
      if (rawBytes.byteLength > SCREEN_CONTEXT_IMPORT_LIMITS.maxInputBytes) {
        return screenContextFailure('CAPTURE_TOO_LARGE')
      }
      return screenContextFailure('UNKNOWN')
    }
    try {
      return {
        ok: true,
        value: await screenContext.importImage(
          event.sender.id,
          parsed.data satisfies ScreenContextImportRequest,
        ),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['importImage']>>>
    } catch (error) {
      return screenContextFailure(screenContextErrorCode(error))
    }
  })
  const screenContextRecaptureSchema = z.object({
    operationId: screenContextOperationIdSchema,
    captureId: z.string().trim().min(1).max(100),
  })
  ipcMain.handle('screen-context:recapture', async (event, payload: unknown) => {
    const parsed = screenContextRecaptureSchema.safeParse(payload)
    if (!parsed.success) return screenContextFailure('CAPTURE_NOT_OWNED')
    try {
      return {
        ok: true,
        value: await screenContext.recapture(
          event.sender.id,
          parsed.data.operationId,
          parsed.data.captureId,
        ),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['recapture']>>>
    } catch (error) {
      return screenContextFailure(screenContextErrorCode(error))
    }
  })
  ipcMain.handle('screen-context:cancel-operation', (event, operationId: unknown) => {
    const parsedOperationId = screenContextOperationIdSchema.safeParse(operationId)
    if (!parsedOperationId.success) return screenContextFailure('OPERATION_STALE')
    return {
      ok: true,
      value: screenContext.cancelOperation(event.sender.id, parsedOperationId.data),
    } satisfies ScreenContextResult<boolean>
  })
  ipcMain.handle('screen-context:release', (event, captureId: unknown) => {
    const parsedCaptureId = z.string().trim().min(1).max(100).safeParse(captureId)
    if (!parsedCaptureId.success) return screenContextFailure('CAPTURE_NOT_OWNED')
    return {
      ok: true,
      value: screenContext.release(event.sender.id, parsedCaptureId.data),
    } satisfies ScreenContextResult<boolean>
  })

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

    let pendingCapture: ReturnType<ScreenContextService['consume']> | undefined
    if (screenContextId) {
      const capabilities = llm().getActiveCapabilities()
      if (!capabilities.supportsVision) {
        return {
          ok: false,
          errorCode: 'VISION_UNSUPPORTED' as const,
        }
      }
      try {
        pendingCapture = screenContext.consume(event.sender.id, screenContextId)
      } catch (error) {
        return {
          ok: false,
          errorCode: screenContextErrorCode(error),
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
        if (pendingCapture) mainLog.info('Vision Request Completed', { turnId })
        const { replyText, emotionKey } = action.result
        return { ok: true, replyText, emotionKey }
      }
      if (pendingCapture && action.error === 'VISION_UNSUPPORTED') {
        return { ok: false, errorCode: 'VISION_UNSUPPORTED' as const }
      }
      if (
        pendingCapture &&
        /некорректный запрос|запрос слишком большой|изображен|vision/i.test(action.error ?? '')
      ) {
        return { ok: false, error: 'SCREEN_CONTEXT_PROVIDER_REJECTED' }
      }
      return { ok: false, error: action.error, errorCode: action.errorCode }
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
      if (config.continuousListeningEnabled !== 'true')
        return {
          ok: false,
          error: translate(getConfig().uiLocale, 'main.error.streamingDisabled'),
        }
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

  ipcMain.handle(
    'tts:synthesize-reply',
    async (_event, turnId: string, replyText: string, emotionKey: string) => {
      const action = await actions.execute<
        { turnId: string; replyText: string; emotionKey: string },
        Awaited<ReturnType<Orchestrator['synthesizeReply']>>
      >({ name: 'speech.synthesizeReply', payload: { turnId, replyText, emotionKey } })
      if (action.status === 'success') {
        logSpeechRecovery('synthesis')
        return { ok: true, ...action.result }
      }
      logSpeechFailure('synthesis', action)
      return { ok: false, error: action.error, errorCode: action.errorCode }
    },
  )
  const ttsWarmupSchema = z.object({
    engine: z.literal('f5'),
    voiceId: z.string().trim().min(1).max(200),
    language: z.enum(['ru', 'en']),
  })
  ipcMain.handle('tts:warmup', (_event, input: unknown) =>
    speech().warmupVoice(ttsWarmupSchema.parse(input)),
  )
  ipcMain.handle('tts:cancel-synthesis', (_event, turnId: string) => {
    cancelledTurns.add(turnId)
    if (activeSynthesisTurnId === turnId) activeSynthesisTurnId = null
    return { ok: true }
  })

  ipcMain.handle('memory:clear', async () => {
    const action = await actions.execute<void, { ok: boolean }>({
      name: 'memory.clear',
      payload: undefined,
    })
    return action.status === 'success' ? { ok: true } : { ok: false, error: action.error }
  })

  ipcMain.handle('project-awareness:get-status', () => projectAwareness().getStatus())
  const projectConfigSchema = z
    .object({
      enabled: z.boolean(),
      provider: z.literal('github'),
      repository: z.string().trim().max(200),
      branch: z.string().trim().max(255),
    })
    .superRefine((config, context) => {
      if (!config.enabled) return
      if (!isValidProjectRepository(config.repository)) {
        context.addIssue({
          code: 'custom',
          path: ['repository'],
          message: translate(getConfig().uiLocale, 'main.error.project.repositoryFormat'),
        })
      }
      if (!isValidProjectBranch(config.branch)) {
        context.addIssue({
          code: 'custom',
          path: ['branch'],
          message: translate(getConfig().uiLocale, 'main.error.project.branchInvalid'),
        })
      }
    })
  ipcMain.handle(
    'project-awareness:configure',
    async (_event, input: ProjectAwarenessPublicConfig) => {
      const config = projectConfigSchema.parse(input)
      saveConfig({ projectAwareness: config })
      win.webContents.send('config:updated', getRendererConfig())
      return projectAwareness().configure(config)
    },
  )
  const projectCredentialSchema = z
    .string()
    .trim()
    .min(20)
    .max(500)
    .refine((token) => !/\s/.test(token))
  const applyProjectCredential = (
    runtime: ProjectAwarenessRuntime,
    credential: LoadedProjectCredential,
  ): void => {
    runtime.setCredential(credential.token, {
      configured: credential.configured,
      source: credential.source,
      secureStorageAvailable: credential.secureStorageAvailable,
      lastError: credential.lastError,
    })
  }
  ipcMain.handle('project-awareness:save-credential', async (_event, token: string) => {
    const parsedToken = projectCredentialSchema.parse(token)
    const runtime = projectAwareness()
    const credential = await projectCredentialStore().save(parsedToken)
    await runtime.disconnect()
    applyProjectCredential(runtime, credential)
    if (!runtime.getStatus().enabled) return runtime.getStatus()
    try {
      return await runtime.connect()
    } catch {
      return runtime.getStatus()
    }
  })
  ipcMain.handle('project-awareness:forget-credential', async () => {
    const runtime = projectAwareness()
    await runtime.disconnect()
    const credential = await projectCredentialStore().clear()
    applyProjectCredential(runtime, credential)
    return runtime.getStatus()
  })
  ipcMain.handle('project-awareness:open-token-settings', () =>
    shell.openExternal('https://github.com/settings/personal-access-tokens/new'),
  )
  ipcMain.handle('project-awareness:connect', () => projectAwareness().connect())
  ipcMain.handle('project-awareness:disconnect', () => projectAwareness().disconnect())
  ipcMain.handle('project-awareness:sync', () => projectAwareness().sync())
  ipcMain.handle('project-awareness:rebuild-index', () => projectAwareness().rebuildIndex())
  ipcMain.handle('project-awareness:get-project-map', () => projectAwareness().getProjectMap())
  const projectSearchSchema = z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(10).optional(),
    maxCharacters: z.number().int().min(1_000).max(20_000).optional(),
  })
  const projectReadFileSchema = z.object({
    path: z
      .string()
      .min(1)
      .max(500)
      .refine((path) => !path.includes('..')),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  const projectReadSymbolSchema = z.object({
    name: z.string().min(1).max(300),
    path: z
      .string()
      .min(1)
      .max(500)
      .refine((path) => !path.includes('..'))
      .optional(),
  })
  const projectRecentChangesSchema = z.object({
    limit: z.number().int().min(1).max(10).optional(),
    query: z.string().max(300).optional(),
  })
  ipcMain.handle('project-awareness:search', (_event, input: ProjectSearchInput) =>
    projectAwareness().search(projectSearchSchema.parse(input)),
  )
  ipcMain.handle('project-awareness:read-file', (_event, input: ProjectReadFileInput) =>
    projectAwareness().readFile(projectReadFileSchema.parse(input)),
  )
  ipcMain.handle('project-awareness:read-symbol', (_event, input: ProjectReadSymbolInput) =>
    projectAwareness().readSymbol(projectReadSymbolSchema.parse(input)),
  )
  ipcMain.handle(
    'project-awareness:get-recent-changes',
    (_event, input: ProjectRecentChangesInput) =>
      projectAwareness().getRecentChanges(projectRecentChangesSchema.parse(input)),
  )

  ipcMain.handle('llm:providers', (): ProviderProfile[] => [...PROVIDER_PROFILES])
  ipcMain.handle('llm:get-readiness', () => {
    const config = getRendererConfig().llm
    const provider = PROVIDER_PROFILES.find((item) => item.id === config.activeProvider)
    const credentialReady =
      provider?.requiresApiKey === false ||
      config.providers[config.activeProvider].credential.configured
    return {
      reason: credentialReady
        ? config.providers[config.activeProvider].model.trim()
          ? 'ready'
          : 'model-missing'
        : 'missing-credential',
      providerId: config.activeProvider,
      providerDisplayName: provider?.displayName ?? config.activeProvider,
    }
  })

  ipcMain.handle('llm:fetch-models', async (_event, provider: string) => {
    const action = await actions.execute<
      { provider: string },
      { ok: boolean; models?: ModelInfo[]; error?: string; kind?: string }
    >({ name: 'llm.fetchModels', payload: { provider } })
    return action.status === 'success' ? action.result : { ok: false, error: action.error }
  })

  const llmProviderSchema = z
    .string()
    .refine((provider): provider is LlmProviderId => isLlmProviderId(provider))
  const llmCredentialSchema = z.object({
    provider: llmProviderSchema,
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .refine((value) => !/\s/.test(value)),
  })
  ipcMain.handle('llm:save-credential', async (_event, payload: unknown) => {
    const { provider, apiKey } = llmCredentialSchema.parse(payload)
    const status = await llmCredentialStore().save(provider, apiKey)
    win.webContents.send('config:updated', getRendererConfig())
    return status
  })
  ipcMain.handle('llm:forget-credential', async (_event, provider: unknown) => {
    const status = await llmCredentialStore().forget(llmProviderSchema.parse(provider))
    win.webContents.send('config:updated', getRendererConfig())
    return status
  })
  ipcMain.handle('llm:get-credential-status', (_event, provider: unknown) =>
    llmCredentialStore().getStatus(llmProviderSchema.parse(provider)),
  )
  ipcMain.handle('llm:validate-credential', async (_event, payload: unknown) => {
    const { provider, apiKey } = llmCredentialSchema.parse(payload)
    try {
      const catalog = createModelCatalog(provider)
      return {
        ok: true,
        models: enrichModelCatalog(provider, await catalog.fetchModels(apiKey)),
      }
    } catch (error) {
      if (error instanceof ModelFetchError) {
        return { ok: false, error: error.message, kind: error.kind }
      }
      return {
        ok: false,
        error: translate(getConfig().uiLocale, 'main.error.llmCredentialValidation'),
        kind: 'unknown',
      }
    }
  })

  ipcMain.handle('config:get', () => getRendererConfig())

  ipcMain.handle('config:save', (_event, partial: Partial<AppSettings>) => {
    return actions
      .execute<Partial<AppSettings>, { ok: boolean }>({ name: 'config.save', payload: partial })
      .then((action) =>
        action.status === 'success' ? action.result : { ok: false, error: action.error },
      )
  })

  ipcMain.handle('vrm:pick', async () => {
    const action = await actions.execute<void, { ok: boolean; vrmPath?: string }>({
      name: 'vrm.pick',
      payload: undefined,
    })
    if (action.status !== 'success' || !action.result) return { ok: false, error: action.error }
    if (action.result.ok) win.webContents.send('config:updated', getRendererConfig())
    return action.result
  })

  ipcMain.handle('vrm:read', (_event, filePath: string) => {
    return actions
      .execute<string, { ok: boolean; buffer?: ArrayBuffer; error?: string }>({
        name: 'vrm.read',
        payload: filePath,
      })
      .then((action) =>
        action.status === 'success' ? action.result : { ok: false, error: action.error },
      )
  })

  ipcMain.handle('vrma:pick', async () => {
    const action = await actions.execute<
      void,
      { ok: boolean; animPath?: string; buffer?: ArrayBuffer }
    >({
      name: 'vrma.pick',
      payload: undefined,
    })
    return action.status === 'success' ? action.result : { ok: false, error: action.error }
  })

  ipcMain.handle('debug:write-transition-recording', (_event, payload: unknown) => {
    const dir = join(process.cwd(), 'runtime-debug', 'transitions')
    mkdirSync(dir, { recursive: true })
    const safeName = `transition-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    const filePath = join(dir, safeName)
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return { ok: true, filePath }
  })
}
