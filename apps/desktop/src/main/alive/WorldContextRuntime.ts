import type {
  AutonomySettings,
  PersistentGoal,
  RendererWorldContextInput,
  WorldContextSnapshot,
} from '../../shared/alive'
import type { BrowserObservation } from '../../shared/desktop-control'
import type { SystemContextAdapter, SystemContextObservation } from './SystemContextAdapter'

const SYSTEM_POLL_MS = 5_000

export interface WorldContextProviders {
  browser?(): BrowserObservation | null
  project?(): { name?: string; branch?: string } | null
  activeGoal?(): PersistentGoal | null
}

export class WorldContextRuntime {
  private renderer: RendererWorldContextInput | null = null
  private system: SystemContextObservation | null = null
  private schedulerObservedAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private disposed = false

  constructor(
    private readonly adapter?: SystemContextAdapter,
    private readonly providers: WorldContextProviders = {},
  ) {}

  start(): void {
    if (!this.adapter || this.running || this.timer) return
    this.disposed = false
    void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.poll()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  updateRenderer(input: RendererWorldContextInput): void {
    if (this.renderer && input.observedAt < this.renderer.observedAt) return
    this.renderer = { ...input }
  }

  markSchedulerObserved(at = Date.now()): void {
    this.schedulerObservedAt = at
  }

  snapshot(settings: AutonomySettings, now = Date.now()): WorldContextSnapshot {
    const globalUserIdleMs = this.system?.globalUserIdleMs ?? this.renderer?.userIdleMs ?? 0
    const browser = this.providers.browser?.() ?? null
    const project = this.providers.project?.() ?? null
    const activeGoal = this.providers.activeGoal?.() ?? null
    const privacy = settings.privacyMode
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
        (this.system?.capturedAt ?? this.renderer?.observedAt ?? now) - globalUserIdleMs,
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
        systemMs: this.system ? Math.max(0, now - this.system.capturedAt) : null,
      }),
    })
  }

  private async poll(): Promise<void> {
    if (!this.adapter || this.disposed || this.running) return
    this.timer = null
    this.running = true
    try {
      this.system = await this.adapter.observe()
    } catch {
      // Preserve the last bounded observation; failure is exposed through freshness/status.
      if (this.system) this.system = { ...this.system, status: 'degraded' }
    } finally {
      this.running = false
      if (!this.disposed) {
        this.timer = setTimeout(() => void this.poll(), SYSTEM_POLL_MS)
        this.timer.unref()
      }
    }
  }
}
