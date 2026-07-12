import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { avatarStartupTuning, type OverlayViewMode, overlayCameraPresets } from './avatarTuning'

export class SceneManager {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  private readonly lookAtAnchor = new THREE.Object3D()
  private framedPosition: { x: number; y: number; z: number } | null = null
  private framedTarget: { x: number; y: number; z: number } | null = null
  private lastTime = performance.now()
  private animCallbacks: Array<(delta: number) => void> = []
  private rafId = 0
  private resizeObserver: ResizeObserver

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(
      canvas.clientWidth || window.innerWidth,
      canvas.clientHeight || window.innerHeight,
      false,
    )
    this.renderer.setClearColor(0x1a1a2e, 0)
    this.renderer.shadowMap.enabled = true

    this.scene = new THREE.Scene()
    this.scene.add(this.lookAtAnchor)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambient)

    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(1, 2, 2)
    dir.castShadow = true
    this.scene.add(dir)

    const fill = new THREE.DirectionalLight(0x8899ff, 0.3)
    fill.position.set(-1, 0, -1)
    this.scene.add(fill)

    this.camera = new THREE.PerspectiveCamera(
      avatarStartupTuning.camera.fov,
      canvas.clientWidth / canvas.clientHeight,
      avatarStartupTuning.camera.near,
      avatarStartupTuning.camera.far,
    )
    this.applyCameraView(avatarStartupTuning.camera.position, avatarStartupTuning.camera.target)

    // Orbit controls — drag to rotate, wheel to zoom, right-drag to pan
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(
      avatarStartupTuning.camera.target.x,
      avatarStartupTuning.camera.target.y,
      avatarStartupTuning.camera.target.z,
    )
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 0.6
    this.controls.maxDistance = 6
    this.controls.minPolarAngle = Math.PI * 0.1
    this.controls.maxPolarAngle = Math.PI * 0.9
    this.controls.update()

    // Dynamically follow the canvas size (window resize, devtools, layout changes)
    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(canvas)
    window.addEventListener('resize', this.onResize)
  }

  setOverlayCameraView(scale = 1): void {
    this.setOverlayCameraPreset('front', scale)
  }

  /**
   * Restores the front-facing view. If a model has been framed via
   * {@link frameLoadedModel}, reuses that computed front framing; otherwise falls
   * back to the static startup tuning. Local presentation concern — does not
   * touch model state.
   */
  resetCamera(): void {
    const position = this.framedPosition ?? avatarStartupTuning.camera.position
    const target = this.framedTarget ?? avatarStartupTuning.camera.target
    this.applyCameraView(position, target)
    this.controls.target.set(target.x, target.y, target.z)
    this.controls.update()
  }

  /**
   * Computes a front-facing, full-body framing from the loaded model's bounds so
   * the avatar fills a sensible fraction of the viewport instead of appearing
   * tiny. VRM front faces -Z, so the camera sits on the -Z side. The result is
   * cached and reused by {@link resetCamera}. Preview-only presentation concern.
   */
  frameLoadedModel(fillRatio = 0.72): void {
    const box = new THREE.Box3()
    let hasMesh = false
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh & { isSkinnedMesh?: boolean }
      if ((mesh.isMesh || mesh.isSkinnedMesh) && mesh.geometry) {
        box.expandByObject(mesh)
        hasMesh = true
      }
    })
    if (!hasMesh || box.isEmpty()) return
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)
    const height = size.y || 1.6
    const vFov = THREE.MathUtils.degToRad(this.camera.fov)
    const distance = height / Math.max(0.2, fillRatio) / (2 * Math.tan(vFov / 2))
    this.framedTarget = { x: 0, y: center.y, z: 0 }
    this.framedPosition = { x: 0, y: center.y, z: -distance }
    this.applyCameraView(this.framedPosition, this.framedTarget)
    this.controls.target.set(0, center.y, 0)
    this.controls.update()
  }

  setOverlayCameraPreset(mode: OverlayViewMode, scale = 1): void {
    const preset = overlayCameraPresets[mode] ?? overlayCameraPresets.front
    const clampedScale = Math.max(preset.scaleMin, Math.min(preset.scaleMax, scale))
    const target = preset.target
    const offset = {
      x: preset.position.x - target.x,
      y: preset.position.y - target.y,
      z: preset.position.z - target.z,
    }
    this.applyCameraView(
      {
        x: target.x + offset.x / clampedScale,
        y: target.y + offset.y / clampedScale,
        z: target.z + offset.z / clampedScale,
      },
      target,
      preset.fov,
    )
    this.controls.target.set(target.x, target.y, target.z)
    this.controls.update()
  }

  setTransparentBackground(enabled: boolean): void {
    this.renderer.setClearColor(0x1a1a2e, enabled ? 0 : 1)
  }

  onAddAnimation(cb: (delta: number) => void): void {
    this.animCallbacks.push(cb)
  }

  start(): void {
    const loop = (): void => {
      this.rafId = requestAnimationFrame(loop)
      const now = performance.now()
      const delta = (now - this.lastTime) / 1000
      this.lastTime = now
      this.controls.update()
      this.syncLookAtAnchor()
      for (const cb of this.animCallbacks) cb(delta)
      this.renderer.render(this.scene, this.camera)
    }
    loop()
  }

  getLookAtTarget(): THREE.Object3D {
    this.syncLookAtAnchor()
    return this.lookAtAnchor
  }

  stop(): void {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.onResize)
  }

  dispose(): void {
    this.stop()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  // arrow fn so `this` stays bound when used as ResizeObserver/listener callback
  private onResize = (): void => {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // false: update only the drawing buffer, let CSS (100%/100%) own display size
    this.renderer.setSize(w, h, false)
  }

  private applyCameraView(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    fov = avatarStartupTuning.camera.fov,
  ): void {
    if (this.camera.fov !== fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.camera.position.set(position.x, position.y, position.z)
    this.camera.lookAt(target.x, target.y, target.z)
    this.syncLookAtAnchor()
  }

  private syncLookAtAnchor(): void {
    this.lookAtAnchor.position.copy(this.camera.position)
    this.lookAtAnchor.quaternion.identity()
  }
}
