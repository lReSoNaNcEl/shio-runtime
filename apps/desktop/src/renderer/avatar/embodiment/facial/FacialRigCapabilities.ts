import type { VRM } from '@pixiv/three-vrm'
import { Matrix3, Mesh, Vector3 } from 'three'

import { FACIAL_ACTING_CHANNELS, type FacialActingChannel } from '../../../../shared/facial-acting'

export interface FacialChannelCapability {
  status: 'supported' | 'zero-effect' | 'missing'
  maxDeltaMm: number
}
export type FacialRigCapabilities = Record<FacialActingChannel, FacialChannelCapability>

/** Model-local inspection only. The Mixer owns registration and all final writes. */
export function inspectFacialRig(vrm: VRM): {
  capabilities: FacialRigCapabilities
  binds: Map<FacialActingChannel, Array<{ mesh: Mesh; index: number }>>
} {
  const binds = new Map<FacialActingChannel, Array<{ mesh: Mesh; index: number }>>()
  const capabilities = Object.fromEntries(
    FACIAL_ACTING_CHANNELS.map((name) => [name, { status: 'missing', maxDeltaMm: 0 }]),
  ) as FacialRigCapabilities
  vrm.scene.updateMatrixWorld(true)
  vrm.scene.traverse((node) => {
    if (!(node instanceof Mesh)) return
    const positions = node.geometry.attributes.position
    if (!positions) return
    const world = new Matrix3().setFromMatrix4(node.matrixWorld)
    const delta = new Vector3()
    for (const name of FACIAL_ACTING_CHANNELS) {
      const index = node.morphTargetDictionary?.[name]
      if (index === undefined) continue
      const target = node.geometry.morphAttributes.position?.[index]
      const capability = capabilities[name]
      if (capability.status === 'missing') capability.status = 'zero-effect'
      if (!target || target.count !== positions.count) continue
      let maxDelta = 0
      for (let vertex = 0; vertex < target.count; vertex++) {
        const relative = node.geometry.morphTargetsRelative
        const x = target.getX(vertex) - (relative ? 0 : positions.getX(vertex))
        const y = target.getY(vertex) - (relative ? 0 : positions.getY(vertex))
        const z = target.getZ(vertex) - (relative ? 0 : positions.getZ(vertex))
        const length = delta.set(x, y, z).applyMatrix3(world).length()
        if (Number.isFinite(length)) maxDelta = Math.max(maxDelta, length)
      }
      capability.maxDeltaMm = Math.max(capability.maxDeltaMm, maxDelta * 1000)
      if (maxDelta <= 0.000001) continue
      capability.status = 'supported'
      const entries = binds.get(name) ?? []
      entries.push({ mesh: node, index })
      binds.set(name, entries)
    }
  })
  return { capabilities, binds }
}
