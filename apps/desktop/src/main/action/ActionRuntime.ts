import type { RuntimeEventInput } from '../../shared/runtime'
import type { ActionRequest, ActionResult, ToolDefinition } from './types'

export type ActionRuntimeEventListener = (event: RuntimeEventInput) => void

export class ActionRuntime {
  private tools = new Map<string, ToolDefinition<unknown, unknown>>()

  constructor(private readonly onEvent?: ActionRuntimeEventListener) {}

  register<TPayload, TResult>(tool: ToolDefinition<TPayload, TResult>): void {
    this.tools.set(tool.name, tool as ToolDefinition<unknown, unknown>)
  }

  listTools(): string[] {
    return [...this.tools.keys()]
  }

  async execute<TPayload, TResult>(
    request: ActionRequest<TPayload>,
  ): Promise<ActionResult<TResult>> {
    this.publishActionEvent('ToolRequested', request.name)
    const tool = this.tools.get(request.name)
    if (!tool) {
      const error = `Action is not registered: ${request.name}`
      this.publishActionEvent('ToolFailed', request.name, error)
      return {
        status: 'failure',
        action: request.name,
        error,
      }
    }

    try {
      const result = (await tool.execute(request.payload)) as TResult
      this.publishActionEvent('ToolCompleted', request.name)
      return {
        status: 'success',
        action: request.name,
        result,
      }
    } catch (e) {
      // Duck-type a normalized domain error (e.g. Speech Adapter's
      // SpeechServiceError) without coupling the generic Action Runtime to any
      // domain: carry its stable code and sanitized message through unchanged.
      const normalized =
        e &&
        typeof e === 'object' &&
        typeof (e as { code?: unknown }).code === 'string' &&
        typeof (e as { recoverable?: unknown }).recoverable === 'boolean'
          ? (e as {
              code: string
              recoverable: boolean
              providerId?: string
              technicalMessage?: string
            })
          : null
      const error = normalized?.technicalMessage ?? String(e)
      this.publishActionEvent('ToolFailed', request.name, error)
      return {
        status: 'failure',
        action: request.name,
        error,
        errorCode: normalized?.code,
        recoverable: normalized?.recoverable,
        providerId: normalized?.providerId,
      }
    }
  }

  private publishActionEvent(
    type: RuntimeEventInput['type'],
    action: string,
    detail?: string,
  ): void {
    this.onEvent?.({
      type,
      category: 'action',
      source: 'main.actionRuntime',
      detail: detail ?? action,
      metadata: { action },
    })
  }
}
