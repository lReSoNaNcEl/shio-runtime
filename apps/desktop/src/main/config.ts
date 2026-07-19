import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

import { DEFAULT_SPEECH_URL } from '../shared/config'
import type { LlmConfig } from '../shared/llm'
import {
  DEFAULT_UI_LOCALE,
  isUiLocale,
  normalizeUiLocale,
  type UiLocale,
} from '../shared/localization'
import type { ProjectAwarenessPublicConfig } from '../shared/project-awareness'
import { defaultLlmConfig, isLlmProviderId, normalizeLlmConfig } from './llm'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

export interface ProjectAwarenessConfig extends ProjectAwarenessPublicConfig {
  maxFileSizeBytes: number
}

export interface AppConfig {
  llm: LlmConfig
  projectAwareness: ProjectAwarenessConfig
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
  developerOverlayAnimationHudEnabled: string
  developerModeEnabled: string
  passiveCompanionEnabled: string
  lookAtEnabled: string
  continuousListeningEnabled: string
  continuousListeningMode: string
  continuousListeningReplyCooldownMs: string
  continuousListeningFollowUpWindowMs: string
  continuousListeningCuriosityChance: string
}

// String-valued keys only; `llm` is handled separately because it is an object.
type StringConfigKey = Exclude<keyof AppConfig, 'llm' | 'projectAwareness' | 'uiLocale'>

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
  developerOverlayAnimationHudEnabled: 'true',
  developerModeEnabled: 'false',
  passiveCompanionEnabled: process.env.PASSIVE_COMPANION_ENABLED ?? 'false',
  lookAtEnabled: 'true',
  continuousListeningEnabled: 'false',
  continuousListeningMode: 'silent',
  continuousListeningReplyCooldownMs: '15000',
  continuousListeningFollowUpWindowMs: '20000',
  continuousListeningCuriosityChance: '0.03',
}

function freshDefaults(): AppConfig {
  return {
    llm: defaultLlmConfig(),
    projectAwareness: {
      enabled: true,
      provider: 'github',
      repository: '',
      branch: 'main',
      maxFileSizeBytes: 256 * 1024,
    },
    uiLocale: DEFAULT_UI_LOCALE,
    ...stringDefaults,
  }
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

function normalizeDeveloperMode(value: unknown): string {
  return value === 'true' ? 'true' : 'false'
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

function resolveProjectAwarenessConfig(saved: Record<string, unknown>): ProjectAwarenessConfig {
  const defaults = freshDefaults().projectAwareness
  if (!saved.projectAwareness || typeof saved.projectAwareness !== 'object') return defaults
  const project = saved.projectAwareness as Record<string, unknown>
  return {
    enabled: typeof project.enabled === 'boolean' ? project.enabled : defaults.enabled,
    provider: 'github',
    repository:
      typeof project.repository === 'string' && project.repository
        ? project.repository
        : defaults.repository,
    branch: typeof project.branch === 'string' && project.branch ? project.branch : defaults.branch,
    maxFileSizeBytes:
      typeof project.maxFileSizeBytes === 'number' &&
      Number.isFinite(project.maxFileSizeBytes) &&
      project.maxFileSizeBytes >= 16 * 1024
        ? Math.min(project.maxFileSizeBytes, 2 * 1024 * 1024)
        : defaults.maxFileSizeBytes,
  }
}

function serializedConfig(config: AppConfig): string {
  return JSON.stringify(config, null, 2)
}

export function loadConfig(): AppConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown> &
        LegacyPersistedConfig
      const known = pickKnownStrings(saved)
      const { llm, migrated } = resolveLlmConfig(saved)
      const projectAwareness = resolveProjectAwarenessConfig(saved)
      const hasLegacyProjectToken =
        typeof saved.projectAwareness === 'object' &&
        saved.projectAwareness !== null &&
        typeof (saved.projectAwareness as Record<string, unknown>).token === 'string'
      _config = {
        ...freshDefaults(),
        ...known,
        developerModeEnabled: normalizeDeveloperMode(known.developerModeEnabled),
        developerOverlayAnimationHudEnabled:
          known.developerOverlayAnimationHudEnabled === 'false' ? 'false' : 'true',
        llm,
        projectAwareness,
        uiLocale: normalizeUiLocale(saved.uiLocale),
      }

      // One-time migration: pull the Groq key from env into userData config.
      let envMigrated = false
      if (!_config.llm.providers.groq.apiKey && process.env.GROQ_API_KEY) {
        _config.llm.providers.groq.apiKey = process.env.GROQ_API_KEY
        envMigrated = true
      }
      if (migrated || envMigrated || hasLegacyProjectToken) {
        writeFileSync(CONFIG_PATH, serializedConfig(_config), 'utf-8')
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

export function getRendererConfig(): Omit<AppConfig, 'projectAwareness'> & {
  projectAwareness: ProjectAwarenessPublicConfig
} {
  const { maxFileSizeBytes: _maxFileSizeBytes, ...projectAwareness } = _config.projectAwareness
  return { ..._config, projectAwareness }
}

export function saveConfig(
  partial: Partial<Omit<AppConfig, 'projectAwareness'>> & {
    projectAwareness?: Partial<ProjectAwarenessPublicConfig>
  },
): void {
  // `llm`, when present, is replaced wholesale (the renderer always sends the
  // complete object), so a shallow merge preserves every provider's creds.
  _config = {
    ..._config,
    ...partial,
    developerModeEnabled:
      partial.developerModeEnabled === undefined
        ? _config.developerModeEnabled
        : normalizeDeveloperMode(partial.developerModeEnabled),
    developerOverlayAnimationHudEnabled:
      partial.developerOverlayAnimationHudEnabled === undefined
        ? _config.developerOverlayAnimationHudEnabled
        : partial.developerOverlayAnimationHudEnabled === 'false'
          ? 'false'
          : 'true',
    uiLocale:
      partial.uiLocale === undefined
        ? _config.uiLocale
        : isUiLocale(partial.uiLocale)
          ? partial.uiLocale
          : _config.uiLocale,
    projectAwareness: partial.projectAwareness
      ? { ..._config.projectAwareness, ...partial.projectAwareness }
      : _config.projectAwareness,
  }
  writeFileSync(CONFIG_PATH, serializedConfig(_config), 'utf-8')
}
