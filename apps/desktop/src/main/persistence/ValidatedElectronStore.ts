import { existsSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'

import ElectronStore from 'electron-store'
import type { z } from 'zod'

interface ValidatedElectronStoreOptions {
  clearMalformedJson?: boolean
}

type ElectronStoreConstructor = typeof ElectronStore

/**
 * electron-vite externalizes production dependencies into CommonJS require calls.
 * electron-store is ESM-only, so Node exposes its constructor below `.default`
 * in the built Main process while Vitest's ESM loader exposes it directly.
 */
export function resolveElectronStoreConstructor(module: unknown): ElectronStoreConstructor {
  const candidate =
    module && typeof module === 'object' && 'default' in module
      ? (module as { default: unknown }).default
      : module
  if (typeof candidate !== 'function') throw new TypeError('ElectronStore constructor unavailable')
  return candidate as ElectronStoreConstructor
}

const ElectronStoreRuntime = resolveElectronStoreConstructor(ElectronStore)

/**
 * Exact-path JSON persistence backed by electron-store's atomic writer, with
 * Shio-owned Zod validation and migrations kept outside the storage package.
 */
export class ValidatedElectronStore<T extends object> {
  private storeInstance: ElectronStore<Record<string, unknown>> | null = null

  constructor(
    private readonly filePath: string,
    private readonly schema: z.ZodType<T>,
    private readonly options: ValidatedElectronStoreOptions = {},
  ) {}

  read(): T | null {
    if (!existsSync(this.filePath)) return null
    const store = this.store()
    return this.schema.parse(store.store)
  }

  write(value: T): T {
    const validated = this.schema.parse(value)
    this.store().store = validated as Record<string, unknown>
    return validated
  }

  path(): string {
    return this.filePath
  }

  close(): void {
    this.storeInstance?._closeWatcher()
    this.storeInstance = null
  }

  private store(): ElectronStore<Record<string, unknown>> {
    if (this.storeInstance) return this.storeInstance
    const extension = extname(this.filePath)
    const fileExtension = extension ? extension.slice(1) : 'json'
    this.storeInstance = new ElectronStoreRuntime<Record<string, unknown>>({
      cwd: dirname(this.filePath),
      name: basename(this.filePath, extension),
      fileExtension,
      accessPropertiesByDotNotation: false,
      clearInvalidConfig: this.options.clearMalformedJson ?? false,
      serialize: (value) => JSON.stringify(value, null, 2),
    })
    if (this.storeInstance.path !== this.filePath) {
      throw new Error(`electron-store path mismatch: ${this.storeInstance.path}`)
    }
    return this.storeInstance
  }
}
