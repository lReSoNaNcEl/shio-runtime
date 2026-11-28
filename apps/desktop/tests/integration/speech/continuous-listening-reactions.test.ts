import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type CapturedPcmTiming,
  StreamingPcmCapture,
} from '../../../src/renderer/audio/StreamingPcmCapture'
import { SpeechInputRuntime } from '../../../src/renderer/runtime/SpeechInputRuntime'
import { StreamingAsrClient } from '../../../src/renderer/speech/continuous-listening/StreamingAsrClient'
import type { UserSpeechActivityMonitor } from '../../../src/renderer/speech/listening/UserSpeechActivity'
import { createDeferred } from '../../support/Deferred'

const owners: SpeechInputRuntime[] = []
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture() {
  let at = 0
  let speaking = false
  let suppressed = false
  vi.spyOn(performance, 'now').mockImplementation(() => at)
  vi.stubGlobal('window', {
    api: {
      asr: { getStreamingConnection: async () => ({ baseUrl: 'http://127.0.0.1:8000' }) },
    },
  })
  vi.spyOn(StreamingAsrClient.prototype, 'connect').mockResolvedValue()
  vi.spyOn(StreamingAsrClient.prototype, 'stop').mockResolvedValue()
  const send = vi.spyOn(StreamingAsrClient.prototype, 'sendPcm').mockReturnValue(true)
  vi.spyOn(StreamingPcmCapture.prototype, 'isAlive').mockReturnValue(true)
  // Replace device acquisition only. RMS, resampling, monitor, policy and
  // SpeechInput wiring are production code, with the same single capture.
  vi.spyOn(StreamingPcmCapture.prototype, 'start').mockImplementation(async function (
    this: StreamingPcmCapture,
    _device,
    onFrame,
  ) {
    const capture = this as unknown as { audioContext: unknown; onFrame: typeof onFrame }
    capture.audioContext = { sampleRate: 48_000, close: async () => undefined }
    capture.onFrame = onFrame
  })
  const onset = vi.fn()
  const nod = vi.fn()
  const owner = new SpeechInputRuntime({
    speechRuntime: {},
    characterState: { get: () => ({ mode: speaking ? 'speaking' : 'idle' }) },
    speechState: {},
    presentation: { reactToUserSpeechOnset: onset, acknowledgeUserSpeech: nod },
    events: { publish: () => undefined },
    setStatus: () => undefined,
    pushMessage: () => undefined,
    formatMicrophoneUnavailable: (error: string) => error,
    emptyRecordingMessage: () => '',
    recordRuntimeEvent: () => undefined,
    reportSpeechServiceError: () => undefined,
    listeningReactionsSuppressed: () => suppressed,
  } as never)
  owners.push(owner)
  const internals = owner as unknown as {
    streamingCapture: {
      handleNativeFrame: (frame: Float32Array, timing: CapturedPcmTiming) => void
    }
    userSpeech: UserSpeechActivityMonitor
    handleContinuousDeviceLost: () => void
  }
  const feed = (level: number, duration: number) => {
    for (let elapsed = 0; elapsed < duration; elapsed += 100) {
      at += 100
      internals.streamingCapture.handleNativeFrame(new Float32Array(4_800).fill(level), {
        endedAt: Date.now(),
        discontinuous: false,
      })
    }
  }
  return {
    owner,
    internals,
    onset,
    nod,
    send,
    feed,
    suppress: () => (suppressed = true),
    speak: () => (speaking = true),
  }
}

describe('continuous listening embodiment from the existing PCM capture', () => {
  it('keeps capture off when disabled before connection discovery returns', async () => {
    const { owner } = fixture()
    const connection = createDeferred<{ baseUrl: string }>()
    vi.spyOn(window.api.asr, 'getStreamingConnection').mockReturnValue(connection.promise)
    const projection = vi.fn()
    owner.setContinuousLifecycleHandler(projection)
    const start = owner.setContinuousListening(true)
    expect(projection.mock.lastCall?.[0].transport).toBe('starting')
    await owner.setContinuousListening(false)
    expect(projection.mock.lastCall?.[0].transport).toBe('off')
    connection.resolve({ baseUrl: 'http://127.0.0.1:8000' })
    await start
    expect(projection.mock.lastCall?.[0]).toMatchObject({
      transport: 'off',
      microphoneCaptured: false,
    })
    expect(StreamingPcmCapture.prototype.start).not.toHaveBeenCalled()
  })

  it('reacts locally before ASR and nods once in a pause while preserving ASR PCM', async () => {
    const { owner, feed, onset, nod, send, internals } = fixture()
    await owner.setContinuousListening(true)
    feed(0.08, 1_500)
    internals.userSpeech.observeExternalOnset(1_550)
    feed(0.001, 400)
    expect(onset).toHaveBeenCalledOnce()
    expect(nod).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledTimes(19)
    const firstPcm = new Int16Array(send.mock.calls[0][0])
    expect(firstPcm.length).toBe(1_600)
    expect(firstPcm[0]).toBe(Math.round(0.08 * 0x7fff))
    await owner.setContinuousListening(false)
    internals.userSpeech.observeExternalOnset(5_000)
    feed(0.08, 1_500)
    feed(0.001, 400)
    expect(onset).toHaveBeenCalledOnce()
    expect(nod).toHaveBeenCalledOnce()
  })

  it.each(['speak', 'suppress'] as const)('suppresses reactions under %s', async (policy) => {
    const fixtureState = fixture()
    await fixtureState.owner.setContinuousListening(true)
    fixtureState[policy]()
    fixtureState.feed(0.08, 1_500)
    fixtureState.feed(0.001, 400)
    expect(fixtureState.onset).not.toHaveBeenCalled()
    expect(fixtureState.nod).not.toHaveBeenCalled()
  })

  it('drops pending acknowledgement on device loss and starts a fresh session', async () => {
    const { owner, feed, onset, nod, internals } = fixture()
    await owner.setContinuousListening(true)
    feed(0.08, 1_500)
    internals.handleContinuousDeviceLost()
    feed(0.001, 400)
    expect(nod).not.toHaveBeenCalled()
    await owner.setContinuousListening(false)
    await owner.setContinuousListening(true)
    feed(0.08, 1_500)
    feed(0.001, 400)
    expect(onset).toHaveBeenCalledTimes(2)
    expect(nod).toHaveBeenCalledOnce()
    owner.dispose()
    internals.userSpeech.observeExternalOnset(10_000)
    expect(onset).toHaveBeenCalledTimes(2)
  })
})
