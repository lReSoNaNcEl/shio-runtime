import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type InvariantId,
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
  bodyActiveExecutionCount: 1,
  bodyPoseOwnerCount: 1,
  bodyTransitionRemaining: 0,
  bodyUnderruns: 0,
  bodyMotionState: 'ready',
  bodyPresentationMode: 'primary',
  currentBodyAnimation: 'talk_loop',
  currentBehaviorId: 'speaking',
  mouthMax: 0.4,
  facialActiveSources: ['lipSync', 'emotion', 'autoBlink', 'speakingEye', 'facialActing'],
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

interface InvariantCase {
  name: string
  expectId: InvariantId | null
  overrides: Partial<RuntimeInvariantInput>
}

const cases: InvariantCase[] = [
  { name: 'HEALTHY baseline', expectId: null, overrides: {} },
  {
    name: 'HEALTHY generated preparation without applied pose',
    expectId: null,
    overrides: { bodyMotionState: 'loading', bodyPoseOwnerCount: 0 },
  },
  {
    name: 'HEALTHY Overlay presentation without generator',
    expectId: null,
    overrides: { bodyPresentationMode: 'mirror', bodyActiveExecutionCount: 0 },
  },
  {
    name: 'INV-04 Overlay cannot own a generated execution',
    expectId: 'INV-04-single-skeleton-owner',
    overrides: { bodyPresentationMode: 'mirror' },
  },
  {
    name: 'INV-02 speaking but no playback',
    expectId: 'INV-02-noplayback-not-speaking',
    overrides: { playbackActive: false, activePlaybackId: 0 },
  },
  {
    name: 'INV-03 playing but no id',
    expectId: 'INV-03-playing-one-id',
    overrides: { playbackActive: true, activePlaybackId: 0 },
  },
  {
    name: 'INV-04 two skeleton owners, no transition',
    expectId: 'INV-04-single-skeleton-owner',
    overrides: { bodyPoseOwnerCount: 2, bodyTransitionRemaining: 0 },
  },
  {
    name: 'INV-05 character idle but avatar speaking',
    expectId: 'INV-05-idle-no-speaking-anim',
    overrides: {
      characterMode: 'idle',
      avatarMode: 'speaking',
      speechStatus: 'silent',
      isSpeaking: false,
      playbackActive: false,
      activePlaybackId: 0,
      conversationResponsePhase: 'waiting',
    },
  },
  {
    name: 'INV-06 phase speaking but no playback',
    expectId: 'INV-06-phase-speaking-playback',
    overrides: {
      isSpeaking: false,
      speechStatus: 'synthesizing',
      playbackActive: false,
      activePlaybackId: 0,
      conversationResponsePhase: 'speaking',
    },
  },
  {
    name: 'INV-07 LookAt disabled but eyes moving',
    expectId: 'INV-07-lookat-disabled-no-updates',
    overrides: {
      lookAtTarget: 'none',
      lookAtEyeYaw: 0.12,
      lookAtEyePitch: 0.03,
    },
  },
  {
    name: 'INV-08 Head Motion disabled but energy',
    expectId: 'INV-08-headmotion-disabled-no-updates',
    overrides: { headMotionActiveGenerators: [], headMotionEnergy: 0.25 },
  },
  {
    name: 'INV-09 foreign facial writer',
    expectId: 'INV-09-mixer-only-facial-writer',
    overrides: { facialEntrySources: ['lipSync', 'rogueWriter'] },
  },
  {
    name: 'INV-10 transition ownership gap',
    expectId: 'INV-10-transition-ownership',
    overrides: {
      bodyActiveExecutionCount: 1,
      bodyPoseOwnerCount: 0,
      bodyTransitionRemaining: 0.2,
    },
  },
  {
    name: 'INV-11 mouth high after speech',
    expectId: 'INV-11-mouth-release',
    overrides: {
      speechStatus: 'silent',
      isSpeaking: false,
      characterMode: 'idle',
      avatarMode: 'idle',
      conversationResponsePhase: 'waiting',
      playbackActive: false,
      activePlaybackId: 0,
      mouthMax: 0.55,
    },
  },
  {
    name: 'INV-12 missing core viseme',
    expectId: 'INV-12-supported-viseme-fallback',
    overrides: { facialSupportedVisemes: ['aa', 'ou', 'ee', 'oh'] },
  },
  {
    name: 'INV-14 invalid facial profile',
    expectId: 'INV-14-valid-facial-profile',
    overrides: { currentFacialProfile: 'unknown' },
  },
  {
    name: 'INV-15 profile release timeout',
    expectId: 'INV-15-profile-release-timeout',
    overrides: { facialStuckWarnings: ['mouth > 0.4 while LipSync is reset'] },
  },
]

describe('runtime state invariants', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it.each(cases)('$name', ({ expectId, overrides }) => {
    const validator = new RuntimeStateInvariantValidator()
    const input = { ...HEALTHY, ...overrides }
    validator.evaluate(input)
    const health = validator.evaluate({ ...input, now: 500, frame: 1 })

    if (expectId === null) {
      expect(health.failCount).toBe(0)
      expect(health.totalViolations).toBe(0)
    } else {
      expect(health.invariants).toContainEqual(
        expect.objectContaining({ id: expectId, status: 'fail' }),
      )
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`${expectId} VIOLATION`))
    }
  })

  it('reports a flat mouth once after the speaking grace and hold windows', () => {
    const validator = new RuntimeStateInvariantValidator()
    const flat = { ...HEALTHY, mouthMax: 0 }
    validator.evaluate(flat)
    expect(validator.evaluate({ ...flat, now: 799, frame: 1 }).failCount).toBe(0)
    validator.evaluate({ ...flat, now: 800, frame: 2 })
    expect(validator.evaluate({ ...flat, now: 1249, frame: 3 }).totalViolations).toBe(0)

    const health = validator.evaluate({ ...flat, now: 1250, frame: 4 })
    expect(health.lastViolation?.id).toBe('INV-01-speaking-lipsync')
    expect(validator.evaluate({ ...flat, now: 1700, frame: 5 }).totalViolations).toBe(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })
})
