import { ipcMain, dialog, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getConfig, saveConfig } from './config'
import type { Orchestrator } from './orchestrator'
import type { SpeechClient } from './speech/speechClient'
import { ActionRuntime } from './action/ActionRuntime'
import type { RuntimeEventInput } from '../shared/runtime/events'
import { createModelCatalog, isLlmProviderId, ModelFetchError, PROVIDER_PROFILES } from './llm'
import { createLLMProvider } from './llm'
import type { LlmConfig, ModelInfo, ProviderProfile } from './llm'
import { z } from 'zod'

export interface AppSettings {
  llm: LlmConfig
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
  speech: () => SpeechClient,
  win: BrowserWindow
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
    execute: async () => speech().health()
  })
  actions.register<ArrayBuffer, { text: string }>({
    name: 'speech.recognize',
    description: 'Recognize WAV audio through the local speech service.',
    execute: async (wavBuffer) => {
      const result = await speech().recognize(wavBuffer)
      return { text: result.text }
    }
  })
  actions.register<{ turnId: string; userText: string }, Awaited<ReturnType<Orchestrator['createReply']>>>({
    name: 'speech.createReply',
    description: 'Create a character reply through the current LLM orchestration.',
    execute: async ({ turnId, userText }) => {
      if (activeCharacterGenerationTurnId) {
        throw new Error(`Character generation overlap: activeTurnId=${activeCharacterGenerationTurnId} requestedTurnId=${turnId}`)
      }
      activeCharacterGenerationTurnId = turnId
      try {
        const result = await orchestrator().createReply(userText)
        if (cancelledTurns.has(turnId)) throw new Error(`Conversation interrupted turnId=${turnId}`)
        return result
      }
      finally { if (activeCharacterGenerationTurnId === turnId) activeCharacterGenerationTurnId = null }
    }
  })
  actions.register<{ turnId: string; replyText: string; emotionKey: string }, Awaited<ReturnType<Orchestrator['synthesizeReply']>>>({
    name: 'speech.synthesizeReply',
    description: 'Synthesize speech audio for an assistant reply.',
    execute: async ({ turnId, replyText, emotionKey }) => {
      if (activeSynthesisTurnId) {
        throw new Error(`TTS synthesis overlap: activeTurnId=${activeSynthesisTurnId} requestedTurnId=${turnId}`)
      }
      activeSynthesisTurnId = turnId
      try {
        const result = await orchestrator().synthesizeReply(replyText, emotionKey)
        if (cancelledTurns.has(turnId)) throw new Error(`Conversation interrupted turnId=${turnId}`)
        return result
      }
      finally { if (activeSynthesisTurnId === turnId) activeSynthesisTurnId = null }
    }
  })
  actions.register({
    name: 'memory.clear',
    description: 'Clear current conversation memory.',
    execute: async () => {
      await orchestrator().clearHistory()
      return { ok: true }
    }
  })
  actions.register<Partial<AppSettings>, { ok: boolean }>({
    name: 'config.save',
    description: 'Persist application configuration.',
    execute: (partial) => {
      saveConfig(partial)
      win.webContents.send('config:updated', getConfig())
      return { ok: true }
    }
  })
  actions.register<{ provider: string; apiKey: string }, { ok: boolean; models?: ModelInfo[]; error?: string; kind?: string }>({
    name: 'llm.fetchModels',
    description: 'Load the available model catalog for an LLM provider.',
    execute: async ({ provider, apiKey }) => {
      if (!isLlmProviderId(provider)) {
        return { ok: false, error: `Unknown provider: ${provider}`, kind: 'invalid_response' }
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
    }
  })
  actions.register({
    name: 'vrm.pick',
    description: 'Open a native file dialog for selecting a VRM model.',
    execute: async () => {
      const result = await dialog.showOpenDialog(win, {
        title: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 VRM-\u043c\u043e\u0434\u0435\u043b\u044c',
        filters: [{ name: 'VRM Model', extensions: ['vrm'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false }
      const vrmPath = result.filePaths[0]
      saveConfig({ vrmPath })
      return { ok: true, vrmPath }
    }
  })
  actions.register<string, { ok: boolean; buffer?: ArrayBuffer; error?: string }>({
    name: 'vrm.read',
    description: 'Read a VRM model file from disk.',
    execute: (filePath) => {
      const buf = readFileSync(filePath)
      return { ok: true, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
    }
  })
  actions.register({
    name: 'vrma.pick',
    description: 'Open a native file dialog for selecting and reading a VRM animation.',
    execute: async () => {
      const result = await dialog.showOpenDialog(win, {
        title: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 VRM-\u0430\u043d\u0438\u043c\u0430\u0446\u0438\u044e',
        filters: [{ name: 'VRM Animation', extensions: ['vrma'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false }
      const animPath = result.filePaths[0]
      const buf = readFileSync(animPath)
      return {
        ok: true,
        animPath,
        buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      }
    }
  })

  ipcMain.handle('health:check', async () => {
    const action = await actions.execute<void, unknown>({ name: 'speech.health', payload: undefined })
    return action.status === 'success' ? { ok: true, data: action.result } : { ok: false, error: action.error }
  })

  ipcMain.handle('asr:recognize', async (_event, wavBuffer: ArrayBuffer) => {
    const action = await actions.execute<ArrayBuffer, { text: string }>({ name: 'speech.recognize', payload: wavBuffer })
    return action.status === 'success' ? { ok: true, text: action.result?.text } : { ok: false, error: action.error }
  })

  ipcMain.handle('llm:reply', async (_event, turnId: string, userText: string) => {
    cancelledTurns.delete(turnId)
    const action = await actions.execute<{ turnId: string; userText: string }, Awaited<ReturnType<Orchestrator['createReply']>>>({
      name: 'speech.createReply',
      payload: { turnId, userText }
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

  const backlogResultSchema = z.object({
    action: z.enum(['select', 'merge', 'discard_all']),
    selectedIds: z.array(z.string()).max(10),
    text: z.string().max(600).optional(),
    reason: z.string().max(200),
    confidence: z.number().min(0).max(1),
    backlogVersion: z.number().int().nonnegative()
  }).superRefine((value, context) => {
    if (value.action !== 'discard_all' && (!value.text?.trim() || value.selectedIds.length === 0)) {
      context.addIssue({ code: 'custom', message: 'Selection requires text and selectedIds' })
    }
  })

  ipcMain.handle('llm:arbitrate-backlog', async (_event, payload: {
    items?: Array<{ id: string; text: string; priorityClass: string; attentionScore: number; createdAt: number }>
    backlogVersion?: number
    providerId?: string
    model?: string
  }) => {
    if (!payload || !Array.isArray(payload.items) || !isLlmProviderId(payload.providerId ?? '') ||
      typeof payload.model !== 'string' || !payload.model || !Number.isInteger(payload.backlogVersion)) {
      return { ok: false, error: 'Invalid backlog arbitration request' }
    }
    const config = getConfig()
    if (config.continuousListeningEnabled !== 'true') return { ok: false, error: 'Streaming Mode is disabled' }
    const role = config.llm.roles.backlogSelector
    if (!role.enabled || role.providerId !== payload.providerId || role.model !== payload.model) {
      return { ok: false, error: 'Backlog Selector role is disabled or stale' }
    }
    if (!role.providerId) return { ok: false, error: 'Backlog Selector provider is not configured' }
    const providerId = role.providerId
    const credentials = config.llm.providers[providerId]
    if (!credentials?.apiKey) return { ok: false, error: 'Backlog Selector API key is not configured' }
    if (backlogArbitrationInFlight) return { ok: false, error: 'Backlog arbitration is already active' }
    const prompt = [
      'You are a conversation backlog arbitration classifier.',
      'You inspect completed user utterances captured through continuous microphone listening while the assistant was busy.',
      'Do not answer the user, roleplay, or invent wording. Select, merge, or discard only.',
      'Prefer direct corrections, direct questions, direct follow-ups, then recent relevant continuation.',
      'Reject self-echo, duplicates, stale utterances, filler, and unrelated background speech.',
      'Return valid JSON only with action, selectedIds, optional text, reason, confidence, backlogVersion.',
      'Select at most one next user turn. When merging, preserve the user wording and meaning.'
    ].join(' ')
    try {
      backlogArbitrationInFlight = true
      const provider = createLLMProvider({ provider: providerId, apiKey: credentials.apiKey, model: role.model })
      const raw = await provider.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify({ backlogVersion: payload.backlogVersion, items: payload.items }) }
      ])
      const json = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as unknown
      return { ok: true, result: backlogResultSchema.parse(json) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      backlogArbitrationInFlight = false
    }
  })

  ipcMain.handle('tts:synthesize-reply', async (_event, turnId: string, replyText: string, emotionKey: string) => {
    const action = await actions.execute<
      { turnId: string; replyText: string; emotionKey: string },
      Awaited<ReturnType<Orchestrator['synthesizeReply']>>
    >({ name: 'speech.synthesizeReply', payload: { turnId, replyText, emotionKey } })
    return action.status === 'success' ? { ok: true, ...action.result } : { ok: false, error: action.error }
  })
  ipcMain.handle('tts:cancel-synthesis', (_event, turnId: string) => {
    cancelledTurns.add(turnId)
    if (activeSynthesisTurnId === turnId) activeSynthesisTurnId = null
    return { ok: true }
  })

  ipcMain.handle('memory:clear', async () => {
    const action = await actions.execute<void, { ok: boolean }>({ name: 'memory.clear', payload: undefined })
    return action.status === 'success' ? { ok: true } : { ok: false, error: action.error }
  })

  ipcMain.handle('llm:providers', (): ProviderProfile[] => [...PROVIDER_PROFILES])

  ipcMain.handle('llm:fetch-models', async (_event, provider: string, apiKey: string) => {
    const action = await actions.execute<{ provider: string; apiKey: string }, { ok: boolean; models?: ModelInfo[]; error?: string; kind?: string }>(
      { name: 'llm.fetchModels', payload: { provider, apiKey } }
    )
    return action.status === 'success' ? action.result : { ok: false, error: action.error }
  })

  ipcMain.handle('config:get', () => {
    const cfg = getConfig()
    return {
      llm: cfg.llm,
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
      passiveCompanionEnabled: cfg.passiveCompanionEnabled,
      lookAtEnabled: cfg.lookAtEnabled,
      continuousListeningEnabled: cfg.continuousListeningEnabled,
      continuousListeningMode: cfg.continuousListeningMode,
      continuousListeningReplyCooldownMs: cfg.continuousListeningReplyCooldownMs,
      continuousListeningFollowUpWindowMs: cfg.continuousListeningFollowUpWindowMs,
      continuousListeningCuriosityChance: cfg.continuousListeningCuriosityChance
    } satisfies AppSettings
  })

  ipcMain.handle('config:save', (_event, partial: Partial<AppSettings>) => {
    return actions.execute<Partial<AppSettings>, { ok: boolean }>({ name: 'config.save', payload: partial }).then((action) =>
      action.status === 'success' ? action.result : { ok: false, error: action.error }
    )
  })

  ipcMain.handle('vrm:pick', async () => {
    const action = await actions.execute<void, { ok: boolean; vrmPath?: string }>({ name: 'vrm.pick', payload: undefined })
    return action.status === 'success' ? action.result : { ok: false, error: action.error }
  })

  ipcMain.handle('vrm:read', (_event, filePath: string) => {
    return actions.execute<string, { ok: boolean; buffer?: ArrayBuffer; error?: string }>({ name: 'vrm.read', payload: filePath }).then((action) =>
      action.status === 'success' ? action.result : { ok: false, error: action.error }
    )
  })

  ipcMain.handle('vrma:pick', async () => {
    const action = await actions.execute<void, { ok: boolean; animPath?: string; buffer?: ArrayBuffer }>({
      name: 'vrma.pick',
      payload: undefined
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
