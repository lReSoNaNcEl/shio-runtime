import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { type OverlayViewMode, resolveOverlayCameraView } from '../../tuning/cameraTuning'
import { avatarStartupTuning } from '../../tuning/startupTuning'
import {
  AvatarRendererQuality,
  type AvatarTextureQualityState,
  computeDrawingBufferSize,
  resolveEffectiveDpr,
} from './AvatarRendererQuality'

export interface AvatarRenderQualityDebugState {
  cssWidth: number
  cssHeight: number
  drawingBufferWidth: number
  drawingBufferHeight: number
  effectiveDpr: number
  outputColorSpace: string
  toneMapping: number
  drawCalls: number
  triangles: number
  geometries: number
  gpuTextures: number
  modelTextures: AvatarTextureQualityState
}

export class SceneManager {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  private readonly quality = new AvatarRendererQuality()
  private readonly lookAtAnchor = new THREE.Object3D()
  private framedPosition: { x: number; y: number; z: number } | null = null
  private framedTarget: { x: number; y: number; z: number } | null = null
  private handCameraTarget: (() => THREE.Sphere | null) | null = null
  private handCameraRadius = 0
  private handCameraFitDistance = 0
  private modelHeight = 1.65
  private modelBase = 0
  private modelHeadY: number | null = null
  private modelFrontSign: -1 | 1 = -1
  private lastTime = performance.now()
  private animCallbacks: Array<(delta: number) => void> = []
  private rafId = 0
  private resizeObserver: ResizeObserver
  private effectiveDpr = 1
  private running = false
  private disposed = false
  private renderQualityLogPending = false

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.quality.configureRenderer(this.renderer)
    this.effectiveDpr = resolveEffectiveDpr(window.devicePixelRatio)
    this.renderer.setPixelRatio(this.effectiveDpr)
    this.renderer.setSize(
      canvas.clientWidth || window.innerWidth,
      canvas.clientHeight || window.innerHeight,
      false,
    )
    this.renderer.setClearColor(0x1a1a2e, 0)

    this.scene = new THREE.Scene()
    this.scene.add(this.lookAtAnchor)

    const ambient = new THREE.HemisphereLight(0xfff7f0, 0x262a3a, 0.42)
    this.scene.add(ambient)

    const key = new THREE.DirectionalLight(0xfff4e9, 0.92)
    key.position.set(1.5, 2.4, -2.2)
    key.castShadow = true
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0xaab8ff, 0.28)
    fill.position.set(-1.8, 1.25, -1.1)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight(0xd9e5ff, 0.38)
    rim.position.set(0.8, 2.2, 2.5)
    this.scene.add(rim)

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
    this.setOverlayCameraPreset('bust', scale)
  }

  /**
   * Restores the front-facing view. If a model has been framed via
   * {@link frameLoadedModel}, reuses that computed front framing; otherwise falls
   * back to the static startup tuning. Local presentation concern — does not
   * touch model state.
   */
  resetCamera(): void {
    this.stopHandCamera()
    const position = this.framedPosition ?? avatarStartupTuning.camera.position
    const target = this.framedTarget ?? avatarStartupTuning.camera.target
    this.applyCameraView(position, target)
    this.controls.target.set(target.x, target.y, target.z)
    this.controls.update()
  }

  /**
   * Computes a front-facing, full-body framing from the loaded model's bounds so
   * the avatar fills a sensible fraction of the viewport instead of appearing
   * tiny. Camera placement follows the loaded model's VRM front. The result is
   * cached and reused by {@link resetCamera}. Preview-only presentation concern.
   */
  frameLoadedModel(fillRatio = 0.72): void {
    this.stopHandCamera()
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
    this.framedPosition = { x: 0, y: center.y, z: this.modelFrontSign * distance }
    this.applyCameraView(this.framedPosition, this.framedTarget)
    this.controls.target.set(0, center.y, 0)
    this.controls.update()
  }

  /** Preview-only framing follows the composed hand; it never writes the rig. */
  frameHand(getBounds: () => THREE.Sphere | null): void {
    const bounds = getBounds()
    if (!bounds) return
    const target = bounds.center
    this.handCameraTarget = getBounds
    this.handCameraRadius = bounds.radius
    const distance = this.handCameraDistance(bounds.radius)
    this.handCameraFitDistance = distance
    this.controls.minDistance = Math.max(0.08, this.modelHeight * 0.06)
    this.applyCameraView(
      {
        x: target.x,
        y: target.y + distance * 0.1,
        z: target.z + this.modelFrontSign * distance,
      },
      target,
      this.camera.fov,
    )
    this.controls.target.copy(target)
    this.controls.update()
  }

  private stopHandCamera(): void {
    this.handCameraTarget = null
    this.handCameraRadius = 0
    this.handCameraFitDistance = 0
    this.controls.minDistance = 0.6
  }

  private updateHandCamera(): void {
    const bounds = this.handCameraTarget?.()
    if (!bounds) {
      if (this.handCameraTarget) this.stopHandCamera()
      return
    }
    const target = bounds.center
    this.camera.position.add(target.clone().sub(this.controls.target))
    this.controls.target.copy(target)
    this.handCameraRadius = Math.max(this.handCameraRadius, bounds.radius)
    const distance = this.handCameraDistance(this.handCameraRadius)
    if (distance > this.handCameraFitDistance) {
      this.handCameraFitDistance = distance
      const offset = this.camera.position.clone().sub(target)
      if (offset.length() < distance)
        this.camera.position.copy(target).add(offset.setLength(distance))
    }
  }

  private handCameraDistance(radius: number): number {
    const vertical = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.1, this.camera.aspect))
    return Math.max(
      this.modelHeight * 0.12,
      (radius * 1.1) / Math.sin(Math.min(vertical, horizontal)),
    )
  }

  setOverlayCameraPreset(mode: OverlayViewMode, scale = 1): void {
    this.stopHandCamera()
    const { position, target, fov } = resolveOverlayCameraView(
      mode,
      {
        height: this.modelHeight,
        base: this.modelBase,
        headY: this.modelHeadY,
        frontSign: this.modelFrontSign,
      },
      scale,
    )
    this.applyCameraView(position, target, fov)
    this.controls.target.set(target.x, target.y, target.z)
    this.controls.update()
  }

  setTransparentBackground(enabled: boolean): void {
    this.renderer.setClearColor(0x1a1a2e, enabled ? 0 : 1)
  }

  onAddAnimation(cb: (delta: number) => void): void {
    this.animCallbacks.push(cb)
  }

  configureAvatarModelQuality(): AvatarTextureQualityState {
    const bounds = new THREE.Box3()
    this.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) bounds.expandByObject(object)
    })
    if (!bounds.isEmpty()) {
      this.modelHeight = Math.max(0.2, bounds.max.y - bounds.min.y)
      this.modelBase = bounds.min.y
    }
    const state = this.quality.configureModel(this.scene, this.renderer)
    this.renderQualityLogPending = true
    return state
  }

  setAvatarHeadPosition(position: THREE.Vector3 | null): void {
    this.modelHeadY = position?.y ?? null
  }

  setAvatarFrontSign(sign: -1 | 1): void {
    this.modelFrontSign = sign
  }

  getRenderQualityDebugState(): AvatarRenderQualityDebugState {
    const canvas = this.renderer.domElement
    const cssWidth = canvas.clientWidth || window.innerWidth
    const cssHeight = canvas.clientHeight || window.innerHeight
    const drawingBuffer = computeDrawingBufferSize(cssWidth, cssHeight, this.effectiveDpr)
    return {
      cssWidth,
      cssHeight,
      drawingBufferWidth: drawingBuffer.width,
      drawingBufferHeight: drawingBuffer.height,
      effectiveDpr: this.effectiveDpr,
      outputColorSpace: this.renderer.outputColorSpace,
      toneMapping: this.renderer.toneMapping,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      gpuTextures: this.renderer.info.memory.textures,
      modelTextures: this.quality.getTextureState(),
    }
  }

  start(): void {
    if (this.running || this.disposed) return
    this.running = true
    this.lastTime = performance.now()
    const loop = (): void => {
      if (!this.running || this.disposed) return
      this.rafId = requestAnimationFrame(loop)
      const now = performance.now()
      const delta = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000))
      this.lastTime = now
      const nextDpr = resolveEffectiveDpr(window.devicePixelRatio)
      if (nextDpr !== this.effectiveDpr) this.onResize()
      this.updateHandCamera()
      this.controls.update()
      this.syncLookAtAnchor()
      for (const cb of this.animCallbacks) cb(delta)
      this.renderer.render(this.scene, this.camera)
      if (this.renderQualityLogPending) {
        this.renderQualityLogPending = false
        const quality = this.getRenderQualityDebugState()
        console.log(
          `[RENDERDBG] frame css=${quality.cssWidth}x${quality.cssHeight} buffer=${quality.drawingBufferWidth}x${quality.drawingBufferHeight} dpr=${quality.effectiveDpr} calls=${quality.drawCalls} triangles=${quality.triangles} gpuTextures=${quality.gpuTextures} color=${quality.outputColorSpace} toneMapping=${quality.toneMapping}`,
        )
      }
    }
    loop()
  }

  getLookAtTarget(): THREE.Object3D {
    this.syncLookAtAnchor()
    return this.lookAtAnchor
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.onResize)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.handCameraTarget = null
    this.animCallbacks = []
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
    const nextDpr = resolveEffectiveDpr(window.devicePixelRatio)
    if (nextDpr !== this.effectiveDpr) {
      this.effectiveDpr = nextDpr
      this.renderer.setPixelRatio(this.effectiveDpr)
    }
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // false: update only the drawing buffer, let CSS (100%/100%) own display size
    this.renderer.setSize(w, h, false)
  }

  private applyCameraView(
    position: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    fov: number = avatarStartupTuning.camera.fov,
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
