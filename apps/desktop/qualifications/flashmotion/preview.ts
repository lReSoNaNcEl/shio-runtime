import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Matrix4,
  type Object3D,
  OrthographicCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'

import {
  limitStandingRootY,
  measurePlantedFeet,
} from '../../src/renderer/avatar/rendering/three/GeneratedBodyBindings'
import { plantLeg } from '../../src/renderer/avatar/rendering/three/plantLeg'
import { VrmModelLoader } from '../../src/renderer/avatar/rendering/three/VrmModelLoader'

// HumanML3D's 22-joint order. These are source joint directions used to inspect
// gross body motion. Hand twist, fingers and contact solving are outside this preview.
const segments: ReadonlyArray<readonly [VRMHumanBoneName, VRMHumanBoneName, number, number]> = [
  ['spine', 'chest', 3, 6],
  ['chest', 'neck', 6, 12],
  ['leftShoulder', 'leftUpperArm', 13, 16],
  ['leftUpperArm', 'leftLowerArm', 16, 18],
  ['leftLowerArm', 'leftHand', 18, 20],
  ['rightShoulder', 'rightUpperArm', 14, 17],
  ['rightUpperArm', 'rightLowerArm', 17, 19],
  ['rightLowerArm', 'rightHand', 19, 21],
  ['leftUpperLeg', 'leftLowerLeg', 1, 4],
  ['leftLowerLeg', 'leftFoot', 4, 7],
  ['leftFoot', 'leftToes', 7, 10],
  ['rightUpperLeg', 'rightLowerLeg', 2, 5],
  ['rightLowerLeg', 'rightFoot', 5, 8],
  ['rightFoot', 'rightToes', 8, 11],
]

const smplxBones: readonly (VRMHumanBoneName | null)[] = [
  'hips',
  'leftUpperLeg',
  'rightUpperLeg',
  'spine',
  'leftLowerLeg',
  'rightLowerLeg',
  'chest',
  'leftFoot',
  'rightFoot',
  'upperChest',
  'leftToes',
  'rightToes',
  null,
  'leftShoulder',
  'rightShoulder',
  null,
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  null,
  null,
  null,
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
]

async function createPreview() {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(640, 720)
  document.body.style.margin = '0'
  document.body.append(renderer.domElement)
  const scene = new Scene()
  scene.background = new Color(0x202632)
  scene.add(new AmbientLight(0xffffff, 2))
  const light = new DirectionalLight(0xffffff, 2)
  light.position.set(1, 3, 4)
  scene.add(light)

  const response = await fetch('/model.vrm')
  if (!response.ok) throw new Error('VRM fixture unavailable')
  const vrm = await new VrmModelLoader().load(scene, await response.arrayBuffer())
  const humanoid = vrm.humanoid
  vrm.scene.updateMatrixWorld(true)
  const bone = (name: VRMHumanBoneName) => humanoid.getNormalizedBoneNode(name)
  const hips = bone('hips')
  const leftHip = bone('leftUpperLeg')
  const rightHip = bone('rightUpperLeg')
  if (!hips || !leftHip || !rightHip) throw new Error('VRM is missing required hip bones')
  const vertical = new Vector3(0, 1, 0)
  const left = worldPosition(leftHip).sub(worldPosition(rightHip))
  left.y = 0
  left.normalize()
  const front = left.clone().cross(vertical)
  const basis = new Matrix4().makeBasis(left, vertical, front)
  const basisRotation = new Quaternion().setFromRotationMatrix(basis)
  const inverseBasis = basisRotation.clone().invert()
  const restHips = hips.position.clone()
  const restRotation = hips.quaternion.clone()
  const standingSupport = new URLSearchParams(location.search).get('support') === 'standing'
  const plantedFeet = standingSupport
    ? measurePlantedFeet(vrm, vrm.meta.metaVersion === '0' ? -1 : 1)
    : []
  if (standingSupport && plantedFeet.length !== 2)
    throw new Error('VRM is missing standing support bones')
  let filteredRootY = restHips.y
  const armTargets = segments.flatMap(([name, childName, start, end]) => {
    const parent = bone(name)
    const child = bone(childName)
    if (!parent || !child) return []
    return [
      {
        parent,
        start,
        end,
        restDirection: worldPosition(child).sub(worldPosition(parent)).normalize(),
        restWorld: parent.getWorldQuaternion(new Quaternion()),
      },
    ]
  })
  const bounds = new Box3().setFromObject(vrm.scene)
  const height = bounds.max.y - bounds.min.y
  if (height <= 0 || !Number.isFinite(height)) throw new Error('Invalid VRM bounds')
  const grid = new GridHelper(5, 20, 0x8995a6, 0x475368)
  grid.position.y = bounds.min.y
  scene.add(grid)
  const camera = new OrthographicCamera(
    -height * 0.55,
    height * 0.55,
    height * 0.62,
    -height * 0.62,
    0.01,
    40,
  )
  const center = bounds.getCenter(new Vector3())
  camera.position.copy(center).addScaledVector(front, 4).addScaledVector(left, 0.9)
  camera.position.y += 0.12
  camera.lookAt(center)

  const vector = (frame: number[][], index: number) => new Vector3().fromArray(frame[index])
  const sourceToVrm = new Vector3()
  const inverseParent = new Quaternion()
  const rotation = new Quaternion()
  const target = new Vector3()
  const scale = height / 1.65
  function positionRoot(current: number[], first: number[]) {
    const rootOffset = new Vector3().fromArray(current).sub(new Vector3().fromArray(first))
    hips?.position.copy(restHips).add(rootOffset.applyMatrix4(basis).multiplyScalar(scale))
  }
  function pose(frame: number[][], first: number[][]) {
    positionRoot(frame[0], first[0])
    hips?.quaternion.copy(restRotation)
    vrm.scene.updateMatrixWorld(true)
    for (const entry of armTargets) {
      target.copy(vector(frame, entry.end)).sub(vector(frame, entry.start))
      if (target.lengthSq() < 1e-10 || !entry.parent.parent) continue
      sourceToVrm.copy(target).applyMatrix4(basis).normalize()
      entry.parent.parent.getWorldQuaternion(inverseParent).invert()
      rotation.setFromUnitVectors(entry.restDirection, sourceToVrm).multiply(entry.restWorld)
      entry.parent.quaternion.copy(inverseParent).multiply(rotation)
      entry.parent.updateMatrixWorld(true)
    }
    return render(1 / 20)
  }
  const rawTargets = smplxBones.map((name) => name && bone(name))
  function poseS2g(frame: number[][], root: number[], firstRoot: number[]) {
    positionRoot(root, firstRoot)
    for (const [index, node] of rawTargets.entries()) {
      if (!node) continue
      target.fromArray(frame[index])
      const radians = target.length()
      if (radians < 1e-10) {
        node.quaternion.identity()
        continue
      }
      rotation.setFromAxisAngle(target.divideScalar(radians), radians)
      node.quaternion.copy(basisRotation).multiply(rotation).multiply(inverseBasis)
    }
    return render(1 / 30)
  }
  function render(seconds: number) {
    if (standingSupport && hips) {
      // Match the standing playback path for horizontal anchoring and knee rate.
      hips.position.x = restHips.x
      hips.position.z = restHips.z
      const targetY = Math.min(hips.position.y, restHips.y - 0.002 * scale)
      const filtered = (targetY - filteredRootY) * (1 - Math.exp(-3 * seconds))
      const step = Math.max(-0.015 * seconds, Math.min(0.015 * seconds, filtered))
      filteredRootY = limitStandingRootY(
        vrm,
        plantedFeet,
        restHips,
        filteredRootY,
        filteredRootY + step,
        seconds,
      )
      hips.position.y = filteredRootY
      hips.updateMatrixWorld(true)
      for (const leg of plantedFeet) {
        plantLeg(leg.upper, leg.lower, leg.foot, leg.target, leg.orientation, leg.pole)
      }
    }
    vrm.update(0)
    renderer.render(scene, camera)
    return Object.fromEntries(
      (
        [
          'leftHand',
          'rightHand',
          'leftFoot',
          'rightFoot',
          'leftIndexDistal',
          'rightIndexDistal',
        ] as const
      ).map((name) => {
        const node = bone(name)
        return [name, node ? worldPosition(node).toArray() : null]
      }),
    )
  }
  return { pose, poseS2g, vrmVersion: vrm.meta.metaVersion, height, left: left.toArray() }
}

function worldPosition(node: Object3D) {
  return node.getWorldPosition(new Vector3())
}

Object.assign(window, { flashMotionPreview: createPreview() })
