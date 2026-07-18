import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'

import { translate } from '../shared/localization/format'
import type { UiLocale } from '../shared/localization/locale'
import type {
  ProjectAwarenessPublicConfig,
  ProjectReadFileInput,
  ProjectReadSymbolInput,
  ProjectRecentChangesInput,
  ProjectSearchInput,
} from '../shared/projectAwareness'
import { isValidProjectBranch, isValidProjectRepository } from '../shared/projectAwareness'
import type { RuntimeEventInput } from '../shared/runtime/events'
import type { SpeechOperation, SpeechServiceErrorCode } from '../shared/speech/speechErrors'
import { ActionRuntime } from './action/ActionRuntime'
import { getConfig, getRendererConfig, saveConfig } from './config'
import type { LlmConfig, ModelInfo, ProviderProfile } from './llm'
import {
  createLLMProvider,
  createModelCatalog,
  isLlmProviderId,
  ModelFetchError,
  PROVIDER_PROFILES,
} from './llm'
import type { Orchestrator } from './orchestrator'
import type {
  LoadedProjectCredential,
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
} from './project-awareness'
import { deriveCapabilities, type SpeechClient } from './speech/speechClient'
import { logSpeechError, logSpeechRecovery } from './speech/speechErrors'

export interface AppSettings {
  llm: LlmConfig
  projectAwareness: ProjectAwarenessPublicConfig
  uiLocale: UiLocale
  pythonSpeechUrl: string
  ttsVoice: string
  ttsLanguage: string
  ttsEngine: string
  vrmPath: string
  micDeviceId: string
  overlayWidth: string
  overlayHeight: string
  overlayMargin: string
  overlayOpacity: string
  overlayTransparentBackground: string
  overlayClickThrough: string
  overlayCorner: string
  overlayScale: string
  overlayViewMode: string
  overlayShowCurrentAnimation: string
  developerModeEnabled: string
  passiveCompanionEnabled?: string
  lookAtEnabled: string
  continuousListeningEnabled: string
  continuousListeningMode: string
  continuousListeningReplyCooldownMs: string
  continuousListeningFollowUpWindowMs: string
  continuousListeningCuriosityChance: string
}

export function registerIpcHandlers(
  orchestrator: () => Orchestrator,
  projectAwareness: () => ProjectAwarenessRuntime,
  projectCredentialStore: () => ProjectCredentialStore,
  speech: () => SpeechClient,
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
    { turnId: string; userText: string },
    Awaited<ReturnType<Orchestrator['createReply']>>
  >({
    name: 'speech.createReply',
    description: 'Create a character reply through the current LLM orchestration.',
    execute: async ({ turnId, userText }) => {
      if (activeCharacterGenerationTurnId) {
        throw new Error(
          `Character generation overlap: activeTurnId=${activeCharacterGenerationTurnId} requestedTurnId=${turnId}`,
        )
      }
      activeCharacterGenerationTurnId = turnId
      try {
        const result = await orchestrator().createReply(userText)
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
    { provider: string; apiKey: string },
    { ok: boolean; models?: ModelInfo[]; error?: string; kind?: string }
  >({
    name: 'llm.fetchModels',
    description: 'Load the available model catalog for an LLM provider.',
    execute: async ({ provider, apiKey }) => {
      if (!isLlmProviderId(provider)) {
        return {
          ok: false,
          error: translate(getConfig().uiLocale, 'main.error.unknownProvider', { provider }),
          kind: 'invalid_response',
        }
      }
      try {
        const catalog = createModelCatalog(provider)
        const models = await catalog.fetchModels(apiKey)
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

  ipcMain.handle('llm:reply', async (_event, turnId: string, userText: string) => {
    cancelledTurns.delete(turnId)
    const action = await actions.execute<
      { turnId: string; userText: string },
      Awaited<ReturnType<Orchestrator['createReply']>>
    >({
      name: 'speech.createReply',
      payload: { turnId, userText },
    })
    if (action.status === 'success' && action.result) {
      const { replyText, emotionKey } = action.result
      return { ok: true, replyText, emotionKey }
    }
    return { ok: false, error: action.error }
  })
  ipcMain.handle('llm:cancel-reply', (_event, turnId: string) => {
    cancelledTurns.add(turnId)
    if (activeCharacterGenerationTurnId === turnId) activeCharacterGenerationTurnId = null
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
      const credentials = config.llm.providers[providerId]
      if (!credentials?.apiKey)
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
          apiKey: credentials.apiKey,
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
    return runtime.getStatus().enabled ? runtime.connect() : runtime.getStatus()
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

  ipcMain.handle('llm:fetch-models', async (_event, provider: string, apiKey: string) => {
    const action = await actions.execute<
      { provider: string; apiKey: string },
      { ok: boolean; models?: ModelInfo[]; error?: string; kind?: string }
    >({ name: 'llm.fetchModels', payload: { provider, apiKey } })
    return action.status === 'success' ? action.result : { ok: false, error: action.error }
  })

  ipcMain.handle('config:get', () => {
    const cfg = getConfig()
    return {
      llm: cfg.llm,
      uiLocale: cfg.uiLocale,
      projectAwareness: {
        enabled: cfg.projectAwareness.enabled,
        provider: cfg.projectAwareness.provider,
        repository: cfg.projectAwareness.repository,
        branch: cfg.projectAwareness.branch,
      },
      pythonSpeechUrl: cfg.pythonSpeechUrl,
      ttsVoice: cfg.ttsVoice,
      ttsLanguage: cfg.ttsLanguage,
      ttsEngine: 'f5',
      vrmPath: cfg.vrmPath,
      micDeviceId: cfg.micDeviceId,
      overlayWidth: cfg.overlayWidth,
      overlayHeight: cfg.overlayHeight,
      overlayMargin: cfg.overlayMargin,
      overlayOpacity: cfg.overlayOpacity,
      overlayTransparentBackground: cfg.overlayTransparentBackground,
      overlayClickThrough: cfg.overlayClickThrough,
      overlayCorner: cfg.overlayCorner,
      overlayScale: cfg.overlayScale,
      overlayViewMode: cfg.overlayViewMode,
      overlayShowCurrentAnimation: cfg.overlayShowCurrentAnimation,
      developerModeEnabled: cfg.developerModeEnabled,
      passiveCompanionEnabled: cfg.passiveCompanionEnabled,
      lookAtEnabled: cfg.lookAtEnabled,
      continuousListeningEnabled: cfg.continuousListeningEnabled,
      continuousListeningMode: cfg.continuousListeningMode,
      continuousListeningReplyCooldownMs: cfg.continuousListeningReplyCooldownMs,
      continuousListeningFollowUpWindowMs: cfg.continuousListeningFollowUpWindowMs,
      continuousListeningCuriosityChance: cfg.continuousListeningCuriosityChance,
    } satisfies AppSettings
  })

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
    return action.status === 'success' ? action.result : { ok: false, error: action.error }
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
