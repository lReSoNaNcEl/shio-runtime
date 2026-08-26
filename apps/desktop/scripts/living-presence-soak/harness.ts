import assert from 'node:assert/strict'

import { DEFAULT_AUTONOMY_SETTINGS } from '../../src/main/alive/AliveStore'
import { AmbientPresencePolicy } from '../../src/main/alive/AmbientPresencePolicy'
import type { AmbientPresenceIntent, MoodState, WorldContextSnapshot } from '../../src/shared/alive'

const SOAK_DURATION_MS = 30 * 60_000
const EVENT_INTERVAL_MS = 35_000
const SAMPLE_INTERVAL_MS = 1_000
const MAX_HEAP_GROWTH_BYTES = 32 * 1024 * 1024

const mood: MoodState = {
  valence: 0.2,
  arousal: 0.4,
  confidence: 0.6,
  playfulness: 0.3,
  curiosity: 0.7,
  frustration: 0,
  updatedAt: 0,
}

interface SoakState {
  processName: string
  displayName: string
  globalUserIdleMs: number
  conversationActive: boolean
  audioActive: boolean
  mediaPlaying: boolean
  browserComputerUseScreenFocusActive: boolean
}

interface SelectedIntent {
  at: number
  intent: AmbientPresenceIntent
}

function snapshot(state: SoakState, at: number): WorldContextSnapshot {
  return {
    capturedAt: at,
    appFocused: state.processName === 'shio.exe',
    globalUserIdleMs: state.globalUserIdleMs,
    userIdleMs: state.globalUserIdleMs,
    conversationActive: state.conversationActive,
    audioActive: state.audioActive,
    privacyMode: false,
    lastUserActivityAt: at - state.globalUserIdleMs,
    foregroundApplication: {
      processName: state.processName,
      displayName: state.displayName,
    },
    media: { playing: state.mediaPlaying },
    system: { cpuLoad: 0.2, memoryLoad: 0.4 },
    systemAdapter: 'available',
    freshness: {
      state: 'fresh',
      capturedAt: at,
      expiresAt: at + 30_000,
      stale: false,
      renderer: 'fresh',
      system: 'fresh',
    },
  }
}

function nextState(stage: number, current: SoakState): SoakState {
  switch (stage % 8) {
    case 0:
      return {
        ...current,
        processName: 'chrome.exe',
        displayName: 'Chrome',
        conversationActive: false,
        browserComputerUseScreenFocusActive: false,
      }
    case 1:
      return { ...current, mediaPlaying: true }
    case 2:
      return { ...current, globalUserIdleMs: 6 * 60_000 }
    case 3:
      return { ...current, globalUserIdleMs: 0 }
    case 4:
      return {
        ...current,
        processName: 'shio.exe',
        displayName: 'Shio',
        browserComputerUseScreenFocusActive: true,
      }
    case 5:
      return {
        ...current,
        processName: 'webstorm.exe',
        displayName: 'WebStorm',
        conversationActive: true,
        browserComputerUseScreenFocusActive: false,
      }
    case 6:
      return { ...current, conversationActive: false, mediaPlaying: false }
    default:
      return { ...current, processName: 'chrome.exe', displayName: 'Chrome' }
  }
}

async function main(): Promise<void> {
  const policy = new AmbientPresencePolicy()
  const startedAt = Date.now()
  const heapBaseline = process.memoryUsage().heapUsed
  let heapPeak = heapBaseline
  let state: SoakState = {
    processName: 'webstorm.exe',
    displayName: 'WebStorm',
    globalUserIdleMs: 0,
    conversationActive: false,
    audioActive: false,
    mediaPlaying: false,
    browserComputerUseScreenFocusActive: false,
  }
  let previous = snapshot(state, startedAt)
  let stage = 0
  let nextEventAt = startedAt
  let nextProgressAt = startedAt + 60_000
  let browserFocusSuppressions = 0
  let conversationSuppressions = 0
  const visited = new Set<string>([state.processName])
  const selected: SelectedIntent[] = []

  while (Date.now() - startedAt < SOAK_DURATION_MS) {
    const now = Date.now()
    const eventDue = now >= nextEventAt
    if (eventDue) {
      state = nextState(stage, state)
      stage += 1
      nextEventAt += EVENT_INTERVAL_MS
      visited.add(state.processName)
    }
    const current = snapshot(state, now)
    const intent = policy.decide({
      previous,
      current,
      settings: DEFAULT_AUTONOMY_SETTINGS,
      mood,
      browserComputerUseScreenFocusActive: state.browserComputerUseScreenFocusActive,
      at: now,
    })
    if (intent) selected.push({ at: now, intent })
    if (eventDue && state.browserComputerUseScreenFocusActive) {
      assert.equal(intent, null, 'active browser gaze must suppress ambient presence')
      browserFocusSuppressions += 1
    }
    if (eventDue && state.conversationActive) {
      assert.equal(intent, null, 'active user conversation must suppress ambient presence')
      conversationSuppressions += 1
    }
    previous = current
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed)

    if (now >= nextProgressAt) {
      console.log('Living Presence soak progress', {
        elapsedMs: now - startedAt,
        selectedIntents: selected.length,
        foreground: state.processName,
        browserFocus: state.browserComputerUseScreenFocusActive,
        conversationActive: state.conversationActive,
      })
      nextProgressAt += 60_000
    }
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS))
  }

  assert.deepEqual([...visited].sort(), ['chrome.exe', 'shio.exe', 'webstorm.exe'])
  assert(browserFocusSuppressions >= 1)
  assert(conversationSuppressions >= 1)
  assert(selected.length >= 8, 'presence should remain subtly observable')
  assert(
    selected.length <= Math.ceil(SOAK_DURATION_MS / 30_000),
    'presence must remain cooldown-bounded',
  )
  for (const [index, item] of selected.entries()) {
    assert.equal(item.intent.embodiment?.intensity, 'subtle')
    assert.equal('speech' in item.intent, false)
    assert.equal('text' in item.intent, false)
    if (index > 0) {
      assert(item.at - (selected[index - 1]?.at ?? 0) >= 30_000)
      assert.notEqual(
        item.intent.attention,
        selected[index - 1]?.intent.attention,
        'the same ambient reaction must not repeat consecutively',
      )
    }
  }
  assert(heapPeak - heapBaseline < MAX_HEAP_GROWTH_BYTES)
  console.log('Living Presence thirty-minute soak passed', {
    durationMs: Date.now() - startedAt,
    selectedIntents: selected.length,
    gameSuppressions,
    conversationSuppressions,
    heapGrowthBytes: heapPeak - heapBaseline,
  })
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
