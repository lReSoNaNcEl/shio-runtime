import type { AvatarStateEffect } from './AvatarStateMachine'

interface ScheduledGesture {
  gesture: string
}

export class AvatarGestureScheduler {
  private currentGesture = 'none'

  schedule(effect: AvatarStateEffect): ScheduledGesture {
    this.currentGesture = `${effect.mode}:${effect.behaviorId}`
    return { gesture: this.currentGesture }
  }

  reset(): void {
    this.currentGesture = 'none'
  }

  getDebugState(): { currentGesture: string } {
    return { currentGesture: this.currentGesture }
  }
}
