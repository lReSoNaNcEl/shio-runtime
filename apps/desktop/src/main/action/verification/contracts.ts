export type ActionExecutionStatus = 'success' | 'failure' | 'timeout' | 'cancelled'

export interface ActionExecutionResult<TResult = unknown> {
  status: ActionExecutionStatus
  startedAt: number
  completedAt: number
  durationMs: number
  output?: TResult
  evidence?: unknown
  errorCode?: string
  error?: string
}

export type ActionVerificationStatus = 'not-required' | 'verified' | 'unverified' | 'failed'

export interface ActionVerificationEvidence {
  kind: string
  summary: string
  details?: Readonly<Record<string, string | number | boolean>>
}

export interface ActionVerificationResult {
  status: ActionVerificationStatus
  evidence: readonly ActionVerificationEvidence[]
  reasonCode?: string
  summary?: string
  observedAt?: number
  durationMs: number
}

export type VerificationMode = 'none' | 'execution-evidence' | 'post-state'

export type RetrySafety = 'safe' | 'requires-replan' | 'never-auto'

export interface ToolVerificationPolicy {
  mode: VerificationMode
  verifier?: string
  timeoutMs?: number
  retrySafety?: RetrySafety
}

export interface ActionVerificationRequest<TPayload = unknown, TResult = unknown> {
  actionId: string
  tool: string
  payload: TPayload
  execution: ActionExecutionResult<TResult>
  signal: AbortSignal
}

export interface ActionVerifier {
  readonly id: string
  verify(request: ActionVerificationRequest): Promise<ActionVerificationResult>
}

export class ActionVerificationCancelledError extends Error {
  constructor() {
    super('Action verification was cancelled')
    this.name = 'ActionVerificationCancelledError'
  }
}
