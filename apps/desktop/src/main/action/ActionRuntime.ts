import { randomUUID } from 'node:crypto'

import {
  type ActionAuthorization,
  type ActionConfirmationRequest,
  type ActionLogEntry,
  type ActionOutcome,
  type ActionRuntimeSnapshot,
  actionConfirmationRequestSchema,
  type DesktopAuthorityMode,
} from '../../shared/actions'
import type { RuntimeEventInput } from '../../shared/runtime'
import { ActionError } from './ActionError'
import type { ActionPermissionGuard } from './ActionPermissionGuard'
import { getActionCompletionStatus } from './actionResultStatus'
import type { ActionRequest, ActionResult, NormalizedActionError, ToolDefinition } from './types'
import {
  type ActionExecutionResult,
  ActionVerificationCancelledError,
  ActionVerificationCoordinator,
  type ActionVerificationResult,
  NO_VERIFICATION_POLICY,
  type ToolVerificationPolicy,
} from './verification'

export type ActionRuntimeEventListener = (event: RuntimeEventInput) => void

interface ActionRuntimeOptions {
  permissionGuard: ActionPermissionGuard
  authorityMode: () => DesktopAuthorityMode
  cancelPendingConfirmations: () => void
  cancelConfirmation?: (actionId: string) => void
  onEvent?: ActionRuntimeEventListener
  onChanged?: (snapshot: ActionRuntimeSnapshot) => void
}

interface ActiveAction {
  tool: string
  phase: 'executing' | 'verifying' | 'recovering'
  controller: AbortController
  cancel: () => void
}

interface InternalExecutionOptions {
  recoveryDepth: number
  recoveryOf?: string
  parentSignal?: AbortSignal
}

const MAX_ACTION_LOG_ENTRIES = 50
const MAX_CORRECTIVE_ACTIONS = 1

export class ActionRuntime {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>()
  private readonly active = new Map<string, ActiveAction>()
  private readonly emergencyStopHandlers = new Set<() => Promise<void> | void>()
  private readonly recentActions: ActionLogEntry[] = []
  private readonly cancelledActionIds = new Set<string>()
  private readonly verification = new ActionVerificationCoordinator()
  private pendingConfirmation: ActionConfirmationRequest | null = null

  constructor(private readonly options: ActionRuntimeOptions) {}

  register<TPayload, TResult>(tool: ToolDefinition<TPayload, TResult>): void {
    this.tools.set(tool.name, tool as ToolDefinition<unknown, unknown>)
  }

  registerVerifier(
    verifier: Parameters<ActionVerificationCoordinator['registerVerifier']>[0],
  ): void {
    this.verification.registerVerifier(verifier)
  }

  listTools(): string[] {
    return [...this.tools.keys()]
  }

  onEmergencyStop(handler: () => Promise<void> | void): () => void {
    this.emergencyStopHandlers.add(handler)
    return () => this.emergencyStopHandlers.delete(handler)
  }

  snapshot(): ActionRuntimeSnapshot {
    const firstActive = this.active.entries().next().value as [string, ActiveAction] | undefined
    return {
      schemaVersion: 1,
      authorityMode: this.options.authorityMode(),
      pendingConfirmation: this.pendingConfirmation
        ? actionConfirmationRequestSchema.parse(this.pendingConfirmation)
        : null,
      pendingAuthorityChange: null,
      activeActionId: firstActive?.[0] ?? null,
      activeActionPhase: firstActive?.[1].phase ?? null,
      recentActions: this.recentActions.map((entry) => ({
        ...entry,
        lifecycle: [...entry.lifecycle],
      })),
    }
  }

  notifyAuthorityModeChanged(): void {
    this.publishSnapshot()
  }

  execute<TPayload, TResult>(request: ActionRequest<TPayload>): Promise<ActionResult<TResult>> {
    return this.executeInternal(request, { recoveryDepth: 0 })
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

  private async executeInternal<TPayload, TResult>(
    request: ActionRequest<TPayload>,
    internal: InternalExecutionOptions,
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

    if (tool.singleFlight && this.hasConflictingAction(request.name, internal.recoveryOf)) {
      return this.fail<TResult>(log, {
        outcome: 'failure',
        code: 'ACTION_ALREADY_RUNNING',
        message: 'Another action of this type is already running',
        recoverable: true,
      })
    }

    let authorization: ActionAuthorization
    let detachAuthorizationAbort: (() => void) | undefined
    try {
      const confirmation = tool.confirmation?.(actionId, payload, request as ActionRequest<unknown>)
      const authorizationTask = this.options.permissionGuard.authorize(
        tool.authority ?? 'implicit',
        confirmation,
        request.authorizationScopeId,
        (pending) => {
          this.pendingConfirmation = pending
          this.publishSnapshot()
        },
      )
      const authorizationAbort = request.signal
        ? new Promise<never>((_resolve, reject) => {
            const abort = (): void => {
              this.options.cancelConfirmation?.(actionId)
              reject(
                new ActionError(
                  'ACTION_CANCELLED',
                  'Action cancelled before authorization',
                  'cancelled',
                  true,
                ),
              )
            }
            request.signal?.addEventListener('abort', abort, { once: true })
            detachAuthorizationAbort = () => request.signal?.removeEventListener('abort', abort)
            if (request.signal?.aborted) abort()
          })
        : null
      authorization = authorizationAbort
        ? await Promise.race([authorizationTask, authorizationAbort])
        : await authorizationTask
      detachAuthorizationAbort?.()
      this.pendingConfirmation = null
      this.advance(log, 'authorized')
      log.authorization = authorization
      this.publishActionEvent('ToolAuthorized', request.name, {
        actionId,
        lifecycle: 'authorized',
        authorization,
      })
    } catch (error) {
      detachAuthorizationAbort?.()
      this.pendingConfirmation = null
      const normalized = this.cancelledActionIds.has(actionId)
        ? cancelledError()
        : this.normalizeError(error)
      this.cancelledActionIds.delete(actionId)
      return this.fail<TResult>(log, normalized)
    }

    const controller = new AbortController()
    let cancelExecution: (error: ActionError) => void = () => undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancelExecution = reject
    })
    const cancel = (): void =>
      cancelExecution(
        new ActionError(
          'ACTION_CANCELLED',
          'Action cancelled by Emergency Stop',
          'cancelled',
          true,
        ),
      )
    const abortFromParent = (): void => {
      controller.abort(internal.parentSignal?.reason)
      cancel()
    }
    const abortFromRequest = (): void => {
      controller.abort(request.signal?.reason)
      cancel()
    }
    if (internal.parentSignal?.aborted) abortFromParent()
    else internal.parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    if (request.signal?.aborted) abortFromRequest()
    else request.signal?.addEventListener('abort', abortFromRequest, { once: true })
    const detachExecutionAbort = (): void => {
      internal.parentSignal?.removeEventListener('abort', abortFromParent)
      request.signal?.removeEventListener('abort', abortFromRequest)
    }
    this.active.set(actionId, { tool: request.name, phase: 'executing', controller, cancel })
    log.adapter = tool.adapter
    this.publishSnapshot()
    this.publishActionEvent('ToolStarted', request.name, {
      actionId,
      lifecycle: 'authorized',
      phase: 'executing',
      authorization,
      ...(tool.adapter ? { adapter: tool.adapter } : {}),
    })

    const execution = await this.executeTool<TResult>(
      tool,
      payload,
      actionId,
      controller,
      cancellation,
    )
    this.advance(log, 'executed')
    log.executionStatus = execution.status

    if (execution.status === 'timeout') {
      this.active.delete(actionId)
      detachExecutionAbort()
      this.cancelledActionIds.delete(actionId)
      return this.finishExecutionTerminal(log, request.name, authorization, execution)
    }
    if (controller.signal.aborted || execution.status === 'cancelled') {
      this.active.delete(actionId)
      detachExecutionAbort()
      this.cancelledActionIds.delete(actionId)
      return this.finishCancelled(log, request.name, authorization, execution)
    }

    const policy = this.resolveVerificationPolicy(tool, payload)
    const active = this.active.get(actionId)
    if (active) active.phase = 'verifying'
    this.advance(log, 'verification-started')

    let verification: ActionVerificationResult
    try {
      verification = await Promise.race([
        this.verification.verify(
          {
            actionId,
            tool: request.name,
            payload,
            execution,
            signal: controller.signal,
          },
          policy,
        ),
        cancellation,
      ])
    } catch (error) {
      if (
        controller.signal.aborted ||
        error instanceof ActionVerificationCancelledError ||
        this.cancelledActionIds.has(actionId)
      ) {
        this.active.delete(actionId)
        detachExecutionAbort()
        this.cancelledActionIds.delete(actionId)
        return this.finishCancelled(log, request.name, authorization, execution)
      }
      verification = {
        status: 'failed',
        evidence: [],
        reasonCode: 'verifier-error',
        summary: 'Verification failed before a trustworthy verdict was produced.',
        observedAt: Date.now(),
        durationMs: 0,
      }
    }
    this.advance(log, 'verification-completed')
    log.verificationStatus = verification.status
    log.verificationDurationMs = verification.durationMs

    let result = this.buildResult<TResult>(
      actionId,
      request.name,
      authorization,
      execution,
      verification,
    )
    const recoveryRequest =
      internal.recoveryDepth < MAX_CORRECTIVE_ACTIONS &&
      authorization === 'full' &&
      policy.retrySafety === 'safe' &&
      verification.status !== 'verified' &&
      verification.status !== 'not-required' &&
      tool.recover
        ? tool.recover(payload, verification)
        : undefined
    if (recoveryRequest && !controller.signal.aborted) {
      log.recoveryAttempted = true
      const recovering = this.active.get(actionId)
      if (recovering) recovering.phase = 'recovering'
      this.publishSnapshot()
      const recovered = await this.executeInternal<unknown, TResult>(recoveryRequest, {
        recoveryDepth: internal.recoveryDepth + 1,
        recoveryOf: actionId,
        parentSignal: controller.signal,
      })
      if (controller.signal.aborted || recovered.status === 'cancelled') {
        this.active.delete(actionId)
        detachExecutionAbort()
        this.cancelledActionIds.delete(actionId)
        return this.finishCancelled(log, request.name, authorization, execution)
      }
      result = {
        ...(recovered.status === 'success' ? recovered : result),
        actionId,
        action: request.name,
        authorization,
        recovery: {
          attempted: true,
          actionId: recovered.actionId,
          status: recovered.status,
        },
      }
    }

    this.active.delete(actionId)
    detachExecutionAbort()
    this.cancelledActionIds.delete(actionId)
    this.complete(log, result.status, result.errorCode)
    this.publishTerminalEvent(request.name, result)
    return result
  }

  private async executeTool<TResult>(
    tool: ToolDefinition<unknown, unknown>,
    payload: unknown,
    actionId: string,
    controller: AbortController,
    cancellation: Promise<never>,
  ): Promise<ActionExecutionResult<TResult>> {
    const startedAt = Date.now()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new ActionError('ACTION_TIMEOUT', 'Action execution timed out', 'timeout', true))
      }, tool.timeoutMs ?? 60_000)
    })
    try {
      const output = (await Promise.race([
        Promise.resolve(tool.execute(payload, { actionId, signal: controller.signal })),
        cancellation,
        timeoutPromise,
      ])) as TResult
      const completedAt = Date.now()
      return {
        status: 'success',
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        output,
      }
    } catch (error) {
      const normalized = this.cancelledActionIds.has(actionId)
        ? cancelledError()
        : this.normalizeError(error)
      const completedAt = Date.now()
      return {
        status: executionStatus(normalized.outcome),
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        evidence: normalized.evidence,
        errorCode: normalized.code,
        error: normalized.message,
        recoverable: normalized.recoverable,
        providerId: normalized.providerId,
      }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private buildResult<TResult>(
    actionId: string,
    action: string,
    authorization: ActionAuthorization,
    execution: ActionExecutionResult<TResult>,
    verification: ActionVerificationResult,
  ): ActionResult<TResult> {
    const candidate: ActionResult<TResult> = {
      actionId,
      status: 'failure',
      action,
      authorization,
      ...(execution.output !== undefined ? { result: execution.output } : {}),
      execution,
      verification,
      recoverable: execution.recoverable ?? verification.status === 'unverified',
      providerId: execution.providerId,
    }
    const status = getActionCompletionStatus(candidate)
    return {
      ...candidate,
      status,
      ...(status === 'success'
        ? {}
        : {
            errorCode: execution.errorCode ?? verification.reasonCode,
            error: execution.error ?? verification.summary,
          }),
    }
  }

  private finishCancelled<TResult>(
    log: ActionLogEntry,
    action: string,
    authorization: ActionAuthorization,
    execution: ActionExecutionResult<TResult>,
  ): ActionResult<TResult> {
    const result: ActionResult<TResult> = {
      actionId: log.actionId,
      status: 'cancelled',
      action,
      authorization,
      execution: { ...execution, status: 'cancelled' },
      error: 'Action cancelled by Emergency Stop',
      errorCode: 'ACTION_CANCELLED',
      recoverable: true,
    }
    this.complete(log, 'cancelled', result.errorCode)
    this.publishTerminalEvent(action, result)
    return result
  }

  private finishExecutionTerminal<TResult>(
    log: ActionLogEntry,
    action: string,
    authorization: ActionAuthorization,
    execution: ActionExecutionResult<TResult>,
  ): ActionResult<TResult> {
    const status = execution.status === 'timeout' ? 'timeout' : 'failure'
    const result: ActionResult<TResult> = {
      actionId: log.actionId,
      status,
      action,
      authorization,
      execution,
      error: execution.error,
      errorCode: execution.errorCode,
      recoverable: true,
    }
    this.complete(log, status, result.errorCode)
    this.publishTerminalEvent(action, result)
    return result
  }

  private hasConflictingAction(tool: string, recoveryOf?: string): boolean {
    const activeConflict = [...this.active.entries()].some(
      ([actionId, active]) => active.tool === tool && actionId !== recoveryOf,
    )
    return activeConflict || this.pendingConfirmation?.tool === tool
  }

  private resolveVerificationPolicy(
    tool: ToolDefinition<unknown, unknown>,
    payload: unknown,
  ): ToolVerificationPolicy {
    if (!tool.verification) return NO_VERIFICATION_POLICY
    return typeof tool.verification === 'function' ? tool.verification(payload) : tool.verification
  }

  private advance(log: ActionLogEntry, stage: ActionLogEntry['lifecycle'][number]): void {
    if (!log.lifecycle.includes(stage)) log.lifecycle.push(stage)
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
    const result: ActionResult<TResult> = {
      actionId: log.actionId,
      status: error.outcome,
      action: log.tool,
      authorization,
      error: error.message,
      errorCode: error.code,
      recoverable: error.recoverable,
      providerId: error.providerId,
    }
    this.publishTerminalEvent(log.tool, result)
    return result
  }

  private publishTerminalEvent(action: string, result: ActionResult): void {
    const eventType: RuntimeEventInput['type'] =
      result.status === 'success'
        ? 'ToolCompleted'
        : result.status === 'permission-denied'
          ? 'PermissionDenied'
          : result.status === 'cancelled'
            ? 'ToolCancelled'
            : result.status === 'timeout'
              ? 'ToolTimedOut'
              : 'ToolFailed'
    this.publishActionEvent(eventType, action, {
      actionId: result.actionId,
      lifecycle: 'completed',
      outcome: result.status,
      ...(result.authorization ? { authorization: result.authorization } : {}),
      ...(result.execution ? { executionStatus: result.execution.status } : {}),
      ...(result.verification ? { verificationStatus: result.verification.status } : {}),
      ...(result.recovery?.attempted ? { recoveryAttempted: 'true' } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    })
  }

  private normalizeError(error: unknown): NormalizedActionError {
    if (error instanceof ActionError) {
      return {
        outcome: error.outcome,
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        providerId: error.providerId,
        evidence: error.evidence,
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
        evidence?: unknown
      }
      return {
        outcome: 'failure',
        code: normalized.code,
        message: normalized.technicalMessage ?? 'Action execution failed',
        recoverable: normalized.recoverable,
        providerId: normalized.providerId,
        evidence: normalized.evidence,
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
    if (this.recentActions.length > MAX_ACTION_LOG_ENTRIES) {
      this.recentActions.length = MAX_ACTION_LOG_ENTRIES
    }
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

function cancelledError(): NormalizedActionError {
  return {
    outcome: 'cancelled',
    code: 'ACTION_CANCELLED',
    message: 'Action cancelled by Emergency Stop',
    recoverable: true,
  }
}

function executionStatus(outcome: Exclude<ActionOutcome, 'success'>) {
  if (outcome === 'timeout') return 'timeout' as const
  if (outcome === 'cancelled') return 'cancelled' as const
  return 'failure' as const
}
