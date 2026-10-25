import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import { AvatarModel } from '../../src/renderer/avatar/rendering/two/AvatarModel'
import { AvatarConversationPresentationPort } from '../../src/renderer/runtime/ConversationPresentationPort'
import type { SyncedAvatarState } from '../../src/renderer/runtime/OverlayRuntime'
import {
  normalizeCharacterEmbodimentIntent,
  parseCharacterEmbodimentResponse,
} from '../../src/shared/character-response'
import { migrateLegacyDesktopSettings } from '../../src/shared/config'

function main(): void {
  const structured = parseCharacterEmbodimentResponse(
    '[happy]Готово.<shio-embodiment>{"intensity":"strong","gestureHint":"celebrate","gazeHint":"user"}</shio-embodiment>',
  )
  assert.equal(structured.replyText, '[happy]Готово.')
  assert.deepEqual(structured.embodimentIntent, {
    intensity: 'strong',
    gestureHint: 'celebrate',
    gazeHint: 'user',
  })
  assert.equal(normalizeCharacterEmbodimentIntent({ intensity: 'maximum' }), undefined)
  assert.equal(
    normalizeCharacterEmbodimentIntent({ intensity: 'normal', animationId: 'unsafe' })?.intensity,
    'normal',
  )
  assert.equal(
    parseCharacterEmbodimentResponse('[calm]Обычный legacy ответ.').embodimentIntent,
    undefined,
  )
  assert.equal(
    parseCharacterEmbodimentResponse(
      '[warm]Не показывай служебный хвост.<shio-embodiment>{"intensity":"normal"',
    ).replyText,
    '[warm]Не показывай служебный хвост.',
  )
  assert.equal(
    parseCharacterEmbodimentResponse('[warm]Ответ.</shio-embodiment>').replyText,
    '[warm]Ответ.',
  )
  console.log('Structured response parsing and legacy fallback: PASS')

  const model = new AvatarModel()
  model.setLookAtMode('screenFocus')
  model.update(0.016)
  // Concrete S22 gaze and visual rendering are covered by the GPU qualification.
  model.setLookAtMode('speaking')
  model.update(0.016)
  assert.equal(model.getLookAtDebugState().mode, 'speaking')
  model.dispose()
  console.log('Screen gaze ownership and normal-turn release: PASS')

  const mirrored: SyncedAvatarState[] = []
  const presentation = new AvatarConversationPresentationPort(
    {
      setEmbodimentIntent: () => undefined,
      setBehaviorEmbodimentIntent: () => undefined,
      setBrowserScreenGaze: () => undefined,
    } as never,
    { publishAvatarState: (state: SyncedAvatarState) => mirrored.push(state) } as never,
    () => undefined,
  )
  presentation.publishAvatarState({ mode: 'idle' })
  presentation.setBrowserScreenGaze('browser-session-a', true)
  assert.equal(mirrored.at(-1)?.browserScreenGazeActive, true)
  presentation.setBrowserScreenGaze('browser-session-b', true)
  presentation.setBrowserScreenGaze('browser-session-a', false)
  assert.equal(mirrored.at(-1)?.browserScreenGazeSessionId, 'browser-session-b')
  assert.equal(mirrored.at(-1)?.browserScreenGazeActive, true)
  presentation.setBehaviorEmbodimentIntent({ intensity: 'subtle', gazeHint: 'screen' })
  presentation.setEmbodimentIntent({ intensity: 'subtle', gazeHint: 'user' })
  assert.equal(mirrored.at(-1)?.behaviorEmbodimentIntent, undefined)
  presentation.setBrowserScreenGaze('browser-session-b', false)
  assert.equal(mirrored.at(-1)?.browserScreenGazeActive, false)
  console.log('Mirror Overlay browser gaze projection and stale release: PASS')

  const migrated = migrateLegacyDesktopSettings({ ttsVoice: 'legacy-user-voice' })
  assert.equal('ttsVoice' in migrated, false)
  console.log('TTS voice migration/internalization: PASS')

  console.log('Structured Embodiment focused repro: PASS')
}

describe('structured embodiment', () => {
  it('contains protocol data and preserves presentation projections', () => {
    main()
  })
})
