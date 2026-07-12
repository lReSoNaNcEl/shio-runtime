import type { ActionRequest, ActionResult, ToolDefinition } from './types'
import type { RuntimeEventInput } from '../../shared/runtime/events'

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

  async execute<TPayload, TResult>(request: ActionRequest<TPayload>): Promise<ActionResult<TResult>> {
    this.publishActionEvent('ToolRequested', request.name)
    const tool = this.tools.get(request.name)
    if (!tool) {
      const error = `Action is not registered: ${request.name}`
      this.publishActionEvent('ToolFailed', request.name, error)
      return {
        status: 'failure',
        action: request.name,
        error
      }
    }

    try {
      const result = (await tool.execute(request.payload)) as TResult
      this.publishActionEvent('ToolCompleted', request.name)
      return {
        status: 'success',
        action: request.name,
        result
      }
    } catch (e) {
      this.publishActionEvent('ToolFailed', request.name, String(e))
      return {
        status: 'failure',
        action: request.name,
        error: String(e)
      }
    }
  }

  private publishActionEvent(type: RuntimeEventInput['type'], action: string, detail?: string): void {
    this.onEvent?.({
      type,
      category: 'action',
      source: 'main.actionRuntime',
      detail: detail ?? action,
      metadata: { action }
    })
  }
}
