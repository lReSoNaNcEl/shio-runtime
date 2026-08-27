export type BrowserHeldInputOwner = 'playwright' | 'cdp'

interface HeldInput {
  release(): Promise<void>
  timeout?: ReturnType<typeof setTimeout>
}

export interface BrowserHeldInputSnapshot {
  keys: readonly string[]
  buttons: readonly ('left' | 'right')[]
}

/** Sole state owner for input that may outlive one atomic Playwright or CDP call. */
export class BrowserHeldInputRegistry {
  private readonly keys = new Map<string, HeldInput>()
  private readonly buttons = new Map<string, HeldInput>()

  holdKey(
    owner: BrowserHeldInputOwner,
    key: string,
    release: () => Promise<void>,
    maximumHoldMs?: number,
  ): void {
    this.hold(this.keys, entryId(owner, key), release, maximumHoldMs)
  }

  holdButton(
    owner: BrowserHeldInputOwner,
    button: 'left' | 'right',
    release: () => Promise<void>,
    maximumHoldMs?: number,
  ): void {
    this.hold(this.buttons, entryId(owner, button), release, maximumHoldMs)
  }

  async releaseKey(owner: BrowserHeldInputOwner, key: string): Promise<boolean> {
    return this.releaseEntry(this.keys, entryId(owner, key))
  }

  async releaseButton(owner: BrowserHeldInputOwner, button: 'left' | 'right'): Promise<boolean> {
    return this.releaseEntry(this.buttons, entryId(owner, button))
  }

  async releaseOwner(owner: BrowserHeldInputOwner): Promise<void> {
    const prefix = `${owner}\u0000`
    const releases = [
      ...this.takeMatching(this.keys, prefix),
      ...this.takeMatching(this.buttons, prefix),
    ]
    await Promise.allSettled(releases.map((entry) => entry.release()))
  }

  async releaseAll(): Promise<void> {
    const releases = [...this.keys.values(), ...this.buttons.values()]
    this.keys.clear()
    this.buttons.clear()
    for (const entry of releases) if (entry.timeout) clearTimeout(entry.timeout)
    await Promise.allSettled(releases.map((entry) => entry.release()))
  }

  resetOwner(owner: BrowserHeldInputOwner): void {
    const prefix = `${owner}\u0000`
    this.takeMatching(this.keys, prefix)
    this.takeMatching(this.buttons, prefix)
  }

  reset(): void {
    for (const entry of [...this.keys.values(), ...this.buttons.values()]) {
      if (entry.timeout) clearTimeout(entry.timeout)
    }
    this.keys.clear()
    this.buttons.clear()
  }

  snapshot(): BrowserHeldInputSnapshot {
    return Object.freeze({
      keys: Object.freeze([...this.keys.keys()].map(entryValue)),
      buttons: Object.freeze([...this.buttons.keys()].map(entryValue) as ('left' | 'right')[]),
    })
  }

  isKeyHeld(owner: BrowserHeldInputOwner, key: string): boolean {
    return this.keys.has(entryId(owner, key))
  }

  isButtonHeld(owner: BrowserHeldInputOwner, button: 'left' | 'right'): boolean {
    return this.buttons.has(entryId(owner, button))
  }

  private hold(
    entries: Map<string, HeldInput>,
    id: string,
    release: () => Promise<void>,
    maximumHoldMs?: number,
  ): void {
    const previous = entries.get(id)
    if (previous?.timeout) clearTimeout(previous.timeout)
    const entry: HeldInput = { release }
    if (maximumHoldMs !== undefined) {
      entry.timeout = setTimeout(() => {
        void this.releaseEntry(entries, id).catch(() => undefined)
      }, maximumHoldMs)
    }
    entries.set(id, entry)
  }

  private async releaseEntry(entries: Map<string, HeldInput>, id: string): Promise<boolean> {
    const entry = entries.get(id)
    entries.delete(id)
    if (entry?.timeout) clearTimeout(entry.timeout)
    await entry?.release()
    return Boolean(entry)
  }

  private takeMatching(entries: Map<string, HeldInput>, prefix: string): HeldInput[] {
    const selected: HeldInput[] = []
    for (const [id, entry] of entries) {
      if (!id.startsWith(prefix)) continue
      entries.delete(id)
      if (entry.timeout) clearTimeout(entry.timeout)
      selected.push(entry)
    }
    return selected
  }
}

function entryId(owner: BrowserHeldInputOwner, value: string): string {
  return `${owner}\u0000${value}`
}

function entryValue(id: string): string {
  return id.slice(id.indexOf('\u0000') + 1)
}
