export type ActionStatus = 'success' | 'failure'

export interface ActionRequest<TPayload = unknown> {
  name: string
  payload: TPayload
}

export interface ActionResult<TResult = unknown> {
  status: ActionStatus
  action: string
  result?: TResult
  error?: string
}

export type ActionHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => Promise<TResult> | TResult

export interface ToolDefinition<TPayload = unknown, TResult = unknown> {
  name: string
  description: string
  execute: ActionHandler<TPayload, TResult>
}
