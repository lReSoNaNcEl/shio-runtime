import assert from 'node:assert/strict'

import { AvatarSpeakingGestureScheduler } from '../../src/renderer/avatar/AvatarSpeakingGestureScheduler'
import type { AvatarStateEffect } from '../../src/renderer/avatar/AvatarStateMachine'
import { resolveEmotionEmbodimentProfile } from '../../src/renderer/avatar/EmotionEmbodimentProfile'
import { PhraseEnvelopeController } from '../../src/renderer/three/PhraseEnvelopeController'
import { buildSpeechPhraseTimingPlan } from '../../src/renderer/three/SpeechPhraseTiming'
import { VrmModel } from '../../src/renderer/three/VrmModel'
import {
  type CharacterState,
  cloneCharacterState,
  INITIAL_CHARACTER_STATE,
} from '../../src/shared/runtime/characterState'

const empty = buildSpeechPhraseTimingPlan('')
assert.deepEqual(empty, { boundaries: [], hasTerminalPunctuation: false })

const plain = buildSpeechPhraseTimingPlan('Обычная phrase')
assert.equal(plain.boundaries.length, 0)
assert.equal(plain.hasTerminalPunctuation, false)

const punctuation = buildSpeechPhraseTimingPlan(
  'Привет, мир — да... Really? Следующее предложение!',
)
assert.ok(punctuation.boundaries.some((item) => item.type === 'comma'))
assert.ok(punctuation.boundaries.some((item) => item.type === 'dash'))
assert.ok(punctuation.boundaries.some((item) => item.type === 'ellipsis'))
assert.ok(punctuation.boundaries.filter((item) => item.type === 'sentence').length >= 2)
assert.ok(punctuation.boundaries.every((item) => item.normalizedPosition >= 0))
assert.ok(punctuation.boundaries.every((item) => item.normalizedPosition <= 1))
assert.equal(punctuation.hasTerminalPunctuation, true)
console.log('PhraseTimingPlan: PASS')

const commaPlan = buildSpeechPhraseTimingPlan('Раз, два')
const sentencePlan = buildSpeechPhraseTimingPlan('Раз. Два')
const comma = new PhraseEnvelopeController()
comma.start(commaPlan)
const onset0 = comma.getOutput().articulationScale
comma.update(0.03, 0.1, 0.4)
const onset1 = comma.getOutput().articulationScale
comma.update(0.08, 0.2, 0.4)
const onset2 = comma.getOutput().articulationScale
assert.ok(onset0 < onset1 && onset1 < onset2)
comma.update(0.016, commaPlan.boundaries[0]?.normalizedPosition ?? 0.5, 0.4)
const commaClosure = comma.getOutput().closureStrength
assert.ok(commaClosure > 0)

const sentence = new PhraseEnvelopeController()
sentence.start(sentencePlan)
sentence.update(0.12, 0.2, 0.5)
sentence.update(0.03, sentencePlan.boundaries[0]?.normalizedPosition ?? 0.5, 0.5)
assert.ok(sentence.getOutput().closureStrength > commaClosure)
sentence.finish()
for (let index = 0; index < 30; index += 1) sentence.update(0.016, 1, 0)
assert.equal(sentence.getPhase(), 'idle')
assert.ok(sentence.getOutput().articulationScale <= 0.01)

comma.interrupt()
for (let index = 0; index < 30; index += 1) comma.update(0.016, 1, 1)
assert.equal(comma.getPhase(), 'interrupted')
assert.ok(comma.getOutput().articulationScale <= 0.01)
comma.start(buildSpeechPhraseTimingPlan('Новый сегмент'))
assert.equal(comma.getPhase(), 'onset')
assert.equal(comma.getOutput().closureStrength, 0)
console.log('PhraseEnvelopeController: PASS')

const headlessFacial = new VrmModel()
headlessFacial.setProceduralMode('speaking')
headlessFacial.startSpeechPhrase(buildSpeechPhraseTimingPlan('Headless Mirror LipSync'))
headlessFacial.setSpeechEnergy(0.5)
headlessFacial.setMouthWeights({ aa: 0.32, ih: 0.18, ou: 0.12, ee: 0.1, oh: 0.14 })
headlessFacial.updateSpeechPhrase(0.12, 0.2, 0.5)
headlessFacial.update(0.016)
assert.ok(Math.max(...Object.values(headlessFacial.getFinalMouthWeights())) > 0.1)
console.log('Headless facial composition: PASS')

for (const alias of ['joy', 'cheerful', 'happy'])
  assert.equal(resolveEmotionEmbodimentProfile(alias).id, 'happy')
for (const alias of ['sadness', 'apologetic', 'sad'])
  assert.equal(resolveEmotionEmbodimentProfile(alias).id, 'sad')
for (const alias of ['anger', 'annoyed', 'angry'])
  assert.equal(resolveEmotionEmbodimentProfile(alias).id, 'angry')
for (const alias of ['surprise', 'surprised'])
  assert.equal(resolveEmotionEmbodimentProfile(alias).id, 'surprised')
assert.equal(resolveEmotionEmbodimentProfile('unknown').id, 'neutral')
console.log('EmotionEmbodimentProfile: PASS')

const speakingEffect: AvatarStateEffect = {
  mode: 'speaking',
  proceduralMode: 'speaking',
  emotionKey: 'happy',
  behaviorId: 'happy',
  loop: true,
  attachLipSync: true,
}

function speakingState(
  length: CharacterState['conversationPresence']['replyLength'],
): CharacterState {
  const state = cloneCharacterState(INITIAL_CHARACTER_STATE)
  state.mode = 'speaking'
  state.emotion = 'happy'
  state.conversationPresence.responsePhase = 'speaking'
  state.conversationPresence.replyLength = length
  return state
}

const shortScheduler = new AvatarSpeakingGestureScheduler()
const shortState = speakingState('short')
const shortOpening = shortScheduler.begin(speakingEffect, shortState)
shortScheduler.recordSelection({
  animationId: 'opening',
  behaviorId: shortOpening.behaviorId,
  skippedCandidates: [],
  selectionReason: 'test',
  phase: shortOpening.phase,
})
for (let elapsed = 0; elapsed < 12; elapsed += 0.5)
  assert.equal(shortScheduler.update(0.5, speakingEffect, shortState), null)

const longScheduler = new AvatarSpeakingGestureScheduler()
const longState = speakingState('long')
const longOpening = longScheduler.begin(speakingEffect, longState)
longScheduler.recordSelection({
  animationId: 'opening',
  behaviorId: longOpening.behaviorId,
  skippedCandidates: [],
  selectionReason: 'test',
  phase: longOpening.phase,
})
let switches = 0
for (let elapsed = 0; elapsed < 12; elapsed += 0.25) {
  const decision = longScheduler.update(0.25, speakingEffect, longState)
  if (!decision) continue
  switches += 1
  longScheduler.recordSelection({
    animationId: `holding-${switches}`,
    behaviorId: decision.behaviorId,
    skippedCandidates: [],
    selectionReason: 'test',
    phase: decision.phase,
  })
}
assert.equal(switches, 1)

const emphasisScheduler = new AvatarSpeakingGestureScheduler()
emphasisScheduler.begin(speakingEffect, shortState)
emphasisScheduler.beginSegment('happy')
const emphasis = emphasisScheduler.update(0.1, speakingEffect, shortState)
assert.equal(emphasis?.phase, 'emphasis')
if (!emphasis) throw new Error('Expected emphasis decision')
emphasisScheduler.recordSelection({
  animationId: 'emphasis',
  behaviorId: emphasis.behaviorId,
  skippedCandidates: [],
  selectionReason: 'test',
  phase: emphasis.phase,
})
emphasisScheduler.beginSegment('happy')
assert.equal(emphasisScheduler.update(0.1, speakingEffect, shortState), null)
shortState.conversationPresence.responsePhase = 'finishingSpeech'
assert.equal(shortScheduler.update(0.1, speakingEffect, shortState), null)
assert.equal(shortScheduler.getDebugState().phase, 'closing')
console.log('Speaking gesture cadence: PASS')

console.log('Embodiment Polish focused repro: PASS')
