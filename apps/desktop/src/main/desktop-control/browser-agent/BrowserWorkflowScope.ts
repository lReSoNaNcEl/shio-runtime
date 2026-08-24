import { randomUUID } from 'node:crypto'

import type {
  ActionAuthorization,
  ActionConfirmationRequest,
  DesktopAuthorityMode,
} from '../../../shared/actions'
import type { BrowserOperation } from '../../../shared/desktop-control'
import { ActionError } from '../../action'
import { requiresExplicitBrowserConfirmation } from './BrowserAgentPolicy'

export const BROWSER_AGENT_MAX_ACTION_ROUNDS = 8
export const BROWSER_AGENT_WORKFLOW_TIMEOUT_MS = 105_000

const BROWSER_SCOPE_OPERATIONS: ReadonlySet<BrowserOperation['operation']> = new Set([
  'observe',
  'open',
  'click',
  'fill',
  'select',
  'scroll',
  'back',
  'forward',
  'tabs',
  'switch-tab',
])

interface BrowserWorkflowScopeRecord {
  workflowId: string
  goal: string
  expiresAt: number
  maxActions: number
  actionCount: number
  approved: boolean
  denied: boolean
  detachAbort?: () => void
}

export interface BrowserWorkflowScope {
  workflowId: string
  goal: string
  allowedOperations: readonly BrowserOperation['operation'][]
  expiresAt: number
  maxActions: number
}

export interface BrowserWorkflowAuthorizationOptions {
  authorityMode: DesktopAuthorityMode
  requestConfirmation(request: ActionConfirmationRequest): Promise<'confirm' | 'cancel'>
}

export class BrowserWorkflowScopeRegistry {
  private readonly scopes = new Map<string, BrowserWorkflowScopeRecord>()

  create(goal: string, signal: AbortSignal): BrowserWorkflowScope {
    const workflowId = `browser-workflow-${randomUUID()}`
    const record: BrowserWorkflowScopeRecord = {
      workflowId,
      goal: goal.trim().slice(0, 2_000),
      expiresAt: Date.now() + BROWSER_AGENT_WORKFLOW_TIMEOUT_MS,
      maxActions: BROWSER_AGENT_MAX_ACTION_ROUNDS,
      actionCount: 0,
      approved: false,
      denied: false,
    }
    const abort = (): void => this.release(workflowId)
    signal.addEventListener('abort', abort, { once: true })
    record.detachAbort = () => signal.removeEventListener('abort', abort)
    this.scopes.set(workflowId, record)
    return Object.freeze({
      workflowId,
      goal: record.goal,
      allowedOperations: Object.freeze([...BROWSER_SCOPE_OPERATIONS]),
      expiresAt: record.expiresAt,
      maxActions: record.maxActions,
    })
  }

  confirmationGoal(workflowId: string | undefined, fallback: string): string {
    if (!workflowId) return fallback
    return this.requireActive(workflowId).goal
  }

  async authorize(
    workflowId: string,
    confirmation: ActionConfirmationRequest,
    options: BrowserWorkflowAuthorizationOptions,
  ): Promise<ActionAuthorization> {
    const scope = this.requireActive(workflowId)
    if (
      confirmation.requestedCapabilities.length !== 1 ||
      confirmation.requestedCapabilities[0] !== 'browser'
    ) {
      throw new ActionError(
        'ACTION_SCOPE_VIOLATION',
        'The workflow scope cannot authorize another capability',
        'permission-denied',
      )
    }
    const operation = confirmation.browserOperation?.operation
    if (operation && !BROWSER_SCOPE_OPERATIONS.has(operation)) {
      throw new ActionError(
        'ACTION_SCOPE_VIOLATION',
        'The browser operation is outside the workflow scope',
        'permission-denied',
      )
    }
    if (scope.actionCount >= scope.maxActions) {
      this.release(workflowId)
      throw new ActionError(
        'BROWSER_ACTION_LIMIT',
        'The browser workflow reached its action limit',
        'failure',
        true,
      )
    }

    const riskClass = confirmation.browserRiskClass ?? 'submission'
    if (requiresExplicitBrowserConfirmation(riskClass)) {
      await this.confirmOrDeny(scope, confirmation, options)
      scope.actionCount += 1
      return 'confirmed'
    }
    if (options.authorityMode === 'full') {
      scope.actionCount += 1
      return 'full'
    }
    if (!scope.approved) await this.confirmOrDeny(scope, confirmation, options)
    scope.actionCount += 1
    return 'confirmed'
  }

  release(workflowId: string): void {
    const scope = this.scopes.get(workflowId)
    if (!scope) return
    scope.detachAbort?.()
    this.scopes.delete(workflowId)
  }

  releaseAll(): void {
    for (const workflowId of [...this.scopes.keys()]) this.release(workflowId)
  }

  private requireActive(workflowId: string): BrowserWorkflowScopeRecord {
    const scope = this.scopes.get(workflowId)
    if (!scope || scope.denied || Date.now() >= scope.expiresAt) {
      this.release(workflowId)
      throw new ActionError(
        'ACTION_SCOPE_EXPIRED',
        'The browser workflow authorization scope is no longer active',
        'permission-denied',
        true,
      )
    }
    return scope
  }

  private async confirmOrDeny(
    scope: BrowserWorkflowScopeRecord,
    confirmation: ActionConfirmationRequest,
    options: BrowserWorkflowAuthorizationOptions,
  ): Promise<void> {
    const decision = await options.requestConfirmation({ ...confirmation, goal: scope.goal })
    if (decision === 'cancel') {
      scope.denied = true
      throw new ActionError(
        'ACTION_CANCELLED',
        'The browser workflow was cancelled before execution',
        'cancelled',
        true,
      )
    }
    scope.approved = true
  }
}
