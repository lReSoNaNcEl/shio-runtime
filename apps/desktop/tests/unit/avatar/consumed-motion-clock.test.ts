import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { PcmPlaybackClock } from '../../../src/renderer/audio/audioPlayer'
import { AdaptiveMotionFilter } from '../../../src/renderer/avatar/rendering/three/AdaptiveMotionFilter'
import { ConsumedMotionClock } from '../../../src/renderer/avatar/rendering/three/ConsumedMotionClock'
import delayedReport from '../../fixtures/avatar/consumed-clock-after-compositor-stall.json'
import jitterWindows from '../../fixtures/avatar/consumed-clock-jitter-windows.json'
import mediumFrames from '../../fixtures/avatar/consumed-clock-medium-frames.json'

const pcm = (seconds: number, state: PcmPlaybackClock['state'] = 'playing'): PcmPlaybackClock => ({
  turnId: 'turn',
  playbackId: 'playback',
  sourceSampleRate: 44100,
  sourceSampleOffset: Math.floor(seconds * 44100),
  state,
})

describe('consumed body presentation time', () => {
  it('accepts the real delayed worklet burst after two sub-50-ms compositor frames', () => {
    const sampler = new ConsumedMotionClock()
    for (const frame of mediumFrames) {
      const result = sampler.sample({ ...pcm(0), sourceSampleOffset: frame.consumed }, frame.delta)
      expect(result?.discontinuity).toBe(false)
      expect(result?.offset).toBeLessThanOrEqual(frame.consumed)
      expect(frame.consumed - (result?.offset ?? 0)).toBeLessThanOrEqual(44100 * 0.05)
    }
  })
  it.each(jitterWindows)(
    'bounds presentation lag without calling packet cadence a source jump',
    (...frames) => {
      const sampler = new ConsumedMotionClock()
      for (const frame of frames) {
        const clock = { ...pcm(0), sourceSampleOffset: frame.consumed }
        const result = sampler.sample(clock, frame.delta)
        expect(result?.discontinuity).toBe(false)
        expect((result?.offset ?? 0) - frame.consumed).toBeLessThanOrEqual(
          Number.EPSILON * frame.consumed * 2,
        )
        expect(frame.consumed - (result?.offset ?? 0)).toBeLessThanOrEqual(44100 * 0.05)
      }
    },
  )
  it('accepts the real delayed worklet report after a long compositor frame', () => {
    const sampler = new ConsumedMotionClock()
    for (const frame of delayedReport) {
      const clock = { ...pcm(0), sourceSampleOffset: frame.consumed }
      const result = sampler.sample(clock, frame.delta)
      expect(result?.discontinuity).toBe(false)
      expect((result?.offset ?? 0) - frame.consumed).toBeLessThanOrEqual(
        Number.EPSILON * frame.consumed * 2,
      )
      expect(frame.consumed - (result?.offset ?? 0)).toBeLessThanOrEqual(44100 * 0.05)
    }
  })
  it('conserves delayed report time but clears it on buffering or a real clock jump', () => {
    const sampler = new ConsumedMotionClock()
    sampler.sample(pcm(0), 1 / 60)
    sampler.sample(pcm(0.02), 0.086)
    expect(sampler.sample(pcm(3), 0.011)?.discontinuity).toBe(true)
    sampler.reset()
    sampler.sample(pcm(0), 1 / 60)
    sampler.sample(pcm(0.02), 0.086)
    sampler.sample(pcm(0.02), 0.011)
    expect(sampler.sample(pcm(0.11), 0.011)?.discontinuity).toBe(false)
    expect(sampler.sample(pcm(3), 0.011)?.discontinuity).toBe(true)
    sampler.reset()
    sampler.sample(pcm(0), 1 / 60)
    sampler.sample(pcm(0.02), 0.086)
    sampler.sample(pcm(0.02, 'buffering'), 0.011)
    expect(sampler.sample(pcm(0.11), 0.011)?.discontinuity).toBe(true)
  })
  it.each([
    [60, 512 / 48000],
    [90, 512 / 48000],
    [120, 512 / 48000],
    [60, 0.032],
    [90, 0.032],
    [120, 0.032],
  ])('removes packet-cadence stop/start at %i Hz with %f s reports', (hz, quantum) => {
    const sampler = new ConsumedMotionClock(),
      filter = new AdaptiveMotionFilter(),
      bone = new THREE.Object3D(),
      axis = new THREE.Vector3(0, 0, 1)
    const speeds: number[] = []
    let previousOffset = 0
    for (let frame = 0; frame < hz * 4; frame++) {
      const time = frame / hz,
        clock = pcm(Math.floor(time / quantum) * quantum),
        result = sampler.sample(clock, 1 / hz)
      if (!result) throw new Error('Missing body sample')
      expect(result.discontinuity).toBe(false)
      expect(result.offset).toBeLessThanOrEqual(clock.sourceSampleOffset)
      expect(clock.sourceSampleOffset - result.offset).toBeLessThanOrEqual(44100 * 0.05)
      const previous = bone.quaternion.clone(),
        dt = (result.offset - previousOffset) / 44100
      if (dt > 0)
        filter.step(
          bone,
          previous,
          new THREE.Quaternion().setFromAxisAngle(axis, (result.offset / 44100) * 0.2),
          dt,
          { motionClass: 'gesture', phase: 'stroke', sourceSpeeds: new Map([[bone, 0.2]]) },
        )
      else filter.hold()
      if (time > 1) speeds.push(previous.angleTo(bone.quaternion) * hz)
      previousOffset = result.offset
    }
    const mean = speeds.reduce((sum, x) => sum + x, 0) / speeds.length
    const cv = Math.sqrt(speeds.reduce((sum, x) => sum + (x - mean) ** 2, 0) / speeds.length) / mean
    expect(mean).toBeCloseTo(0.2, 2)
    expect(Math.min(...speeds)).toBeGreaterThan(0.18)
    expect(cv).toBeLessThan(0.03)
  })

  it('holds immediately on buffering and exhausts only consumed samples on a stale playing report', () => {
    const sampler = new ConsumedMotionClock()
    for (let frame = 0; frame < 60; frame++) sampler.sample(pcm(frame / 60), 1 / 60)
    const held = sampler.sample(pcm(1, 'buffering'), 1 / 60)?.offset
    for (let i = 0; i < 10; i++)
      expect(sampler.sample(pcm(1, 'buffering'), 0.05)?.offset).toBe(held)
    for (let i = 0; i < 10; i++)
      expect(sampler.sample(pcm(1), 0.05)?.offset).toBeLessThanOrEqual(44100)
    expect(sampler.sample(pcm(1), 0.05)?.offset).toBe(44100)
  })

  it('discards a large audible jump instead of returning banked catch-up', () => {
    const sampler = new ConsumedMotionClock()
    sampler.sample(pcm(0), 1 / 60)
    const resumed = sampler.sample(pcm(3), 1 / 60)
    expect(resumed).toEqual({ offset: 3 * 44100, discontinuity: true })
    expect(sampler.sample(pcm(3.01), 1 / 60)?.offset).toBe(resumed?.offset)
  })

  it('drops unrendered samples on a coarse compositor tick without freezing phase time', () => {
    const sampler = new ConsumedMotionClock()
    sampler.sample(pcm(0), 1 / 60)
    for (let frame = 1; frame < 12; frame++) {
      const clock = pcm(frame * 0.25)
      const value = sampler.sample(clock, 0.25)
      expect(value?.discontinuity).toBe(false)
      expect(value?.offset).toBeCloseTo(clock.sourceSampleOffset - 44100 / 30)
    }
  })

  it('resets on playback replacement, end, cancellation and detach', () => {
    const sampler = new ConsumedMotionClock()
    sampler.sample(pcm(2), 1 / 60)
    expect(sampler.sample({ ...pcm(0), playbackId: 'next' }, 1 / 60)).toEqual({
      offset: 0,
      discontinuity: false,
    })
    for (const terminal of ['ended', 'cancelled'] as const) {
      expect(sampler.sample(pcm(1, terminal), 1 / 60)).toBeNull()
      expect(sampler.sample(pcm(0), 1 / 60)?.offset).toBe(0)
    }
    sampler.reset()
    expect(sampler.sample(pcm(0), 1 / 60)?.offset).toBe(0)
  })
})
