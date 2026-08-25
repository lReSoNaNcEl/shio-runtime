import assert from 'node:assert/strict'

import { DEFAULT_AUTONOMY_SETTINGS } from '../../src/main/alive/AliveStore'
import type { SystemContextAdapter } from '../../src/main/alive/SystemContextAdapter'
import { WorldContextRuntime } from '../../src/main/alive/WorldContextRuntime'
import type { AutonomySettings } from '../../src/shared/alive'

async function main(): Promise<void> {
  let observation = 0
  const adapter: SystemContextAdapter = {
    observe: async () => {
      observation += 1
      return {
        capturedAt: 1_000 + observation,
        globalUserIdleMs: observation === 1 ? 45_000 : 0,
        foregroundApplication: {
          processName: observation === 1 ? 'Code' : 'chrome',
          displayName: observation === 1 ? 'Visual Studio Code' : 'Google Chrome',
          windowTitle: 'Sensitive document title',
        },
        runningApplications: [{ processName: 'Code' }, { processName: 'chrome' }],
        system: { cpuLoad: 25, memoryLoad: 50 },
        status: 'available' as const,
      }
    },
  }
  const world = new WorldContextRuntime(adapter, {
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
  })
  world.updateRenderer({
    appFocused: false,
    userIdleMs: 90_000,
    conversationActive: false,
    audioActive: false,
    observedAt: 1_000,
  })
  await world.refresh()
  const first = world.snapshot(DEFAULT_AUTONOMY_SETTINGS, 2_000)
  assert.equal(first.globalUserIdleMs, 45_000)
  assert.equal(first.foregroundApplication?.processName, 'Code')
  assert.equal(first.freshness.systemMs, 999)
  assert.equal(first.activeBrowser?.sessionActive, true)
  assert.equal(first.activeProject?.branch, 'feature/private')
  assert.equal(first.activeGoal?.id, 'goal-1')

  await world.refresh()
  const globallyActive = world.snapshot(DEFAULT_AUTONOMY_SETTINGS, 2_100)
  assert.equal(globallyActive.globalUserIdleMs, 0)
  assert.equal(globallyActive.foregroundApplication?.processName, 'chrome')
  assert.equal(globallyActive.userIdleMs, 0, 'Renderer-local idle overrode global activity')

  const privacy = world.snapshot(
    { ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true } as AutonomySettings,
    2_200,
  )
  assert.equal(privacy.foregroundApplication, undefined)
  assert.equal(privacy.runningApplications, undefined)
  assert.equal(privacy.activeProject, undefined)
  assert.deepEqual(privacy.activeBrowser, { sessionActive: true })
  assert.equal(JSON.stringify(privacy).includes('Sensitive document title'), false)
  assert.equal(JSON.stringify(privacy).includes('/private'), false)
  world.dispose()
  console.log('WORLD CONTEXT 2.0 REPRO PASS: foreground, global idle, freshness, privacy')
}

void main()
