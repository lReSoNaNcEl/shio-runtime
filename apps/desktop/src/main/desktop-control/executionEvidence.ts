import type { ActionPresentationFact } from '../../shared/actions'
import type {
  BrowserObservation,
  BrowserSemanticRiskClass,
  BrowserSessionState,
  BrowserTab,
} from '../../shared/desktop-control'

export interface BrowserExecutionEvidence {
  kind: 'browser'
  operation:
    | 'observe'
    | 'open'
    | 'click'
    | 'fill'
    | 'select'
    | 'scroll'
    | 'back'
    | 'forward'
    | 'tabs'
    | 'switch-tab'
    | 'workflow'
  riskClass?: BrowserSemanticRiskClass
  requestedUrl?: string
  requestedTabId?: string
  targetName?: string
  before?: BrowserObservation
  after?: BrowserObservation
  afterSession?: BrowserSessionState
  tabs?: readonly BrowserTab[]
  browserToolCalls?: number
  successfulBrowserToolResults?: number
  observationErrorCode?: string
}

export interface ShellExecutionEvidence {
  kind: 'shell'
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  durationMs: number
  timedOut: boolean
  aborted: boolean
}

export type DesktopWorkflowExecutionEvidence = BrowserExecutionEvidence | ShellExecutionEvidence

export interface DesktopWorkflowAdapterResult {
  runtimeCompleted: boolean
  reportedOutcome?: string
  presentationFacts?: readonly ActionPresentationFact[]
  evidence: DesktopWorkflowExecutionEvidence
}

export function isDesktopWorkflowAdapterResult(
  value: unknown,
): value is DesktopWorkflowAdapterResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DesktopWorkflowAdapterResult>
  return (
    typeof candidate.runtimeCompleted === 'boolean' &&
    Boolean(candidate.evidence && typeof candidate.evidence === 'object')
  )
}
