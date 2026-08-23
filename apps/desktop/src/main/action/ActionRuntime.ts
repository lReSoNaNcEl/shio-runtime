import { randomUUID } from 'node:crypto'

import type {
  ActionAuthorization,
  ActionConfirmationRequest,
  ActionLogEntry,
  ActionOutcome,
  ActionRuntimeSnapshot,
  DesktopAuthorityMode,
} from '../../shared/actions'
import type { RuntimeEventInput } from '../../shared/runtime'
import { ActionError } from './ActionError'
import type { ActionPermissionGuard } from './ActionPermissionGuard'
import type { ActionRequest, ActionResult, NormalizedActionError, ToolDefinition } from './types'

export type ActionRuntimeEventListener = (event: RuntimeEventInput) => void

interface ActionRuntimeOptions {
  permissionGuard: ActionPermissionGuard
  authorityMode: () => DesktopAuthorityMode
  cancelPendingConfirmations: () => void
  onEvent?: ActionRuntimeEventListener
  onChanged?: (snapshot: ActionRuntimeSnapshot) => void
}

interface ActiveAction {
  tool: string
  controller: AbortController
  cancel: () => void
}

const MAX_ACTION_LOG_ENTRIES = 50

export class ActionRuntime {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>()
  private readonly active = new Map<string, ActiveAction>()
  private readonly emergencyStopHandlers = new Set<() => Promise<void> | void>()
  private readonly recentActions: ActionLogEntry[] = []
  private readonly cancelledActionIds = new Set<string>()
  private pendingConfirmation: ActionConfirmationRequest | null = null

  constructor(private readonly options: ActionRuntimeOptions) {}

  register<TPayload, TResult>(tool: ToolDefinition<TPayload, TResult>): void {
    this.tools.set(tool.name, tool as ToolDefinition<unknown, unknown>)
  }

  listTools(): string[] {
    return [...this.tools.keys()]
  }

  onEmergencyStop(handler: () => Promise<void> | void): () => void {
    this.emergencyStopHandlers.add(handler)
    return () => this.emergencyStopHandlers.delete(handler)
  }

  snapshot(): ActionRuntimeSnapshot {
    return {
      schemaVersion: 1,
      authorityMode: this.options.authorityMode(),
      pendingConfirmation: this.pendingConfirmation
        ? {
            ...this.pendingConfirmation,
            requestedCapabilities: [...this.pendingConfirmation.requestedCapabilities],
          }
        : null,
      pendingAuthorityChange: null,
      activeActionId: this.active.keys().next().value ?? null,
      recentActions: this.recentActions.map((entry) => ({
        ...entry,
        lifecycle: [...entry.lifecycle],
      })),
    }
  }

  notifyAuthorityModeChanged(): void {
    this.publishSnapshot()
  }

  async execute<TPayload, TResult>(
    request: ActionRequest<TPayload>,
  ): Promise<ActionResult<TResult>> {
    const actionId = `action-${Date.now()}-${randomUUID()}`
    const log: ActionLogEntry = {
      actionId,
      tool: request.name,
      lifecycle: ['requested'],
      requestedAt: Date.now(),
    }
    this.record(log)
    this.publishActionEvent('ToolRequested', request.name, { actionId, lifecycle: 'requested' })

    const tool = this.tools.get(request.name)
    if (!tool) {
      return this.fail<TResult>(log, {
        outcome: 'failure',
        code: 'ACTION_NOT_REGISTERED',
        message: `Action is not registered: ${request.name}`,
      })
    }

    let payload: unknown
    try {
      payload = tool.validate(request.payload)
      this.advance(log, 'validated')
      this.publishActionEvent('ToolValidated', request.name, {
        actionId,
        lifecycle: 'validated',
      })
    } catch {
      return this.fail<TResult>(log, {
        outcome: 'failure',
        code: 'ACTION_VALIDATION_FAILED',
        message: 'Action request validation failed',
      })
    }

    if (
      tool.singleFlight &&
      ([...this.active.values()].some((active) => active.tool === request.name) ||
        this.pendingConfirmation?.tool === request.name)
    ) {
      return this.fail<TResult>(log, {
        outcome: 'failure',
        code: 'ACTION_ALREADY_RUNNING',
        message: 'Another action of this type is already running',
        recoverable: true,
      })
    }

    let authorization: ActionAuthorization
    try {
      const confirmation = tool.confirmation?.(actionId, payload)
      if (confirmation) {
        this.pendingConfirmation = confirmation
        this.publishSnapshot()
      }
      authorization = await this.options.permissionGuard.authorize(
        tool.authority ?? 'implicit',
        confirmation,
      )
      this.pendingConfirmation = null
      this.advance(log, 'authorized')
      log.authorization = authorization
      this.publishActionEvent('ToolAuthorized', request.name, {
        actionId,
        lifecycle: 'authorized',
        authorization,
      })
    } catch (error) {
      this.pendingConfirmation = null
      const normalized = this.cancelledActionIds.has(actionId)
        ? {
            outcome: 'cancelled' as const,
            code: 'ACTION_CANCELLED',
            message: 'Action cancelled by Emergency Stop',
            recoverable: true,
          }
        : this.normalizeError(error)
      this.cancelledActionIds.delete(actionId)
      return this.fail<TResult>(log, normalized)
    }

    const controller = new AbortController()
    let cancelExecution: (error: ActionError) => void = () => undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancelExecution = reject
    })
    this.active.set(actionId, {
      tool: request.name,
      controller,
      cancel: () =>
        cancelExecution(
          new ActionError(
            'ACTION_CANCELLED',
            'Action cancelled by Emergency Stop',
            'cancelled',
            true,
          ),
        ),
    })
    this.advance(log, 'executed')
    log.adapter = tool.adapter
    this.publishActionEvent('ToolStarted', request.name, {
      actionId,
      lifecycle: 'executed',
      authorization,
      ...(tool.adapter ? { adapter: tool.adapter } : {}),
    })

    let timeout: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new ActionError('ACTION_TIMEOUT', 'Action execution timed out', 'timeout', true))
      }, tool.timeoutMs ?? 60_000)
    })

    try {
      const execution = Promise.resolve(
        tool.execute(payload, { actionId, signal: controller.signal }),
      )
      const result = (await Promise.race([execution, cancellation, timeoutPromise])) as TResult
      this.active.delete(actionId)
      if (timeout) clearTimeout(timeout)
      this.complete(log, 'success')
      this.publishActionEvent('ToolCompleted', request.name, {
        actionId,
        lifecycle: 'completed',
        outcome: 'success',
        authorization,
      })
      return {
        actionId,
        status: 'success',
        action: request.name,
        authorization,
        result,
      }
    } catch (error) {
      this.active.delete(actionId)
      if (timeout) clearTimeout(timeout)
      this.cancelledActionIds.delete(actionId)
      return this.fail<TResult>(log, this.normalizeError(error), authorization)
    }
  }

  async emergencyStop(): Promise<void> {
    if (this.pendingConfirmation) this.cancelledActionIds.add(this.pendingConfirmation.actionId)
    for (const [actionId, active] of this.active) {
      this.cancelledActionIds.add(actionId)
      active.controller.abort()
      active.cancel()
    }
    this.options.cancelPendingConfirmations()
    await Promise.allSettled([...this.emergencyStopHandlers].map((handler) => handler()))
    this.publishSnapshot()
  }

  private advance(log: ActionLogEntry, stage: ActionLogEntry['lifecycle'][number]): void {
    log.lifecycle.push(stage)
    this.publishSnapshot()
  }

  private complete(log: ActionLogEntry, outcome: ActionOutcome, errorCode?: string): void {
    if (!log.lifecycle.includes('completed')) log.lifecycle.push('completed')
    log.outcome = outcome
    log.errorCode = errorCode
    log.completedAt = Date.now()
    log.durationMs = Math.max(0, log.completedAt - log.requestedAt)
    this.publishSnapshot()
  }

  private fail<TResult>(
    log: ActionLogEntry,
    error: NormalizedActionError,
    authorization?: ActionAuthorization,
  ): ActionResult<TResult> {
    if (authorization) log.authorization = authorization
    this.complete(log, error.outcome, error.code)
    const eventType: RuntimeEventInput['type'] =
      error.outcome === 'permission-denied'
        ? 'PermissionDenied'
        : error.outcome === 'cancelled'
          ? 'ToolCancelled'
          : error.outcome === 'timeout'
            ? 'ToolTimedOut'
            : 'ToolFailed'
    this.publishActionEvent(eventType, log.tool, {
      actionId: log.actionId,
      lifecycle: 'completed',
      outcome: error.outcome,
      errorCode: error.code,
      ...(authorization ? { authorization } : {}),
    })
    return {
      actionId: log.actionId,
      status: error.outcome,
      action: log.tool,
      authorization,
      error: error.message,
      errorCode: error.code,
      recoverable: error.recoverable,
      providerId: error.providerId,
    }
  }

  private normalizeError(error: unknown): NormalizedActionError {
    if (error instanceof ActionError) {
      return {
        outcome: error.outcome,
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        providerId: error.providerId,
      }
    }
    if (
      error &&
      typeof error === 'object' &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      const normalized = error as {
        code: string
        recoverable?: boolean
        providerId?: string
        technicalMessage?: string
      }
      return {
        outcome: 'failure',
        code: normalized.code,
        message: normalized.technicalMessage ?? 'Action execution failed',
        recoverable: normalized.recoverable,
        providerId: normalized.providerId,
      }
    }
    return {
      outcome: 'failure',
      code: 'ACTION_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : 'Action execution failed',
    }
  }

  private record(log: ActionLogEntry): void {
    this.recentActions.unshift(log)
    if (this.recentActions.length > MAX_ACTION_LOG_ENTRIES)
      this.recentActions.length = MAX_ACTION_LOG_ENTRIES
    this.publishSnapshot()
  }

  private publishSnapshot(): void {
    this.options.onChanged?.(this.snapshot())
  }

  private publishActionEvent(
    type: RuntimeEventInput['type'],
    action: string,
    metadata: Record<string, string>,
  ): void {
    this.options.onEvent?.({
      type,
      category: 'action',
      source: 'main.actionRuntime',
      detail: action,
      metadata: { action, ...metadata },
    })
  }
}
