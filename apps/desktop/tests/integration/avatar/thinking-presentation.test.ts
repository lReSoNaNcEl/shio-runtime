import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarController } from '../../../src/renderer/avatar/AvatarController'
import type { VrmModel } from '../../../src/renderer/avatar/rendering/three/VrmModel'
import { cloneCharacterState, INITIAL_CHARACTER_STATE } from '../../../src/shared/runtime'

const owners: AvatarController[] = []
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose()
  vi.useRealTimers()
})

function fixture() {
  vi.useFakeTimers({ toFake: ['performance'] })
  const owner = new AvatarController()
  owners.push(owner)
  const model = (owner as unknown as { vrmModel: VrmModel }).vrmModel
  const procedural = vi.spyOn(model, 'setProceduralMode')
  const ears = vi.spyOn(model, 'syncEarState')
  const state = cloneCharacterState(INITIAL_CHARACTER_STATE)
  state.mode = 'listening'
  owner.applyCharacterState(state)
  procedural.mockClear()
  return { owner, state, procedural, ears }
}

describe('thinking presentation hysteresis', () => {
  it('preserves listening for a fast response, including ears, and starts speaking immediately', () => {
    const { owner, state, procedural, ears } = fixture()
    state.mode = 'thinking'
    owner.applyCharacterState(state)
    vi.advanceTimersByTime(200)
    state.mode = 'awaitingSpeech'
    owner.applyCharacterState(state)
    owner.update(1 / 60, state)
    expect(procedural).not.toHaveBeenCalled()
    expect(ears).toHaveBeenLastCalledWith('listening', expect.any(String))
    expect(state.mode).toBe('awaitingSpeech')
    state.mode = 'speaking'
    owner.applyCharacterState(state)
    expect(procedural).toHaveBeenLastCalledWith('speaking')
    vi.advanceTimersByTime(1_000)
    owner.update(1 / 60, state)
    expect(procedural.mock.calls.some(([mode]) => mode === 'thinking')).toBe(false)
  })

  it('shows thinking at 400 ms across repeated state reports and awaitingSpeech', () => {
    const { owner, state, procedural } = fixture()
    state.mode = 'thinking'
    owner.applyCharacterState(state)
    vi.advanceTimersByTime(200)
    state.mode = 'awaitingSpeech'
    owner.applyCharacterState(state)
    vi.advanceTimersByTime(199)
    owner.update(1 / 60, state)
    expect(procedural).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    owner.update(1 / 60, state)
    expect(procedural).toHaveBeenCalledExactlyOnceWith('thinking')
    owner.update(1 / 60, state)
    expect(procedural).toHaveBeenCalledOnce()
  })

  it.each(['idle', 'listening', 'stop'] as const)('cancels pending presentation on %s', (mode) => {
    const { owner, state, procedural } = fixture()
    state.mode = 'thinking'
    owner.applyCharacterState(state)
    if (mode === 'stop') owner.stopAnimation()
    else {
      state.mode = mode
      owner.applyCharacterState(state)
    }
    vi.advanceTimersByTime(1_000)
    owner.update(1 / 60, state)
    expect(procedural.mock.calls.some(([value]) => value === 'thinking')).toBe(false)
    if (mode !== 'stop') expect(procedural).toHaveBeenLastCalledWith(mode)
  })
})
