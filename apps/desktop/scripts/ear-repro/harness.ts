/**
 * Ear Behavior Runtime — headless logic reproduction harness.
 *
 * Drives the REAL EarBehaviorRuntime against a synthetic VRM scene (a THREE
 * skeleton with two named ear bones, each with an upward tip child). It verifies
 * the mechanical behaviour that cannot be eyeballed here without a GPU:
 *
 *   - ear bones are discovered and classified L/R
 *   - automatic axis calibration rejects the useless twist axis
 *   - visible amplitude reaches expressive degrees (not micro jitter)
 *   - left and right ears follow independent timelines
 *   - the pose gesture actually changes over time
 *
 * Only the VRM wrapper is faked; all pose/calibration logic is the production class.
 */
import * as THREE from 'three'

import { EarBehaviorRuntime } from '../../src/renderer/three/EarBehaviorRuntime'
import type { VrmProceduralMode } from '../../src/renderer/three/VrmModel'

const tips: Record<string, THREE.Object3D> = {}

function makeEar(name: string, x: number, tiltZ: number): THREE.Object3D {
  const root = new THREE.Object3D()
  root.name = name
  root.position.set(x, 1.5, 0)
  root.rotation.z = tiltZ // slight outward tilt so left/right rigs differ
  const tip = new THREE.Object3D()
  tip.name = `${name}_tip`
  tip.position.set(0, 0.12, 0) // ear points up in its local frame
  root.add(tip)
  tips[name] = tip
  return root
}

const scene = new THREE.Group()
const head = new THREE.Object3D()
head.name = 'J_Bip_C_Head'
head.position.set(0, 1.4, 0)
head.add(makeEar('J_Sec_L_Ear01', -0.08, 0.25))
head.add(makeEar('J_Sec_R_Ear01', 0.08, -0.25))
scene.add(head)
scene.updateMatrixWorld(true)

const leftTip = tips.J_Sec_L_Ear01
const rightTip = tips.J_Sec_R_Ear01
const wpL = new THREE.Vector3()
const wpR = new THREE.Vector3()
function tipGapX(): number {
  scene.updateMatrixWorld(true)
  leftTip.getWorldPosition(wpL)
  rightTip.getWorldPosition(wpR)
  return wpR.x - wpL.x // positive: right tip is to the right of left tip (no crossing)
}
const restGap = tipGapX()

const runtime = new EarBehaviorRuntime()
runtime.attach({ scene } as unknown as Parameters<EarBehaviorRuntime['attach']>[0])

const dt = 1 / 60
function run(profile: VrmProceduralMode, emotion: string, seconds: number) {
  runtime.setProfile(profile)
  runtime.applyEmotion(emotion)
  let maxL = 0
  let maxR = 0
  const posesL = new Set<string>()
  const posesR = new Set<string>()
  let divergedFrames = 0
  let frames = 0
  let minGap = Infinity
  for (let t = 0; t < seconds; t += dt) {
    runtime.update(dt)
    const d = runtime.getDebugState()
    if (d.left) {
      maxL = Math.max(maxL, Math.abs(d.left.currentRotationRad))
      posesL.add(d.left.pose)
    }
    if (d.right) {
      maxR = Math.max(maxR, Math.abs(d.right.currentRotationRad))
      posesR.add(d.right.pose)
    }
    if (d.left && d.right && Math.abs(d.left.currentLift - d.right.currentLift) > 0.05)
      divergedFrames++
    minGap = Math.min(minGap, tipGapX())
    frames++
  }
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1)
  const gapPct = ((minGap / restGap) * 100).toFixed(0)
  console.log(
    `${profile.padEnd(10)} +${emotion.padEnd(10)} maxL=${deg(maxL)}deg maxR=${deg(maxR)}deg ` +
      `posesL=${[...posesL].join('/')} posesR=${[...posesR].join('/')} ` +
      `independent=${((divergedFrames / frames) * 100).toFixed(0)}% minTipGap=${gapPct}%rest`,
  )
  return minGap
}

const initial = runtime.getDebugState()
console.log(`bones=${initial.boneStatus}`)
console.log(`calibration L: ${initial.left?.boneName} axis=${initial.left?.detectedAxis}`)
console.log(`calibration R: ${initial.right?.boneName} axis=${initial.right?.detectedAxis}`)
console.log('---')

console.log(`rest tip gap (world X) = ${restGap.toFixed(4)}`)
run('idle', 'neutral', 30)
run('listening', 'neutral', 20)
run('thinking', 'neutral', 20)
const speakingGap = run('speaking', 'happy', 25)
const speakingAngryGap = run('speaking', 'angry', 20)
run('idle', 'angry', 15)
run('idle', 'sad', 15)
run('thinking', 'surprised', 8)

console.log('--- axis override sanity ---')
runtime.setAxisOverride('z')
runtime.setAmplitudeScale(2)
run('thinking', 'neutral', 4)
runtime.setAxisOverride('auto')
runtime.setAmplitudeScale(1)

// Basic assertions.
const idleState = runtime.getDebugState()
const twistRejected = idleState.left?.detectedAxis?.startsWith('Y') === false
console.log(`\nassert twist-axis(Y) rejected as primary: ${twistRejected ? 'PASS' : 'FAIL'}`)
// Update tick diagnostics must advance (proves the per-instance update loop ran).
console.log(
  `update tick count = ${idleState.updateTickCount}, last delta = ${idleState.lastDeltaMs.toFixed(2)}ms`,
)
console.log(`assert update loop ticked: ${idleState.updateTickCount > 1000 ? 'PASS' : 'FAIL'}`)

// Two independent runtimes (mimicking main + mirror) driven by identical state
// must each animate and must NOT be frame-for-frame identical.
const mainRt = new EarBehaviorRuntime()
const mirrorRt = new EarBehaviorRuntime()
mainRt.attach({ scene } as unknown as Parameters<EarBehaviorRuntime['attach']>[0])
mirrorRt.attach({ scene } as unknown as Parameters<EarBehaviorRuntime['attach']>[0])
mainRt.setProfile('idle')
mirrorRt.setProfile('idle')
let identical = 0
let both = 0
for (let t = 0; t < 40; t += dt) {
  mainRt.update(dt)
  mirrorRt.update(dt)
  const a = mainRt.getDebugState().left
  const b = mirrorRt.getDebugState().left
  if (a && b) {
    both++
    if (Math.abs(a.currentRotationRad - b.currentRotationRad) < 1e-4) identical++
  }
}
const bothTicked =
  mainRt.getDebugState().updateTickCount > 1000 && mirrorRt.getDebugState().updateTickCount > 1000
const notSynced = identical / both < 0.9
console.log(
  `\nmain+mirror independent instances: bothTicked=${bothTicked ? 'PASS' : 'FAIL'} ` +
    `notFrameIdentical=${notSynced ? 'PASS' : 'FAIL'} (identical ${((identical / both) * 100).toFixed(0)}% of frames)`,
)
// No convergence during speaking: tips must never cross (gap > 0) and must stay
// close to the rest gap (ears do not fold toward each other).
const noCross = speakingGap > 0 && speakingAngryGap > 0
const noConverge = speakingGap >= restGap * 0.85 && speakingAngryGap >= restGap * 0.85
console.log(`assert speaking never crosses (gap>0): ${noCross ? 'PASS' : 'FAIL'}`)
console.log(`assert speaking never converges (gap>=85% rest): ${noConverge ? 'PASS' : 'FAIL'}`)
