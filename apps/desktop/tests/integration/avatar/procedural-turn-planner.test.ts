import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { GeneratedBodyPlayback } from '../../../src/renderer/avatar/rendering/three/GeneratedBodyPlayback'
import { plantLeg } from '../../../src/renderer/avatar/rendering/three/plantLeg'
import { TurnInPlaceMotion } from '../../../src/renderer/avatar/rendering/three/TurnInPlaceMotion'
import { greenFoxRig } from '../../support/avatar/greenFoxRig'

function posedTurn(width: number, load: number, airborne = false, tempo = 1, pivot = false) {
  const vrm = greenFoxRig()
  new GeneratedBodyPlayback(() => undefined).attach(vrm)
  const feet = (['left', 'right'] as const).map((side, index) => {
    const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`)
    const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`)
    const foot = vrm.humanoid.getNormalizedBoneNode(`${side}Foot`)
    if (!upper || !lower || !foot) throw new Error('Incomplete actual-rig fixture')
    const target = foot.getWorldPosition(new THREE.Vector3())
    target.x = index ? width / 2 : -width / 2
    if (airborne && index) target.y += 0.09
    return {
      upper,
      lower,
      foot,
      target,
      orientation: foot.getWorldQuaternion(new THREE.Quaternion()),
    }
  })
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')
  if (!hips) throw new Error('Incomplete actual-rig fixture')
  hips.position.x += load
  hips.position.y -= 0.04
  vrm.scene.updateMatrixWorld(true)
  for (const foot of feet)
    plantLeg(
      foot.upper,
      foot.lower,
      foot.foot,
      foot.target,
      foot.orientation,
      new THREE.Vector3(0, 0, -1),
    )
  vrm.humanoid.update()
  vrm.scene.updateMatrixWorld(true)
  const turn = new TurnInPlaceMotion(
    vrm,
    { action: 'turn-in-place', turns: 1, direction: 'clockwise', tempo, finishFacing: 'viewer' },
    17,
    0,
    pivot,
  )
  return { turn, vrm }
}

function run(turn: TurnInPlaceMotion, deltas = [1 / 60]) {
  let firstSupport: string | null = null,
    previousSupport = 'double'
  const landings: number[] = []
  let peakTurnSpeed = 0
  for (let frame = 0; frame < 3200 && !turn.outcome; frame++) {
    const delta = deltas[frame % deltas.length]
    const before = turn.heading
    turn.advance(delta)
    peakTurnSpeed = Math.max(peakTurnSpeed, Math.abs(turn.heading - before) / delta)
    turn.solveAndVerify(true)
    const support = turn.getStatus().support
    if (support !== 'double') firstSupport ??= support
    if (support === 'double' && previousSupport !== 'double') landings.push(turn.heading)
    previousSupport = support
  }
  return {
    firstSupport,
    landings,
    elapsed: turn.elapsed,
    peakTurnSpeed,
    status: turn.getStatus(),
    rejections: turn.planner.rejected,
  }
}

describe('pose-adaptive turn planning', () => {
  it('chooses initial support from actual load rather than the variation seed', () => {
    const left = run(posedTurn(0.16, -0.045).turn)
    const right = run(posedTurn(0.16, 0.045).turn)
    expect(left.status.outcome).toBe('completed')
    expect(right.status.outcome).toBe('completed')
    expect(left.firstSupport).toBe('left')
    expect(right.firstSupport).toBe('right')
  })

  it('recomputes placements and timing when the starting stance changes', () => {
    const narrow = run(posedTurn(0.11, 0).turn)
    const wide = run(posedTurn(0.27, 0).turn)
    expect(narrow.status.outcome).toBe('completed')
    expect(wide.status.outcome).toBe('completed')
    expect(wide.landings).not.toEqual(narrow.landings)
    expect(Math.abs(wide.elapsed - narrow.elapsed)).toBeGreaterThan(0.1)
    expect(wide.status.maxSupportDriftM).toBeLessThan(0.003)
    expect(narrow.status.maxSupportDriftM).toBeLessThan(0.003)
  })

  it('retains a grounded support while landing an already raised foot', () => {
    const { turn } = posedTurn(0.16, -0.075, true)
    expect(turn.getStatus().support).toBe('left')
    const result = run(turn)
    expect(result.status.outcome).toBe('completed')
    expect(result.firstSupport).toBe('left')
    expect(result.status.maxSupportDriftM).toBeLessThan(0.003)
  })

  it('selects the same contacts and duration under a variable render cadence', () => {
    const fixed = run(posedTurn(0.18, 0.02).turn)
    const variable = run(posedTurn(0.18, 0.02).turn, [1 / 144, 1 / 90, 1 / 40, 1 / 60, 1 / 120])
    expect(fixed.status.outcome).toBe('completed')
    expect(variable.status.outcome).toBe('completed')
    expect(variable.status.steps).toBe(fixed.status.steps)
    expect(Math.abs(variable.elapsed - fixed.elapsed)).toBeLessThan(0.04)
    expect(variable.status.actionHeading).toBeCloseTo(fixed.status.actionHeading, 6)
  })

  it('finishes one turn at low render cadence with verified support', () => {
    const turn = posedTurn(0.18, 0.02, false, 1.1).turn
    const result = run(turn, [1 / 12, 1 / 20, 1 / 25])
    expect(result.status.outcome).toBe('completed')
    expect(Math.abs(result.status.actionHeading)).toBeCloseTo(2 * Math.PI, 5)
    expect(result.status.maxSupportDriftM).toBeLessThan(0.003)
  })

  it('uses a stationary forefoot contact for a quick full turn from balanced support', () => {
    const { turn } = posedTurn(0.12, 0, false, 1.1, true)
    const result = run(turn)
    expect(result.status.outcome).toBe('completed')
    expect(result.elapsed).toBeLessThanOrEqual(3.8)
    expect(result.status.steps).toBe(1)
    expect(result.peakTurnSpeed).toBeLessThan(4.5)
    expect(result.status.support).toBe('double')
    expect(result.status.maxSupportDriftM).toBeLessThan(0.003)
  })

  it('settles onto both feet when the pivot is interrupted mid-turn', () => {
    const { turn } = posedTurn(0.12, 0, false, 1.1, true)
    for (let frame = 0; frame < 100 && turn.getStatus().support === 'double'; frame++) {
      turn.advance(1 / 60)
      turn.solveAndVerify(true)
    }
    expect(turn.getStatus().support).not.toBe('double')
    turn.requestStop()
    const result = run(turn)
    expect(result.status.outcome).toBe('cancelled')
    expect(result.status.support).toBe('double')
    expect(result.elapsed).toBeLessThanOrEqual(3.8)
    expect(result.status.maxSupportDriftM).toBeLessThan(0.003)
  })

  it('cancels a pending initial search without acquiring a contact or hanging', () => {
    const { turn } = posedTurn(0.16, 0)
    turn.requestStop()
    const result = run(turn)
    expect(result.status.outcome).toBe('cancelled')
    expect(result.status.steps).toBe(0)
    expect(Math.abs(result.status.actionHeading)).toBeLessThan(0.002)
  })

  it('rejects an initially unsupported COM without teleporting to another support', () => {
    const { turn } = posedTurn(0.16, 0.075, true)
    const before = turn.feet[0].target.clone()
    const result = run(turn)
    expect(result.status.outcome).toBe('failed')
    expect(result.status.steps).toBe(0)
    expect(turn.feet[0].target.distanceTo(before)).toBeLessThan(0.0001)
  })
})
