import { vi } from 'vitest'

import {
  MOTION_CATALOG_REVISION,
  type MotionApi,
  type MotionChunk,
  type MotionLease,
  type MotionPlanIdentity,
} from '../../../src/shared/motion'

/** Only the transport boundary: production playback, timing and safety remain real. */
export function createMockMotionApi(
  options: { lease?: MotionLease; next?: MotionApi['next'] } = {},
) {
  const lease = options.lease ?? createMotionLease()
  return {
    start: vi.fn<MotionApi['start']>(async () => ({ ok: true, lease })),
    next: vi.fn<MotionApi['next']>(
      options.next ??
        (async (input) => {
          const fromFrame = input.fromFrame ?? 0
          return {
            ok: true,
            chunk: createMotionChunk({
              ...input.lease,
              plan: input.plan,
              profileId: input.profileId,
              fromFrame,
              startFrame: fromFrame,
              reset: fromFrame === 0,
            }),
          }
        }),
    ),
    stop: vi.fn<MotionApi['stop']>(async () => ({ ok: true })),
  } satisfies Pick<MotionApi, 'start' | 'next' | 'stop'>
}

export function createMotionLease(overrides: Partial<MotionLease> = {}): MotionLease {
  return {
    sessionId: 'test',
    epoch: 1,
    modelGeneration: 1,
    avatarGeneration: 1,
    seed: 42,
    ...overrides,
  }
}

export function createMotionPlan(overrides: Partial<MotionPlanIdentity> = {}): MotionPlanIdentity {
  return {
    executionId: 'fixture',
    planRevision: 0,
    catalogRevision: MOTION_CATALOG_REVISION,
    phaseId: 'prepare',
    handScoreRevision: 'presence_poised-hands-v1',
    handRigCalibrationRevision: 'vrm-normalized-hands-v1',
    clockDomain: 'local',
    playbackId: null,
    continuityAnchor: 'anchor',
    ...overrides,
  }
}

export function createMotionChunk(overrides: Partial<MotionChunk> = {}): MotionChunk {
  return {
    ...createMotionLease(),
    protocolVersion: 2,
    plan: createMotionPlan(),
    type: 'motion',
    id: 1,
    reset: true,
    fromFrame: 0,
    profileId: 'presence_poised',
    skeleton: 'soma30-standard-tpose-v1',
    fps: 30,
    startFrame: 0,
    rotations: Array.from({ length: 60 }, () => Array.from({ length: 30 }, () => [0, 0, 0, 1])),
    rootPositions: Array.from({ length: 60 }, () => [0, 0.9887084839474641, 0]),
    footContacts: Array.from({ length: 60 }, () => ({
      leftHeel: 1,
      leftToe: 1,
      rightHeel: 1,
      rightToe: 1,
    })),
    inferenceMs: 100,
    ...overrides,
  }
}
