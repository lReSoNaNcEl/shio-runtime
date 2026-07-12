import type { BacklogSelector, BacklogSelectorLlmConfig } from './BacklogSelector'
import { backlogTuning } from './tuning'
import type {
  ActiveConversationExecution,
  AdmittedConversationTurn,
  BufferedUtterance,
  ConversationCompletionResult,
  ConversationExecutionPhase,
  ConversationInput,
} from './types'
import type { UtteranceBacklog } from './UtteranceBacklog'

export type ConversationAdmissionOutcome =
  | 'started'
  | 'queued_backlog'
  | 'queued_explicit'
  | 'ignored_busy'

let admissionCycleSequence = 0
const createCycleId = (): string => `admission-${Date.now()}-${++admissionCycleSequence}`

export class ConversationAdmissionCoordinator {
  private activeExecution: ActiveConversationExecution | undefined
  private drainPromise: Promise<void> | undefined
  private arbitrationPromise: Promise<unknown> | undefined
  private activeCycleId: string | undefined
  private continuousEnabled = false
  private pendingExplicit: ConversationInput | null = null
  private llmConfig: BacklogSelectorLlmConfig = {
    enabled: false,
    providerId: '',
    model: '',
    timeoutMs: 2_000,
    minimumConfidence: 0.72,
  }

  constructor(
    private readonly runConversation: (
      turn: AdmittedConversationTurn,
      reportPhase: (phase: ConversationExecutionPhase) => void,
    ) => Promise<ConversationCompletionResult>,
    private readonly backlog: UtteranceBacklog,
    private readonly selector: BacklogSelector,
    private readonly onError: (error: unknown, turn: ConversationInput) => void = () => undefined,
  ) {}

  isBusy(): boolean {
    return Boolean(this.activeExecution || this.drainPromise)
  }
  getActiveExecution(): Readonly<ActiveConversationExecution> | undefined {
    return this.activeExecution ? { ...this.activeExecution } : undefined
  }

  configureSelector(config: BacklogSelectorLlmConfig): void {
    const changed = JSON.stringify(config) !== JSON.stringify(this.llmConfig)
    this.llmConfig = { ...config }
    if (changed) this.selector.cancel()
  }

  setContinuousEnabled(enabled: boolean): void {
    this.continuousEnabled = enabled
    if (!enabled) {
      this.selector.cancel()
      this.backlog.clear()
    }
  }

  resetStreamingSession(): void {
    this.selector.cancel()
    this.backlog.clear()
  }

  enqueueStreaming(item: BufferedUtterance): ConversationAdmissionOutcome {
    if (!this.continuousEnabled) return 'ignored_busy'
    const outcome = this.backlog.enqueue(item) ? 'queued_backlog' : 'ignored_busy'
    console.debug(
      `[admission] turnId=${item.id} source=continuous_listening outcome=${outcome} activeTurnId=${this.activeExecution?.turnId ?? 'none'}`,
    )
    return outcome
  }

  async admit(
    input: ConversationInput,
    buffered?: BufferedUtterance,
  ): Promise<ConversationAdmissionOutcome> {
    if (this.activeExecution || this.drainPromise) return this.handleBusyInput(input, buffered)

    const cycleId = createCycleId()
    const initialTurn: AdmittedConversationTurn = { ...input, admissionCycleId: cycleId }
    this.activeCycleId = cycleId
    const currentPromise = this.executeCycle(initialTurn, cycleId)
    this.drainPromise = currentPromise
    console.debug(
      `[admission] turnId=${input.turnId} source=${input.source} cycleId=${cycleId} outcome=accepted activeTurnId=none`,
    )
    try {
      await currentPromise
    } finally {
      if (this.drainPromise === currentPromise) {
        this.drainPromise = undefined
        if (this.activeCycleId === cycleId) this.activeCycleId = undefined
      }
    }
    return 'started'
  }

  private handleBusyInput(
    input: ConversationInput,
    buffered?: BufferedUtterance,
  ): ConversationAdmissionOutcome {
    if (input.source === 'continuous_listening' && buffered) return this.enqueueStreaming(buffered)
    if (input.source === 'text_chat' || input.source === 'push_to_talk') {
      this.selector.cancel()
      if (input.source === 'text_chat') this.backlog.discardWeak()
      this.pendingExplicit = input
      console.debug(
        `[admission] turnId=${input.turnId} source=${input.source} outcome=buffered activeTurnId=${this.activeExecution?.turnId ?? 'none'}`,
      )
      return 'queued_explicit'
    }
    console.debug(
      `[admission] turnId=${input.turnId} source=${input.source} outcome=discarded activeTurnId=${this.activeExecution?.turnId ?? 'none'}`,
    )
    return 'ignored_busy'
  }

  private async executeCycle(
    initialTurn: AdmittedConversationTurn,
    cycleId: string,
  ): Promise<void> {
    await this.executeTurn(initialTurn)
    if (initialTurn.source === 'text_chat') this.backlog.discardWeak()
    await this.drainPendingExplicit(cycleId)
    if (!this.continuousEnabled) {
      this.backlog.clear()
      return
    }
    await this.drainOneStreamingTurn(cycleId)
    await this.drainPendingExplicit(cycleId)
    this.backlog.discardWeak()
  }

  private async executeTurn(turn: AdmittedConversationTurn): Promise<void> {
    if (this.activeExecution) {
      throw new Error(
        `Conversation execution overlap: activeTurnId=${this.activeExecution.turnId} requestedTurnId=${turn.turnId}`,
      )
    }
    this.activeExecution = {
      turnId: turn.turnId,
      admissionCycleId: turn.admissionCycleId,
      phase: turn.source === 'debug' ? 'synthesizing' : 'generating',
      startedAt: Date.now(),
    }
    const reportPhase = (phase: ConversationExecutionPhase): void => {
      if (this.activeExecution?.turnId !== turn.turnId) {
        console.debug(`[admission] turnId=${turn.turnId} phase=${phase} stale-phase=ignored`)
        return
      }
      this.activeExecution = { ...this.activeExecution, phase }
      console.debug(
        `[conversation] turnId=${turn.turnId} cycleId=${turn.admissionCycleId} phase=${phase}`,
      )
    }
    try {
      const result = await this.runConversation(turn, reportPhase)
      console.debug(`[conversation] turnId=${turn.turnId} terminal=${result.status}`)
    } catch (error) {
      this.onError(error, turn)
    } finally {
      if (this.activeExecution?.turnId === turn.turnId) this.activeExecution = undefined
    }
  }

  private async drainOneStreamingTurn(cycleId: string): Promise<void> {
    for (let budget = 0; budget < backlogTuning.maxSelectedTurnsPerDrain; budget += 1) {
      const selectionPromise = this.selector.select(this.backlog, {
        continuousEnabled: this.continuousEnabled,
        llm: this.llmConfig,
      })
      this.arbitrationPromise = selectionPromise
      const selection = await selectionPromise.finally(() => {
        if (this.arbitrationPromise === selectionPromise) this.arbitrationPromise = undefined
      })
      if (
        this.activeCycleId !== cycleId ||
        this.pendingExplicit ||
        !this.continuousEnabled ||
        selection.action === 'discard_all' ||
        !selection.text
      )
        return
      if (!this.backlog.consume(selection.selectedIds, selection.backlogVersion)) return
      await this.executeTurn({
        turnId: `backlog-${Date.now()}-${selection.selectedIds.join('-')}`,
        text: selection.text,
        source: 'backlog_selected',
        createdAt: Date.now(),
        utteranceIds: selection.selectedIds,
        admissionCycleId: cycleId,
      })
    }
  }

  private async drainPendingExplicit(cycleId: string): Promise<void> {
    while (this.pendingExplicit) {
      const explicit = this.pendingExplicit
      this.pendingExplicit = null
      await this.executeTurn({ ...explicit, admissionCycleId: cycleId })
    }
  }
}
