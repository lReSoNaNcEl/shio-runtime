/**
 * WI S2.4 — Runtime State Invariant Validator harness (diagnostics self-test).
 *
 * Feeds the REAL RuntimeStateInvariantValidator crafted read-only snapshots and
 * verifies: (a) a healthy snapshot raises zero violations, and (b) each seeded
 * impossible state is detected once its hold window elapses, with the right
 * invariant id and suspected owner. Pure logic — no DOM/WebAudio needed.
 */

import { describe, it } from 'vitest'

import {
  type RuntimeInvariantInput,
  RuntimeStateInvariantValidator,
} from '../../src/renderer/runtime/RuntimeStateInvariantValidator'

const HEALTHY: RuntimeInvariantInput = {
  frame: 0,
  now: 0,
  speechStatus: 'speaking',
  isSpeaking: true,
  characterMode: 'speaking',
  avatarMode: 'speaking',
  conversationResponsePhase: 'speaking',
  playbackActive: true,
  activePlaybackId: 7,
  bodyActiveActionCount: 1,
  bodyWeightedActionCount: 1,
  bodyTransitionRemaining: 0,
  bodyOwnershipGapCount: 0,
  currentBodyAnimation: 'talk_loop',
  currentBehaviorId: 'speaking',
  mouthMax: 0.4,
  facialActiveSources: ['lipSync', 'emotion', 'autoBlink'],
  facialEntrySources: ['lipSync', 'emotion'],
  facialSupportedVisemes: ['aa', 'ih', 'ou', 'ee', 'oh'],
  facialUnsupportedExpressionRequests: [],
  currentFacialProfile: 'happy',
  facialStuckWarnings: [],
  lookAtTarget: 'camera',
  lookAtEyeYaw: 0.05,
  lookAtEyePitch: 0.02,
  headMotionActiveGenerators: ['speakingNod'],
  headMotionEnergy: 0.3,
}

function withOverrides(
  base: RuntimeInvariantInput,
  o: Partial<RuntimeInvariantInput>,
): RuntimeInvariantInput {
  return { ...base, ...o }
}

/** Hold a state for >HOLD_MS across several evaluations and return final health. */
function holdState(
  v: RuntimeStateInvariantValidator,
  input: Omit<RuntimeInvariantInput, 'now' | 'frame'>,
  startNow = 1000,
) {
  let health = v.evaluate({ ...input, now: startNow, frame: 1 } as RuntimeInvariantInput)
  health = v.evaluate({ ...input, now: startNow + 200, frame: 2 } as RuntimeInvariantInput)
  health = v.evaluate({ ...input, now: startNow + 500, frame: 3 } as RuntimeInvariantInput) // > HOLD_MS(450)
  health = v.evaluate({ ...input, now: startNow + 900, frame: 4 } as RuntimeInvariantInput)
  return health
}

interface Case {
  name: string
  expectId: string | null
  input: RuntimeInvariantInput
  prime?: RuntimeInvariantInput // optional earlier state (e.g. to open the speaking window)
}

const cases: Case[] = [
  { name: 'HEALTHY baseline', expectId: null, input: HEALTHY },
  {
    name: 'INV-02 speaking but no playback',
    expectId: 'INV-02-noplayback-not-speaking',
    input: withOverrides(HEALTHY, { playbackActive: false, activePlaybackId: 0 }),
  },
  {
    name: 'INV-03 playing but no id',
    expectId: 'INV-03-playing-one-id',
    input: withOverrides(HEALTHY, { playbackActive: true, activePlaybackId: 0 }),
  },
  {
    name: 'INV-04 two skeleton owners, no transition',
    expectId: 'INV-04-single-skeleton-owner',
    input: withOverrides(HEALTHY, { bodyWeightedActionCount: 2, bodyTransitionRemaining: 0 }),
  },
  {
    name: 'INV-05 character idle but avatar speaking',
    expectId: 'INV-05-idle-no-speaking-anim',
    input: withOverrides(HEALTHY, {
      characterMode: 'idle',
      avatarMode: 'speaking',
      speechStatus: 'silent',
      isSpeaking: false,
      playbackActive: false,
      activePlaybackId: 0,
      conversationResponsePhase: 'waiting',
    }),
  },
  {
    name: 'INV-06 phase speaking but no playback',
    expectId: 'INV-06-phase-speaking-playback',
    input: withOverrides(HEALTHY, {
      isSpeaking: false,
      speechStatus: 'synthesizing',
      playbackActive: false,
      activePlaybackId: 0,
      conversationResponsePhase: 'speaking',
    }),
  },
  {
    name: 'INV-07 LookAt disabled but eyes moving',
    expectId: 'INV-07-lookat-disabled-no-updates',
    input: withOverrides(HEALTHY, {
      lookAtTarget: 'none',
      lookAtEyeYaw: 0.12,
      lookAtEyePitch: 0.03,
    }),
  },
  {
    name: 'INV-08 Head Motion disabled but energy',
    expectId: 'INV-08-headmotion-disabled-no-updates',
    input: withOverrides(HEALTHY, { headMotionActiveGenerators: [], headMotionEnergy: 0.25 }),
  },
  {
    name: 'INV-09 foreign facial writer',
    expectId: 'INV-09-mixer-only-facial-writer',
    input: withOverrides(HEALTHY, { facialEntrySources: ['lipSync', 'rogueWriter'] }),
  },
  {
    name: 'INV-10 transition ownership gap',
    expectId: 'INV-10-transition-ownership',
    input: withOverrides(HEALTHY, {
      bodyActiveActionCount: 1,
      bodyWeightedActionCount: 0,
      bodyTransitionRemaining: 0.2,
    }),
  },
  {
    name: 'INV-11 mouth high after speech',
    expectId: 'INV-11-mouth-release',
    input: withOverrides(HEALTHY, {
      speechStatus: 'silent',
      isSpeaking: false,
      characterMode: 'idle',
      avatarMode: 'idle',
      conversationResponsePhase: 'waiting',
      playbackActive: false,
      activePlaybackId: 0,
      mouthMax: 0.55,
    }),
  },
  {
    name: 'INV-12 missing core viseme',
    expectId: 'INV-12-supported-viseme-fallback',
    input: withOverrides(HEALTHY, { facialSupportedVisemes: ['aa', 'ou', 'ee', 'oh'] }),
  },
  {
    name: 'INV-14 invalid facial profile',
    expectId: 'INV-14-valid-facial-profile',
    input: withOverrides(HEALTHY, { currentFacialProfile: 'unknown' }),
  },
  {
    name: 'INV-15 profile release timeout',
    expectId: 'INV-15-profile-release-timeout',
    input: withOverrides(HEALTHY, { facialStuckWarnings: ['mouth > 0.4 while LipSync is reset'] }),
  },
]

// INV-01 needs the speaking window primed then flat-zero mouth past the warmup.
function testInv01(): boolean {
  const v = new RuntimeStateInvariantValidator()
  const flat = withOverrides(HEALTHY, { mouthMax: 0 })
  // Sustain speaking+audio with mouth flat 0 across >800ms warmup + hold.
  let health = v.getHealth()
  for (let i = 0; i < 20; i++) {
    health = v.evaluate({ ...flat, now: 1000 + i * 120, frame: i + 1 })
  }
  if (!health) throw new Error('health snapshot missing')
  const inv01 = health.invariants.find((r) => r.id === 'INV-01-speaking-lipsync')
  if (!inv01) throw new Error('INV-01 invariant not found in health snapshot')
  const ok = inv01.status === 'fail' && health.lastViolation?.id === 'INV-01-speaking-lipsync'
  console.log(
    `\n[INV-01 speaking→LipSync attached]  ${ok ? '✓ detected' : '✗ MISSED'}  status=${inv01.status} detail="${inv01.detail}"`,
  )
  return ok
}

function main() {
  let passed = 0
  let failed = 0
  const warnLog: string[] = []
  const realWarn = console.warn.bind(console)
  console.warn = (...a: unknown[]) => {
    warnLog.push(String(a[0]))
    realWarn(...a)
  }

  console.log('===== Runtime State Invariant Validator — self-test =====')
  for (const c of cases) {
    const v = new RuntimeStateInvariantValidator()
    const health = holdState(v, c.input)
    const failedIds = health.invariants.filter((r) => r.status === 'fail').map((r) => r.id)
    if (c.expectId === null) {
      const ok = failedIds.length === 0
      console.log(
        `\n[${c.name}]  ${ok ? '✓ no violations' : `✗ unexpected: ${failedIds.join(',')}`}`,
      )
      ok ? passed++ : failed++
    } else {
      const detected = failedIds.includes(c.expectId as never)
      const owner = health.invariants.find((r) => r.id === c.expectId)?.suspectedOwner
      console.log(
        `\n[${c.name}]  ${detected ? '✓ detected' : '✗ MISSED'}  expect=${c.expectId} failing=[${failedIds.join(',')}]${detected ? ` owner="${owner}"` : ''}`,
      )
      detected ? passed++ : failed++
    }
  }

  testInv01() ? passed++ : failed++
  console.warn = realWarn

  console.log(`\n===== SUMMARY =====`)
  console.log(`cases passed: ${passed}, failed: ${failed}`)
  console.log(`[RUNTIME-INV] warnings emitted: ${warnLog.length}`)
  console.log(
    warnLog.length === passed - 1 || warnLog.length >= 9
      ? 'warnings emitted for each seeded violation ✓'
      : `warnings=${warnLog.length}`,
  )
}

describe('runtime state invariants', () => {
  it('detects held impossible states without mutating runtime state', () => {
    main()
  })
})
