import {
  SYSTEM_CONTEXT_PROBES,
  type SystemContextAdapter,
  type SystemContextObservation,
  type SystemContextObservationRequest,
  type SystemContextProbe,
} from './SystemContextAdapter'
import {
  WindowsSystemContextWorker,
  type WindowsSystemContextWorkerClient,
} from './WindowsSystemContextWorker'

const MAX_RUNNING_APPLICATIONS = 20
const WORKER_RETRY_BASE_MS = 5_000
const WORKER_RETRY_MAX_MS = 60_000

interface WindowsObservationPayload {
  foregroundApplication?: {
    processName?: unknown
    displayName?: unknown
    windowTitle?: unknown
  } | null
  runningApplications?: readonly {
    processName?: unknown
    displayName?: unknown
  }[]
  system?: { cpuLoad?: unknown; memoryLoad?: unknown }
}

export interface WindowsSystemContextAdapterOptions {
  getGlobalIdleSeconds(): number
  pwshPath: string
  now?(): number
  worker?: WindowsSystemContextWorkerClient
}

export class WindowsSystemContextAdapter implements SystemContextAdapter {
  private readonly worker: WindowsSystemContextWorkerClient
  private workerStatus: SystemContextObservation['status'] = 'degraded'
  private consecutiveFailures = 0
  private retryAfter = 0
  private disposed = false

  constructor(private readonly options: WindowsSystemContextAdapterOptions) {
    this.worker = options.worker ?? new WindowsSystemContextWorker(options.pwshPath)
  }

  async observe(
    request: SystemContextObservationRequest = { probes: SYSTEM_CONTEXT_PROBES },
  ): Promise<SystemContextObservation> {
    const now = this.options.now?.() ?? Date.now()
    const probes = uniqueProbes(request.probes)
    let payload: WindowsObservationPayload = {}
    let sampledProbes: readonly SystemContextProbe[] = Object.freeze([])
    if (!this.disposed && probes.length > 0 && now >= this.retryAfter) {
      try {
        payload = parsePayload(await this.worker.request(probes))
        sampledProbes = Object.freeze(probes)
        this.workerStatus = 'available'
        this.consecutiveFailures = 0
        this.retryAfter = 0
      } catch {
        this.workerStatus = 'degraded'
        this.consecutiveFailures += 1
        this.retryAfter = now + retryDelay(this.consecutiveFailures)
      }
    }
    const capturedAt = this.options.now?.() ?? Date.now()
    const idle = globalIdle(this.options.getGlobalIdleSeconds)
    const status = idle.available ? this.workerStatus : 'degraded'
    return {
      capturedAt,
      globalUserIdleMs: idle.milliseconds,
      sampledProbes,
      ...(sampledProbes.includes('foreground-application')
        ? { foregroundApplication: foreground(payload.foregroundApplication) }
        : {}),
      ...(sampledProbes.includes('running-applications')
        ? { runningApplications: runningApplications(payload.runningApplications) }
        : {}),
      ...(sampledProbes.includes('system-load') ? { system: systemLoad(payload.system) } : {}),
      status,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.dispose()
  }
}

function uniqueProbes(probes: readonly SystemContextProbe[]): SystemContextProbe[] {
  const requested = new Set(probes)
  return SYSTEM_CONTEXT_PROBES.filter((probe) => requested.has(probe))
}

function parsePayload(value: unknown): WindowsObservationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SYSTEM_CONTEXT_WORKER_INVALID_PAYLOAD')
  }
  return value as WindowsObservationPayload
}

function globalIdle(getGlobalIdleSeconds: () => number): {
  milliseconds: number
  available: boolean
} {
  try {
    const seconds = getGlobalIdleSeconds()
    if (!Number.isFinite(seconds)) throw new Error('SYSTEM_CONTEXT_IDLE_INVALID')
    return { milliseconds: Math.max(0, Math.round(seconds * 1_000)), available: true }
  } catch {
    return { milliseconds: 0, available: false }
  }
}

function foreground(
  value: WindowsObservationPayload['foregroundApplication'],
): SystemContextObservation['foregroundApplication'] {
  const processName = boundedString(value?.processName, 120)
  if (!processName) return undefined
  const displayName = boundedString(value?.displayName, 160)
  const windowTitle = boundedString(value?.windowTitle, 300)
  return {
    processName,
    ...(displayName ? { displayName } : {}),
    ...(windowTitle ? { windowTitle } : {}),
  }
}

function runningApplications(
  value: WindowsObservationPayload['runningApplications'],
): NonNullable<SystemContextObservation['runningApplications']> {
  return Object.freeze(
    (Array.isArray(value) ? value : [])
      .flatMap((application) => {
        const processName = boundedString(application.processName, 120)
        if (!processName) return []
        const displayName = boundedString(application.displayName, 160)
        return [{ processName, ...(displayName ? { displayName } : {}) }]
      })
      .slice(0, MAX_RUNNING_APPLICATIONS),
  )
}

function systemLoad(
  value: WindowsObservationPayload['system'],
): NonNullable<SystemContextObservation['system']> {
  return {
    cpuLoad: boundedLoad(value?.cpuLoad),
    memoryLoad: boundedLoad(value?.memoryLoad),
  }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : undefined
}

function boundedLoad(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : undefined
}

function retryDelay(consecutiveFailures: number): number {
  return Math.min(WORKER_RETRY_MAX_MS, WORKER_RETRY_BASE_MS * 2 ** (consecutiveFailures - 1))
}
