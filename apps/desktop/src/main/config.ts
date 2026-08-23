import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'

import type { DesktopAuthorityMode } from '../shared/actions'
import {
  type AppSettings,
  DEFAULT_SPEECH_URL,
  DESKTOP_CONFIG_SCHEMA_VERSION,
  migrateLegacyDesktopSettings,
  normalizeUiTheme,
  type SetupLifecycleConfig,
  type UiTheme,
} from '../shared/config'
import type { LlmPersistedConfig } from '../shared/llm'
import {
  DEFAULT_UI_LOCALE,
  isUiLocale,
  normalizeUiLocale,
  type UiLocale,
} from '../shared/localization'
import { vrmAssetRegistry } from './assets/VrmAssetRegistry'
import { developerModeDefaults, resolveDeveloperModeSettings } from './configDefaults'
import { defaultLlmConfig, type LlmCredentialStore, normalizeLlmConfig } from './llm'
import { toPublicLlmConfig } from './llm/config'
import { resolveLlmPersistence } from './llm/persistence'
import { mainLog } from './logging/safeLogger'
import { migrateProjectAwarenessPlugin } from './plugins'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')
export const CURRENT_CONFIG_SCHEMA_VERSION = DESKTOP_CONFIG_SCHEMA_VERSION

export interface AppConfig {
  configSchemaVersion: number
  setup: SetupLifecycleConfig
  llm: LlmPersistedConfig
  uiLocale: UiLocale
  uiTheme: UiTheme
  desktopAuthorityMode: DesktopAuthorityMode
  pythonSpeechUrl: string
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
  lookAtEnabled: string
  continuousListeningReplyCooldownMs: string
  continuousListeningFollowUpWindowMs: string
  continuousListeningCuriosityChance: string
}

// String-valued keys only; `llm` is handled separately because it is an object.
type StringConfigKey = Exclude<
  keyof AppConfig,
  'configSchemaVersion' | 'setup' | 'llm' | 'uiLocale' | 'uiTheme' | 'desktopAuthorityMode'
>

function stringDefaults(isPackaged = app.isPackaged): Record<StringConfigKey, string> {
  return {
    pythonSpeechUrl: process.env.PYTHON_SPEECH_URL ?? DEFAULT_SPEECH_URL,
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
    overlayViewMode: 'bust',
    ...developerModeDefaults(isPackaged),
    lookAtEnabled: 'true',
    continuousListeningReplyCooldownMs: '15000',
    continuousListeningFollowUpWindowMs: '20000',
    continuousListeningCuriosityChance: '0.03',
  }
}

export function freshDefaults(isPackaged = app.isPackaged): AppConfig {
  return {
    configSchemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    setup: { completed: false },
    llm: defaultLlmConfig(),
    uiLocale: DEFAULT_UI_LOCALE,
    uiTheme: 'light',
    desktopAuthorityMode: 'confirm',
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

function normalizeDesktopAuthorityMode(value: unknown): DesktopAuthorityMode {
  return value === 'full' ? 'full' : 'confirm'
}

function resolveSetupLifecycle(saved: Record<string, unknown>): SetupLifecycleConfig {
  if (!saved.setup || typeof saved.setup !== 'object') return { completed: false }
  const setup = saved.setup as Record<string, unknown>
  return {
    completed: setup.completed === true,
    ...(typeof setup.completedAt === 'string' ? { completedAt: setup.completedAt } : {}),
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
      const rawSaved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown> &
        import('./llm/persistence').LegacyPersistedLlmConfig
      const legacyProjectFound =
        typeof rawSaved.projectAwareness === 'object' && rawSaved.projectAwareness !== null
      let projectMigrationCompleted = true
      try {
        await migrateProjectAwarenessPlugin({
          userDataPath: app.getPath('userData'),
          legacyConfig: rawSaved.projectAwareness,
        })
      } catch (error) {
        projectMigrationCompleted = false
        mainLog.error('[PluginRuntime] Project Awareness persistence migration failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      const saved = migrateLegacyDesktopSettings(rawSaved) as Record<string, unknown> &
        import('./llm/persistence').LegacyPersistedLlmConfig
      const known = pickKnownStrings(saved)
      const { llm, plaintextCredentials, plaintextProviders, migrated } =
        resolveLlmPersistence(saved)
      const setup = resolveSetupLifecycle(saved)
      const developerMode = resolveDeveloperModeSettings(known, app.isPackaged)
      const configNeedsMigration =
        rawSaved.configSchemaVersion !== CURRENT_CONFIG_SCHEMA_VERSION ||
        rawSaved.continuousListeningMode !== undefined ||
        rawSaved.continuousListeningEnabled !== undefined ||
        rawSaved.passiveCompanionEnabled !== undefined ||
        rawSaved.ttsVoice !== undefined ||
        rawSaved.overlayViewMode === 'front' ||
        (rawSaved.uiTheme !== 'dark' && rawSaved.uiTheme !== 'light') ||
        rawSaved.setup === undefined ||
        legacyProjectFound
      _config = {
        ...freshDefaults(),
        ...known,
        ...developerMode,
        llm,
        setup,
        configSchemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
        uiLocale: normalizeUiLocale(saved.uiLocale),
        uiTheme: normalizeUiTheme(saved.uiTheme),
        desktopAuthorityMode: normalizeDesktopAuthorityMode(saved.desktopAuthorityMode),
        overlayViewMode: known.overlayViewMode ?? 'bust',
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
      if (
        projectMigrationCompleted &&
        ((migrated && llmMigrationCompleted) || configNeedsMigration)
      ) {
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
  const llm = toPublicLlmConfig(_config.llm, (provider) =>
    _llmCredentialStore
      ? _llmCredentialStore.getStatus(provider)
      : {
          configured: false,
          source: 'none',
          secureStorageAvailable: false,
        },
  )
  const { vrmPath, ...publicConfig } = _config
  const vrmAsset = vrmAssetRegistry.describeConfiguredAsset(vrmPath)
  return {
    ...publicConfig,
    llm,
    vrmAssetHandle: vrmAsset.assetHandle,
    vrmAssetName: vrmAsset.displayName,
  }
}

export function getOverlayPresentationConfig(): Pick<
  AppSettings,
  | 'uiLocale'
  | 'uiTheme'
  | 'vrmAssetHandle'
  | 'overlayTransparentBackground'
  | 'overlayScale'
  | 'overlayViewMode'
  | 'developerModeEnabled'
  | 'developerOverlayAnimationHudEnabled'
> {
  const config = getRendererConfig()
  return {
    uiLocale: config.uiLocale,
    uiTheme: config.uiTheme,
    vrmAssetHandle: config.vrmAssetHandle,
    overlayTransparentBackground: config.overlayTransparentBackground,
    overlayScale: config.overlayScale,
    overlayViewMode: config.overlayViewMode,
    developerModeEnabled: config.developerModeEnabled,
    developerOverlayAnimationHudEnabled: config.developerOverlayAnimationHudEnabled,
  }
}

export function saveConfig(
  partial: Partial<Omit<AppConfig, 'llm' | 'setup'>> & {
    llm?: unknown
    setup?: SetupLifecycleConfig
  },
): void {
  const input = partial as Record<string, unknown>
  const knownStrings = pickKnownStrings(input)
  const normalizedLlm = partial.llm === undefined ? _config.llm : normalizeLlmConfig(partial.llm)
  _config = {
    ..._config,
    ...knownStrings,
    configSchemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    setup: partial.setup ? resolveSetupLifecycle({ setup: partial.setup }) : _config.setup,
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
    desktopAuthorityMode:
      partial.desktopAuthorityMode === undefined
        ? _config.desktopAuthorityMode
        : normalizeDesktopAuthorityMode(partial.desktopAuthorityMode),
    uiLocale:
      partial.uiLocale === undefined
        ? _config.uiLocale
        : isUiLocale(partial.uiLocale)
          ? partial.uiLocale
          : _config.uiLocale,
    uiTheme: partial.uiTheme === undefined ? _config.uiTheme : normalizeUiTheme(partial.uiTheme),
  }
  writeFileSync(CONFIG_PATH, serializedConfig(_config), 'utf-8')
}
