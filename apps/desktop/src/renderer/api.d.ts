import type { OverlayPresentationApi, ShioRuntimeApi } from '../shared/ipc'

declare global {
  interface Window {
    api: ShioRuntimeApi
    overlayApi: OverlayPresentationApi
  }
}
