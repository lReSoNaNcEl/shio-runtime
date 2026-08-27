import type { BrowserWindow } from 'electron'

import { actionConfirmationRequestSchema, actionRuntimeSnapshotSchema } from '../../shared/actions'
import {
  BROWSER_COMPUTER_USE_CONTINUOUS_DEFAULT_LEASE_MS,
  type BrowserComputerUseControlAction,
  type BrowserComputerUseSession,
  type BrowserComputerUseStartRequest,
  browserComputerUseControlActionSchema,
  browserComputerUseStartRequestSchema,
} from '../../shared/browser-computer-use'
import type { RuntimeEventInput } from '../../shared/runtime'
import {
  ActionConfirmationBroker,
  ActionPermissionGuard,
  ActionRuntime,
  BrowserActiveTabVerifier,
  BrowserInteractionVerifier,
  BrowserNavigationVerifier,
  type DesktopWorkflowAdapterResult,
  desktopWorkflowVerificationPolicy,
  type EffectiveDesktopWorkflowRequest,
  ShellExecutionVerifier,
  safeDesktopWorkflowRecovery,
} from '../action'
import type { BrowserControlPlugin } from '../browser-control'
import type { BrowserWorkflowScopeRegistry } from '../browser-control/workflow'
import type { CapabilityCatalog } from '../capabilities'
import { getConfig } from '../config'
import type { DesktopControlPlugin } from '../desktop-control'

export interface ActionRuntimeComposition {
  actions: ActionRuntime
  confirmations: ActionConfirmationBroker
}

interface CreateActionRuntimeOptions {
  window: BrowserWindow
  capabilityCatalog: CapabilityCatalog
  browserWorkflowScopes: BrowserWorkflowScopeRegistry
  desktopControl: () => DesktopControlPlugin
  browserControl: () => BrowserControlPlugin
  onEvent?: (event: RuntimeEventInput) => void
}

export function createActionRuntime({
  window,
  capabilityCatalog,
  browserWorkflowScopes,
  desktopControl,
  browserControl,
  onEvent,
}: CreateActionRuntimeOptions): ActionRuntimeComposition {
  const sendToRenderer = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const sendActionEvent = (event: RuntimeEventInput): void => {
    sendToRenderer('action-runtime:event', event)
    onEvent?.(event)
    if (event.type === 'ToolCompleted') capabilityCatalog.invalidate()
  }
  const confirmations = new ActionConfirmationBroker(
    (request) => sendToRenderer('action-runtime:confirmation-requested', request),
    (request) => sendToRenderer('action-runtime:authority-change-requested', request),
  )
  const permissionGuard = new ActionPermissionGuard({
    authorityMode: () => getConfig().desktopAuthorityMode,
    requestConfirmation: (request) => confirmations.requestAction(request),
    authorizeScope: (scopeId, confirmation, requestConfirmation) =>
      browserWorkflowScopes.authorize(scopeId, confirmation, {
        authorityMode: getConfig().desktopAuthorityMode,
        requestConfirmation,
      }),
  })
  const actions = new ActionRuntime({
    permissionGuard,
    authorityMode: () => getConfig().desktopAuthorityMode,
    cancelPendingConfirmations: () => confirmations.cancelAll(),
    cancelConfirmation: (actionId) => confirmations.cancelAction(actionId),
    onEvent: sendActionEvent,
    onChanged: (snapshot) =>
      sendToRenderer(
        'action-runtime:changed',
        actionRuntimeSnapshotSchema.parse({
          ...snapshot,
          pendingAuthorityChange: confirmations.pendingAuthority(),
        }),
      ),
  })
  const browserObservationProvider = {
    observe: (signal: AbortSignal) => browserControl().observeForVerification(signal),
  }
  actions.registerVerifier(new BrowserNavigationVerifier(browserObservationProvider))
  actions.registerVerifier(new BrowserInteractionVerifier(browserObservationProvider))
  actions.registerVerifier(new BrowserActiveTabVerifier())
  actions.registerVerifier(new ShellExecutionVerifier())
  actions.register<EffectiveDesktopWorkflowRequest, DesktopWorkflowAdapterResult>({
    name: 'desktop.workflow',
    description: 'Execute one validated browser or shell operation.',
    validate: (payload) => {
      const request = desktopControl().validateWorkflowRequest(payload)
      return request.requestedCapabilities[0] === 'browser'
        ? browserControl().validateWorkflowRequest(request)
        : request
    },
    authority: 'desktop-workflow',
    confirmation: (actionId, payload, request) =>
      actionConfirmationRequestSchema.parse({
        schemaVersion: 1,
        actionId,
        tool: 'desktop.workflow',
        goal: browserWorkflowScopes.confirmationGoal(request.authorizationScopeId, payload.goal),
        shellCommand: payload.shellCommand,
        browserUrl: payload.browserUrl,
        browserOperation: payload.browserOperation,
        browserRiskClass: payload.browserRiskClass,
        requestedCapabilities: payload.requestedCapabilities,
        risk: payload.risk,
      }),
    timeoutMs: 120_000,
    singleFlight: true,
    adapter: 'desktop-control',
    verification: desktopWorkflowVerificationPolicy,
    recover: (request) => safeDesktopWorkflowRecovery(request),
    execute: (request, context) =>
      request.requestedCapabilities[0] === 'browser'
        ? browserControl().executeWorkflow(request, context.signal)
        : desktopControl().executeWorkflow(request, context.signal),
  })
  actions.register<BrowserComputerUseStartRequest, BrowserComputerUseSession>({
    name: 'browser.use',
    description: 'Authorize and start one bounded or continuous browser computer-use session.',
    validate: (payload) => browserComputerUseStartRequestSchema.parse(payload),
    authority: 'delegated-session',
    confirmation: (actionId, request) => {
      const termination = request.termination ?? { type: 'goal-completed' as const }
      const maximumDurationMs =
        termination.type === 'goal-completed'
          ? request.maxDurationMs
          : termination.type === 'until-time'
            ? termination.durationMs
            : BROWSER_COMPUTER_USE_CONTINUOUS_DEFAULT_LEASE_MS
      return actionConfirmationRequestSchema.parse({
        schemaVersion: 1,
        actionId,
        tool: 'browser.use',
        goal: request.goal,
        maxSteps: request.maxSteps,
        maxActions: request.maxActions,
        maxDurationMs: maximumDurationMs,
        termination,
        requestedCapabilities: ['browser-computer-use'],
        risk: 'normal',
      })
    },
    timeoutMs: 30_000,
    singleFlight: true,
    adapter: 'browser-control',
    execute: (request, context) =>
      browserControl().startComputerUse(request, context.actionId, context.signal),
  })
  actions.register<BrowserComputerUseControlAction, BrowserComputerUseSession>({
    name: 'browser.use-control',
    description: 'Pause, resume, or stop the active browser computer-use session.',
    validate: (payload) => browserComputerUseControlActionSchema.parse(payload),
    authority: 'implicit',
    timeoutMs: 10_000,
    singleFlight: true,
    adapter: 'browser-control',
    execute: (action, context) =>
      browserControl().executeComputerUseControl(action.operation, context.signal),
  })
  actions.onEmergencyStop(() => {
    browserWorkflowScopes.releaseAll()
    return desktopControl().emergencyStop()
  })
  actions.onEmergencyStop(() => browserControl().emergencyStop())
  return { actions, confirmations }
}
