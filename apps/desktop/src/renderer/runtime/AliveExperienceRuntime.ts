import type { AliveSnapshot, BehaviorCommand, ExperienceEvent } from '../../shared/alive'
import type { ControllerState } from '../controller/contracts'
import { observeRendererPromise } from '../reliability/observePromise'
import type { ConversationPresentationPort } from './ConversationPresentationPort'

const WORLD_HEARTBEAT_MS = 5_000
const SILENCE_THRESHOLD_MS = 60_000

interface AliveExperienceRuntimeDeps {
  getControllerState: () => ControllerState
  updateSnapshot: (snapshot: AliveSnapshot) => void
  pushInitiative: (title: string) => void
  runBrowserInitiative: (topic: string) => Promise<void>
  presentation: ConversationPresentationPort
  recordEvent: (label: string, detail?: string) => void
}

/** Renderer observation adapter; it sends typed activity metadata, never raw content. */
export class AliveExperienceRuntime {
  private lastUserActivityAt = Date.now()
  private silenceReportedAt = 0
  private heartbeat: number | null = null
  private unsubscribeChanged: (() => void) | null = null
  private unsubscribeBehavior: (() => void) | null = null
  private started = false

  constructor(private readonly deps: AliveExperienceRuntimeDeps) {}

  start(): void {
    if (this.started) return
    this.started = true
    const observeActivity = (): void => {
      this.lastUserActivityAt = Date.now()
    }
    window.addEventListener('pointerdown', observeActivity, { passive: true })
    window.addEventListener('keydown', observeActivity)
    window.addEventListener('focus', observeActivity)
    this.removeActivityListeners = () => {
      window.removeEventListener('pointerdown', observeActivity)
      window.removeEventListener('keydown', observeActivity)
      window.removeEventListener('focus', observeActivity)
    }
    this.unsubscribeChanged = window.api.alive.onChanged(this.deps.updateSnapshot)
    this.unsubscribeBehavior = window.api.alive.onBehavior((command) => this.applyBehavior(command))
    observeRendererPromise(
      window.api.alive.snapshot().then(this.deps.updateSnapshot),
      'load Alive Runtime snapshot',
    )
    this.heartbeat = window.setInterval(() => this.observeWorld(), WORLD_HEARTBEAT_MS)
    this.observeWorld()
  }

  dispose(): void {
    if (!this.started) return
    this.started = false
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat)
    this.heartbeat = null
    this.unsubscribeChanged?.()
    this.unsubscribeChanged = null
    this.unsubscribeBehavior?.()
    this.unsubscribeBehavior = null
    this.removeActivityListeners()
  }

  report(event: ExperienceEvent): void {
    observeRendererPromise(window.api.alive.reportExperience(event), `report ${event.type}`)
  }

  private removeActivityListeners: () => void = () => undefined

  private observeWorld(): void {
    const state = this.deps.getControllerState()
    const now = Date.now()
    const userIdleMs = Math.max(0, now - this.lastUserActivityAt)
    observeRendererPromise(
      window.api.alive.updateWorld({
        appFocused: document.hasFocus(),
        userIdleMs,
        conversationActive: !['idle', 'listening'].includes(state.status),
        audioActive: state.status === 'speaking' || state.status === 'synthesizing',
        observedAt: now,
      }),
      'update World Context',
    )
    if (
      userIdleMs >= SILENCE_THRESHOLD_MS &&
      now - this.silenceReportedAt >= SILENCE_THRESHOLD_MS
    ) {
      this.silenceReportedAt = now
      this.report({ type: 'silence-threshold', at: now, silenceMs: userIdleMs })
    }
  }

  private applyBehavior(command: BehaviorCommand): void {
    if (command.embodimentPresence?.source === 'browser-computer-use') {
      this.deps.presentation.setBehaviorEmbodimentIntent(
        command.intent.kind === 'embodiment' ? command.intent.intent : undefined,
      )
      this.deps.presentation.setBrowserScreenGaze(
        command.embodimentPresence.sessionId,
        command.embodimentPresence.screenGazeActive,
      )
    }
    if (command.intent.kind === 'embodiment') {
      if (!command.embodimentPresence) {
        this.deps.presentation.setBehaviorEmbodimentIntent(command.intent.intent)
      }
    } else if (command.intent.kind === 'conversation-candidate') {
      if (command.embodimentPresence?.source === 'browser-computer-use') {
        observeRendererPromise(
          this.deps.runBrowserInitiative(command.intent.topic),
          'run browser computer-use initiative',
        )
      } else {
        this.deps.pushInitiative(command.intent.topic)
      }
    } else if (command.intent.kind === 'goal-suggestion') {
      this.deps.pushInitiative(command.intent.objective)
    }
    this.deps.recordEvent(
      'Behavior Command Applied',
      `intent=${command.intent.kind} id=${command.id}`,
    )
  }
}
