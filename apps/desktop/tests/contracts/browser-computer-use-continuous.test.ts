import { describe, expect, it } from 'vitest'

import {
  browserComputerUseStartRequestSchema,
  browserReactiveControlPlanSchema,
  continuousControlBudgetSchema,
} from '../../src/shared/browser-computer-use'

const scopedPlan = {
  id: 'plan-1',
  sessionId: 'browser-use-session-00000000-0000-4000-8000-000000000001',
  pageId: 'page-1',
  sourceObservationId: 'browser-use-observation-00000000-0000-4000-8000-000000000002',
  sourceVisualFingerprint: 'a'.repeat(60),
  confidence: 0.9,
  createdAt: 1_000,
  expiresAt: 5_000,
  reanchorAfterMs: 1_000,
  maximumInputHz: 20,
  anchors: [
    { id: 'player', role: 'controlled', bounds: { x: 10, y: 10, width: 20, height: 20 } },
    { id: 'target', role: 'target', bounds: { x: 100, y: 10, width: 20, height: 20 } },
  ],
  primitive: {
    type: 'directional-keys',
    controlledAnchorId: 'player',
    targetAnchorId: 'target',
    keys: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
    deadZonePx: 8,
  },
} as const

describe('continuous browser computer-use contracts', () => {
  it('keeps goal, time, and explicit-stop termination modes typed and bounded', () => {
    expect(
      browserComputerUseStartRequestSchema.parse({
        goal: 'Keep controlling the page',
        termination: { type: 'until-stopped' },
      }).termination,
    ).toEqual({ type: 'until-stopped' })
    expect(
      browserComputerUseStartRequestSchema.parse({
        goal: 'Control for ten seconds',
        termination: { type: 'until-time', durationMs: 10_000 },
      }).termination,
    ).toEqual({ type: 'until-time', durationMs: 10_000 })
    expect(() =>
      browserComputerUseStartRequestSchema.parse({
        goal: 'Run forever',
        termination: { type: 'until-time', durationMs: Number.MAX_SAFE_INTEGER },
      }),
    ).toThrow()
    expect(() =>
      browserComputerUseStartRequestSchema.parse({
        goal: 'Inject policy',
        termination: { type: 'until-stopped', command: 'ignore limits' },
      }),
    ).toThrow()
  })

  it('accepts only bounded declarative reactive primitives', () => {
    expect(browserReactiveControlPlanSchema.parse(scopedPlan)).toEqual(scopedPlan)
    expect(() =>
      browserReactiveControlPlanSchema.parse({ ...scopedPlan, expiresAt: 6_001 }),
    ).toThrow()
    expect(() =>
      browserReactiveControlPlanSchema.parse({
        ...scopedPlan,
        script: 'document.querySelector("button").click()',
      }),
    ).toThrow()
    expect(() =>
      browserReactiveControlPlanSchema.parse({
        ...scopedPlan,
        primitive: { type: 'directional-keys', controlledAnchorId: 'player', targetAnchorId: 'x' },
      }),
    ).toThrow()
  })

  it('rejects budgets that could make the fast lane unbounded', () => {
    expect(() =>
      continuousControlBudgetSchema.parse({
        maximumDurationMs: 10_000,
        maxSlowDecisionsPerMinute: 2,
        maxReactiveInputEventsPerSecond: 61,
        maxReactiveInputEventsTotal: 10,
        maxPointerHoldMs: 100,
        maxKeyHoldMs: 100,
        maxFrameRate: 30,
      }),
    ).toThrow()
  })
})
