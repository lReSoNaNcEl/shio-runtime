import type {
  AutonomySettings,
  RendererWorldContextInput,
  WorldContextSnapshot,
} from '../../shared/alive'

export class WorldContextRuntime {
  private renderer: RendererWorldContextInput | null = null
  private schedulerObservedAt: number | null = null

  updateRenderer(input: RendererWorldContextInput): void {
    if (this.renderer && input.observedAt < this.renderer.observedAt) return
    this.renderer = { ...input }
  }

  markSchedulerObserved(at = Date.now()): void {
    this.schedulerObservedAt = at
  }

  snapshot(settings: AutonomySettings, now = Date.now()): WorldContextSnapshot {
    return Object.freeze({
      capturedAt: now,
      appFocused: this.renderer?.appFocused ?? false,
      userIdleMs: this.renderer?.userIdleMs ?? 0,
      conversationActive: this.renderer?.conversationActive ?? false,
      audioActive: this.renderer?.audioActive ?? false,
      privacyMode: settings.privacyMode,
      lastUserActivityAt: this.renderer
        ? Math.max(0, this.renderer.observedAt - this.renderer.userIdleMs)
        : now,
      freshness: Object.freeze({
        rendererMs: this.renderer ? Math.max(0, now - this.renderer.observedAt) : null,
        schedulerMs:
          this.schedulerObservedAt === null ? null : Math.max(0, now - this.schedulerObservedAt),
      }),
    })
  }
}
