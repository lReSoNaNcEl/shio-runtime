import type { OverlayViewMode } from '../../tuning/cameraTuning'
import type { GazeTarget } from './AvatarModel'

/** Presentation viewport; S22 owns rendering and model resources. */
export class SceneManager {
  private target: GazeTarget = { x: 0, y: 0 }
  private readonly pointer = (event: PointerEvent): void => {
    const bounds = this.canvas.getBoundingClientRect()
    this.target.x = Math.max(
      -1,
      Math.min(1, ((event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5) * 2),
    )
    this.target.y = Math.max(
      -1,
      Math.min(1, ((event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5) * 2),
    )
  }
  private readonly leave = (): void => {
    this.target.x = this.target.y = 0
  }
  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly view: (mode: string, scale: number) => void,
  ) {
    canvas.addEventListener('pointermove', this.pointer)
    canvas.addEventListener('pointerleave', this.leave)
  }
  resetCamera(): void {
    this.view('full', 1)
  }
  frameLoadedModel(): void {
    this.view('full', 1)
  }
  setOverlayCameraPreset(mode: OverlayViewMode, scale = 1): void {
    this.canvas.style.transform = `scale(${Math.max(0.5, Math.min(2, scale))})`
    this.view(mode, scale)
  }
  setTransparentBackground(transparent: boolean): void {
    this.canvas.style.background = transparent ? 'transparent' : 'var(--app-bg)'
  }
  getLookAtTarget(): GazeTarget {
    return this.target
  }
  dispose(): void {
    this.canvas.removeEventListener('pointermove', this.pointer)
    this.canvas.removeEventListener('pointerleave', this.leave)
  }
}
