import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
  it('removes a retired provider on load while preserving saved provider choices', async () => {
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
          activeProvider: 'retired-provider',
          providers: {
            ...defaults.llm.providers,
            mistral: { model: 'saved-model', accountId: '' },
            'retired-provider': { model: 'retired-model', contextLimit: 8192 },
          },
        },
      }),
    )
    const loaded = await config.loadConfig(credentialStore() as never)
    expect(loaded.llm.activeProvider).toBe('groq')
    expect(loaded.llm.providers.mistral.model).toBe('saved-model')
    expect(loaded.llm.providers).not.toHaveProperty('retired-provider')
    const saved = readFileSync(configPath, 'utf8')
    expect(saved).not.toContain('retired-provider')
    expect(saved).not.toContain('retired-model')
    vi.resetModules()
    const restarted = await import('../../../src/main/config')
    await restarted.loadConfig(credentialStore() as never)
    expect(readFileSync(configPath, 'utf8')).toBe(saved)
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
