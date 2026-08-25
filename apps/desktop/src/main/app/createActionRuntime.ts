import type { BrowserWindow } from 'electron'

import { actionConfirmationRequestSchema, actionRuntimeSnapshotSchema } from '../../shared/actions'
import {
  type BrowserGameControlAction,
  type BrowserGameStatus,
  browserGameControlActionSchema,
  type GameStartPreparation,
} from '../../shared/browser-game'
import type { RuntimeEventInput } from '../../shared/runtime'
import {
  ActionConfirmationBroker,
  ActionPermissionGuard,
  ActionRuntime,
  BrowserActiveTabVerifier,
  BrowserInteractionVerifier,
  BrowserNavigationVerifier,
  desktopWorkflowVerificationPolicy,
  ShellExecutionVerifier,
  safeDesktopWorkflowRecovery,
} from '../action'
import type { BrowserGamePlugin } from '../browser-game'
import type { CapabilityCatalog } from '../capabilities'
import { getConfig } from '../config'
import type { DesktopControlPlugin, DesktopWorkflowAdapterResult } from '../desktop-control'
import type {
  BrowserWorkflowScopeRegistry,
  EffectiveDesktopWorkflowRequest,
} from '../desktop-control/browser-agent'

export interface ActionRuntimeComposition {
  actions: ActionRuntime
  confirmations: ActionConfirmationBroker
}

interface CreateActionRuntimeOptions {
  window: BrowserWindow
  capabilityCatalog: CapabilityCatalog
  browserWorkflowScopes: BrowserWorkflowScopeRegistry
  desktopControl: () => DesktopControlPlugin
  browserGame: () => BrowserGamePlugin
  onEvent?: (event: RuntimeEventInput) => void
}

export function createActionRuntime({
  window,
  capabilityCatalog,
  browserWorkflowScopes,
  desktopControl,
  browserGame,
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
    observe: (signal: AbortSignal) => desktopControl().observeBrowserForVerification(signal),
  }
  actions.registerVerifier(new BrowserNavigationVerifier(browserObservationProvider))
  actions.registerVerifier(new BrowserInteractionVerifier(browserObservationProvider))
  actions.registerVerifier(new BrowserActiveTabVerifier())
  actions.registerVerifier(new ShellExecutionVerifier())
  actions.register<EffectiveDesktopWorkflowRequest, DesktopWorkflowAdapterResult>({
    name: 'desktop.workflow',
    description: 'Execute a validated, bounded desktop automation workflow.',
    validate: (payload) => desktopControl().validateWorkflowRequest(payload),
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
    execute: (request, context) => desktopControl().executeWorkflow(request, context.signal),
  })
  actions.register<GameStartPreparation, BrowserGameStatus>({
    name: 'browser.game-session',
    description: 'Start one Action-authorized bounded browser game session.',
    validate: (payload) => {
      const action = browserGameControlActionSchema.parse(payload)
      if (action.operation !== 'start') throw new Error('Expected a game start action')
      return browserGame().getPreparedStart(action.preparationId)
    },
    authority: 'delegated-session',
    confirmation: (actionId, preparation) =>
      actionConfirmationRequestSchema.parse({
        schemaVersion: 1,
        actionId,
        tool: 'browser.game-session',
        goal: preparation.goal,
        origin: preparation.origin,
        surfaceId: preparation.surface.id,
        surfaceLabel: preparation.surface.label,
        allowedInputs: preparation.allowedInputs,
        maxDurationMs: preparation.maxDurationMs,
        maxInputEvents: preparation.maxInputEvents,
        maxInputEventsPerSecond: preparation.maxInputEventsPerSecond,
        navigation: preparation.navigation,
        requestedCapabilities: ['browser-game-control'],
        risk: 'normal',
      }),
    timeoutMs: 15_000,
    singleFlight: true,
    adapter: 'browser-game-control',
    execute: (preparation, context) =>
      browserGame()
        .getBrowserGameControlProvider()
        .start(preparation.preparationId, context.actionId, context.signal),
  })
  actions.register<Exclude<BrowserGameControlAction, { operation: 'start' }>, BrowserGameStatus>({
    name: 'browser.game-control',
    description: 'Pause, resume, stop, or tune one bounded browser game session.',
    validate: (payload) => {
      const action = browserGameControlActionSchema.parse(payload)
      if (action.operation === 'start') throw new Error('Expected a game control action')
      return action
    },
    authority: 'implicit',
    timeoutMs: 10_000,
    singleFlight: true,
    adapter: 'browser-game-control',
    execute: (action) => browserGame().executeControl(action),
  })
  actions.onEmergencyStop(() => {
    browserWorkflowScopes.releaseAll()
    return desktopControl().emergencyStop()
  })
  actions.onEmergencyStop(async () => {
    await browserGame().emergencyStop()
  })
  return { actions, confirmations }
}
