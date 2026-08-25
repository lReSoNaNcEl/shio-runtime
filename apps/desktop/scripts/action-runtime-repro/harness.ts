import assert from 'node:assert/strict'

import { z } from 'zod'

import {
  ActionConfirmationBroker,
  ActionPermissionGuard,
  ActionRuntime,
} from '../../src/main/action'
import {
  BrowserWorkflowScopeRegistry,
  type EffectiveDesktopWorkflowRequest,
} from '../../src/main/desktop-control/browser-agent'
import {
  actionRuntimeActivity,
  desktopWorkflowActivity,
  isDesktopWorkflowActive,
} from '../../src/renderer/components/actions/actionRuntimePresentation'
import {
  actionConfirmationRequestSchema,
  actionRuntimeSnapshotSchema,
  type DesktopAuthorityMode,
  type DesktopWorkflowRequest,
  desktopWorkflowRequestSchema,
} from '../../src/shared/actions'
import type { RuntimeEventInput } from '../../src/shared/runtime'

async function main(): Promise<void> {
  let mode: DesktopAuthorityMode = 'confirm'
  let executionCount = 0
  let emergencyCleanupCount = 0
  const actionConfirmationEvents: Parameters<ActionConfirmationBroker['requestAction']>[0][] = []
  const authorityConfirmationEvents: Parameters<ActionConfirmationBroker['requestAuthority']>[0][] =
    []
  const runtimeEvents: RuntimeEventInput[] = []
  const snapshots: string[] = []

  const confirmations = new ActionConfirmationBroker(
    (request) => actionConfirmationEvents.push(request),
    (request) => authorityConfirmationEvents.push(request),
    1_000,
  )
  const guard = new ActionPermissionGuard({
    authorityMode: () => mode,
    requestConfirmation: (request) => confirmations.requestAction(request),
  })
  const runtime = new ActionRuntime({
    permissionGuard: guard,
    authorityMode: () => mode,
    cancelPendingConfirmations: () => confirmations.cancelAll(),
    onEvent: (event) => runtimeEvents.push(event),
    onChanged: (snapshot) =>
      snapshots.push(JSON.stringify(actionRuntimeSnapshotSchema.parse(snapshot))),
  })
  runtime.onEmergencyStop(() => {
    emergencyCleanupCount += 1
  })

  const workflow = (goal: string): DesktopWorkflowRequest => ({
    type: 'desktop.workflow',
    goal,
    shellCommand: 'systeminfo',
    requestedCapabilities: ['shell'],
    risk: 'normal',
  })

  runtime.register<DesktopWorkflowRequest, { runtimeCompleted: boolean }>({
    name: 'desktop.workflow',
    description: 'Action Runtime focused repro tool',
    validate: (payload) => desktopWorkflowRequestSchema.parse(payload),
    authority: 'desktop-workflow',
    confirmation: (actionId, request) =>
      actionConfirmationRequestSchema.parse({
        schemaVersion: 1,
        actionId,
        tool: request.type,
        goal: request.goal,
        shellCommand: request.shellCommand,
        browserOperation: request.browserOperation,
        requestedCapabilities: request.requestedCapabilities,
        risk: request.risk,
      }),
    adapter: 'fake-automation-adapter',
    timeoutMs: 500,
    singleFlight: true,
    execute: async (_request, context) => {
      executionCount += 1
      if (_request.goal === 'wait') {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
      }
      return { runtimeCompleted: true }
    },
  })

  let finishSpeechAction: (() => void) | null = null
  runtime.register({
    name: 'speech.wait',
    description: 'Non-desktop action presentation repro',
    validate: (payload) => z.undefined().parse(payload),
    execute: () =>
      new Promise<void>((resolve) => {
        finishSpeechAction = resolve
      }),
  })

  const speechAction = runtime.execute({ name: 'speech.wait', payload: undefined })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(runtime.snapshot().activeActionId)
  assert.equal(
    isDesktopWorkflowActive(runtime.snapshot()),
    false,
    'A speech action was presented as an active desktop workflow',
  )
  assert(finishSpeechAction)
  finishSpeechAction()
  await speechAction

  const confirmed = runtime.execute({
    name: 'desktop.workflow',
    payload: workflow('SECRET_ACTION_GOAL_DO_NOT_LOG'),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(actionConfirmationEvents.length, 1)
  assert.equal(actionConfirmationEvents[0].shellCommand, 'systeminfo')
  assert.equal(isDesktopWorkflowActive(runtime.snapshot()), true)
  assert.equal(desktopWorkflowActivity(runtime.snapshot()), 'awaiting-confirmation')
  assert.equal(executionCount, 0)
  assert(
    confirmations.respondToAction({
      actionId: actionConfirmationEvents[0].actionId,
      decision: 'confirm',
    }),
  )
  const confirmedResult = await confirmed
  assert.equal(confirmedResult.status, 'success')
  assert.equal(confirmedResult.authorization, 'confirmed')
  assert.equal(executionCount, 1)

  const cancelled = runtime.execute({
    name: 'desktop.workflow',
    payload: {
      type: 'desktop.workflow',
      goal: 'Click the exact Catalog button',
      browserOperation: {
        operation: 'click',
        target: {
          kind: 'accessible-name',
          observationId: 'browser-observation-00000000-0000-4000-8000-000000000000',
          role: 'button',
          name: 'Catalog',
        },
      },
      requestedCapabilities: ['browser'],
      risk: 'normal',
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(actionConfirmationEvents[1].browserOperation?.operation, 'click')
  assert(
    confirmations.respondToAction({
      actionId: actionConfirmationEvents[1].actionId,
      decision: 'cancel',
    }),
  )
  const cancelledResult = await cancelled
  assert.equal(cancelledResult.status, 'cancelled')
  assert.equal(executionCount, 1, 'Permission-denied browser click reached the Adapter')

  mode = 'full'
  runtime.notifyAuthorityModeChanged()
  const fullResult = await runtime.execute({ name: 'desktop.workflow', payload: workflow('full') })
  assert.equal(fullResult.status, 'success')
  assert.equal(fullResult.authorization, 'full')
  assert.equal(actionConfirmationEvents.length, 2, 'Full mode requested confirmation')
  assert.equal(executionCount, 2)

  const invalid = await runtime.execute({
    name: 'desktop.workflow',
    payload: {
      type: 'desktop.workflow',
      goal: '',
      requestedCapabilities: ['unknown'],
      risk: 'normal',
    },
  })
  assert.equal(invalid.status, 'failure')
  assert.equal(invalid.errorCode, 'ACTION_VALIDATION_FAILED')
  assert.equal(executionCount, 2)

  mode = 'confirm'
  runtime.notifyAuthorityModeChanged()
  const emergencyPending = runtime.execute({
    name: 'desktop.workflow',
    payload: workflow('emergency pending'),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await runtime.emergencyStop()
  assert.equal((await emergencyPending).status, 'cancelled')
  assert.equal(executionCount, 2)

  mode = 'full'
  const running = runtime.execute({ name: 'desktop.workflow', payload: workflow('wait') })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(runtime.snapshot().activeActionId)
  assert.equal(isDesktopWorkflowActive(runtime.snapshot()), true)
  assert.equal(desktopWorkflowActivity(runtime.snapshot()), 'executing')
  await runtime.emergencyStop()
  assert.equal((await running).status, 'cancelled')
  assert.equal(emergencyCleanupCount, 2)

  const next = await runtime.execute({ name: 'desktop.workflow', payload: workflow('next') })
  assert.equal(next.status, 'success')
  assert.equal(next.authorization, 'full')

  const authorityPromise = confirmations.requestAuthority({
    requestId: `authority-${Date.now()}-00000000-0000-4000-8000-000000000000`,
    requestedMode: 'full',
  })
  assert.equal(authorityConfirmationEvents.length, 1)
  assert(
    confirmations.respondToAuthority({
      requestId: authorityConfirmationEvents[0].requestId,
      decision: 'confirm',
    }),
  )
  assert.equal(await authorityPromise, 'confirm')

  const events = runtimeEvents.map((event) => event.type)
  for (const required of [
    'ToolRequested',
    'ToolValidated',
    'ToolAuthorized',
    'ToolStarted',
    'ToolCompleted',
    'ToolCancelled',
  ]) {
    assert(
      events.includes(required as RuntimeEventInput['type']),
      `Missing lifecycle event ${required}`,
    )
  }
  assert(snapshots.length > 0)
  const serializedLog = JSON.stringify(runtime.snapshot().recentActions)
  assert(!serializedLog.includes('emergency pending'))
  assert(!serializedLog.includes('SECRET_ACTION_GOAL_DO_NOT_LOG'))

  const undefinedTool = new ActionRuntime({
    permissionGuard: guard,
    authorityMode: () => mode,
    cancelPendingConfirmations: () => confirmations.cancelAll(),
  })
  undefinedTool.register({
    name: 'timeout',
    description: 'Timeout probe',
    validate: (payload) => z.undefined().parse(payload),
    timeoutMs: 10,
    execute: () => new Promise(() => undefined),
  })
  const timeoutResult = await undefinedTool.execute({ name: 'timeout', payload: undefined })
  assert.equal(timeoutResult.status, 'timeout')
  assert.equal(timeoutResult.errorCode, 'ACTION_TIMEOUT')

  mode = 'confirm'
  const gameConfirmations: Parameters<ActionConfirmationBroker['requestAction']>[0][] = []
  const gameBroker = new ActionConfirmationBroker(
    (request) => gameConfirmations.push(request),
    () => undefined,
    1_000,
  )
  const gameRuntime = new ActionRuntime({
    permissionGuard: new ActionPermissionGuard({
      authorityMode: () => mode,
      requestConfirmation: (request) => gameBroker.requestAction(request),
    }),
    authorityMode: () => mode,
    cancelPendingConfirmations: () => gameBroker.cancelAll(),
  })
  let gameExecutionCount = 0
  gameRuntime.register<{ preparationId: string }, { state: 'running'; actionId: string }>({
    name: 'browser.game-session',
    description: 'Delegated browser game session repro tool',
    validate: (payload) =>
      z
        .object({ preparationId: z.string().min(1) })
        .strict()
        .parse(payload),
    authority: 'delegated-session',
    confirmation: (actionId) =>
      actionConfirmationRequestSchema.parse({
        schemaVersion: 1,
        actionId,
        tool: 'browser.game-session',
        goal: 'Play the bounded fixture',
        origin: 'https://game.example.test',
        surfaceId: 'game-surface-0',
        surfaceLabel: 'Fixture canvas',
        allowedInputs: ['pointer', 'keyboard'],
        maxDurationMs: 300_000,
        maxInputEvents: 5_000,
        maxInputEventsPerSecond: 15,
        navigation: 'same-origin-only',
        requestedCapabilities: ['browser-game-control'],
        risk: 'normal',
      }),
    execute: (_payload, context) => {
      gameExecutionCount += 1
      return { state: 'running', actionId: context.actionId }
    },
  })
  const gameStart = gameRuntime.execute({
    name: 'browser.game-session',
    payload: { preparationId: 'fixture-preparation' },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(gameConfirmations.length, 1)
  assert.equal(gameConfirmations[0].tool, 'browser.game-session')
  assert.deepEqual(gameConfirmations[0].requestedCapabilities, ['browser-game-control'])
  assert.equal(actionRuntimeActivity(gameRuntime.snapshot()), 'awaiting-confirmation')
  assert.equal(gameExecutionCount, 0)
  assert(
    gameBroker.respondToAction({
      actionId: gameConfirmations[0].actionId,
      decision: 'confirm',
    }),
  )
  const gameResult = await gameStart
  assert.equal(gameResult.status, 'success')
  assert.equal(gameResult.authorization, 'confirmed')
  assert.equal(gameResult.result?.actionId, gameResult.actionId)
  assert.equal(gameExecutionCount, 1)

  mode = 'full'
  const fullGameResult = await gameRuntime.execute({
    name: 'browser.game-session',
    payload: { preparationId: 'second-preparation' },
  })
  assert.equal(fullGameResult.authorization, 'full')
  assert.equal(gameConfirmations.length, 1)
  assert.equal(gameExecutionCount, 2)

  const scopedConfirmations: Parameters<ActionConfirmationBroker['requestAction']>[0][] = []
  const scopedBroker = new ActionConfirmationBroker(
    (request) => scopedConfirmations.push(request),
    () => undefined,
    1_000,
  )
  const scopes = new BrowserWorkflowScopeRegistry()
  const scopedGuard = new ActionPermissionGuard({
    authorityMode: () => mode,
    requestConfirmation: (request) => scopedBroker.requestAction(request),
    authorizeScope: (scopeId, confirmation, requestConfirmation) =>
      scopes.authorize(scopeId, confirmation, {
        authorityMode: mode,
        requestConfirmation,
      }),
  })
  let scopedExecutionCount = 0
  const scopedRuntime = new ActionRuntime({
    permissionGuard: scopedGuard,
    authorityMode: () => mode,
    cancelPendingConfirmations: () => scopedBroker.cancelAll(),
    cancelConfirmation: (actionId) => {
      scopedBroker.cancelAction(actionId)
    },
  })
  scopedRuntime.register<EffectiveDesktopWorkflowRequest, { runtimeCompleted: boolean }>({
    name: 'desktop.workflow',
    description: 'Scoped browser workflow repro tool',
    validate: (payload) => {
      const { browserRiskClass, ...request } = payload as EffectiveDesktopWorkflowRequest
      return { ...desktopWorkflowRequestSchema.parse(request), browserRiskClass }
    },
    authority: 'desktop-workflow',
    confirmation: (actionId, request, actionRequest) =>
      actionConfirmationRequestSchema.parse({
        schemaVersion: 1,
        actionId,
        tool: request.type,
        goal: scopes.confirmationGoal(actionRequest.authorizationScopeId, request.goal),
        browserOperation: request.browserOperation,
        browserRiskClass: request.browserRiskClass,
        requestedCapabilities: request.requestedCapabilities,
        risk: request.risk,
      }),
    execute: async (request, context) => {
      scopedExecutionCount += 1
      if (request.goal === 'wait scoped') {
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
      }
      return { runtimeCompleted: true }
    },
  })

  const workflowSignal = new AbortController()
  mode = 'confirm'
  const scope = scopes.create('Inspect two safe pages', workflowSignal.signal)
  const firstScoped = scopedRuntime.execute({
    name: 'desktop.workflow',
    authorizationScopeId: scope.workflowId,
    signal: workflowSignal.signal,
    payload: {
      type: 'desktop.workflow',
      goal: 'Model-generated substep text',
      browserOperation: { operation: 'observe' },
      browserRiskClass: 'read',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    } as EffectiveDesktopWorkflowRequest,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(scopedConfirmations.length, 1)
  assert.equal(scopedConfirmations[0].goal, 'Inspect two safe pages')
  assert(
    scopedBroker.respondToAction({
      actionId: scopedConfirmations[0].actionId,
      decision: 'confirm',
    }),
  )
  assert.equal((await firstScoped).authorization, 'confirmed')
  const secondScoped = await scopedRuntime.execute({
    name: 'desktop.workflow',
    authorizationScopeId: scope.workflowId,
    signal: workflowSignal.signal,
    payload: {
      type: 'desktop.workflow',
      goal: 'Open the next safe page',
      browserOperation: { operation: 'open', url: 'https://example.com/' },
      browserRiskClass: 'navigation',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    } as EffectiveDesktopWorkflowRequest,
  })
  assert.equal(secondScoped.authorization, 'confirmed')
  assert.equal(scopedConfirmations.length, 1, 'Safe scoped action requested a second confirmation')

  mode = 'full'
  const fullScope = scopes.create('Read in Full Control', new AbortController().signal)
  const fullScoped = await scopedRuntime.execute({
    name: 'desktop.workflow',
    authorizationScopeId: fullScope.workflowId,
    payload: {
      type: 'desktop.workflow',
      goal: 'Observe',
      browserOperation: { operation: 'observe' },
      browserRiskClass: 'read',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    } as EffectiveDesktopWorkflowRequest,
  })
  assert.equal(fullScoped.authorization, 'full')
  assert.equal(scopedConfirmations.length, 1)

  const criticalScope = scopes.create(
    'Buy only after explicit approval',
    new AbortController().signal,
  )
  const critical = scopedRuntime.execute({
    name: 'desktop.workflow',
    authorizationScopeId: criticalScope.workflowId,
    payload: {
      type: 'desktop.workflow',
      goal: 'Click Buy',
      browserOperation: {
        operation: 'click',
        target: {
          kind: 'accessible-name',
          observationId: 'browser-observation-00000000-0000-4000-8000-000000000000',
          role: 'button',
          name: 'Buy',
        },
      },
      browserRiskClass: 'financial',
      requestedCapabilities: ['browser'],
      risk: 'destructive',
    } as EffectiveDesktopWorkflowRequest,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(scopedConfirmations.length, 2)
  assert.equal(scopedExecutionCount, 3, 'Critical Full Control action executed before approval')
  assert(
    scopedBroker.respondToAction({
      actionId: scopedConfirmations[1].actionId,
      decision: 'confirm',
    }),
  )
  assert.equal((await critical).authorization, 'confirmed')

  mode = 'confirm'
  const deniedScope = scopes.create('Denied browser workflow', new AbortController().signal)
  const denied = scopedRuntime.execute({
    name: 'desktop.workflow',
    authorizationScopeId: deniedScope.workflowId,
    payload: {
      type: 'desktop.workflow',
      goal: 'Observe denied',
      browserOperation: { operation: 'observe' },
      browserRiskClass: 'read',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    } as EffectiveDesktopWorkflowRequest,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(scopedConfirmations.length, 3)
  assert(
    scopedBroker.respondToAction({
      actionId: scopedConfirmations[2].actionId,
      decision: 'cancel',
    }),
  )
  assert.equal((await denied).status, 'cancelled')
  assert.equal(scopedExecutionCount, 4)

  mode = 'full'
  const abortController = new AbortController()
  const abortScope = scopes.create('Cancel current browser step', abortController.signal)
  const externallyCancelled = scopedRuntime.execute({
    name: 'desktop.workflow',
    authorizationScopeId: abortScope.workflowId,
    signal: abortController.signal,
    payload: {
      type: 'desktop.workflow',
      goal: 'wait scoped',
      browserOperation: { operation: 'observe' },
      browserRiskClass: 'read',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    } as EffectiveDesktopWorkflowRequest,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  abortController.abort()
  assert.equal((await externallyCancelled).status, 'cancelled')
  scopes.releaseAll()

  console.log('Action Runtime authority, lifecycle, validation and Emergency Stop repro: PASS')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
