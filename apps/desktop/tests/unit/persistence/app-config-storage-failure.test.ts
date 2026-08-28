import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

const directory = mkdtempSync(join(tmpdir(), 'shio-config-storage-failure-'))
const configPath = join(directory, 'config.json')
const original = JSON.stringify({ uiTheme: 'dark', setup: { completed: true } })
let writes = 0

vi.mock('electron', () => ({
  app: { getPath: () => directory, isPackaged: false },
}))

vi.mock('../../../src/main/persistence/ValidatedElectronStore', () => ({
  ValidatedElectronStore: class {
    read(): never {
      throw new Error('fixture storage runtime failure')
    }

    write(): never {
      writes += 1
      throw new Error('fixture write must not run')
    }

    close(): void {}
  },
}))

afterAll(() => rmSync(directory, { force: true, recursive: true }))

describe('App config storage failure containment', () => {
  it('preserves an existing file and blocks later default overwrite', async () => {
    writeFileSync(configPath, original, 'utf8')
    const config = await import('../../../src/main/config')
    const credentials = {
      load: vi.fn(async () => undefined),
      importMissing: vi.fn(async () => undefined),
      recordMigrationError: vi.fn(),
    }

    expect(await config.loadConfig(credentials as never)).toMatchObject({ uiTheme: 'light' })
    expect(config.getConfigStorageHealth()).toEqual({
      state: 'degraded',
      code: 'CONFIG_STORAGE_RUNTIME_FAILURE',
    })
    expect(readFileSync(configPath, 'utf8')).toBe(original)
    expect(() => config.saveConfig({ uiTheme: 'dark' })).toThrow('CONFIG_STORAGE_RUNTIME_FAILURE')
    expect(writes).toBe(0)
    expect(readFileSync(configPath, 'utf8')).toBe(original)
  })
})
