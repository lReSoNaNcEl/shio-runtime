import { describe, expect, it } from 'vitest'

import { UserProsodyBackchannelPolicy } from '../../../src/renderer/speech/listening/UserProsodyBackchannelPolicy'
import {
  type UserSpeechActivityEvent,
  UserSpeechActivityMonitor,
} from '../../../src/renderer/speech/listening/UserSpeechActivity'
import { UserSpeechReactionCoordinator } from '../../../src/renderer/speech/listening/UserSpeechReactionCoordinator'

const BLOCK_MS = 85

/** Feeds voiced/unvoiced blocks at the microphone block cadence. */
function speak(
  policy: UserProsodyBackchannelPolicy,
  pattern: Array<[voiced: boolean, ms: number]>,
  extra: { shioSpeaking?: boolean; suppressed?: boolean } = {},
  start = 0,
) {
  const nods: number[] = []
  let at = start
  for (const [voiced, duration] of pattern)
    for (let elapsed = 0; elapsed < duration; elapsed += BLOCK_MS) {
      at += BLOCK_MS
      if (
        policy.observe({
          at,
          voiced,
          shioSpeaking: extra.shioSpeaking ?? false,
          suppressed: extra.suppressed ?? false,
        })
      )
        nods.push(at)
    }
  return { nods, at }
}

describe('prosody backchannel policy', () => {
  it('acknowledges a short pause after sustained speech once', () => {
    const policy = new UserProsodyBackchannelPolicy(() => 0.5)
    const { nods } = speak(policy, [
      [true, 1_400],
      [false, 500],
    ])
    expect(nods).toHaveLength(1)
  })

  it('ignores short speech, long silence and continuous talking', () => {
    expect(
      speak(new UserProsodyBackchannelPolicy(() => 0), [
        [true, 800],
        [false, 500],
      ]).nods,
    ).toEqual([])
    expect(speak(new UserProsodyBackchannelPolicy(() => 0), [[true, 6_000]]).nods).toEqual([])
    const late = new UserProsodyBackchannelPolicy(() => 0)
    // A pause shorter than 250 ms is part of the phrase, not an acknowledgement point.
    const { nods } = speak(late, [
      [true, 1_400],
      [false, 150],
      [true, 300],
    ])
    expect(nods).toEqual([])
  })

  it('honours its bounded cooldown between acknowledgements', () => {
    const policy = new UserProsodyBackchannelPolicy(() => 1)
    const first = speak(policy, [
      [true, 1_300],
      [false, 400],
      [true, 1_300],
      [false, 400],
    ])
    expect(first.nods).toHaveLength(1)
    const later = speak(
      policy,
      [
        [true, 1_300],
        [false, 400],
      ],
      {},
      first.nods[0] + 4_100,
    )
    expect(later.nods).toHaveLength(1)
  })

  it('stays silent while Shio speaks and under Suspend or Privacy', () => {
    const pattern: Array<[boolean, number]> = [
      [true, 1_500],
      [false, 400],
    ]
    expect(
      speak(new UserProsodyBackchannelPolicy(() => 0), pattern, { shioSpeaking: true }).nods,
    ).toEqual([])
    expect(
      speak(new UserProsodyBackchannelPolicy(() => 0), pattern, { suppressed: true }).nods,
    ).toEqual([])
  })
})

describe('user speech activity monitor', () => {
  it('emits one onset per utterance from microphone levels', () => {
    const monitor = new UserSpeechActivityMonitor()
    const events: UserSpeechActivityEvent[] = []
    const unsubscribe = monitor.subscribe((event) => events.push(event))
    monitor.observeLevel(0.2, 0)
    expect(events).toEqual([])
    monitor.begin()
    for (let at = 0; at < 400; at += BLOCK_MS) monitor.observeLevel(0.001, at)
    monitor.observeLevel(0.08, 400)
    monitor.observeLevel(0.08, 485)
    monitor.observeLevel(0.001, 570)
    monitor.observeLevel(0.08, 655)
    expect(events.filter((event) => event.type === 'onset')).toEqual([{ type: 'onset', at: 400 }])
    monitor.observeLevel(0.08, 2_000)
    expect(events.filter((event) => event.type === 'onset')).toHaveLength(2)
    monitor.end(2_100)
    monitor.end(2_200)
    expect(events.filter((event) => event.type === 'end')).toEqual([{ type: 'end', at: 2_100 }])
    unsubscribe()
  })

  it('treats an ASR VAD start as an onset and deduplicates it within an utterance', () => {
    const monitor = new UserSpeechActivityMonitor()
    const onsets: number[] = []
    monitor.subscribe((event) => {
      if (event.type === 'onset') onsets.push(event.at)
    })
    monitor.observeExternalOnset(100)
    monitor.observeExternalOnset(300)
    monitor.observeExternalOnset(1_500)
    expect(onsets).toEqual([100, 1_500])
  })

  it('ignores non-finite levels', () => {
    const monitor = new UserSpeechActivityMonitor()
    const events: UserSpeechActivityEvent[] = []
    monitor.subscribe((event) => events.push(event))
    monitor.begin()
    monitor.observeLevel(Number.NaN, 0)
    monitor.observeLevel(0.1, Number.POSITIVE_INFINITY)
    expect(events).toEqual([])
  })
})

describe('user speech reaction coordinator', () => {
  it('reacts to onset and pauses, respects suppression, and tears down idempotently', () => {
    const monitor = new UserSpeechActivityMonitor()
    let suppressed = false
    let shioSpeaking = false
    const reactions: string[] = []
    const coordinator = new UserSpeechReactionCoordinator(
      monitor,
      {
        reactToUserSpeechOnset: () => reactions.push('onset'),
        acknowledgeUserSpeech: () => reactions.push('nod'),
      },
      { shioSpeaking: () => shioSpeaking, suppressed: () => suppressed, random: () => 0 },
    )
    monitor.begin()
    let at = 0
    for (; at < 1_400; at += BLOCK_MS) monitor.observeLevel(0.08, at)
    for (const end = at + 450; at < end; at += BLOCK_MS) monitor.observeLevel(0.001, at)
    expect(reactions).toEqual(['onset', 'nod'])
    suppressed = true
    monitor.observeExternalOnset(at + 5_000)
    shioSpeaking = true
    suppressed = false
    monitor.observeExternalOnset(at + 9_000)
    expect(reactions).toEqual(['onset', 'nod'])
    coordinator.dispose()
    coordinator.dispose()
    shioSpeaking = false
    monitor.observeExternalOnset(at + 20_000)
    expect(reactions).toEqual(['onset', 'nod'])
  })
})
