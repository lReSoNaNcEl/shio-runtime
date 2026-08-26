import type {
  AutonomySettings,
  PersistentGoal,
  RendererWorldContextInput,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { BrowserObservation } from '../../shared/browser-control'
import {
  SYSTEM_CONTEXT_PROBES,
  type SystemContextAdapter,
  type SystemContextObservation,
  type SystemContextProbe,
} from './SystemContextAdapter'

const SYSTEM_POLL_MS = 1_000
const SYSTEM_PROBE_INTERVAL_MS: Readonly<Record<SystemContextProbe, number>> = Object.freeze({
  'foreground-application': 2_000,
  'running-applications': 30_000,
  'system-load': 10_000,
})

interface SystemSourceObservedAt {
  globalIdle: number | null
  foregroundApplication: number | null
  runningApplications: number | null
  systemLoad: number | null
}

export interface WorldContextProviders {
  browser?(): BrowserObservation | null
  project?(): { name?: string; branch?: string } | null
  activeGoal?(): PersistentGoal | null
}

export interface WorldContextRuntimeOptions {
  now?(): number
  pollIntervalMs?: number
  probeIntervals?: Partial<Readonly<Record<SystemContextProbe, number>>>
}

export class WorldContextRuntime {
  private renderer: RendererWorldContextInput | null = null
  private system: SystemContextObservation | null = null
  private readonly systemObservedAt: SystemSourceObservedAt = {
    globalIdle: null,
    foregroundApplication: null,
    runningApplications: null,
    systemLoad: null,
  }
  private schedulerObservedAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private disposed = false

  constructor(
    private readonly adapter?: SystemContextAdapter,
    private readonly providers: WorldContextProviders = {},
    private readonly options: WorldContextRuntimeOptions = {},
  ) {}

  start(): void {
    if (!this.adapter || this.disposed || this.running || this.timer) return
    void this.poll(true)
  }

  async refresh(options: { force?: boolean } = {}): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.poll(options.force ?? true)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      this.adapter?.dispose?.()
    } catch {
      // Adapter failure is contained during application shutdown.
    }
  }

  updateRenderer(input: RendererWorldContextInput): void {
    if (this.renderer && input.observedAt < this.renderer.observedAt) return
    this.renderer = { ...input }
  }

  markSchedulerObserved(at = this.now()): void {
    this.schedulerObservedAt = at
  }

  snapshot(settings: AutonomySettings, now = this.now()): WorldContextSnapshot {
    const globalUserIdleMs = this.system?.globalUserIdleMs ?? this.renderer?.userIdleMs ?? 0
    const browser = this.providers.browser?.() ?? null
    const project = this.providers.project?.() ?? null
    const activeGoal = this.providers.activeGoal?.() ?? null
    const privacy = settings.privacyMode
    const systemSources = Object.freeze({
      globalIdleMs: age(this.systemObservedAt.globalIdle, now),
      foregroundApplicationMs: age(this.systemObservedAt.foregroundApplication, now),
      runningApplicationsMs: age(this.systemObservedAt.runningApplications, now),
      systemLoadMs: age(this.systemObservedAt.systemLoad, now),
    })
    return Object.freeze({
      capturedAt: now,
      appFocused: this.renderer?.appFocused ?? false,
      globalUserIdleMs,
      userIdleMs: globalUserIdleMs,
      conversationActive: this.renderer?.conversationActive ?? false,
      audioActive: this.renderer?.audioActive ?? false,
      privacyMode: privacy,
      lastUserActivityAt: Math.max(
        0,
        (this.systemObservedAt.globalIdle ?? this.renderer?.observedAt ?? now) - globalUserIdleMs,
      ),
      ...(!privacy && this.system?.foregroundApplication
        ? { foregroundApplication: this.system.foregroundApplication }
        : {}),
      ...(!privacy && this.system?.runningApplications
        ? { runningApplications: this.system.runningApplications }
        : {}),
      ...(browser
        ? {
            activeBrowser: privacy
              ? { sessionActive: true }
              : {
                  sessionActive: true,
                  url: browser.url.slice(0, 2_048),
                  title: browser.title?.slice(0, 300),
                },
          }
        : {}),
      ...(!privacy && project ? { activeProject: project } : {}),
      ...(activeGoal
        ? {
            activeGoal: {
              id: activeGoal.id,
              title: activeGoal.title.slice(0, 160),
              state: activeGoal.status,
            },
          }
        : {}),
      ...(!privacy && this.system?.media ? { media: this.system.media } : {}),
      ...(this.system?.system ? { system: this.system.system } : {}),
      systemAdapter: this.system?.status ?? 'unavailable',
      freshness: Object.freeze({
        rendererMs: this.renderer ? Math.max(0, now - this.renderer.observedAt) : null,
        schedulerMs:
          this.schedulerObservedAt === null ? null : Math.max(0, now - this.schedulerObservedAt),
        systemMs: maximumAge(systemSources),
        systemSources,
      }),
    })
  }

  private async poll(force = false): Promise<void> {
    if (!this.adapter || this.disposed || this.running) return
    this.timer = null
    this.running = true
    try {
      const now = this.now()
      const observation = await this.adapter.observe({ probes: this.dueProbes(now, force) })
      this.mergeSystemObservation(observation)
    } catch {
      // Preserve the last bounded observation; failure is exposed through freshness/status.
      if (this.system) this.system = { ...this.system, status: 'degraded' }
    } finally {
      this.running = false
      if (!this.disposed) {
        this.timer = setTimeout(
          () => void this.poll(),
          Math.max(100, this.options.pollIntervalMs ?? SYSTEM_POLL_MS),
        )
        this.timer.unref()
      }
    }
  }

  private dueProbes(now: number, force: boolean): readonly SystemContextProbe[] {
    if (force) return SYSTEM_CONTEXT_PROBES
    return SYSTEM_CONTEXT_PROBES.filter((probe) => {
      const observedAt = probeObservedAt(this.systemObservedAt, probe)
      const interval = Math.max(
        100,
        this.options.probeIntervals?.[probe] ?? SYSTEM_PROBE_INTERVAL_MS[probe],
      )
      return observedAt === null || now - observedAt >= interval
    })
  }

  private mergeSystemObservation(observation: SystemContextObservation): void {
    const sampled = new Set(observation.sampledProbes ?? inferredSampledProbes(observation))
    const previous = this.system
    const foregroundApplication = sampled.has('foreground-application')
      ? observation.foregroundApplication
      : previous?.foregroundApplication
    const runningApplications = sampled.has('running-applications')
      ? observation.runningApplications
      : previous?.runningApplications
    const system = sampled.has('system-load') ? observation.system : previous?.system
    this.systemObservedAt.globalIdle = observation.capturedAt
    if (sampled.has('foreground-application')) {
      this.systemObservedAt.foregroundApplication = observation.capturedAt
    }
    if (sampled.has('running-applications')) {
      this.systemObservedAt.runningApplications = observation.capturedAt
    }
    if (sampled.has('system-load')) this.systemObservedAt.systemLoad = observation.capturedAt
    this.system = {
      capturedAt: observation.capturedAt,
      globalUserIdleMs: observation.globalUserIdleMs,
      sampledProbes: Object.freeze([...sampled]),
      ...(foregroundApplication ? { foregroundApplication } : {}),
      ...(runningApplications ? { runningApplications } : {}),
      ...((observation.media ?? previous?.media)
        ? { media: observation.media ?? previous?.media }
        : {}),
      ...(system ? { system } : {}),
      status: observation.status,
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

function inferredSampledProbes(
  observation: SystemContextObservation,
): readonly SystemContextProbe[] {
  return SYSTEM_CONTEXT_PROBES.filter((probe) => {
    if (probe === 'foreground-application') return 'foregroundApplication' in observation
    if (probe === 'running-applications') return 'runningApplications' in observation
    return 'system' in observation
  })
}

function probeObservedAt(
  observedAt: SystemSourceObservedAt,
  probe: SystemContextProbe,
): number | null {
  if (probe === 'foreground-application') return observedAt.foregroundApplication
  if (probe === 'running-applications') return observedAt.runningApplications
  return observedAt.systemLoad
}

function age(observedAt: number | null, now: number): number | null {
  return observedAt === null ? null : Math.max(0, now - observedAt)
}

function maximumAge(sources: WorldContextSnapshot['freshness']['systemSources']): number | null {
  if (!sources) return null
  const ages = Object.values(sources).filter((value): value is number => value !== null)
  return ages.length > 0 ? Math.max(...ages) : null
}
