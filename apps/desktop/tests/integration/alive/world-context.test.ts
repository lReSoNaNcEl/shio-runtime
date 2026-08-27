import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { DEFAULT_AUTONOMY_SETTINGS } from '../../../src/main/alive/AliveStore'
import {
  SYSTEM_CONTEXT_PROBES,
  type SystemContextAdapter,
  type SystemContextProbe,
} from '../../../src/main/alive/SystemContextAdapter'
import { WindowsSystemContextAdapter } from '../../../src/main/alive/WindowsSystemContextAdapter'
import type { WindowsSystemContextWorkerClient } from '../../../src/main/alive/WindowsSystemContextWorker'
import { WorldContextRuntime } from '../../../src/main/alive/WorldContextRuntime'
import type { AutonomySettings } from '../../../src/shared/alive'

async function multiRateWorldProjection(): Promise<void> {
  let now = 1_000
  const requests: SystemContextProbe[][] = []
  let disposeCalls = 0
  const adapter: SystemContextAdapter = {
    observe: async (request) => {
      const probes = [...(request?.probes ?? SYSTEM_CONTEXT_PROBES)]
      requests.push(probes)
      return {
        capturedAt: now,
        globalUserIdleMs: now === 1_000 ? 45_000 : 0,
        sampledProbes: probes,
        ...(probes.includes('foreground-application')
          ? {
              foregroundApplication: {
                processName: now < 3_000 ? 'Code' : 'chrome',
                displayName: now < 3_000 ? 'Visual Studio Code' : 'Google Chrome',
                windowTitle: 'Sensitive document title',
              },
            }
          : {}),
        ...(probes.includes('running-applications')
          ? { runningApplications: [{ processName: 'Code' }, { processName: 'chrome' }] }
          : {}),
        ...(probes.includes('system-load') ? { system: { cpuLoad: 25, memoryLoad: 50 } } : {}),
        status: 'available' as const,
      }
    },
    dispose: () => {
      disposeCalls += 1
    },
  }
  const world = new WorldContextRuntime(
    adapter,
    {
      browser: () =>
        ({
          observationId: 'browser-observation-00000000-0000-4000-8000-000000000000',
          sessionId: 'browser-session-00000000-0000-4000-8000-000000000000',
          url: 'https://example.test/private',
          title: 'Private page',
          capturedAt: 1,
          content: '',
          interactiveElements: [],
          truncated: false,
        }) as never,
      project: () => ({ name: 'owner/private-project', branch: 'feature/private' }),
      activeGoal: () => ({ id: 'goal-1', title: 'Finish task', status: 'active' }) as never,
    },
    { now: () => now, pollIntervalMs: 60_000 },
  )
  world.updateRenderer({
    appFocused: false,
    userIdleMs: 90_000,
    conversationActive: false,
    audioActive: false,
    observedAt: 1_000,
  })

  await world.refresh()
  assert.deepEqual(requests[0], SYSTEM_CONTEXT_PROBES)
  const first = world.snapshot(DEFAULT_AUTONOMY_SETTINGS, 2_000)
  assert.equal(first.globalUserIdleMs, 45_000)
  assert.equal(first.foregroundApplication?.processName, 'Code')
  assert.equal(first.freshness.systemMs, 1_000)
  assert.deepEqual(first.freshness.systemSources, {
    globalIdleMs: 1_000,
    foregroundApplicationMs: 1_000,
    runningApplicationsMs: 1_000,
    systemLoadMs: 1_000,
  })
  assert.equal(first.activeBrowser?.sessionActive, true)
  assert.equal(first.activeProject?.branch, 'feature/private')
  assert.equal(first.activeGoal?.id, 'goal-1')

  now = 1_500
  await world.refresh({ force: false })
  assert.deepEqual(requests[1], [], 'cheap idle tick requested an expensive probe')
  const idleOnly = world.snapshot(DEFAULT_AUTONOMY_SETTINGS, now)
  assert.equal(idleOnly.globalUserIdleMs, 0)
  assert.equal(idleOnly.foregroundApplication?.processName, 'Code')
  assert.equal(idleOnly.freshness.systemSources?.globalIdleMs, 0)
  assert.equal(idleOnly.freshness.systemSources?.foregroundApplicationMs, 500)
  assert.equal(idleOnly.freshness.systemMs, 500)

  now = 3_000
  await world.refresh({ force: false })
  assert.deepEqual(requests[2], ['foreground-application'])
  assert.equal(
    world.snapshot(DEFAULT_AUTONOMY_SETTINGS, now).foregroundApplication?.processName,
    'chrome',
  )

  now = 11_000
  await world.refresh({ force: false })
  assert.deepEqual(requests[3], ['foreground-application', 'system-load'])

  now = 31_000
  await world.refresh({ force: false })
  assert.deepEqual(requests[4], SYSTEM_CONTEXT_PROBES)

  const privacy = world.snapshot(
    { ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true } as AutonomySettings,
    now,
  )
  assert.equal(privacy.foregroundApplication, undefined)
  assert.equal(privacy.runningApplications, undefined)
  assert.equal(privacy.activeProject, undefined)
  assert.deepEqual(privacy.activeBrowser, { sessionActive: true })
  assert.equal(JSON.stringify(privacy).includes('Sensitive document title'), false)
  assert.equal(JSON.stringify(privacy).includes('/private'), false)
  world.dispose()
  world.dispose()
  assert.equal(disposeCalls, 1, 'System Context Adapter disposal was not idempotent')
}

async function persistentWindowsWorker(): Promise<void> {
  let now = 1_000
  let failWorker = false
  let disposeCalls = 0
  const workerRequests: SystemContextProbe[][] = []
  const worker: WindowsSystemContextWorkerClient = {
    request: async (probes) => {
      workerRequests.push([...probes])
      if (failWorker) throw new Error('WORKER_FAILED')
      return {
        foregroundApplication: {
          processName: 'code',
          displayName: 'Visual Studio Code',
          windowTitle: 'Workspace',
        },
        runningApplications: [{ processName: 'code' }],
        system: { cpuLoad: 12.5, memoryLoad: 42 },
      }
    },
    dispose: () => {
      disposeCalls += 1
    },
  }
  const adapter = new WindowsSystemContextAdapter({
    getGlobalIdleSeconds: () => 12.5,
    pwshPath: 'unused-in-injected-test',
    now: () => now,
    worker,
  })

  const idleOnly = await adapter.observe({ probes: [] })
  assert.equal(idleOnly.globalUserIdleMs, 12_500)
  assert.equal(workerRequests.length, 0, 'idle-only sample contacted the PowerShell worker')

  const full = await adapter.observe({ probes: SYSTEM_CONTEXT_PROBES })
  assert.equal(workerRequests.length, 1)
  assert.equal(full.status, 'available')
  assert.equal(full.foregroundApplication?.processName, 'code')
  assert.deepEqual(full.sampledProbes, SYSTEM_CONTEXT_PROBES)

  failWorker = true
  now = 2_000
  const failed = await adapter.observe({ probes: ['system-load'] })
  assert.equal(failed.status, 'degraded')
  assert.deepEqual(failed.sampledProbes, [])
  assert.equal(workerRequests.length, 2)

  now = 3_000
  await adapter.observe({ probes: ['system-load'] })
  assert.equal(workerRequests.length, 2, 'worker circuit breaker ignored its retry delay')

  failWorker = false
  now = 7_000
  assert.equal((await adapter.observe({ probes: ['system-load'] })).status, 'available')
  assert.equal(workerRequests.length, 3)

  adapter.dispose()
  adapter.dispose()
  assert.equal(disposeCalls, 1)
}

describe('World Context Runtime integration', () => {
  it('maintains multi-rate freshness, privacy, and idempotent teardown', multiRateWorldProjection)
  it('reuses its injected worker and applies bounded failure backoff', persistentWindowsWorker)
})
