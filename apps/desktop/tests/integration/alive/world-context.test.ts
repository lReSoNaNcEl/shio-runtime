import assert from 'node:assert/strict'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import { AliveFacade } from '../../../src/main/alive/AliveFacade'
import { AliveStore, DEFAULT_AUTONOMY_SETTINGS } from '../../../src/main/alive/AliveStore'
import {
  SYSTEM_CONTEXT_PROBES,
  type SystemContextAdapter,
  type SystemContextObservation,
  type SystemContextProbe,
} from '../../../src/main/alive/SystemContextAdapter'
import { WindowsSystemContextAdapter } from '../../../src/main/alive/WindowsSystemContextAdapter'
import type { WindowsSystemContextWorkerClient } from '../../../src/main/alive/WindowsSystemContextWorker'
import { WorldContextRuntime } from '../../../src/main/alive/WorldContextRuntime'
import type { AutonomySettings } from '../../../src/shared/alive'
import { createTempDirectory } from '../../support'

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
  assert.deepEqual(requests[0], ['foreground-application'])
  const first = world.snapshot(DEFAULT_AUTONOMY_SETTINGS, 2_000)
  assert.equal(first.globalUserIdleMs, 45_000)
  assert.equal(first.foregroundApplication?.processName, 'Code')
  assert.equal(first.freshness.systemMs, 1_000)
  assert.deepEqual(first.freshness.systemSources, {
    globalIdleMs: 1_000,
    foregroundApplicationMs: 1_000,
  })
  assert.equal(first.activeBrowser?.sessionActive, true)
  assert.equal(first.activeProject?.branch, 'feature/private')
  assert.equal('activeGoal' in first, false)

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
  assert.deepEqual(requests[3], ['foreground-application'])

  now = 31_000
  await world.refresh({ force: false })
  assert.deepEqual(requests[4], ['foreground-application'])

  const applicationsRequest = world.listRunningApplications()
  assert.strictEqual(world.listRunningApplications(), applicationsRequest)
  assert.deepEqual(await applicationsRequest, [{ processName: 'Code' }, { processName: 'chrome' }])
  assert.deepEqual(requests[5], ['running-applications'])
  assert.equal('runningApplications' in world.snapshot(DEFAULT_AUTONOMY_SETTINGS), false)

  const privacy = world.snapshot(
    { ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true } as AutonomySettings,
    now,
  )
  assert.equal(privacy.foregroundApplication, undefined)
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
  const failed = await adapter.observe({ probes: ['foreground-application'] })
  assert.equal(failed.status, 'degraded')
  assert.deepEqual(failed.sampledProbes, [])
  assert.equal(workerRequests.length, 2)

  now = 3_000
  await adapter.observe({ probes: ['foreground-application'] })
  assert.equal(workerRequests.length, 2, 'worker circuit breaker ignored its retry delay')

  failWorker = false
  now = 7_000
  assert.equal((await adapter.observe({ probes: ['foreground-application'] })).status, 'available')
  assert.equal(workerRequests.length, 3)

  adapter.dispose()
  adapter.dispose()
  assert.equal(disposeCalls, 1)
}

describe('World Context Runtime integration', () => {
  it('maintains multi-rate freshness, privacy, and idempotent teardown', multiRateWorldProjection)
  it('reuses its injected worker and applies bounded failure backoff', persistentWindowsWorker)

  it('blocks the on-demand application list before and during a private session', async () => {
    const directory = await createTempDirectory('shio-running-applications-')
    const store = new AliveStore(join(directory.path, 'alive.sqlite'))
    const observation: SystemContextObservation = {
      capturedAt: 1_000,
      globalUserIdleMs: 0,
      status: 'available',
    }
    const applications = Promise.withResolvers<SystemContextObservation>()
    let requests = 0
    const runtime = new AliveFacade(store, {
      systemContextAdapter: {
        observe: async (request) => {
          if (!request?.probes.includes('running-applications')) return observation
          requests += 1
          return applications.promise
        },
      },
    })
    runtime.start()
    try {
      runtime.updateSettings({ ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true })
      assert.deepEqual(await runtime.getRunningApplications(), { status: 'private' })
      assert.equal(requests, 0)

      runtime.updateSettings(DEFAULT_AUTONOMY_SETTINGS)
      const pending = runtime.getRunningApplications()
      assert.equal(requests, 1)
      runtime.updateSettings({ ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true })
      applications.resolve({ ...observation, runningApplications: [{ processName: 'example' }] })
      assert.deepEqual(await pending, { status: 'private' })
    } finally {
      runtime.dispose()
      await directory.cleanup()
    }
  })
})
