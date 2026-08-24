import type { DesktopWorkflowActionResult, DesktopWorkflowRequest } from '../../../shared/actions'
import { parseCharacterActionResponse } from '../../../shared/character-response'
import type { BrowserContextProvider, BrowserObservation } from '../../../shared/desktop-control'
import {
  BROWSER_AGENT_MAX_ACTION_ROUNDS,
  BROWSER_AGENT_WORKFLOW_TIMEOUT_MS,
  type BrowserWorkflowScopeRegistry,
} from './BrowserWorkflowScope'

export interface BrowserAgentStep {
  proposal: string
  request: DesktopWorkflowRequest
  result: DesktopWorkflowActionResult
  observation: BrowserObservation | null
}

export interface BrowserAgentContinuationInput {
  steps: readonly BrowserAgentStep[]
  observation: BrowserObservation | null
  allowFurtherActions: boolean
  assistantReply: string
  signal: AbortSignal
}

export interface BrowserAgentLoopOptions {
  initialReply: string
  userGoal: string
  signal: AbortSignal
  browserContext?: BrowserContextProvider
  canExecute(request: DesktopWorkflowRequest): boolean
  execute(
    request: DesktopWorkflowRequest,
    signal: AbortSignal,
    authorizationScopeId: string,
  ): Promise<DesktopWorkflowActionResult>
  continueConversation(input: BrowserAgentContinuationInput): Promise<string>
  rejectedReply(): string
  limitReply(): string
}

export interface BrowserAgentLoopResult {
  handled: boolean
  replyText: string
  latestResult?: DesktopWorkflowActionResult
  rounds: number
}

export class BrowserAgentCoordinator {
  constructor(private readonly scopes: BrowserWorkflowScopeRegistry) {}

  async run(options: BrowserAgentLoopOptions): Promise<BrowserAgentLoopResult> {
    let response = parseCharacterActionResponse(options.initialReply)
    if (
      response.kind !== 'action' ||
      response.request.requestedCapabilities.length !== 1 ||
      response.request.requestedCapabilities[0] !== 'browser'
    ) {
      return { handled: false, replyText: options.initialReply, rounds: 0 }
    }

    const workflowController = new AbortController()
    let deadlineReached = false
    const abortFromTurn = (): void => workflowController.abort(options.signal.reason)
    options.signal.addEventListener('abort', abortFromTurn, { once: true })
    if (options.signal.aborted) abortFromTurn()
    const deadline = setTimeout(() => {
      deadlineReached = true
      workflowController.abort(new Error('Browser workflow deadline reached'))
    }, BROWSER_AGENT_WORKFLOW_TIMEOUT_MS)
    const scope = this.scopes.create(options.userGoal, workflowController.signal)
    const steps: BrowserAgentStep[] = []
    let latestResult: DesktopWorkflowActionResult | undefined
    let assistantReply = options.initialReply

    try {
      for (let round = 1; round <= BROWSER_AGENT_MAX_ACTION_ROUNDS; round += 1) {
        if (workflowController.signal.aborted) {
          if (options.signal.aborted) throw options.signal.reason ?? new Error('Turn cancelled')
          return {
            handled: true,
            replyText: options.limitReply(),
            latestResult,
            rounds: steps.length,
          }
        }
        if (!options.canExecute(response.request)) {
          return {
            handled: true,
            replyText: options.rejectedReply(),
            latestResult,
            rounds: steps.length,
          }
        }

        latestResult = await options.execute(
          response.request,
          workflowController.signal,
          scope.workflowId,
        )
        if (options.signal.aborted) throw options.signal.reason ?? new Error('Turn cancelled')
        if (deadlineReached) {
          return {
            handled: true,
            replyText: options.limitReply(),
            latestResult,
            rounds: steps.length,
          }
        }
        const observation = options.browserContext?.currentObservation() ?? null
        const allowFurtherActions = !['cancelled', 'permission-denied'].includes(
          latestResult.outcome,
        )
        steps.push({
          proposal: response.replyText,
          request: response.request,
          result: latestResult,
          observation,
        })
        const continued = await options.continueConversation({
          steps,
          observation,
          allowFurtherActions,
          assistantReply,
          signal: workflowController.signal,
        })
        if (options.signal.aborted) throw options.signal.reason ?? new Error('Turn cancelled')
        assistantReply = continued
        response = parseCharacterActionResponse(continued)
        if (response.kind === 'none') {
          return {
            handled: true,
            replyText: response.replyText,
            latestResult,
            rounds: steps.length,
          }
        }
        if (
          response.kind === 'malformed' ||
          !allowFurtherActions ||
          response.request.requestedCapabilities.length !== 1 ||
          response.request.requestedCapabilities[0] !== 'browser'
        ) {
          return {
            handled: true,
            replyText: options.rejectedReply(),
            latestResult,
            rounds: steps.length,
          }
        }
      }
      return {
        handled: true,
        replyText: options.limitReply(),
        latestResult,
        rounds: steps.length,
      }
    } finally {
      clearTimeout(deadline)
      options.signal.removeEventListener('abort', abortFromTurn)
      this.scopes.release(scope.workflowId)
    }
  }
}
