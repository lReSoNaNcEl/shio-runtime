import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'
import { z } from 'zod'

import type { DesktopAuthorityMode } from '../shared/actions'
import {
  type AppSettings,
  DEFAULT_OVERLAY_HEIGHT,
  DEFAULT_OVERLAY_WIDTH,
  DEFAULT_SPEECH_VOLUME_PERCENT,
  DESKTOP_CONFIG_SCHEMA_VERSION,
  migrateLegacyDesktopSettings,
  normalizeUiTheme,
  type SetupLifecycleConfig,
} from '../shared/config'
import type { LlmPersistedConfig } from '../shared/llm'
import {
  DEFAULT_UI_LOCALE,
  isUiLocale,
  normalizeUiLocale,
  type UiLocale,
} from '../shared/localization'
import { vrmAssetRegistry } from './assets/VrmAssetRegistry'
import {
  developerModeDefaults,
  resolveDeveloperModeSettings,
  speechVolumePercentSchema,
} from './configDefaults'
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

export interface AppConfig
  extends Omit<
    AppSettings,
    'llm' | 'vrmAssetHandle' | 'vrmAssetName' | 'speechFallbackLanguage' | 'avatarRenderingDisabled'
  > {
  llm: LlmPersistedConfig
  vrmPath: string
  legacySpeechLanguage?: UiLocale
}

// String-valued keys only; `llm` is handled separately because it is an object.
type StringConfigKey = Exclude<
  keyof AppConfig,
  | 'configSchemaVersion'
  | 'setup'
  | 'llm'
  | 'uiLocale'
  | 'uiTheme'
  | 'flashMotionEnabled'
  | 'desktopAuthorityMode'
  | 'speechVolumePercent'
  | 'legacySpeechLanguage'
>

function stringDefaults(isPackaged = app.isPackaged): Record<StringConfigKey, string> {
  return {
    ttsEngine: 'fish-s2-pro',
    vrmPath: '',
    micDeviceId: '',
    overlayWidth: process.env.OVERLAY_WIDTH ?? String(DEFAULT_OVERLAY_WIDTH),
    overlayHeight: process.env.OVERLAY_HEIGHT ?? String(DEFAULT_OVERLAY_HEIGHT),
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
    flashMotionEnabled: true,
    desktopAuthorityMode: 'confirm',
    speechVolumePercent: DEFAULT_SPEECH_VOLUME_PERCENT,
    ...stringDefaults(isPackaged),
  }
}

let _config: AppConfig = freshDefaults()
let _llmCredentialStore: LlmCredentialStore | null = null
let _configStorageHealth: ConfigStorageHealth = { state: 'ready' }

export type ConfigStorageHealth =
  | { state: 'ready' }
  | {
      state: 'degraded'
      code: 'CONFIG_STORAGE_RUNTIME_FAILURE' | 'CONFIG_LLM_CREDENTIAL_MIGRATION_PENDING'
    }

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
    throw new Error(_configStorageHealth.code)
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
        rawSaved.ttsLanguage !== undefined ||
        rawSaved.pythonSpeechUrl !== undefined ||
        rawSaved.overlayViewMode === 'front' ||
        (rawSaved.uiTheme !== 'dark' && rawSaved.uiTheme !== 'light') ||
        rawSaved.setup === undefined ||
        (!migrated && JSON.stringify(saved.llm) !== JSON.stringify(llm)) ||
        legacyProjectFound
      _config = {
        ...freshDefaults(),
        ...known,
        ...developerMode,
        llm,
        setup,
        configSchemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
        uiLocale: normalizeUiLocale(saved.uiLocale),
        ...(isUiLocale(saved.legacySpeechLanguage) && {
          legacySpeechLanguage: saved.legacySpeechLanguage,
        }),
        uiTheme: normalizeUiTheme(saved.uiTheme),
        flashMotionEnabled: saved.flashMotionEnabled !== false,
        speechVolumePercent: speechVolumePercentSchema
          .catch(DEFAULT_SPEECH_VOLUME_PERCENT)
          .parse(saved.speechVolumePercent),
        desktopAuthorityMode: normalizeDesktopAuthorityMode(saved.desktopAuthorityMode),
        overlayViewMode: known.overlayViewMode ?? 'bust',
      }

      if (migrated) {
        try {
          await llmCredentialStore.importMissing(plaintextCredentials)
        } catch {
          // A later settings save must also leave the legacy file available for retry.
          _configStorageHealth = {
            state: 'degraded',
            code: 'CONFIG_LLM_CREDENTIAL_MIGRATION_PENDING',
          }
          llmCredentialStore.recordMigrationError(
            plaintextProviders,
            'Plaintext LLM credential migration failed',
          )
        }
      }
      if (
        _configStorageHealth.state === 'ready' &&
        projectMigrationCompleted &&
        (migrated || configNeedsMigration)
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
  const { vrmPath, legacySpeechLanguage, ...publicConfig } = _config
  const vrmAsset = vrmAssetRegistry.describeConfiguredAsset(vrmPath)
  return {
    ...publicConfig,
    ...(process.env.SHIO_SILENT_QA === '1' ? { avatarRenderingDisabled: true as const } : {}),
    speechFallbackLanguage: legacySpeechLanguage ?? publicConfig.uiLocale,
    llm,
    vrmAssetHandle: vrmAsset.assetHandle,
    vrmAssetName: vrmAsset.displayName,
  }
}

export function getOverlayPresentationConfig(): Pick<
  AppSettings,
  | 'avatarRenderingDisabled'
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
    ...(config.avatarRenderingDisabled ? { avatarRenderingDisabled: true as const } : {}),
    vrmAssetHandle: config.vrmAssetHandle,
    overlayTransparentBackground: config.overlayTransparentBackground,
    overlayScale: config.overlayScale,
    overlayViewMode: config.overlayViewMode,
    developerModeEnabled: config.developerModeEnabled,
    developerOverlayAnimationHudEnabled: config.developerOverlayAnimationHudEnabled,
  }
}

export function saveConfig(
  partial: Partial<Omit<AppConfig, 'llm' | 'setup' | 'legacySpeechLanguage'>> & {
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
    flashMotionEnabled: partial.flashMotionEnabled ?? _config.flashMotionEnabled,
    speechVolumePercent: partial.speechVolumePercent ?? _config.speechVolumePercent,
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
