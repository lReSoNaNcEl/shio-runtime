const DEFAULT_TICK_MS = 10_000

export class SchedulerRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private observedAt: number | null = null

  constructor(private readonly tickMs = DEFAULT_TICK_MS) {}

  start(onTick: (now: number) => Promise<void>): void {
    if (this.timer) return
    const run = (): void => {
      const now = Date.now()
      this.observedAt = now
      void this.runTick(onTick, now)
    }
    this.timer = setInterval(run, this.tickMs)
    this.timer.unref()
    run()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  lastTickAt(): number | null {
    return this.observedAt
  }

  private async runTick(onTick: (now: number) => Promise<void>, now: number): Promise<void> {
    try {
      await onTick(now)
    } catch {
      // The composed runtime records the bounded failure in Runtime Health.
    }
  }
}
