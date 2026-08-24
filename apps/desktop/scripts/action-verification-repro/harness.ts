import assert from 'node:assert/strict'

import {
  ActionError,
  ActionPermissionGuard,
  ActionRuntime,
  ActionVerificationCancelledError,
  type ActionVerificationRequest,
  type ActionVerificationResult,
  type ActionVerifier,
  BrowserActiveTabVerifier,
  BrowserInteractionVerifier,
  BrowserNavigationVerifier,
  buildActionResultNarrationContext,
  desktopWorkflowVerificationPolicy,
  isVerifiedSuccess,
  ShellExecutionVerifier,
  safeDesktopWorkflowRecovery,
  toDesktopWorkflowActionResult,
} from '../../src/main/action'
import type {
  BrowserExecutionEvidence,
  DesktopWorkflowAdapterResult,
  ShellExecutionEvidence,
} from '../../src/main/desktop-control'
import { actionResultFallback } from '../../src/main/orchestrator'
import { type DesktopWorkflowRequest, desktopWorkflowRequestSchema } from '../../src/shared/actions'
import type { BrowserObservation } from '../../src/shared/desktop-control'

type Executor = (
  request: DesktopWorkflowRequest,
  signal: AbortSignal,
) => Promise<DesktopWorkflowAdapterResult> | DesktopWorkflowAdapterResult

function observation(
  serial: number,
  url: string,
  content: string,
  interactiveElements: BrowserObservation['interactiveElements'] = [],
): BrowserObservation {
  return {
    observationId: `browser-observation-00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
    sessionId: 'browser-session-00000000-0000-4000-8000-000000000000',
    url,
    title: content,
    capturedAt: serial,
    content,
    interactiveElements,
    truncated: false,
  }
}

function browserResult(evidence: BrowserExecutionEvidence): DesktopWorkflowAdapterResult {
  return { runtimeCompleted: true, evidence }
}

function shellEvidence(overrides: Partial<ShellExecutionEvidence> = {}): ShellExecutionEvidence {
  return {
    kind: 'shell',
    exitCode: 0,
    stdout: 'v24.19.0',
    stderr: '',
    truncated: false,
    durationMs: 8,
    timedOut: false,
    aborted: false,
    ...overrides,
  }
}

function shellRequest(goal: string, risk: DesktopWorkflowRequest['risk'] = 'normal') {
  return desktopWorkflowRequestSchema.parse({
    type: 'desktop.workflow',
    goal,
    shellCommand: goal,
    requestedCapabilities: ['shell'],
    risk,
  })
}

function openRequest(goal: string, url = 'https://expected.example/path') {
  return desktopWorkflowRequestSchema.parse({
    type: 'desktop.workflow',
    goal,
    browserOperation: { operation: 'open', url },
    requestedCapabilities: ['browser'],
    risk: 'normal',
  })
}

function switchTabRequest(tabId = 'tab-catalog') {
  return desktopWorkflowRequestSchema.parse({
    type: 'desktop.workflow',
    goal: 'Switch to the catalog tab',
    browserOperation: { operation: 'switch-tab', tabId },
    requestedCapabilities: ['browser'],
    risk: 'normal',
  })
}

function clickRequest(goal: string) {
  return desktopWorkflowRequestSchema.parse({
    type: 'desktop.workflow',
    goal,
    browserOperation: {
      operation: 'click',
      target: {
        kind: 'semantic-ref',
        observationId: 'browser-observation-00000000-0000-4000-8000-000000000001',
        ref: 'e1',
      },
    },
    requestedCapabilities: ['browser'],
    risk: 'normal',
  })
}

function createRuntime(options: {
  executor: Executor
  mode?: 'confirm' | 'full'
  observe?: (signal: AbortSignal) => Promise<BrowserObservation>
  confirmationCount?: { value: number }
  recover?: boolean
  singleFlight?: boolean
}) {
  const guard = new ActionPermissionGuard({
    authorityMode: () => options.mode ?? 'full',
    requestConfirmation: async () => {
      if (options.confirmationCount) options.confirmationCount.value += 1
      return 'confirm'
    },
  })
  const runtime = new ActionRuntime({
    permissionGuard: guard,
    authorityMode: () => options.mode ?? 'full',
    cancelPendingConfirmations: () => undefined,
  })
  const provider = {
    observe:
      options.observe ??
      (async () => {
        throw new Error('observation unavailable')
      }),
  }
  runtime.registerVerifier(new BrowserNavigationVerifier(provider))
  runtime.registerVerifier(new BrowserInteractionVerifier(provider))
  runtime.registerVerifier(new BrowserActiveTabVerifier())
  runtime.registerVerifier(new ShellExecutionVerifier())
  runtime.register<DesktopWorkflowRequest, DesktopWorkflowAdapterResult>({
    name: 'desktop.workflow',
    description: 'Action verification focused repro Tool',
    validate: (payload) => desktopWorkflowRequestSchema.parse(payload),
    authority: 'desktop-workflow',
    confirmation: (actionId, request) => ({
      schemaVersion: 1,
      actionId,
      tool: 'desktop.workflow',
      goal: request.goal,
      shellCommand: request.shellCommand,
      browserOperation: request.browserOperation,
      requestedCapabilities: request.requestedCapabilities,
      risk: request.risk,
    }),
    verification: desktopWorkflowVerificationPolicy,
    recover: options.recover ? (request) => safeDesktopWorkflowRecovery(request) : undefined,
    singleFlight: options.singleFlight ?? true,
    execute: (request, context) => options.executor(request, context.signal),
  })
  return runtime
}

async function main(): Promise<void> {
  const before = observation(1, 'https://expected.example/home', 'home', [
    { ref: 'e1', role: 'button', name: 'Catalog' },
  ])
  const after = observation(2, 'https://expected.example/catalog', 'catalog', [])

  const verifiedOpenRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'open',
        requestedUrl: 'https://expected.example/path',
        before,
        after,
      }),
  })
  const verifiedOpen = await verifiedOpenRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: openRequest('verified open') })
  assert.equal(verifiedOpen.execution?.status, 'success')
  assert.equal(verifiedOpen.verification?.status, 'verified')
  assert.equal(verifiedOpen.status, 'success')
  assert.equal(verifiedOpen.error, undefined)
  assert.equal(isVerifiedSuccess(verifiedOpen), true)

  const wrongUrlRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'open',
        requestedUrl: 'https://expected.example/path',
        before,
        after: observation(3, 'https://wrong.example/', 'wrong'),
      }),
  })
  const wrongUrl = await wrongUrlRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: openRequest('wrong open') })
  assert.equal(wrongUrl.execution?.status, 'success')
  assert.equal(wrongUrl.verification?.status, 'failed')
  assert.equal(wrongUrl.status, 'failure')
  assert.equal(isVerifiedSuccess(wrongUrl), false)

  const switchedTabRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'switch-tab',
        requestedTabId: 'tab-catalog',
        after,
        afterSession: {
          sessionId: after.sessionId,
          status: 'ready',
          currentUrl: after.url,
          currentTitle: after.title,
          activeTabId: 'tab-catalog',
          openedAt: 1,
          updatedAt: 2,
        },
      }),
  })
  const switchedTab = await switchedTabRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: switchTabRequest() })
  assert.equal(switchedTab.verification?.status, 'verified')
  assert.equal(switchedTab.status, 'success')

  const changedClickRuntime = createRuntime({
    executor: () =>
      browserResult({ kind: 'browser', operation: 'click', targetName: 'Catalog', before, after }),
  })
  const changedClick = await changedClickRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: clickRequest('changed click') })
  assert.equal(changedClick.verification?.status, 'verified')
  assert.equal(changedClick.status, 'success')

  const unchangedClickRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'click',
        targetName: 'Catalog',
        before,
        after: observation(4, before.url, before.content, before.interactiveElements),
      }),
  })
  const unchangedClick = await unchangedClickRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: clickRequest('unchanged click') })
  assert.equal(unchangedClick.execution?.status, 'success')
  assert.equal(unchangedClick.verification?.status, 'unverified')
  assert.equal(unchangedClick.status, 'failure')

  const targetDisappearedRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'click',
        targetName: 'Catalog',
        before,
        after: observation(5, before.url, before.content, []),
      }),
  })
  const targetDisappeared = await targetDisappearedRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: clickRequest('target disappeared') })
  assert.equal(targetDisappeared.verification?.status, 'verified')

  const deadBrowserRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'click',
        before,
        observationErrorCode: 'BROWSER_UNAVAILABLE',
      }),
  })
  const deadBrowser = await deadBrowserRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: clickRequest('dead browser') })
  assert.equal(deadBrowser.verification?.status, 'failed')
  assert.notEqual(deadBrowser.status, 'success')

  const textOnlyDshRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'workflow',
        before,
        after,
        browserToolCalls: 0,
        successfulBrowserToolResults: 0,
      }),
  })
  const textOnlyDsh = await textOnlyDshRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({
    name: 'desktop.workflow',
    payload: {
      type: 'desktop.workflow',
      goal: 'DSH says Done without browser tools',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    },
  })
  assert.equal(textOnlyDsh.verification?.status, 'failed')

  const toolBackedDshRuntime = createRuntime({
    executor: () =>
      browserResult({
        kind: 'browser',
        operation: 'workflow',
        before,
        after,
        browserToolCalls: 1,
        successfulBrowserToolResults: 1,
      }),
  })
  const toolBackedDsh = await toolBackedDshRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({
    name: 'desktop.workflow',
    payload: {
      type: 'desktop.workflow',
      goal: 'DSH browser workflow with observed change',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    },
  })
  assert.equal(toolBackedDsh.verification?.status, 'verified')

  const transportFailureRuntime = createRuntime({
    executor: () => {
      throw new ActionError(
        'DSH_TRANSPORT_CLOSED',
        'Transport closed after a browser mutation',
        'failure',
        true,
        'desktop-control',
        {
          kind: 'browser',
          operation: 'workflow',
          before,
          after,
          browserToolCalls: 1,
          successfulBrowserToolResults: 1,
        } satisfies BrowserExecutionEvidence,
      )
    },
  })
  const transportFailure = await transportFailureRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({
    name: 'desktop.workflow',
    payload: {
      type: 'desktop.workflow',
      goal: 'Transport failure after real mutation',
      requestedCapabilities: ['browser'],
      risk: 'normal',
    },
  })
  assert.equal(transportFailure.execution?.status, 'failure')
  assert.equal(transportFailure.verification?.status, 'verified')
  assert.equal(transportFailure.status, 'failure')

  const shellRuntime = createRuntime({
    executor: () => ({
      runtimeCompleted: true,
      reportedOutcome: 'v24.19.0',
      evidence: shellEvidence(),
    }),
  })
  const nodeVersion = await shellRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: shellRequest('node -v') })
  assert.equal(nodeVersion.verification?.status, 'verified')
  assert.equal(nodeVersion.status, 'success')
  const narrationContext = JSON.stringify(
    buildActionResultNarrationContext(toDesktopWorkflowActionResult(nodeVersion)),
  )
  assert.match(narrationContext, /v24\.19\.0/)
  assert(!/(?:exitCode|stdout|stderr|rpcMethod|pid)/u.test(narrationContext))

  const failedShellRuntime = createRuntime({
    executor: () => {
      throw new ActionError('DSH_REMOTE_ERROR', 'Command failed', 'failure', true, undefined, {
        ...shellEvidence({ exitCode: 1, stdout: '', stderr: 'failed' }),
      })
    },
  })
  const failedShell = await failedShellRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: shellRequest('exit 1') })
  assert.equal(failedShell.execution?.status, 'failure')
  assert.equal(failedShell.verification?.status, 'failed')
  assert.equal(failedShell.status, 'failure')

  const truncatedShellRuntime = createRuntime({
    executor: () => ({
      runtimeCompleted: true,
      reportedOutcome: 'bounded summary',
      evidence: shellEvidence({ stdout: 'x'.repeat(64_000), truncated: true }),
    }),
  })
  const truncatedShell = await truncatedShellRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: shellRequest('large informational output') })
  assert.equal(truncatedShell.verification?.status, 'verified')

  let mutationExecutions = 0
  const mutationRuntime = createRuntime({
    recover: true,
    executor: () => {
      mutationExecutions += 1
      return {
        runtimeCompleted: true,
        evidence: shellEvidence({ stdout: '' }),
      }
    },
  })
  const mutation = await mutationRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: shellRequest('New-Item C:\\fixture', 'destructive') })
  assert.equal(mutation.execution?.status, 'success')
  assert.equal(mutation.verification?.status, 'unverified')
  assert.equal(mutation.status, 'failure')
  assert.equal(mutationExecutions, 1, 'Generic shell mutation was automatically rerun')

  let recoveryExecutions = 0
  const recoveryRuntime = createRuntime({
    recover: true,
    executor: () => {
      recoveryExecutions += 1
      return browserResult({
        kind: 'browser',
        operation: 'open',
        requestedUrl: 'https://expected.example/path',
        before,
        after:
          recoveryExecutions === 1
            ? observation(6, 'https://wrong.example/', 'wrong')
            : observation(7, 'https://expected.example/path', 'recovered'),
      })
    },
  })
  const recovered = await recoveryRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: openRequest('safe recovery') })
  assert.equal(recoveryExecutions, 2)
  assert.equal(recovered.status, 'success')
  assert.equal(recovered.verification?.status, 'verified')
  assert.equal(recovered.recovery?.attempted, true)

  let unsafeClickExecutions = 0
  const unsafeRecoveryRuntime = createRuntime({
    recover: true,
    executor: () => {
      unsafeClickExecutions += 1
      return browserResult({
        kind: 'browser',
        operation: 'click',
        before,
        after: observation(8, before.url, before.content, before.interactiveElements),
      })
    },
  })
  const unsafeClick = await unsafeRecoveryRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: clickRequest('Submit') })
  assert.equal(unsafeClick.verification?.status, 'unverified')
  assert.equal(unsafeClickExecutions, 1, 'Potentially non-idempotent click was retried')

  const confirmationCount = { value: 0 }
  const confirmRuntime = createRuntime({
    mode: 'confirm',
    confirmationCount,
    executor: () => ({
      runtimeCompleted: true,
      reportedOutcome: 'v24.19.0',
      evidence: shellEvidence(),
    }),
  })
  const confirmed = await confirmRuntime.execute<
    DesktopWorkflowRequest,
    DesktopWorkflowAdapterResult
  >({ name: 'desktop.workflow', payload: shellRequest('node -v') })
  assert.equal(confirmationCount.value, 1)
  assert.equal(confirmed.authorization, 'confirmed')
  assert.equal(confirmed.verification?.status, 'verified')
  assert.equal(nodeVersion.authorization, 'full')
  assert.equal(nodeVersion.verification?.status, confirmed.verification?.status)

  let deniedExecutions = 0
  const deniedGuard = {
    authorize: async () => {
      throw new ActionError('ACTION_PERMISSION_DENIED', 'Permission denied', 'permission-denied')
    },
  } as unknown as ActionPermissionGuard
  const deniedRuntime = new ActionRuntime({
    permissionGuard: deniedGuard,
    authorityMode: () => 'confirm',
    cancelPendingConfirmations: () => undefined,
  })
  let deniedVerifications = 0
  deniedRuntime.registerVerifier({
    id: 'denied-probe',
    verify: async () => {
      deniedVerifications += 1
      return verifiedResult()
    },
  })
  deniedRuntime.register({
    name: 'denied',
    description: 'Permission denied probe',
    validate: (payload) => payload,
    authority: 'desktop-workflow',
    confirmation: (actionId) => ({
      schemaVersion: 1,
      actionId,
      tool: 'desktop.workflow',
      goal: 'denied',
      shellCommand: 'node -v',
      requestedCapabilities: ['shell'],
      risk: 'normal',
    }),
    verification: { mode: 'execution-evidence', verifier: 'denied-probe' },
    execute: async () => {
      deniedExecutions += 1
    },
  })
  const denied = await deniedRuntime.execute({ name: 'denied', payload: undefined })
  assert.equal(denied.status, 'permission-denied')
  assert.equal(deniedExecutions, 0)
  assert.equal(deniedVerifications, 0)

  let slowStarted!: () => void
  const slowStartedPromise = new Promise<void>((resolve) => {
    slowStarted = resolve
  })
  let lateVerifierMutation = 0
  const slowVerifier: ActionVerifier = {
    id: 'slow-verifier',
    verify: (request) =>
      new Promise((resolve, reject) => {
        slowStarted()
        const timer = setTimeout(() => {
          lateVerifierMutation += 1
          resolve(verifiedResult())
        }, 80)
        request.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(new ActionVerificationCancelledError())
          },
          { once: true },
        )
      }),
  }
  const slowRuntime = simpleVerificationRuntime(slowVerifier, 500)
  const slowAction = slowRuntime.execute({ name: 'probe', payload: 'slow' })
  await slowStartedPromise
  assert.equal(slowRuntime.snapshot().activeActionPhase, 'verifying')
  await slowRuntime.emergencyStop()
  const cancelled = await slowAction
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.recovery, undefined)
  await delay(100)
  assert.equal(lateVerifierMutation, 0)

  const timeoutVerifier: ActionVerifier = {
    id: 'timeout-verifier',
    verify: (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new ActionVerificationCancelledError()),
          { once: true },
        )
      }),
  }
  const verificationTimeoutRuntime = simpleVerificationRuntime(timeoutVerifier, 10)
  const verificationTimeout = await verificationTimeoutRuntime.execute({
    name: 'probe',
    payload: 'timeout',
  })
  assert.equal(verificationTimeout.execution?.status, 'success')
  assert.equal(verificationTimeout.verification?.status, 'unverified')
  assert.equal(verificationTimeout.verification?.reasonCode, 'verification-timeout')
  assert.equal(verificationTimeout.status, 'failure')

  let staleStarted!: () => void
  const staleStartedPromise = new Promise<void>((resolve) => {
    staleStarted = resolve
  })
  const staleVerifier: ActionVerifier = {
    id: 'stale-verifier',
    verify: async (request: ActionVerificationRequest) => {
      if (request.payload === 'A') {
        staleStarted()
        await delay(80)
      }
      return verifiedResult()
    },
  }
  const staleRuntime = simpleVerificationRuntime(staleVerifier, 500)
  const actionA = staleRuntime.execute({ name: 'probe', payload: 'A' })
  await staleStartedPromise
  await staleRuntime.emergencyStop()
  assert.equal((await actionA).status, 'cancelled')
  const actionB = await staleRuntime.execute({ name: 'probe', payload: 'B' })
  assert.equal(actionB.status, 'success')
  await delay(100)
  const actionBLog = staleRuntime
    .snapshot()
    .recentActions.find((entry) => entry.actionId === actionB.actionId)
  assert.equal(actionBLog?.outcome, 'success')
  assert.equal(actionBLog?.verificationStatus, 'verified')

  const unverifiedPresentation = toDesktopWorkflowActionResult(unchangedClick)
  const unverifiedFallback = actionResultFallback(
    unverifiedPresentation,
    'Нажми кнопку',
    'ru',
    true,
  )
  assert(!/(?:готово|успешно|сделано)/iu.test(unverifiedFallback))
  assert.match(unverifiedFallback, /не смогла над[её]жно подтвердить/iu)
  const failedFallback = actionResultFallback(
    toDesktopWorkflowActionResult(wrongUrl),
    'Открой страницу',
    'ru',
    true,
  )
  assert(!/(?:готово|успешно|сделано)/iu.test(failedFallback))
  const verifiedFallback = actionResultFallback(
    toDesktopWorkflowActionResult(verifiedOpen),
    'Открой страницу',
    'ru',
    true,
  )
  assert.match(verifiedFallback, /готово/iu)
  const cancelledFallback = actionResultFallback(
    {
      actionId: cancelled.actionId,
      tool: 'desktop.workflow',
      outcome: 'cancelled',
      execution: { runtimeCompleted: false, verification: 'failed' },
      errorCode: 'ACTION_CANCELLED',
      error: 'Action cancelled by Emergency Stop',
    },
    'Открой страницу',
    'ru',
    true,
  )
  assert.match(cancelledFallback, /отменена/iu)
  assert(!/(?:готово|успешно|сделано)/iu.test(cancelledFallback))

  const audit = recoveryRuntime.snapshot().recentActions
  assert(audit.some((entry) => entry.lifecycle.includes('verification-started')))
  assert(audit.some((entry) => entry.lifecycle.includes('verification-completed')))
  assert(audit.some((entry) => entry.recoveryAttempted === true))
  assert(audit.every((entry) => JSON.stringify(entry).length < 2_000))

  console.log('Action Verification & Recovery v1 focused repro: PASS')
}

function simpleVerificationRuntime(verifier: ActionVerifier, timeoutMs: number): ActionRuntime {
  const guard = new ActionPermissionGuard({
    authorityMode: () => 'full',
    requestConfirmation: async () => 'confirm',
  })
  const runtime = new ActionRuntime({
    permissionGuard: guard,
    authorityMode: () => 'full',
    cancelPendingConfirmations: () => undefined,
  })
  runtime.registerVerifier(verifier)
  runtime.register<string, { ok: true }>({
    name: 'probe',
    description: 'Verification cancellation and stale-result probe',
    validate: (payload) => String(payload),
    verification: {
      mode: 'post-state',
      verifier: verifier.id,
      timeoutMs,
      retrySafety: 'never-auto',
    },
    execute: async () => ({ ok: true }),
  })
  return runtime
}

function verifiedResult(): ActionVerificationResult {
  return {
    status: 'verified',
    evidence: [],
    summary: 'verified',
    observedAt: Date.now(),
    durationMs: 0,
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
