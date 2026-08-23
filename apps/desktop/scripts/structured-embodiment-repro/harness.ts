import assert from 'node:assert/strict'

import * as THREE from 'three'

import { LookTargetResolver } from '../../src/renderer/avatar/embodiment/gaze/LookAtRuntime'
import { avatarLookAtTuning } from '../../src/renderer/avatar/tuning/motionTuning'
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

const migrated = migrateLegacyDesktopSettings({ ttsVoice: 'legacy-user-voice' })
assert.equal('ttsVoice' in migrated, false)
console.log('TTS voice migration/internalization: PASS')

console.log('Structured Embodiment focused repro: PASS')
