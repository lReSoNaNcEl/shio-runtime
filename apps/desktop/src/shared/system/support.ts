import type { LlmProviderId } from '../llm'
import type { ProjectAwarenessStatus } from '../project-awareness'

export interface ReleaseInfo {
  version: string
  platform: string
  arch: string
  electronVersion: string
  nodeVersion: string
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
  projectAwareness: ProjectAwarenessStatus
  vrmLoaded: boolean
  microphoneConfigured: boolean
  overlayVisible: boolean
  latestRuntimeErrors: ReadonlyArray<{ timestamp: string; message: string }>
  paths: {
    userData: string
    logs: string
  }
}
