export class TestEventCollector<T> {
  readonly #events: T[] = []

  add = (event: T): void => {
    this.#events.push(event)
  }

  all(): readonly T[] {
    return this.#events
  }

  clear(): void {
    this.#events.length = 0
  }

  last(): T | undefined {
    return this.#events.at(-1)
  }
}
