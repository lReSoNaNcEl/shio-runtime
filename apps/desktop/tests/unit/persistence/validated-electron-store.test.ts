import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { closeElectronStoreWatcher } from '../../../src/main/persistence/ElectronStoreLifecycleAdapter'
import {
  resolveElectronStoreConstructor,
  ValidatedElectronStore,
} from '../../../src/main/persistence/ValidatedElectronStore'
import { ProjectAwarenessConfigStore } from '../../../src/main/project-awareness/ProjectAwarenessConfigStore'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function temporaryPath(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'shio-electron-store-'))
  temporaryDirectories.push(directory)
  const nested = join(directory, 'nested')
  mkdirSync(nested)
  return join(nested, name)
}

describe('ValidatedElectronStore', () => {
  it('contains the optional watcher cleanup behind a guarded compatibility adapter', () => {
    const closeWatcher = vi.fn()

    expect(closeElectronStoreWatcher({ _closeWatcher: closeWatcher })).toBe(true)
    expect(closeWatcher).toHaveBeenCalledOnce()
    expect(closeElectronStoreWatcher({})).toBe(false)
    expect(
      closeElectronStoreWatcher({
        _closeWatcher: () => {
          throw new Error('dependency hook changed')
        },
      }),
    ).toBe(false)
  })

  it('resolves both ESM and externalized CommonJS module shapes', () => {
    class FakeElectronStore {}

    expect(resolveElectronStoreConstructor(FakeElectronStore)).toBe(FakeElectronStore)
    expect(resolveElectronStoreConstructor({ default: FakeElectronStore })).toBe(FakeElectronStore)
    expect(() => resolveElectronStoreConstructor({})).toThrow(
      'ElectronStore constructor unavailable',
    )
  })

  it('persists and reopens the exact legacy JSON path', () => {
    const path = temporaryPath('plugin-registry.json')
    const schema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean() }).strict()
    const writer = new ValidatedElectronStore(path, schema)
    writer.write({ schemaVersion: 1, enabled: true })
    writer.close()

    expect(existsSync(path)).toBe(true)
    expect(existsSync(`${path}.json`)).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ schemaVersion: 1, enabled: true })
    expect(new ValidatedElectronStore(path, schema).read()).toEqual({
      schemaVersion: 1,
      enabled: true,
    })
  })

  it('rejects schema corruption without silently changing the document', () => {
    const path = temporaryPath('project-awareness.json')
    const schema = z.object({ schemaVersion: z.literal(1), repository: z.string() }).strict()
    const store = new ValidatedElectronStore(path, schema)
    writeFileSync(path, '{"schemaVersion":1,"repository":42}', 'utf8')

    expect(() => store.read()).toThrow()
    expect(readFileSync(path, 'utf8')).toContain('"repository":42')
  })

  it('can explicitly recover the app config from malformed JSON', () => {
    const path = temporaryPath('config.json')
    writeFileSync(path, '{malformed', 'utf8')
    const store = new ValidatedElectronStore(path, z.record(z.string(), z.unknown()), {
      clearMalformedJson: true,
    })

    expect(store.read()).toEqual({})
    store.write({})
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({})
  })

  it('persists and restarts Project Awareness at its exact config path', async () => {
    const path = temporaryPath('config.json')
    const first = new ProjectAwarenessConfigStore(path)
    expect(await first.load()).toMatchObject({ repository: '', branch: 'main' })
    await first.savePublic({ provider: 'github', repository: 'owner/repo', branch: 'release/v1' })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      repository: 'owner/repo',
      branch: 'release/v1',
    })
    expect(await new ProjectAwarenessConfigStore(path).load()).toMatchObject({
      repository: 'owner/repo',
      branch: 'release/v1',
    })
  })
})
