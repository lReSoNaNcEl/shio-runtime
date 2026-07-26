import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

import { type AppSettings, DEFAULT_SPEECH_URL } from '../shared/config'
import type { LlmPersistedConfig } from '../shared/llm'
import {
  DEFAULT_UI_LOCALE,
  isUiLocale,
  normalizeUiLocale,
  type UiLocale,
} from '../shared/localization'
import type { ProjectAwarenessPublicConfig } from '../shared/project-awareness'
import { developerModeDefaults, resolveDeveloperModeSettings } from './configDefaults'
import { defaultLlmConfig, type LlmCredentialStore, normalizeLlmConfig } from './llm'
import { toPublicLlmConfig } from './llm/config'
import { resolveLlmPersistence } from './llm/persistence'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

export interface ProjectAwarenessConfig extends ProjectAwarenessPublicConfig {
  maxFileSizeBytes: number
}

export interface AppConfig {
  llm: LlmPersistedConfig
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

function stringDefaults(isPackaged = app.isPackaged): Record<StringConfigKey, string> {
  return {
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
    ...developerModeDefaults(isPackaged),
    passiveCompanionEnabled: process.env.PASSIVE_COMPANION_ENABLED ?? 'false',
    lookAtEnabled: 'true',
    continuousListeningEnabled: 'false',
    continuousListeningMode: 'silent',
    continuousListeningReplyCooldownMs: '15000',
    continuousListeningFollowUpWindowMs: '20000',
    continuousListeningCuriosityChance: '0.03',
  }
}

export function freshDefaults(isPackaged = app.isPackaged): AppConfig {
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
    ...stringDefaults(isPackaged),
  }
}

let _config: AppConfig = freshDefaults()
let _llmCredentialStore: LlmCredentialStore | null = null

function pickKnownStrings(
  saved: Record<string, unknown>,
): Partial<Record<StringConfigKey, string>> {
  const result: Partial<Record<StringConfigKey, string>> = {}
  for (const key of Object.keys(stringDefaults()) as StringConfigKey[]) {
    const value = saved[key]
    if (typeof value === 'string') result[key] = value
  }
  return result
}

function normalizeDeveloperMode(value: unknown): string {
  return value === 'true' ? 'true' : 'false'
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

export async function loadConfig(llmCredentialStore: LlmCredentialStore): Promise<AppConfig> {
  _llmCredentialStore = llmCredentialStore
  await llmCredentialStore.load()
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown> &
        import('./llm/persistence').LegacyPersistedLlmConfig
      const known = pickKnownStrings(saved)
      const { llm, plaintextCredentials, plaintextProviders, migrated } =
        resolveLlmPersistence(saved)
      const projectAwareness = resolveProjectAwarenessConfig(saved)
      const developerMode = resolveDeveloperModeSettings(known, app.isPackaged)
      const hasLegacyProjectToken =
        typeof saved.projectAwareness === 'object' &&
        saved.projectAwareness !== null &&
        typeof (saved.projectAwareness as Record<string, unknown>).token === 'string'
      _config = {
        ...freshDefaults(),
        ...known,
        ...developerMode,
        llm,
        projectAwareness,
        uiLocale: normalizeUiLocale(saved.uiLocale),
      }

      let llmMigrationCompleted = !migrated
      if (migrated) {
        try {
          await llmCredentialStore.importMissing(plaintextCredentials)
          llmMigrationCompleted = true
        } catch {
          llmCredentialStore.recordMigrationError(
            plaintextProviders,
            'Plaintext LLM credential migration failed',
          )
        }
      }
      if ((migrated && llmMigrationCompleted) || (!migrated && hasLegacyProjectToken)) {
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

export function getRendererConfig(): AppSettings {
  const { maxFileSizeBytes: _maxFileSizeBytes, ...projectAwareness } = _config.projectAwareness
  const llm = toPublicLlmConfig(_config.llm, (provider) =>
    _llmCredentialStore
      ? _llmCredentialStore.getStatus(provider)
      : {
          configured: false,
          source: 'none',
          secureStorageAvailable: false,
        },
  )
  return { ..._config, llm, projectAwareness }
}

export function saveConfig(
  partial: Partial<Omit<AppConfig, 'projectAwareness' | 'llm'>> & {
    llm?: unknown
    projectAwareness?: Partial<ProjectAwarenessPublicConfig>
  },
): void {
  const input = partial as Record<string, unknown>
  const knownStrings = pickKnownStrings(input)
  const normalizedLlm = partial.llm === undefined ? _config.llm : normalizeLlmConfig(partial.llm)
  _config = {
    ..._config,
    ...knownStrings,
    llm: normalizedLlm,
    developerModeEnabled:
      knownStrings.developerModeEnabled === undefined
        ? _config.developerModeEnabled
        : normalizeDeveloperMode(knownStrings.developerModeEnabled),
    developerOverlayAnimationHudEnabled:
      knownStrings.developerOverlayAnimationHudEnabled === undefined
        ? _config.developerOverlayAnimationHudEnabled
        : knownStrings.developerOverlayAnimationHudEnabled === 'false'
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
