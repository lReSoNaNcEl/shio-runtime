const fs = require('node:fs')

/** The production loader's normalized bind hierarchy; textures are irrelevant to FK. */
async function loadVrmForProbe(filename) {
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm')
  globalThis.self ??= globalThis
  const loader = new GLTFLoader()
  loader.register(() => ({
    name: 'qualification-geometry',
    loadTexture: async () => new THREE.Texture(),
  }))
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const bytes = fs.readFileSync(filename)
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  )
  const vrm = gltf.userData.vrm
  VRMUtils.removeUnnecessaryJoints(vrm.scene)
  vrm.scene.updateMatrixWorld(true)
  return vrm
}

async function loadRigGeometry(filename) {
  const { VRMUtils } = await import('@pixiv/three-vrm')
  const vrm = await loadVrmForProbe(filename)
  const entries = Object.entries(vrm.humanoid.normalizedHumanBones)
  const names = new Map(entries.map(([name, bone]) => [bone.node, name]))
  const bones = Object.fromEntries(
    entries.map(([name, { node }]) => [
      name,
      {
        parent: names.get(node.parent) ?? null,
        position: node.position.toArray(),
        rotation: node.quaternion.toArray(),
      },
    ]),
  )
  const result = {
    bones,
    forwardSign: vrm.meta.metaVersion === '0' ? -1 : 1,
    vrmVersion: vrm.meta.metaVersion,
  }
  VRMUtils.deepDispose(vrm.scene)
  return result
}

/** Installed only in the qualification renderer; retains no input pose. */
function installGeometryProbe(rig) {
  const add = (a, b) => a.map((v, i) => v + b[i])
  const sub = (a, b) => a.map((v, i) => v - b[i])
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
  const length = (a) => Math.sqrt(dot(a, a))
  const unit = (a) => a.map((v) => v / Math.max(1e-8, length(a)))
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const multiply = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
  const rotate = (v, q) => multiply(multiply(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]).slice(0, 3)
  const fk = (pose) => {
    const world = {}
    const visit = (name) => {
      if (world[name]) return world[name]
      const bone = rig.bones[name]
      const parent = bone.parent ? visit(bone.parent) : { p: [0, 0, 0], q: [0, 0, 0, 1] }
      const position =
        name === 'hips'
          ? (pose.hipsPosition ?? bone.position)
          : name === 'chest'
            ? (pose.chestPosition ?? bone.position)
            : bone.position
      world[name] = {
        p: add(parent.p, rotate(position, parent.q)),
        q: multiply(parent.q, pose.bones[name] ?? bone.rotation),
      }
      return world[name]
    }
    for (const name of Object.keys(rig.bones)) visit(name)
    return world
  }
  const bind = fk({ bones: {} })
  const palmNormal = (joints, side) =>
    unit(
      cross(
        sub(joints[`${side}IndexProximal`].p, joints[`${side}Hand`].p),
        sub(joints[`${side}LittleProximal`].p, joints[`${side}Hand`].p),
      ),
    )
  const palmSigns = Object.fromEntries(
    ['left', 'right'].map((side) => [side, palmNormal(bind, side)[1] > 0 ? -1 : 1]),
  )
  window.__measureRig = (pose) => {
    const joints = fk(pose)
    const hip = joints.hips.p
    const neck = joints.neck?.p ?? joints.head.p
    const torso = Math.max(0.1, length(sub(neck, hip)))
    const forward = rotate([0, 0, rig.forwardSign], joints.hips.q)
    const result = {}
    for (const side of ['left', 'right']) {
      const wrist = joints[`${side}Hand`].p
      const normal = palmNormal(joints, side).map((v) => v * palmSigns[side])
      const longitudinal = unit(sub(joints[`${side}MiddleProximal`].p, wrist))
      const armLength =
        length(sub(bind[`${side}UpperArm`].p, bind[`${side}LowerArm`].p)) +
        length(sub(bind[`${side}LowerArm`].p, bind[`${side}Hand`].p))
      const hand = {
        wristHeightTorso: (wrist[1] - hip[1]) / torso,
        wristToHeadM: length(sub(wrist, joints.head.p)),
        wristToChestM: length(sub(wrist, joints.chest.p)),
        palmForward: dot(normal, forward),
        palmUp: normal[1],
        fingerUp: longitudinal[1],
        fingerForward: dot(longitudinal, forward),
        reachRatio: length(sub(wrist, joints[`${side}UpperArm`].p)) / armLength,
        indexMiddleOpeningDeg:
          (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                dot(
                  unit(sub(joints[`${side}IndexIntermediate`].p, joints[`${side}IndexProximal`].p)),
                  unit(
                    sub(joints[`${side}MiddleIntermediate`].p, joints[`${side}MiddleProximal`].p),
                  ),
                ),
              ),
            ),
          ) *
            180) /
          Math.PI,
        indexMiddleSignedSpread: dot(
          sub(
            unit(sub(joints[`${side}IndexIntermediate`].p, joints[`${side}IndexProximal`].p)),
            unit(sub(joints[`${side}MiddleIntermediate`].p, joints[`${side}MiddleProximal`].p)),
          ),
          unit(sub(joints[`${side}IndexProximal`].p, joints[`${side}LittleProximal`].p)),
        ),
        indexMiddleTipSpanM: dot(
          sub(joints[`${side}IndexDistal`].p, joints[`${side}MiddleDistal`].p),
          unit(sub(joints[`${side}IndexProximal`].p, joints[`${side}LittleProximal`].p)),
        ),
      }
      for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
        const proximal = joints[`${side}${finger}Proximal`].p
        const intermediate = joints[`${side}${finger}Intermediate`].p
        const distal = joints[`${side}${finger}Distal`].p
        hand[`${finger.toLowerCase()}FlexDeg`] =
          (Math.acos(
            Math.max(-1, Math.min(1, dot(longitudinal, unit(sub(intermediate, proximal))))),
          ) *
            180) /
          Math.PI
        hand[`${finger.toLowerCase()}TipToPalmM`] = length(sub(distal, wrist))
      }
      result[side] = hand
    }
    return result
  }
}

module.exports = { loadRigGeometry, loadVrmForProbe, installGeometryProbe }
