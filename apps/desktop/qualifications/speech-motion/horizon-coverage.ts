import { readFileSync, writeFileSync } from 'node:fs'

import * as THREE from 'three'

import { GeneratedBodyPlayback } from '../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { sourceHandDisplacements } from '../../src/renderer/avatar/rendering/three/SourceHandDisplacements'
import type { MotionChunk } from '../../src/shared/motion'
import { greenFoxRig } from '../../tests/support/avatar/greenFoxRig'

const filename = process.argv[2],
  model = process.argv[3]
const data = JSON.parse(readFileSync(filename, 'utf8')) as {
  horizons: MotionChunk[]
  frames: Array<{ executionId: string; phase: string; sourceFrame: number }>
}
const vrm = greenFoxRig(model),
  owner = new GeneratedBodyPlayback(() => undefined)
owner.attach(vrm)
const bindings = Reflect.get(owner, 'bindings') as Array<{
  name: string
  index: number
  bone: THREE.Object3D
  restInModel: THREE.Quaternion
}>
const report = data.horizons
  .filter((chunk) => chunk.plan.phaseId === 'stroke')
  .map((chunk) => {
    const consumed = data.frames.filter(
      (frame) =>
        frame.executionId === chunk.plan.executionId &&
        frame.phase === 'stroke' &&
        frame.sourceFrame >= chunk.startFrame &&
        frame.sourceFrame < chunk.startFrame + 60,
    )
    const end = Math.max(0, ...consumed.map((frame) => frame.sourceFrame - chunk.startFrame))
    const hands = ['left', 'right'].map((side) => {
      const chain = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'].map((part) =>
        bindings.find((binding) => binding.name === `${side}${part}`),
      )
      if (chain.some((binding) => !binding)) throw new Error('Missing arm')
      const segments = chain.slice(0, 3).map((binding, index) => {
        const child = chain[index + 1]
        if (!binding || !child) throw new Error('Missing arm segment')
        return { ...binding, child: child.bone }
      })
      const points = sourceHandDisplacements(
        chunk,
        segments,
        vrm.scene.getWorldQuaternion(new THREE.Quaternion()),
        vrm.meta.metaVersion === '0',
        0,
        60,
      )
      return {
        side,
        consumedExcursionM: Math.max(
          ...points.slice(0, Math.floor(end) + 1).map((point) => point.length()),
        ),
        fullExcursionM: Math.max(...points.map((point) => point.length())),
      }
    })
    return {
      profile: chunk.profileId,
      executionId: chunk.plan.executionId,
      consumedFrames: end,
      generatedFrames: 60,
      hands,
    }
  })
writeFileSync(filename.replace(/\.json$/, '-coverage.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
