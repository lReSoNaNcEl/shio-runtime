import type { ShioRuntimeApi } from '../shared/ipc'

declare global {
  interface Window {
    api: ShioRuntimeApi
  }
}
