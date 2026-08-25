import type { AliveRuntimeHealth, AutonomyMode } from '../alive'
import type { LlmProviderId } from '../llm'
import type { RuntimePluginHealth } from '../plugins'
import type { AvatarRuntimeHealth } from '../runtime'

export type RendererProcessStatus =
  | 'not-created'
  | 'loading'
  | 'ready'
  | 'failed-to-load'
  | 'render-process-gone'
  | 'closed'

export interface RendererProcessFailure {
  kind: 'load' | 'process'
  code: number
  reason: string
  description: string
}

export interface RendererProcessHealth {
  status: RendererProcessStatus
  updatedAt: string
  recoveryAttempts: number
  lastFailure: RendererProcessFailure | null
}

export interface ReleaseInfo {
  version: string
  platform: string
  arch: string
  electronVersion: string
  nodeVersion: string
  isPackaged: boolean
}

export interface RuntimeSupportBundle {
  release: ReleaseInfo
  speech: {
    capabilities: {
      serviceReachable: boolean
      recognition: boolean
      synthesis: boolean
      streaming: boolean
    }
    error?: string
  }
  llm: {
    provider: LlmProviderId
    model: string
    credentialConfigured: Record<LlmProviderId, boolean>
  }
  /** Enabled Plugins only; disabled optional capabilities are intentionally absent. */
  plugins: readonly RuntimePluginHealth[]
  avatarRuntime: {
    /** False when the renderer is not ready, so a previously reported snapshot is stale. */
    reportFresh: boolean
    health: AvatarRuntimeHealth | null
  }
  aliveRuntime: {
    mode: AutonomyMode
    globallySuspended: boolean
    health: AliveRuntimeHealth
  }
  renderers: {
    main: RendererProcessHealth
    overlay: RendererProcessHealth
  }
  microphoneConfigured: boolean
  overlayVisible: boolean
  latestRuntimeErrors: ReadonlyArray<{ timestamp: string; message: string }>
  paths: {
    userData: string
    logs: string
  }
}
