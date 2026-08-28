import { describe, expect, it } from 'vitest'

import { resolveScreenContextSettlement } from '../../../src/renderer/components/chat/useScreenContextAttachment'

describe('screen context attachment settlement', () => {
  it('clears a capture consumed before a later renderer cancellation', () => {
    expect(
      resolveScreenContextSettlement({
        status: 'cancelled',
        attachmentDisposition: 'released',
      }),
    ).toEqual({ retain: false, state: 'empty' })
  })

  it('keeps a capture when generation was cancelled before Main consumed it', () => {
    expect(
      resolveScreenContextSettlement({
        status: 'cancelled',
        attachmentDisposition: 'retained',
      }),
    ).toEqual({ retain: true, state: 'retryable' })
  })

  it('removes an expired capture instead of leaving a stale attachment card', () => {
    expect(
      resolveScreenContextSettlement({
        status: 'failed',
        failure: {
          domain: 'screen-context',
          code: 'CAPTURE_EXPIRED',
          attachmentDisposition: 'expired',
          retrySameRequest: false,
          canResubmitWithoutImage: true,
        },
      }),
    ).toEqual({ retain: false, state: 'expired' })
  })
})
