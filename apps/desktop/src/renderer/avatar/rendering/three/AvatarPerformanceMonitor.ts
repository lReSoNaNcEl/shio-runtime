import * as THREE from 'three'

import type { VrmPerformanceDebugState } from './VrmModel'

export class AvatarPerformanceMonitor {
  private avatarFps = 0

  updatePerformanceDebug(delta: number): void {
    if (delta <= 0) return
    const instant = 1 / delta
    this.avatarFps =
      this.avatarFps <= 0 ? instant : THREE.MathUtils.lerp(this.avatarFps, instant, 0.08)
  }

  getPerformanceDebugState(): VrmPerformanceDebugState {
    return {
      avatarFps: Number(this.avatarFps.toFixed(1)),
    }
  }
}
