import { describe, expect, it } from 'vitest'

import { actionExperienceEvent } from '../../../src/main/app/ActionExperienceBridge'

describe('Action Experience bridge', () => {
  it('projects only verified completion and permission-denial events', () => {
    expect(
      actionExperienceEvent(
        {
          type: 'ToolCompleted',
          category: 'action',
          source: 'main.actionRuntime',
          metadata: { actionId: 'action-verified', verificationStatus: 'verified' },
        },
        100,
      ),
    ).toEqual({
      type: 'action-verified',
      at: 100,
      actionId: 'action-verified',
      eventId: 'action-runtime:ToolCompleted:action-verified',
    })
    expect(
      actionExperienceEvent({
        type: 'ToolCompleted',
        category: 'action',
        source: 'main.actionRuntime',
        metadata: { actionId: 'action-unverified', verificationStatus: 'not-required' },
      }),
    ).toBeNull()
    expect(
      actionExperienceEvent(
        {
          type: 'PermissionDenied',
          category: 'action',
          source: 'main.actionRuntime',
          metadata: { actionId: 'action-denied' },
        },
        101,
      ),
    ).toEqual({
      type: 'permission-denied',
      at: 101,
      actionId: 'action-denied',
      eventId: 'action-runtime:PermissionDenied:action-denied',
    })
  })
})
