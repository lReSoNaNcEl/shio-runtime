import assert from 'node:assert/strict'

import * as THREE from 'three'

import { LookTargetResolver } from '../../src/renderer/avatar/embodiment/gaze/LookAtRuntime'
import { avatarLookAtTuning } from '../../src/renderer/avatar/tuning/motionTuning'
import { AvatarConversationPresentationPort } from '../../src/renderer/runtime/ConversationPresentationPort'
import type { SyncedAvatarState } from '../../src/renderer/runtime/OverlayRuntime'
import {
  normalizeCharacterEmbodimentIntent,
  parseCharacterEmbodimentResponse,
} from '../../src/shared/character-response'
import { migrateLegacyDesktopSettings } from '../../src/shared/config'

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

const screenTarget = new THREE.Object3D()
const screenBase = new THREE.Object3D()
const screenResolver = new LookTargetResolver()
const screen = screenResolver.resolve({
  deltaMs: 16,
  mode: 'screenFocus',
  modeTuning: avatarLookAtTuning.modes.screenFocus,
  baseTarget: screenBase,
  target: screenTarget,
})
assert.equal(screen.targetKind, 'screenContext')
assert.notEqual(screen.eyeYaw, 0)

const normal = screenResolver.resolve({
  deltaMs: 16,
  mode: 'speaking',
  modeTuning: avatarLookAtTuning.modes.speaking,
  baseTarget: screenBase,
  target: screenTarget,
})
assert.notEqual(normal.targetKind, 'screenContext')
console.log('Screen gaze ownership and normal-turn release: PASS')

const mirrored: SyncedAvatarState[] = []
const presentation = new AvatarConversationPresentationPort(
  {
    setEmbodimentIntent: () => undefined,
    setBehaviorEmbodimentIntent: () => undefined,
    setGameScreenGaze: () => undefined,
  } as never,
  { publishAvatarState: (state: SyncedAvatarState) => mirrored.push(state) } as never,
  () => undefined,
)
presentation.publishAvatarState({ mode: 'idle' })
presentation.setGameScreenGaze('game-session-a', true)
assert.equal(mirrored.at(-1)?.gameScreenGazeActive, true)
presentation.setGameScreenGaze('game-session-b', true)
presentation.setGameScreenGaze('game-session-a', false)
assert.equal(mirrored.at(-1)?.gameScreenGazeSessionId, 'game-session-b')
assert.equal(mirrored.at(-1)?.gameScreenGazeActive, true)
presentation.setBehaviorEmbodimentIntent({ intensity: 'subtle', gazeHint: 'screen' })
presentation.setEmbodimentIntent({ intensity: 'subtle', gazeHint: 'user' })
assert.equal(mirrored.at(-1)?.behaviorEmbodimentIntent, undefined)
presentation.setGameScreenGaze('game-session-b', false)
assert.equal(mirrored.at(-1)?.gameScreenGazeActive, false)
console.log('Mirror Overlay game gaze projection and stale release: PASS')

const migrated = migrateLegacyDesktopSettings({ ttsVoice: 'legacy-user-voice' })
assert.equal('ttsVoice' in migrated, false)
console.log('TTS voice migration/internalization: PASS')

console.log('Structured Embodiment focused repro: PASS')
