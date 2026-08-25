export interface SystemContextObservation {
  capturedAt: number
  globalUserIdleMs: number
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
  observe(): Promise<SystemContextObservation>
}

export class UnavailableSystemContextAdapter implements SystemContextAdapter {
  async observe(): Promise<SystemContextObservation> {
    return {
      capturedAt: Date.now(),
      globalUserIdleMs: 0,
      status: 'degraded',
    }
  }
}
