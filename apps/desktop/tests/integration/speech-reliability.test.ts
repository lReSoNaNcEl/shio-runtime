import assert from 'node:assert/strict'

import { describe, it } from 'vitest'

import {
  type ManagedSpeechClient,
  SpeechClientManager,
} from '../../src/main/speech/SpeechClientManager'
import type { SpeechStreamOutput, SpeechStreamStart } from '../../src/shared/speech'

function managerKeepsEndpointAndCancelsStream(): void {
  const constructedEndpoints: string[] = []
  const cancelled: string[] = []
  let disposed = false
  const manager = new SpeechClientManager('http://127.0.0.1:8123/', (endpoint) => {
    constructedEndpoints.push(endpoint)
    return {
      dispose: () => {
        disposed = true
      },
      health: async () => ({
        status: 'ok',
        serviceId: 'shio.speech-api',
        contractVersion: '2.1',
        synthesis: {
          status: 'ready',
          engine: 'fish-s2-pro',
          streaming: true,
          voiceCloning: true,
        },
      }),
      emotions: async () => ({ schemaVersion: 1, defaultEmotion: 'neutral', supported: [] }),
      warnIfEmotionContractDrift: async () => undefined,
      recognize: async () => ({ text: 'recognized by current endpoint' }),
      warmupVoice: async () => ({
        state: 'ready',
        engine: 'fish-s2-pro',
        voiceId: 'animevox_makima',
        language: 'ru',
      }),
      openStream: (_input: SpeechStreamStart, onEvent: (event: SpeechStreamOutput) => void) => {
        onEvent({
          type: 'ready',
          protocolVersion: 2,
          sessionId: 'speech:reliability',
          engine: 'fish-s2-pro',
          sampleRate: 24_000,
          channels: 1,
          sampleFormat: 'float32-le',
          modelId: 'FunAudioLLM/Fun-Fish S2 Pro3-0.5B-2512',
          modelRevision: 'pinned-model',
          sourceRevision: 'pinned-source',
        })
        return {
          send: () => undefined,
          cancel: async (reason: string) => {
            cancelled.push(reason)
          },
        }
      },
    } satisfies ManagedSpeechClient
  })

  assert.equal(manager.getEndpoint(), 'http://127.0.0.1:8123')
  assert.deepEqual(constructedEndpoints, ['http://127.0.0.1:8123'])
  const connection = manager.openStream(
    {
      protocolVersion: 2,
      sessionId: 'speech:reliability',
      turnId: 'reliability',
      voiceId: 'animevox_makima',
      language: 'ru',
      delivery: { emotion: 'neutral', pace: 'normal', energy: 'normal', volume: 'normal' },
    },
    () => undefined,
  )
  connection.cancel('test interruption')
  assert.deepEqual(cancelled, ['test interruption'])
  manager.dispose()
  assert.equal(disposed, true)
  assert.throws(() => manager.getCurrent(), /disposed/u)
}

describe('speech client reliability', () => {
  it(
    'keeps the configured endpoint immutable and cancels a live stream',
    managerKeepsEndpointAndCancelsStream,
  )
})
