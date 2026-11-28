import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { configSaveSchema } from '../../../src/main/ipc/payloadSchemas'

const electronState = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataPath,
    isPackaged: false,
  },
}))

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.resetModules()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function temporaryUserData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'shio-app-config-'))
  temporaryDirectories.push(directory)
  electronState.userDataPath = directory
  return directory
}

function credentialStore() {
  return {
    load: vi.fn(async () => undefined),
    importMissing: vi.fn(async () => undefined),
    recordMigrationError: vi.fn(),
    getStatus: vi.fn(() => ({
      configured: false,
      source: 'none',
      secureStorageAvailable: true,
    })),
  }
}

describe('App config electron-store migration', () => {
  it('persists FlashMotion enabled and disabled, including profiles made before the setting', async () => {
    const directory = temporaryUserData()
    const path = join(directory, 'config.json')
    writeFileSync(path, JSON.stringify({ uiLocale: 'ru' }))
    const config = await import('../../../src/main/config')
    await config.loadConfig(credentialStore() as never)
    expect(config.getRendererConfig().flashMotionEnabled).toBe(true)
    config.saveConfig({ flashMotionEnabled: false })
    await config.loadConfig(credentialStore() as never)
    expect(config.getRendererConfig().flashMotionEnabled).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      flashMotionEnabled: false,
      uiLocale: 'ru',
    })
    config.saveConfig({ flashMotionEnabled: true })
    await config.loadConfig(credentialStore() as never)
    expect(config.getRendererConfig().flashMotionEnabled).toBe(true)
    expect(configSaveSchema.safeParse({ flashMotionEnabled: 'false' }).success).toBe(false)
  })
  it.each(['en', 'ru', 'invalid', undefined])(
    'resolves the speech fallback after restart for %s',
    async (saved) => {
      const directory = temporaryUserData()
      const path = join(directory, 'config.json')
      if (saved !== undefined)
        writeFileSync(
          path,
          JSON.stringify({ configSchemaVersion: 9, uiLocale: 'ru', ttsLanguage: saved }),
        )
      const config = await import('../../../src/main/config')
      await config.loadConfig(credentialStore() as never)
      expect(config.getRendererConfig().speechFallbackLanguage).toBe(saved === 'en' ? 'en' : 'ru')
      config.saveConfig({ uiLocale: 'en' })

      vi.resetModules()
      const restarted = await import('../../../src/main/config')
      await restarted.loadConfig(credentialStore() as never)
      expect(restarted.getRendererConfig().speechFallbackLanguage).toBe(
        saved === 'ru' ? 'ru' : 'en',
      )
      const persisted = JSON.parse(readFileSync(path, 'utf8'))
      expect(persisted).not.toHaveProperty('ttsLanguage')
      expect(persisted).not.toHaveProperty('speechFallbackLanguage')
      expect(persisted.legacySpeechLanguage).toBe(
        saved === 'ru' || saved === 'en' ? saved : undefined,
      )
      for (const key of ['ttsLanguage', 'legacySpeechLanguage', 'speechFallbackLanguage']) {
        expect(configSaveSchema.safeParse({ [key]: 'ru' }).success).toBe(false)
      }
    },
  )

  it.each([undefined, -1, 110, '0'])(
    'defaults invalid or missing speech volume (%s) and restores mute on restart',
    async (value) => {
      const directory = temporaryUserData()
      writeFileSync(join(directory, 'config.json'), JSON.stringify({ speechVolumePercent: value }))
      const first = await import('../../../src/main/config')
      expect((await first.loadConfig(credentialStore() as never)).speechVolumePercent).toBe(100)
      first.saveConfig({ speechVolumePercent: 0 })
      first.saveConfig({ uiTheme: 'dark' })
      vi.resetModules()
      const restarted = await import('../../../src/main/config')
      expect((await restarted.loadConfig(credentialStore() as never)).speechVolumePercent).toBe(0)
    },
  )

  it('migrates a Mistral profile and preserves supported providers and role parameters', async () => {
    const directory = temporaryUserData()
    const configPath = join(directory, 'config.json')
    const config = await import('../../../src/main/config')
    const defaults = config.freshDefaults()
    writeFileSync(
      configPath,
      JSON.stringify({
        ...defaults,
        llm: {
          ...defaults.llm,
          activeProvider: 'mistral',
          providers: {
            ...defaults.llm.providers,
            groq: { model: 'saved-model', accountId: '' },
            mistral: { model: 'retired-model', apiKey: 'retired-key' },
            'retired-provider': { model: 'retired-model', contextLimit: 8192 },
          },
          roles: {
            computerUseVision: { providerId: 'mistral', model: 'retired-model', maxSteps: 19 },
            characterFallbacks: [
              { providerId: 'openrouter', model: 'router-model' },
              { providerId: 'mistral', model: 'retired-model' },
              { providerId: 'cloudflare', model: 'cloud-model' },
            ],
          },
        },
      }),
    )
    const credentials = credentialStore()
    const loaded = await config.loadConfig(credentials as never)
    expect(loaded.llm.activeProvider).toBe('groq')
    expect(loaded.llm.providers.groq.model).toBe('saved-model')
    expect(Object.keys(loaded.llm.providers)).toEqual([
      'groq',
      'cloudflare',
      'openrouter',
      'codex-cli',
      'ollama',
    ])
    expect(loaded.llm.roles).toMatchObject({
      computerUseVision: { providerId: '', model: '', maxSteps: 19 },
      characterFallbacks: [
        { providerId: 'openrouter', model: 'router-model' },
        { providerId: 'cloudflare', model: 'cloud-model' },
      ],
    })
    expect(credentials.importMissing).toHaveBeenCalledWith({})
    const saved = readFileSync(configPath, 'utf8')
    expect(saved).not.toContain('retired-provider')
    expect(saved).not.toContain('retired-model')
    expect(saved).not.toContain('retired-key')
    expect(saved).not.toContain('mistral')
    vi.resetModules()
    const restarted = await import('../../../src/main/config')
    await restarted.loadConfig(credentialStore() as never)
    expect(readFileSync(configPath, 'utf8')).toBe(saved)
  })

  it('removes the retired microphone selector from an otherwise current profile', async () => {
    const directory = temporaryUserData()
    const configPath = join(directory, 'config.json')
    const config = await import('../../../src/main/config')
    const defaults = config.freshDefaults()
    const llm = {
      ...defaults.llm,
      activeProvider: 'openrouter',
      providers: {
        ...defaults.llm.providers,
        openrouter: { ...defaults.llm.providers.openrouter, model: 'character-model' },
      },
      roles: {
        ...defaults.llm.roles,
        characterFallbacks: [{ providerId: 'groq', model: 'fallback-model' }],
        computerUseVision: {
          ...defaults.llm.roles.computerUseVision,
          providerId: 'openrouter',
          model: 'vision-model',
        },
      },
    }
    const backlogSelector = { enabled: true, providerId: 'groq', model: 'selector-model' }
    writeFileSync(
      configPath,
      JSON.stringify({ ...defaults, llm: { ...llm, roles: { ...llm.roles, backlogSelector } } }),
    )

    const credentials = credentialStore()
    expect((await config.loadConfig(credentials as never)).llm).toEqual(llm)
    expect(JSON.parse(readFileSync(configPath, 'utf8')).llm).toEqual(llm)
    expect(credentials.importMissing).not.toHaveBeenCalled()
    expect(configSaveSchema.safeParse({ llm: { roles: { backlogSelector } } }).success).toBe(false)
  })

  it('preserves a supported legacy key across failed import and later settings saves', async () => {
    const directory = temporaryUserData()
    const configPath = join(directory, 'config.json')
    const oldFile = JSON.stringify({
      provider: 'mistral',
      apiKey: 'retired-key',
      model: 'retired-model',
      groqApiKey: 'supported-key',
      groqModel: 'supported-model',
    })
    writeFileSync(configPath, oldFile)
    const first = await import('../../../src/main/config')
    const credentials = credentialStore()
    credentials.importMissing.mockRejectedValueOnce(new Error('secure storage unavailable'))
    const loaded = await first.loadConfig(credentials as never)
    expect(loaded.llm.activeProvider).toBe('groq')
    expect(loaded.llm.providers.groq.model).toBe('supported-model')
    expect(credentials.importMissing).toHaveBeenCalledWith({ groq: 'supported-key' })
    expect(() => first.saveConfig({ uiTheme: 'dark' })).toThrow(
      'CONFIG_LLM_CREDENTIAL_MIGRATION_PENDING',
    )
    expect(readFileSync(configPath, 'utf8')).toBe(oldFile)

    vi.resetModules()
    const restarted = await import('../../../src/main/config')
    const recoveredCredentials = credentialStore()
    await restarted.loadConfig(recoveredCredentials as never)
    expect(recoveredCredentials.importMissing).toHaveBeenCalledWith({ groq: 'supported-key' })
    restarted.saveConfig({ uiTheme: 'dark' })
    expect(readFileSync(configPath, 'utf8')).not.toMatch(/mistral|apiKey|retired-|supported-key/u)
  })

  it.each([
    { activeProvider: 'mistral' },
    { providers: { mistral: { model: 'retired-model' } } },
    { roles: { computerUseVision: { providerId: 'mistral' } } },
    { roles: { characterFallbacks: [{ providerId: 'mistral', model: 'retired-model' }] } },
  ])('rejects a retired provider from the renderer in %j', (llm) => {
    expect(configSaveSchema.safeParse({ llm }).success).toBe(false)
  })

  it('accepts automatic roles and keeps a supported catalog model with its original ID', () => {
    const llm = {
      activeProvider: 'openrouter',
      providers: {
        openrouter: { model: 'mistralai/mistral-small:free' },
        'codex-cli': { model: 'gpt-5.4', codexReasoningByModel: { 'gpt-5.4': 'high' } },
      },
      roles: { computerUseVision: { providerId: '' } },
    }
    expect(configSaveSchema.parse({ llm })).toEqual({ llm })
  })

  it('keeps fresh defaults, the exact path, and restart persistence', async () => {
    const directory = temporaryUserData()
    const configPath = join(directory, 'config.json')
    const first = await import('../../../src/main/config')
    const firstCredentials = credentialStore()

    expect(await first.loadConfig(firstCredentials as never)).toMatchObject({ uiTheme: 'light' })
    expect(firstCredentials.load).toHaveBeenCalledOnce()
    expect(() => readFileSync(configPath, 'utf8')).toThrow()
    first.saveConfig({ uiTheme: 'dark' })
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({ uiTheme: 'dark' })

    vi.resetModules()
    const restarted = await import('../../../src/main/config')
    expect(await restarted.loadConfig(credentialStore() as never)).toMatchObject({
      uiTheme: 'dark',
    })
  })

  it('preserves explicit legacy migration and makes it idempotent without persisting secrets', async () => {
    const directory = temporaryUserData()
    const configPath = join(directory, 'config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: 'groq',
        apiKey: 'legacy-secret',
        model: 'legacy-model',
        overlayViewMode: 'front',
      }),
      'utf8',
    )
    const first = await import('../../../src/main/config')
    const firstCredentials = credentialStore()

    expect(await first.loadConfig(firstCredentials as never)).toMatchObject({
      overlayViewMode: 'bust',
      llm: {
        activeProvider: 'groq',
        providers: { groq: { model: 'legacy-model' } },
      },
    })
    expect(firstCredentials.importMissing).toHaveBeenCalledWith({ groq: 'legacy-secret' })
    const migrated = readFileSync(configPath, 'utf8')
    expect(migrated).not.toContain('legacy-secret')
    expect(migrated).not.toContain('apiKey')

    vi.resetModules()
    const restarted = await import('../../../src/main/config')
    const restartedCredentials = credentialStore()
    await restarted.loadConfig(restartedCredentials as never)
    expect(restartedCredentials.importMissing).not.toHaveBeenCalled()
    expect(readFileSync(configPath, 'utf8')).toBe(migrated)
  })

  it('recovers malformed JSON to a valid default document', async () => {
    const directory = temporaryUserData()
    const configPath = join(directory, 'config.json')
    mkdirSync(directory, { recursive: true })
    writeFileSync(configPath, '{malformed', 'utf8')
    const config = await import('../../../src/main/config')

    expect(await config.loadConfig(credentialStore() as never)).toMatchObject({
      uiTheme: 'light',
      setup: { completed: false },
    })
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({
      uiTheme: 'light',
      setup: { completed: false },
    })
    const backups = readdirSync(directory).filter((name) =>
      /^config\.json\.corrupt\.\d+\.json$/u.test(name),
    )
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(directory, backups[0]), 'utf8')).toBe('{malformed')
  })
})
