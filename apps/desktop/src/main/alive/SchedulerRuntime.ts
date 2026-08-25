const DEFAULT_TICK_MS = 10_000

export class SchedulerRuntime {
  private timer: ReturnType<typeof setTimeout> | null = null
  private observedAt: number | null = null
  private running = false
  private disposed = false

  constructor(private readonly tickMs = DEFAULT_TICK_MS) {}

  start(onTick: (now: number) => Promise<void>): void {
    if (this.timer || this.running) return
    this.disposed = false
    const run = async (): Promise<void> => {
      this.timer = null
      this.running = true
      const now = Date.now()
      this.observedAt = now
      await this.runTick(onTick, now)
      this.running = false
      if (this.disposed) return
      this.timer = setTimeout(() => {
        void run()
      }, this.tickMs)
      this.timer.unref()
    }
    void run()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  isRunning(): boolean {
    return this.running || this.timer !== null
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
