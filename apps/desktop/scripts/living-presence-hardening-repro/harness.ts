import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_AUTONOMY_SETTINGS } from '../../src/main/alive/AliveStore'
import { AmbientPresencePolicy } from '../../src/main/alive/AmbientPresencePolicy'
import { ConversationThreadRuntime } from '../../src/main/conversation-threads'
import type { MoodState, WorldContextSnapshot } from '../../src/shared/alive'

const mood: MoodState = {
  valence: 0.2,
  arousal: 0.4,
  confidence: 0.6,
  playfulness: 0.3,
  curiosity: 0.7,
  frustration: 0,
  updatedAt: 1_000,
}

function world(overrides: Partial<WorldContextSnapshot> = {}): WorldContextSnapshot {
  return {
    capturedAt: 1_000,
    appFocused: true,
    globalUserIdleMs: 0,
    userIdleMs: 0,
    conversationActive: false,
    audioActive: false,
    privacyMode: false,
    lastUserActivityAt: 1_000,
    foregroundApplication: { processName: 'webstorm.exe', displayName: 'WebStorm' },
    systemAdapter: 'available',
    freshness: {
      state: 'fresh',
      capturedAt: 1_000,
      expiresAt: 31_000,
      stale: false,
      renderer: 'fresh',
      system: 'fresh',
    },
    ...overrides,
  }
}

function ambientPresenceContract(): void {
  const policy = new AmbientPresencePolicy()
  const foreground = policy.decide({
    previous: world(),
    current: world({
      capturedAt: 2_000,
      foregroundApplication: { processName: 'chrome.exe', displayName: 'Chrome' },
    }),
    settings: DEFAULT_AUTONOMY_SETTINGS,
    mood,
    browserComputerUseScreenFocusActive: false,
    at: 2_000,
  })
  assert.equal(foreground?.attention, 'foreground-change')
  assert.equal(foreground?.embodiment?.gazeHint, 'screen')

  const cooldown = policy.decide({
    previous: world({ globalUserIdleMs: 6 * 60_000 }),
    current: world({ globalUserIdleMs: 0 }),
    settings: DEFAULT_AUTONOMY_SETTINGS,
    mood,
    browserComputerUseScreenFocusActive: false,
    at: 3_000,
  })
  assert.equal(cooldown, null, 'many world changes must remain cooldown-bounded')

  const busyPolicy = new AmbientPresencePolicy()
  assert.equal(
    busyPolicy.decide({
      previous: world(),
      current: world({
        conversationActive: true,
        foregroundApplication: { processName: 'chrome.exe' },
      }),
      settings: DEFAULT_AUTONOMY_SETTINGS,
      mood,
      browserComputerUseScreenFocusActive: false,
      at: 40_000,
    }),
    null,
    'active conversation must win over ambient presence',
  )
  assert.equal(
    busyPolicy.decide({
      previous: world(),
      current: world({ foregroundApplication: { processName: 'chrome.exe' } }),
      settings: DEFAULT_AUTONOMY_SETTINGS,
      mood,
      browserComputerUseScreenFocusActive: true,
      at: 80_000,
    }),
    null,
    'active browser computer-use gaze must not be displaced',
  )
  assert.equal(
    busyPolicy.decide({
      previous: world(),
      current: world({ foregroundApplication: { processName: 'chrome.exe' } }),
      settings: { ...DEFAULT_AUTONOMY_SETTINGS, privacyMode: true },
      mood,
      browserComputerUseScreenFocusActive: false,
      at: 120_000,
    }),
    null,
  )
}

function threadContract(path: string): void {
  const runtime = new ConversationThreadRuntime(path)
  const first = runtime.open(
    {
      topic: 'Browser computer use',
      summary: 'The substantive implementation discussion was interrupted.',
      status: 'interrupted',
      salience: 0.8,
    },
    'turn-substantive',
    1_000,
  )
  runtime.open(
    {
      topic: 'Waiting for fixture data',
      summary: 'The user will provide a fixture before the discussion continues.',
      status: 'waiting-user',
      salience: 0.7,
    },
    'turn-waiting',
    2_000,
  )
  const awareness = runtime.awareness(3_000)
  assert.equal(awareness.length, 1)
  assert.equal(awareness[0]?.status, 'waiting-user')
  assert.equal('memoryId' in (awareness[0] ?? {}), false)
  assert.equal('goalId' in (awareness[0] ?? {}), false)

  const resolved = runtime.resolve(first.id, 4_000)
  assert.equal(resolved.status, 'resolved')
  assert.equal(
    runtime.awareness(4_000).some((thread) => thread.id === first.id),
    false,
  )

  const expiring = runtime.open(
    { topic: 'Short-lived branch', summary: 'A temporary conversational branch.' },
    'turn-expiring',
    5_000,
  )
  assert.equal(
    runtime.awareness(expiring.expiresAt + 1).some((item) => item.id === expiring.id),
    false,
  )
  runtime.close()
}

async function main(): Promise<void> {
  ambientPresenceContract()
  const directory = await mkdtemp(join(tmpdir(), 'shio-living-presence-'))
  try {
    const threadPath = join(directory, 'conversation', 'threads.sqlite')
    threadContract(threadPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  console.log('living presence hardening repro passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
