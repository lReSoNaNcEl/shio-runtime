import type {
  BrowserCompletionAssessment,
  BrowserComputerUseDecision,
  BrowserComputerUseObservation,
  BrowserReactiveControlPlan,
  BrowserReactivePlanningContext,
  BrowserVisualControlState,
} from '../../../shared/browser-computer-use'

export interface BrowserVisualActionStatus {
  state: BrowserVisualControlState
  model: string
  supportsVision: boolean
}

export interface BrowserComputerUseDecisionContext {
  goal: string
  observation: BrowserComputerUseObservation
  recentAction?: {
    type: BrowserComputerUseDecision['type']
    outcome: 'executed' | 'stale' | 'failed'
  }
}

export interface BrowserVisualActionAdapter {
  status(): BrowserVisualActionStatus
  decide(
    context: BrowserComputerUseDecisionContext,
    signal: AbortSignal,
  ): Promise<BrowserComputerUseDecision>
  planReactive(
    context: BrowserReactivePlanningContext,
    signal: AbortSignal,
  ): Promise<BrowserReactiveControlPlan | null>
  verifyCompletion(
    context: { goal: string; observation: BrowserComputerUseObservation },
    signal: AbortSignal,
  ): Promise<BrowserCompletionAssessment>
}
