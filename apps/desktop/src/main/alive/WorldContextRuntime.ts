import type {
  AutonomySettings,
  RendererWorldContextInput,
  RunningApplication,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { BrowserObservation } from '../../shared/browser-control'
import type {
  SystemContextAdapter,
  SystemContextObservation,
  SystemContextProbe,
} from './SystemContextAdapter'

const SYSTEM_POLL_MS = 1_000
const FOREGROUND_POLL_MS = 2_000

export interface WorldContextProviders {
  browser?(): BrowserObservation | null
  project?(): { name?: string; branch?: string } | null
}

export interface WorldContextRuntimeOptions {
  now?(): number
  pollIntervalMs?: number
}

export class WorldContextRuntime {
  private renderer: RendererWorldContextInput | null = null
  private system: SystemContextObservation | null = null
  private lastForegroundAt: number | null = null
  private applicationsRequest: Promise<readonly RunningApplication[] | null> | null = null
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

  listRunningApplications(): Promise<readonly RunningApplication[] | null> {
    if (!this.adapter || this.disposed) return Promise.resolve(null)
    this.applicationsRequest ??= this.adapter
      .observe({ probes: ['running-applications'] })
      .then(
        (observation) => (this.disposed ? null : (observation.runningApplications ?? null)),
        () => null,
      )
      .finally(() => {
        this.applicationsRequest = null
      })
    return this.applicationsRequest
  }

  updateRenderer(input: RendererWorldContextInput): void {
    if (this.renderer && input.observedAt < this.renderer.observedAt) return
    this.renderer = { ...input }
  }

  snapshot(settings: AutonomySettings, now = this.now()): WorldContextSnapshot {
    const globalUserIdleMs = this.system?.globalUserIdleMs ?? this.renderer?.userIdleMs ?? 0
    const browser = this.providers.browser?.() ?? null
    const project = this.providers.project?.() ?? null
    const privacy = settings.privacyMode
    const systemSources = Object.freeze({
      globalIdleMs: age(this.system?.capturedAt ?? null, now),
      foregroundApplicationMs: age(this.lastForegroundAt, now),
    })
    return Object.freeze({
      capturedAt: now,
      appFocused: this.renderer?.appFocused ?? false,
      globalUserIdleMs,
      conversationActive: this.renderer?.conversationActive ?? false,
      audioActive: this.renderer?.audioActive ?? false,
      privacyMode: privacy,
      lastUserActivityAt: Math.max(
        0,
        (this.system?.capturedAt ?? this.renderer?.observedAt ?? now) - globalUserIdleMs,
      ),
      ...(!privacy && this.system?.foregroundApplication
        ? { foregroundApplication: this.system.foregroundApplication }
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
      ...(!privacy && this.system?.media ? { media: this.system.media } : {}),
      systemAdapter: this.system?.status ?? 'unavailable',
      freshness: Object.freeze({
        rendererMs: this.renderer ? Math.max(0, now - this.renderer.observedAt) : null,
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
      if (!this.disposed) this.mergeSystemObservation(observation)
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
    return force ||
      this.lastForegroundAt === null ||
      now - this.lastForegroundAt >= FOREGROUND_POLL_MS
      ? ['foreground-application']
      : []
  }

  private mergeSystemObservation(observation: SystemContextObservation): void {
    const foregroundSampled =
      observation.sampledProbes?.includes('foreground-application') ??
      'foregroundApplication' in observation
    if (foregroundSampled) this.lastForegroundAt = observation.capturedAt
    this.system = {
      capturedAt: observation.capturedAt,
      globalUserIdleMs: observation.globalUserIdleMs,
      foregroundApplication: foregroundSampled
        ? observation.foregroundApplication
        : this.system?.foregroundApplication,
      media: observation.media ?? this.system?.media,
      status: observation.status,
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

function age(observedAt: number | null, now: number): number | null {
  return observedAt === null ? null : Math.max(0, now - observedAt)
}

function maximumAge(sources: WorldContextSnapshot['freshness']['systemSources']): number | null {
  if (!sources) return null
  const ages = Object.values(sources).filter((value): value is number => value !== null)
  return ages.length > 0 ? Math.max(...ages) : null
}
