import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../src/renderer/public/pcmCaptureWorklet.js', import.meta.url),
  'utf8',
)
interface Packet {
  startFrame: number
  samples: Float32Array
}
interface Processor {
  process(inputs: Float32Array[][]): boolean
  port: { onmessage: () => void }
}

function harness(sampleRate: number) {
  const capacity = Math.ceil(1.5 * sampleRate)
  let processor: Processor
  const packets: Packet[] = []
  const scope = {
    sampleRate,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = { postMessage: (packet: Packet) => packets.push(packet) }
    },
    registerProcessor: (_: string, Constructor: new (options: unknown) => Processor) => {
      processor = new Constructor({ processorOptions: { maxQueuedFrames: capacity } })
    },
  }
  runInNewContext(source, scope)
  function run(ms: number, acknowledge: boolean): void {
    for (let count = 0; count < (ms * sampleRate) / 1000; count += 128) {
      const input = Float32Array.from({ length: 128 }, (_, i) => scope.currentFrame + i)
      processor.process([[input]])
      scope.currentFrame += input.length
      if (acknowledge) processor.port.onmessage()
    }
  }
  return { run, packets, capacity, scope }
}

it.each([44_100, 48_000])(
  'bounds delivery and drains an intact 1.1-second renderer stall at %i Hz',
  (rate) => {
    const { run, packets, scope } = harness(rate)
    run(1100, false)
    expect(packets).toHaveLength(1)
    const atResume = packets.length
    run(50, true)
    expect(
      packets.slice(atResume).reduce((n, packet) => n + packet.samples.length, 0),
    ).toBeLessThan(rate * 0.15)
    run(1700, true)
    let cursor = 0
    for (const packet of packets) {
      expect(packet.startFrame).toBe(cursor)
      expect(packet.samples[0]).toBe(cursor)
      cursor += packet.samples.length
      expect(packet.samples.at(-1)).toBe(cursor - 1)
    }
    expect(scope.currentFrame - cursor).toBeLessThan(rate * 0.025)
  },
)

it('overwrites only the oldest unsent samples when a stall exceeds the bounded ring', () => {
  const { run, packets, capacity, scope } = harness(48_000)
  run(2600, false)
  expect(packets).toHaveLength(1)
  const resumeFrame = scope.currentFrame
  run(50, true)
  const retained = packets[1]
  expect(retained.startFrame).toBeGreaterThanOrEqual(resumeFrame - capacity)
  expect(retained.samples[0]).toBe(retained.startFrame)
  expect(packets[2].startFrame).toBe(retained.startFrame + retained.samples.length)
})
