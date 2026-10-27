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

  it('binds the HUD to applied motion and uses Spectrum with both theme tokens', () => {
    const controller = source('src/renderer/Controller.ts')
    const app = source('src/renderer/components/App.tsx')
    assert.match(controller, /const pose = avatar.bodyMotion.appliedPose/)
    assert.match(controller, /pose && !pose.outcome \? pose.profileId : ''/)
    assert.match(app, /<Text>\{state.overlayMotionProfileId\}<\/Text>/)
    assert.doesNotMatch(controller + app, /overlayAnimationFile|currentBodyAnimationFile/)
    const hud = source('src/renderer/styles/overlay.css').split('/* Overlay */')[0]
    assert.match(hud, /background: var\(--panel\)/)
    assert.match(hud, /color: var\(--text\)/)
    assert.doesNotMatch(hud, /#[0-9a-f]{3,8}\b|rgba?\(/i)
    const themes = source('src/renderer/styles/tokens.css').split(':root[data-theme="light"]')
    assert.equal(themes.length, 2)
    for (const theme of themes) {
      assert.match(theme, /--panel:/)
      assert.match(theme, /--text:/)
    }
  })
})
