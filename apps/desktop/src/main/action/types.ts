import type {
  ActionAuthorization,
  ActionConfirmationRequest,
  ActionOutcome,
} from '../../shared/actions'
import type {
  ActionExecutionResult,
  ActionVerificationResult,
  ToolVerificationPolicy,
} from './verification'

export type ActionStatus = ActionOutcome

export interface ActionRequest<TPayload = unknown> {
  name: string
  payload: TPayload
  /** Main-owned scope metadata. This is never accepted from renderer payloads. */
  authorizationScopeId?: string
  signal?: AbortSignal
}

export interface ActionResult<TResult = unknown> {
  actionId: string
  status: ActionStatus
  action: string
  authorization?: ActionAuthorization
  result?: TResult
  execution?: ActionExecutionResult<TResult>
  verification?: ActionVerificationResult
  recovery?: {
    attempted: boolean
    actionId?: string
    status?: ActionStatus
  }
  error?: string
  /** Stable, normalized domain error code when the thrown error carried one. */
  errorCode?: string
  recoverable?: boolean
  providerId?: string
}

export interface ActionExecutionContext {
  actionId: string
  signal: AbortSignal
}

export type ActionHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: ActionExecutionContext,
) => Promise<TResult> | TResult

export interface ToolDefinition<TPayload = unknown, TResult = unknown> {
  name: string
  description: string
  validate: (payload: unknown) => TPayload
  authority?: 'implicit' | 'desktop-workflow' | 'delegated-session'
  confirmation?: (
    actionId: string,
    payload: TPayload,
    request: ActionRequest<TPayload>,
  ) => ActionConfirmationRequest
  adapter?: string
  timeoutMs?: number
  singleFlight?: boolean
  verification?: ToolVerificationPolicy | ((payload: TPayload) => ToolVerificationPolicy)
  recover?: (
    payload: TPayload,
    verification: ActionVerificationResult,
  ) => ActionRequest<TPayload> | undefined
  execute: ActionHandler<TPayload, TResult>
}

export interface NormalizedActionError {
  outcome: Exclude<ActionOutcome, 'success'>
  code: string
  message: string
  recoverable?: boolean
  providerId?: string
  evidence?: unknown
}
