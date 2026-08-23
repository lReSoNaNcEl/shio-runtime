import type { RendererProcessHealth, RendererProcessStatus } from '../../shared/system'

export class RendererProcessHealthTracker {
  private health: RendererProcessHealth

  constructor(private readonly now: () => Date = () => new Date()) {
    this.health = this.initialHealth()
  }

  reset(): void {
    this.health = this.initialHealth()
  }

  markLoading(): void {
    this.update('loading')
  }

  markReady(): void {
    this.update('ready')
  }

  markClosed(): void {
    this.update('closed')
  }

  markLoadFailure(code: number, description: string, reason = 'load-failed'): void {
    this.update('failed-to-load', {
      kind: 'load',
      code,
      reason: reason.slice(0, 100),
      description: description.slice(0, 500),
    })
  }

  markProcessGone(reason: string, exitCode: number): void {
    this.update('render-process-gone', {
      kind: 'process',
      code: exitCode,
      reason: reason.slice(0, 100),
      description: 'Renderer process terminated',
    })
  }

  claimRecovery(): boolean {
    if (this.health.recoveryAttempts >= 1) return false
    this.health = {
      ...this.health,
      recoveryAttempts: this.health.recoveryAttempts + 1,
      updatedAt: this.now().toISOString(),
    }
    return true
  }

  getSnapshot(): RendererProcessHealth {
    return {
      ...this.health,
      lastFailure: this.health.lastFailure && { ...this.health.lastFailure },
    }
  }

  private initialHealth(): RendererProcessHealth {
    return {
      status: 'not-created',
      updatedAt: this.now().toISOString(),
      recoveryAttempts: 0,
      lastFailure: null,
    }
  }

  private update(status: RendererProcessStatus, lastFailure = this.health.lastFailure): void {
    this.health = {
      ...this.health,
      status,
      updatedAt: this.now().toISOString(),
      lastFailure,
    }
  }
}
