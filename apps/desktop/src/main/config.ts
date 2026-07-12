import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

import { DEFAULT_SPEECH_URL } from '../shared/config'
import type { LlmConfig } from '../shared/llmProviders'
import { defaultLlmConfig, isLlmProviderId, normalizeLlmConfig } from './llm'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

interface AppConfig {
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
  passiveCompanionEnabled: string
  lookAtEnabled: string
  continuousListeningEnabled: string
  continuousListeningMode: string
  continuousListeningReplyCooldownMs: string
  continuousListeningFollowUpWindowMs: string
  continuousListeningCuriosityChance: string
}

// String-valued keys only; `llm` is handled separately because it is an object.
type StringConfigKey = Exclude<keyof AppConfig, 'llm'>

const stringDefaults: Record<StringConfigKey, string> = {
  pythonSpeechUrl: process.env.PYTHON_SPEECH_URL ?? DEFAULT_SPEECH_URL,
  ttsVoice: process.env.TTS_VOICE ?? 'animevox_makima',
  ttsLanguage: process.env.TTS_LANGUAGE ?? 'ru',
  ttsEngine: process.env.TTS_ENGINE ?? 'f5',
  vrmPath: '',
  micDeviceId: '',
  overlayWidth: process.env.OVERLAY_WIDTH ?? '360',
  overlayHeight: process.env.OVERLAY_HEIGHT ?? '560',
  overlayMargin: process.env.OVERLAY_MARGIN ?? '24',
  overlayOpacity: process.env.OVERLAY_OPACITY ?? '1',
  overlayTransparentBackground: process.env.OVERLAY_TRANSPARENT_BACKGROUND ?? 'true',
  overlayClickThrough: process.env.OVERLAY_CLICK_THROUGH ?? 'true',
  overlayCorner: process.env.OVERLAY_CORNER ?? 'bottom-right',
  overlayScale: process.env.OVERLAY_SCALE ?? '1',
  overlayViewMode: 'front',
  overlayShowCurrentAnimation: 'false',
  passiveCompanionEnabled: process.env.PASSIVE_COMPANION_ENABLED ?? 'false',
  lookAtEnabled: 'true',
  continuousListeningEnabled: 'false',
  continuousListeningMode: 'silent',
  continuousListeningReplyCooldownMs: '15000',
  continuousListeningFollowUpWindowMs: '20000',
  continuousListeningCuriosityChance: '0.03',
}

function freshDefaults(): AppConfig {
  return { llm: defaultLlmConfig(), ...stringDefaults }
}

let _config: AppConfig = freshDefaults()

/**
 * Legacy shapes persisted before the nested-LLM refactor. Read-only, used
 * exclusively for one-time migration. Never written back to disk verbatim.
 */
interface LegacyPersistedConfig {
  // v1 (flat multi-provider)
  provider?: string
  apiKey?: string
  model?: string
  // v0 (Groq-only)
  groqApiKey?: string
  groqModel?: string
}

function pickKnownStrings(
  saved: Record<string, unknown>,
): Partial<Record<StringConfigKey, string>> {
  const result: Partial<Record<StringConfigKey, string>> = {}
  for (const key of Object.keys(stringDefaults) as StringConfigKey[]) {
    const value = saved[key]
    if (typeof value === 'string') result[key] = value
  }
  return result
}

/**
 * Build the LLM config from persisted data, migrating older shapes:
 * - v1: flat { provider, apiKey, model }
 * - v0: { groqApiKey, groqModel }
 * Returns { llm, migrated } where `migrated` signals we upgraded an old shape.
 */
function resolveLlmConfig(saved: Record<string, unknown> & LegacyPersistedConfig): {
  llm: LlmConfig
  migrated: boolean
} {
  if (saved.llm && typeof saved.llm === 'object') {
    return { llm: normalizeLlmConfig(saved.llm), migrated: false }
  }

  const llm = defaultLlmConfig()
  let migrated = false

  // v1 flat shape
  if (typeof saved.provider === 'string' && isLlmProviderId(saved.provider)) {
    llm.activeProvider = saved.provider
    migrated = true
  }
  if (typeof saved.apiKey === 'string' && saved.apiKey) {
    llm.providers[llm.activeProvider].apiKey = saved.apiKey
    migrated = true
  }
  if (typeof saved.model === 'string' && saved.model) {
    llm.providers[llm.activeProvider].model = saved.model
    migrated = true
  }

  // v0 Groq-only shape
  if (typeof saved.groqApiKey === 'string' && saved.groqApiKey && !llm.providers.groq.apiKey) {
    llm.providers.groq.apiKey = saved.groqApiKey
    migrated = true
  }
  if (typeof saved.groqModel === 'string' && saved.groqModel) {
    llm.providers.groq.model = saved.groqModel
    migrated = true
  }

  return { llm, migrated }
}

export function loadConfig(): AppConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown> &
        LegacyPersistedConfig
      const known = pickKnownStrings(saved)
      const { llm, migrated } = resolveLlmConfig(saved)
      _config = { ...freshDefaults(), ...known, llm }

      // One-time migration: pull the Groq key from env into userData config.
      let envMigrated = false
      if (!_config.llm.providers.groq.apiKey && process.env.GROQ_API_KEY) {
        _config.llm.providers.groq.apiKey = process.env.GROQ_API_KEY
        envMigrated = true
      }
      if (migrated || envMigrated) {
        writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf-8')
      }
    }
  } catch {
    _config = freshDefaults()
  }
  return _config
}

export function getConfig(): AppConfig {
  return _config
}

export function saveConfig(partial: Partial<AppConfig>): void {
  // `llm`, when present, is replaced wholesale (the renderer always sends the
  // complete object), so a shallow merge preserves every provider's creds.
  _config = { ..._config, ...partial }
  writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf-8')
}
