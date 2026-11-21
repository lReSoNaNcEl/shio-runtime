import { describe, expect, it, vi } from 'vitest'

import { FlashMotionSpeech } from '../../../src/main/motion/FlashMotionSpeech'
import type { SpeechStreamStart } from '../../../src/shared/speech'

const turn: SpeechStreamStart = {
  protocolVersion: 2,
  turnId: 'turn-1',
  sessionId: 'speech:turn-1',
  language: 'ru',
  delivery: { emotion: 'neutral', pace: 'normal', energy: 'normal', volume: 'normal' },
}

describe('FlashMotion speech input', () => {
  it('uses only the exact playback turn and returns whole source frames', () => {
    const speech = new FlashMotionSpeech()
    speech.start(turn)
    speech.addText(turn.turnId, 0, 'Первая фраза')
    speech.addAudio({
      type: 'audio',
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      sequence: 0,
      samples: 44_100,
      sampleOffset: 0,
      textSequence: 0,
      pcm: new ArrayBuffer(44_100 * 4),
    })
    expect(speech.window('turn-2:playback-1', 4400)).toBeUndefined()
    expect(speech.window('turn-1:playback-1', 38_000)).toBeUndefined()
    const window = speech.window('turn-1:playback-1', 4400)
    expect(window).toMatchObject({
      startSample: 4400,
      contextSamples: 2940,
      followingSamples: 4410,
      frames: 24,
      text: 'Первая фраза',
    })
    expect(Buffer.from(window?.pcm ?? '', 'base64')).toHaveLength((2 + 24 + 3) * 1470 * 4)
    speech.clear('turn-1')
    expect(speech.window('turn-1:playback-1', 4400)).toBeUndefined()
  })

  it('keeps a finished turn only for the bounded drain interval', () => {
    vi.useFakeTimers()
    try {
      const speech = new FlashMotionSpeech()
      speech.start(turn)
      speech.finish(turn.turnId)
      expect(speech.matches('turn-1:playback-1')).toBe(true)
      vi.advanceTimersByTime(6501)
      expect(speech.matches('turn-1:playback-1')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
