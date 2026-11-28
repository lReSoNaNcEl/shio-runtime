import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it } from 'vitest'

import { isBelow } from '../support/architecture/sourceAst'
import { desktopRoot, sourceFiles, sourceRoot } from './context'

const rendererRoot = resolve(sourceRoot, 'renderer')
const source = (name: string) => readFileSync(resolve(desktopRoot, name), 'utf8')

describe('generated-motion migration boundary', () => {
  it('keeps clip loaders, root-track policies and file/cache projections removed', () => {
    for (const name of [
      'avatar/rendering/three/VrmBodyPlayback.ts',
      'avatar/rendering/three/AvatarAnimationLoader.ts',
      'avatar/rendering/three/RootMotionController.ts',
      'avatar/rendering/three/AnimationDebugTypes.ts',
      'avatar/rendering/three/VrmAnimationTypes.ts',
      'avatar/OverlayAnimationPolicy.ts',
      'runtime/StreamingSpeechPipeline.ts',
    ])
      assert(!existsSync(resolve(rendererRoot, name)), `Removed module returned: ${name}`)

    assert.deepEqual(
      readdirSync(rendererRoot, { recursive: true, encoding: 'utf8' }).filter((name) =>
        /\.vrma$/iu.test(name),
      ),
      [],
    )
    for (const file of sourceFiles.filter((name) => isBelow(name, rendererRoot)))
      assert.doesNotMatch(
        readFileSync(file, 'utf8'),
        /rootMotionPolicy|legacyBlendDuration|activeFileName|currentBodyAnimationFile|animationAssetCache|clipCache|lastLoadFile|currentClip|ownershipGapCount|OverlayAnimationPolicy|import\.meta\.glob[^\n]*vrma|pickVrma|loadExternalAnimation/iu,
        file,
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
