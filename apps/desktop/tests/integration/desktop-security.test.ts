import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import { VrmAssetRegistry } from '../../src/main/assets/VrmAssetRegistry'
import { vrmAssetHandleSchema } from '../../src/main/ipc/payloadSchemas'
import { installRendererNavigationGuards } from '../../src/main/windows/windowSecurity'

describe('Desktop resource and navigation boundaries', () => {
  function assertOpaqueAssetBoundary(): void {
    assert.throws(
      () => vrmAssetHandleSchema.parse('C:\\Users\\attacker\\arbitrary.vrm'),
      /Invalid VRM asset handle/,
    )

    const directory = mkdtempSync(join(tmpdir(), 'shio-security-repro-'))
    const selectedPath = join(directory, 'selected.vrm')
    const expected = Buffer.from([0x67, 0x6c, 0x54, 0x46])
    try {
      writeFileSync(selectedPath, expected)
      const registry = new VrmAssetRegistry()
      const selected = registry.registerSelectedAsset(selectedPath)
      assert(vrmAssetHandleSchema.safeParse(selected.assetHandle).success)
      assert.deepEqual(Buffer.from(registry.readAsset(selected.assetHandle)), expected)
      assert.throws(() => registry.readAsset(selectedPath), /Unknown VRM asset handle/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }

  function assertWindowAndPreloadBoundaries(): void {
    let navigationListener: ((event: { preventDefault(): void }, url: string) => void) | undefined
    let openHandler: (() => { action: 'deny' }) | undefined
    installRendererNavigationGuards({
      webContents: {
        on: (
          _event: 'will-navigate',
          listener: (event: { preventDefault(): void }, url: string) => void,
        ) => {
          navigationListener = listener
        },
        setWindowOpenHandler: (handler: () => { action: 'deny' }) => {
          openHandler = handler
        },
      },
    })
    let prevented = false
    navigationListener?.(
      { preventDefault: () => (prevented = true) },
      'app:///C:/Users/attacker/arbitrary.vrm',
    )
    assert(prevented, 'arbitrary app: filesystem navigation was not rejected')
    assert.equal(openHandler?.().action, 'deny', 'new renderer window was not rejected')
  }
  it(
    'resolves registered opaque handles without accepting renderer paths',
    assertOpaqueAssetBoundary,
  )
  it('blocks arbitrary navigation and new windows', assertWindowAndPreloadBoundaries)
})
