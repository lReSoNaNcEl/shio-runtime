export class TestClock {
  readonly #initialNow: number
  #now: number

  constructor(initialNow = 0) {
    this.#initialNow = initialNow
    this.#now = initialNow
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError('TestClock can only advance by a finite non-negative duration')
    }
    this.#now += milliseconds
  }

  now = (): number => this.#now

  reset(): void {
    this.#now = this.#initialNow
  }
}
