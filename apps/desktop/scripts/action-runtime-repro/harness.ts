import assert from 'node:assert/strict'

import { z } from 'zod'

import {
  ActionConfirmationBroker,
  ActionPermissionGuard,
  ActionRuntime,
} from '../../src/main/action'
import {
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

  console.log('Action Runtime authority, lifecycle, validation and Emergency Stop repro: PASS')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
