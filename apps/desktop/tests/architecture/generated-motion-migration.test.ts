import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it } from 'vitest'

const desktopRoot = resolve(import.meta.dirname, '../..')
const source = (name: string) => readFileSync(resolve(desktopRoot, name), 'utf8')

describe('generated-motion migration boundary', () => {
  it('keeps clip loaders, root-track policies and file/cache projections removed', () => {
    for (const name of [
      'VrmBodyPlayback',
      'AvatarAnimationLoader',
      'RootMotionController',
      'AnimationDebugTypes',
      'VrmAnimationTypes',
    ])
      assert.equal(
        existsSync(resolve(desktopRoot, `src/renderer/avatar/rendering/three/${name}.ts`)),
        false,
      )
    assert.equal(
      existsSync(resolve(desktopRoot, 'src/renderer/avatar/OverlayAnimationPolicy.ts')),
      false,
    )
    for (const name of [
      'avatar/AvatarAnimationController.ts',
      'avatar/animationManifest.ts',
      'avatar/rendering/three/GeneratedMotionTypes.ts',
      'avatar/rendering/three/GeneratedBodyPlayback.ts',
      'runtime/TransitionRecorder.ts',
      'controller/RuntimeDiagnosticsProjection.ts',
    ])
      assert.doesNotMatch(
        source(`src/renderer/${name}`),
        /rootMotionPolicy|legacyBlendDuration|activeFileName|clipCache|lastLoadFile|currentClip|ownershipGapCount/,
      )
    for (const name of ['package.json', 'package-lock.json'])
      assert.doesNotMatch(source(name), /three-vrm-animation/)
  })

  it('keeps removed clip-file projections out of the HUD boundary', () => {
    const controller = source('src/renderer/Controller.ts')
    const app = source('src/renderer/components/App.tsx')
    assert.doesNotMatch(controller + app, /overlayAnimationFile|currentBodyAnimationFile/)
  })
})
