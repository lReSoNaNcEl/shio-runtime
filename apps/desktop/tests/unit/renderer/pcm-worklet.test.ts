import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { describe, it } from 'vitest'

function render(parts: Float32Array[]): { audio: number[]; consumed: number } {
  type WorkletPlayer = new (
    options: unknown,
  ) => {
    port: { onmessage: (event: unknown) => void }
    process: (inputs: unknown, outputs: Float32Array[][]) => boolean
  }
  let Player: WorkletPlayer | undefined
  let consumed = 0
  const sandbox = {
    Float32Array,
    ArrayBuffer,
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = {
        onmessage: () => undefined,
        postMessage: (message: { type: string; samples: number }) => {
          if (message.type === 'consumed') consumed += message.samples
        },
      }
    },
    registerProcessor: (_name: string, implementation: WorkletPlayer) => {
      Player = implementation
    },
  }
  runInNewContext(readFileSync('src/renderer/audio/pcmStreamWorklet.js', 'utf8'), sandbox)
  assert(Player, 'Worklet was not registered')
  const player = new Player({ processorOptions: { sourceSampleRate: 44100 } })
  for (const part of parts) player.port.onmessage({ data: { type: 'push', pcm: part.buffer } })
  player.port.onmessage({ data: { type: 'finish' } })
  const audio: number[] = []
  for (let index = 0; index < 40; index++) {
    const output = new Float32Array(128)
    player.process([], [[output]])
    audio.push(...output)
  }
  return { audio, consumed }
}

describe('PCM worklet resampling', () => {
  it('preserves sample position and interpolation across packet boundaries', () => {
    const source = Float32Array.from({ length: 2400 }, (_, index) => Math.sin(index / 20) * 0.4)
    const whole = render([source.slice()])
    const fragmented = render([
      source.slice(0, 37),
      source.slice(37, 122),
      source.slice(122, 901),
      source.slice(901),
    ])
    assert.equal(fragmented.audio.length, whole.audio.length)
    const error = Math.max(
      ...fragmented.audio.map((value, index) => Math.abs(value - whole.audio[index])),
    )
    assert(error < 1e-7, `Packet boundaries changed the resampling phase: ${error}`)
    assert.equal(fragmented.consumed, source.length)
    assert(whole.audio.some((value) => Math.abs(value) > 0.1))
  })
})
