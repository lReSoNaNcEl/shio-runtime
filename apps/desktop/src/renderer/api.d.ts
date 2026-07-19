import type { ShioRuntimeApi } from '../shared/ipc/api'

declare global {
  interface Window {
    api: ShioRuntimeApi
  }
}
