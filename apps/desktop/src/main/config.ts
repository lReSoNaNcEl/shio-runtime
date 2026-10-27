import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'
import { z } from 'zod'

import type { DesktopAuthorityMode } from '../shared/actions'
import {
  type AppSettings,
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
import { resolveLlmProviderAccountId, toPublicLlmConfig } from './llm/config'
import { resolveLlmPersistence } from './llm/persistence'
import { mainLog } from './logging/safeLogger'
import { ValidatedElectronStore } from './persistence/ValidatedElectronStore'
import { migrateProjectAwarenessPlugin } from './plugins'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')
const appConfigDocumentSchema = z.record(z.string(), z.unknown())
const appConfigStore = new ValidatedElectronStore(CONFIG_PATH, appConfigDocumentSchema)
export const CURRENT_CONFIG_SCHEMA_VERSION = DESKTOP_CONFIG_SCHEMA_VERSION

export interface AppConfig {
  configSchemaVersion: number
  setup: SetupLifecycleConfig
  llm: LlmPersistedConfig
  uiLocale: UiLocale
  uiTheme: UiTheme
  desktopAuthorityMode: DesktopAuthorityMode
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
    ttsLanguage: process.env.TTS_LANGUAGE ?? 'ru',
    ttsEngine: 'fish-s2-pro',
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
let _configStorageHealth: ConfigStorageHealth = { state: 'ready' }

export type ConfigStorageHealth =
  | { state: 'ready' }
  | { state: 'degraded'; code: 'CONFIG_STORAGE_RUNTIME_FAILURE' }

export function getConfigStorageHealth(): ConfigStorageHealth {
  return _configStorageHealth
}

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

function persistConfig(config: AppConfig): void {
  if (_configStorageHealth.state === 'degraded') {
    throw new Error('CONFIG_STORAGE_RUNTIME_FAILURE')
  }
  appConfigStore.write(config as unknown as Record<string, unknown>)
}

function isMalformedConfigError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof z.ZodError
}

function backupMalformedConfig(): boolean {
  if (!existsSync(CONFIG_PATH)) return false
  const backupPath = `${CONFIG_PATH}.corrupt.${Date.now()}.json`
  try {
    appConfigStore.close()
    renameSync(CONFIG_PATH, backupPath)
    mainLog.warn('[Config] malformed configuration backed up before reset', {
      backupName: backupPath.slice(backupPath.lastIndexOf('\\') + 1),
    })
    return true
  } catch (error) {
    mainLog.error('[Config] malformed configuration backup failed; preserving original', {
      error: error instanceof Error ? error.name : 'UNKNOWN',
    })
    return false
  }
}

export async function loadConfig(llmCredentialStore: LlmCredentialStore): Promise<AppConfig> {
  _llmCredentialStore = llmCredentialStore
  await llmCredentialStore.load()
  _configStorageHealth = { state: 'ready' }
  try {
    const stored = appConfigStore.read()
    if (stored) {
      const rawSaved = stored as Record<string, unknown> &
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
        rawSaved.pythonSpeechUrl !== undefined ||
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
        persistConfig(_config)
      }
    }
  } catch (error) {
    _config = freshDefaults()
    if (isMalformedConfigError(error)) {
      if (backupMalformedConfig()) {
        try {
          persistConfig(_config)
        } catch (persistError) {
          mainLog.error(
            '[Config] defaults could not be persisted after malformed config recovery',
            {
              error: persistError instanceof Error ? persistError.name : 'UNKNOWN',
            },
          )
        }
      }
    } else {
      appConfigStore.close()
      _configStorageHealth = {
        state: 'degraded',
        code: 'CONFIG_STORAGE_RUNTIME_FAILURE',
      }
      mainLog.error('[Config] storage read failed; preserving existing configuration file', {
        error: error instanceof Error ? error.name : 'UNKNOWN',
      })
    }
  }
  return _config
}

export function getConfig(): AppConfig {
  return _config
}

export function getRendererConfig(): AppSettings {
  const llm = toPublicLlmConfig(
    _config.llm,
    (provider) =>
      _llmCredentialStore
        ? _llmCredentialStore.getStatus(provider)
        : {
            configured: false,
            source: 'none',
            secureStorageAvailable: false,
          },
    (provider, accountId) => resolveLlmProviderAccountId(provider, accountId),
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
  const nextConfig: AppConfig = {
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
  persistConfig(nextConfig)
  _config = nextConfig
}
