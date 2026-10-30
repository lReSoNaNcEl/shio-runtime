export const SYSTEM_CONTEXT_PROBES = [
  'foreground-application',
  'running-applications',
  'system-load',
] as const

export type SystemContextProbe = (typeof SYSTEM_CONTEXT_PROBES)[number]

export interface SystemContextObservationRequest {
  probes: readonly SystemContextProbe[]
}

export interface SystemContextObservation {
  capturedAt: number
  globalUserIdleMs: number
  /** Probes completed in this observation. Omitted by legacy/test adapters. */
  sampledProbes?: readonly SystemContextProbe[]
  foregroundApplication?: {
    processName: string
    displayName?: string
    windowTitle?: string
  }
  runningApplications?: readonly {
    processName: string
    displayName?: string
  }[]
  media?: {
    playing: boolean
    title?: string
    application?: string
  }
  system?: {
    cpuLoad?: number
    memoryLoad?: number
    gpuLoad?: number
  }
  status: 'available' | 'degraded'
}

export interface SystemContextAdapter {
  observe(request?: SystemContextObservationRequest): Promise<SystemContextObservation>
  dispose?(): void
}
