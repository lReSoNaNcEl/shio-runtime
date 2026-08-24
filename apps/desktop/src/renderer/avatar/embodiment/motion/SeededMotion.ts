const FIXED_STEP_SECONDS = 1 / 120

export class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0 || 1
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0
    return this.state / 4294967296
  }

  range(min: number, max: number): number {
    return min + this.next() * Math.max(0, max - min)
  }

  signed(amplitude: number): number {
    return (this.next() * 2 - 1) * Math.max(0, amplitude)
  }
}

export interface BoundedRandomMotionChannelOptions {
  amplitude: number
  intervalSeconds: { min: number; max: number }
  stiffness: number
  damping: number
}

/**
 * A bounded, damped random-target channel. Updates use a fixed internal step
 * so 30/60/120 FPS runs stay in the same behavioral envelope.
 */
export class BoundedRandomMotionChannel {
  private value = 0
  private velocity = 0
  private target = 0
  private secondsUntilTarget = 0

  constructor(
    private readonly random: SeededRandom,
    private options: BoundedRandomMotionChannelOptions,
  ) {}

  configure(options: Partial<BoundedRandomMotionChannelOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      intervalSeconds: options.intervalSeconds ?? this.options.intervalSeconds,
    }
    this.clampState()
  }

  update(delta: number): number {
    let remaining = Math.max(0, delta)
    while (remaining > 0) {
      const step = Math.min(FIXED_STEP_SECONDS, remaining)
      this.step(step)
      remaining -= step
    }
    return this.value
  }

  reset(): void {
    this.value = 0
    this.velocity = 0
    this.target = 0
    this.secondsUntilTarget = 0
  }

  getValue(): number {
    return this.value
  }

  getLimit(): number {
    return Math.max(0, this.options.amplitude)
  }

  private step(delta: number): void {
    this.secondsUntilTarget -= delta
    if (this.secondsUntilTarget <= 0) {
      this.target = this.random.signed(this.options.amplitude)
      this.secondsUntilTarget = this.random.range(
        this.options.intervalSeconds.min,
        this.options.intervalSeconds.max,
      )
    }

    const acceleration =
      (this.target - this.value) * this.options.stiffness - this.velocity * this.options.damping
    this.velocity += acceleration * delta
    this.value += this.velocity * delta
    this.clampState()
  }

  private clampState(): void {
    const limit = Math.max(0, this.options.amplitude)
    this.value = Math.max(-limit, Math.min(limit, this.value))
    this.target = Math.max(-limit, Math.min(limit, this.target))
    if (this.value === -limit || this.value === limit) this.velocity *= 0.35
  }
}

export function smoothUnit(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}
