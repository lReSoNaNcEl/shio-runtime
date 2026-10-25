import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { AvatarModel } from '../../src/renderer/avatar/rendering/two/AvatarModel'

describe('S22 secondary motion lifecycle', () => {
  it('reports unavailable presentation honestly and contains impulses before load', () => {
    const model = new AvatarModel()
    assert.equal(model.isLoaded(), false)
    assert.equal(model.triggerEarImpulse('direct-address'), false)
    assert.equal(model.getLastEarImpulseDecision()?.reason, 'presentation unavailable')
    assert.equal(model.getEarBehaviorDebugState().enabled, false)
    model.setEarAmplitudeScale(0.7)
    assert.equal(model.getEarBehaviorDebugState().amplitudeScale, 0.7)
    model.unload()
    model.dispose()
    model.dispose()
    assert.equal(model.getTailBehaviorDebugState().available, false)
  })
})
