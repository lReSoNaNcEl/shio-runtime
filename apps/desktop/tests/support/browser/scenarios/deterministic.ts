import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BrowserAutomationError,
  BrowserComputerUseRuntime,
  type BrowserVisualActionAdapter,
  LlmBrowserVisualActionAdapter,
  PlaywrightBrowserAdapter,
  resolveChromeExecutable,
} from '../../../../src/main/browser-control'
import { LlmResponseError } from '../../../../src/main/llm'
import type { BrowserComputerUseDecision } from '../../../../src/shared/browser-computer-use'
import {
  closeServer,
  refFor,
  removeProfile,
  ScriptedVisualAdapter,
  SENSITIVE_SECRETS,
  scopedDecision,
  startFixture,
  target,
  waitForSession,
} from '../BrowserControlSupport'
export async function deterministicRepro(
  executablePath: string,
  profileDirectory: string,
  origin: string,
): Promise<void> {
  const browser = new PlaywrightBrowserAdapter({ executablePath, profileDirectory })
  let reopened: PlaywrightBrowserAdapter | undefined
  try {
    const initial = (await browser.open(origin)).observation
    assert(initial)
    assert.equal(initial.title, 'Browser Control Fixture')
    assert(initial.interactiveElements.some((element) => element.name === 'Canvas target'))

    const filled = (await browser.fill(target(initial, 'textbox', 'Player name'), 'Ada'))
      .observation
    assert(filled)
    const selected = (await browser.select(target(filled, 'combobox', 'Difficulty'), ['hard']))
      .observation
    assert(selected)
    const saved = (await browser.click(target(selected, 'button', 'Save profile'))).observation
    assert(saved?.content.includes('Saved Ada on hard'))
    assert(saved)
    await browser.click(target(saved, 'button', 'Check notifications'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const notifications = await browser.observe()
    assert(notifications.content.includes('Notification permission: denied'), notifications.content)
    console.log('Browser Control repro: semantic operations PASS')

    const delayedCookie = (await browser.open(`${origin}/delayed-cookie`)).observation
    assert(delayedCookie)
    assert(
      delayedCookie.interactiveElements.some((element) => element.name === 'Close cookie banner'),
      'The bounded navigation stabilization returned before the delayed cookie UI appeared',
    )
    const closedCookie = (
      await browser.click(target(delayedCookie, 'button', 'Close cookie banner'))
    ).observation
    assert(closedCookie?.content.includes('Cookie banner closed'))
    console.log('Browser Control repro: delayed cookie stabilization PASS')

    await browser.open(`${origin}/cross-frame`)
    let frameDecision = 0
    const frameRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ScriptedVisualAdapter((context) => {
        assert(context.observation.visual?.bytes.length)
        frameDecision += 1
        if (frameDecision === 1) {
          return scopedDecision(context.observation, {
            type: 'click',
            x: 100,
            y: 70,
            button: 'left',
          })
        }
        assert(context.observation.semantic?.ariaSnapshot.includes('Cross-frame modal closed'))
        return scopedDecision(context.observation, {
          type: 'done',
          summary: 'Cross-frame modal closed with visual control',
        })
      }),
    })
    const frameStarted = await frameRuntime.start(
      {
        goal: 'Close the visible cross-frame modal',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'cross-frame-visual-action',
      new AbortController().signal,
    )
    assert.equal(frameStarted.activity, 'starting')
    assert.equal(frameStarted.actionCount, 0)
    const frameCompleted = await waitForSession(
      frameRuntime,
      (session) => session.state === 'completed',
    )
    assert.equal(frameCompleted.actionCount, 1)
    assert((await browser.observe()).content.includes('Cross-frame modal closed'))
    console.log('Browser Control repro: cross-frame visual fallback PASS')

    await browser.open(`${origin}/?blocker=sensitive`)
    const sensitiveSemantic = await browser.observe()
    const sensitiveComputerUse = await browser.captureComputerUseObservation(true)
    const semanticEvidence = JSON.stringify(sensitiveSemantic)
    const computerUseEvidence = JSON.stringify({
      ...sensitiveComputerUse,
      visual: sensitiveComputerUse.visual
        ? { mimeType: sensitiveComputerUse.visual.mimeType }
        : null,
    })
    for (const secret of SENSITIVE_SECRETS) {
      assert(!semanticEvidence.includes(secret), `Sensitive semantic leak: ${secret}`)
      assert(!computerUseEvidence.includes(secret), `Sensitive computer-use leak: ${secret}`)
    }
    assert(
      sensitiveSemantic.interactiveElements
        .filter((element) => element.sensitive)
        .every((element) => element.name && !SENSITIVE_SECRETS.includes(element.name as never)),
    )
    assert(sensitiveComputerUse.visual?.bytes.length)
    await browser.open(origin)
    console.log('Browser Control repro: sensitive evidence redaction PASS')

    const refObservation = await browser.captureComputerUseObservation(true)
    const saveRef = refFor(refObservation, 'Save profile')
    await browser.observe()
    await assert.rejects(
      () =>
        browser.executeComputerUseDecision(
          scopedDecision(refObservation, { type: 'click-ref', ref: saveRef }),
          new AbortController().signal,
        ),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )
    console.log('Browser Control repro: exact observation ref ownership PASS')

    await assert.rejects(
      () => browser.click(target(initial, 'button', 'Save profile')),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )

    const unavailableVisual: BrowserVisualActionAdapter = {
      status: () => ({
        state: 'needs-setup',
        model: 'Auto · text-only-model',
        supportsVision: false,
      }),
      decide: async () => {
        throw new Error('An unavailable visual model must never receive a decision request')
      },
      planReactive: async () => {
        throw new Error('An unavailable visual model must never receive a reactive plan request')
      },
      verifyCompletion: async () => {
        throw new Error('An unavailable visual model must never verify completion')
      },
    }
    const unavailableRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: unavailableVisual,
    })
    await assert.rejects(
      () =>
        unavailableRuntime.start(
          {
            goal: 'Must require a vision model',
            maxSteps: 30,
            maxActions: 100,
            maxDurationMs: 30_000,
          },
          'unavailable-visual-action',
          new AbortController().signal,
        ),
      (error) =>
        error instanceof BrowserAutomationError && error.code === 'COMPUTER_USE_UNAVAILABLE',
    )

    const boundedVisual = new ScriptedVisualAdapter((context) =>
      scopedDecision(context.observation, {
        type: 'done',
        summary: 'Configured step cap verified',
      } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>),
    )
    const boundedRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: boundedVisual,
      maximumSteps: () => 5,
    })
    const boundedSession = await boundedRuntime.start(
      {
        goal: 'Respect the configured step cap',
        maxSteps: 100,
        maxActions: 100,
        maxDurationMs: 30_000,
      },
      'bounded-visual-action',
      new AbortController().signal,
    )
    assert.equal(boundedSession.maxSteps, 5)
    await waitForSession(boundedRuntime, (session) => session.state === 'completed')
    console.log('Browser Control repro: completion verification PASS')

    let incompleteDecisions = 0
    const incompleteVisual = new ScriptedVisualAdapter(
      (context) => {
        incompleteDecisions += 1
        return incompleteDecisions === 1
          ? scopedDecision(context.observation, {
              type: 'done',
              summary: 'Model proposed completion too early',
            })
          : scopedDecision(context.observation, {
              type: 'request-user',
              reasonCode: 'fixture-remains-incomplete',
            })
      },
      true,
      () => ({
        status: 'not-satisfied',
        confidence: 0.99,
        evidenceSummary: 'The fixture still shows an incomplete state.',
      }),
    )
    const incompleteRuntime = new BrowserComputerUseRuntime({ browser, visual: incompleteVisual })
    await incompleteRuntime.start(
      {
        goal: 'Complete a state that is still incomplete',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'incomplete-action',
      new AbortController().signal,
    )
    const incomplete = await waitForSession(
      incompleteRuntime,
      (session) => session.state === 'waiting-user',
    )
    assert.notEqual(incomplete.state, 'completed')
    await incompleteRuntime.stop()

    const uncertainRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ScriptedVisualAdapter(
        (context) =>
          scopedDecision(context.observation, {
            type: 'done',
            summary: 'Unverifiable proposal',
          }),
        true,
        () => ({ status: 'uncertain', confidence: 0.4 }),
      ),
    })
    await uncertainRuntime.start(
      {
        goal: 'Require honest completion evidence',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'uncertain-action',
      new AbortController().signal,
    )
    const uncertain = await waitForSession(
      uncertainRuntime,
      (session) => session.state === 'failed',
    )
    assert.equal(uncertain.lastErrorCode, 'COMPUTER_USE_COMPLETION_UNVERIFIED')
    console.log('Browser Control repro: completion honesty PASS')

    let fixtureDecision = 0
    const fixtureEvents: string[] = []
    const fixtureVisual = new ScriptedVisualAdapter((context) => {
      assert(context.observation.visual?.bytes.length)
      fixtureDecision += 1
      if (fixtureDecision === 1) {
        return scopedDecision(context.observation, {
          type: 'click-ref',
          ref: refFor(context.observation, 'Canvas target'),
        } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
      }
      if (fixtureDecision === 2) {
        return scopedDecision(context.observation, {
          type: 'key',
          key: 'ArrowRight',
        } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
      }
      return scopedDecision(context.observation, {
        type: 'done',
        summary: 'Canvas and keyboard controls verified',
      } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
    })
    const fixtureRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: fixtureVisual,
      onEvent: (event) => fixtureEvents.push(event.type),
    })
    await fixtureRuntime.start(
      {
        goal: 'Verify canvas and keyboard control',
        maxSteps: 10,
        maxActions: 10,
        maxDurationMs: 30_000,
      },
      'fixture-action',
      new AbortController().signal,
    )
    const fixtureCompleted = await waitForSession(
      fixtureRuntime,
      (session) => session.state === 'completed',
    )
    assert.equal(fixtureCompleted.actionCount, 2)
    assert(fixtureEvents.includes('computer-use-started'))
    assert(fixtureEvents.includes('computer-use-progress'))
    assert(fixtureEvents.includes('computer-use-completed'))
    console.log('Browser Control repro: delegated input PASS')

    const recoveryObservationIds: string[] = []
    const recoveryRuntime = new BrowserComputerUseRuntime({
      browser,
      visual: new ScriptedVisualAdapter((context, _signal, call) => {
        recoveryObservationIds.push(context.observation.id)
        if (call === 0) {
          throw new BrowserAutomationError('COMPUTER_USE_MODEL_SCHEMA_MISMATCH')
        }
        return scopedDecision(context.observation, {
          type: 'done',
          summary: 'Fresh observation recovery verified',
        })
      }),
    })
    await recoveryRuntime.start(
      {
        goal: 'Recover a malformed visual decision without browser input',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'fresh-observation-recovery-action',
      new AbortController().signal,
    )
    const recoveredSession = await waitForSession(
      recoveryRuntime,
      (session) => session.state === 'completed',
    )
    assert.equal(recoveredSession.actionCount, 0)
    assert.equal(recoveryObservationIds.length, 2)
    assert.notEqual(recoveryObservationIds[0], recoveryObservationIds[1])
    console.log('Browser Control repro: malformed decision re-observation PASS')

    let pauseDecision = 0
    const pauseVisual = new ScriptedVisualAdapter(async (context, signal) => {
      pauseDecision += 1
      if (pauseDecision === 1) {
        return scopedDecision(context.observation, {
          type: 'key-down',
          key: 'ArrowLeft',
        } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
      }
      if (pauseDecision === 2) {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
      return scopedDecision(context.observation, {
        type: 'done',
        summary: 'Pause and resume verified',
      } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>)
    })
    const pauseRuntime = new BrowserComputerUseRuntime({ browser, visual: pauseVisual })
    await pauseRuntime.start(
      {
        goal: 'Verify pause and input release',
        maxSteps: 10,
        maxActions: 10,
        maxDurationMs: 30_000,
      },
      'pause-action',
      new AbortController().signal,
    )
    await waitForSession(
      pauseRuntime,
      (session) => session.actionCount === 1 && session.activity === 'deciding',
    )
    console.log('Browser Control repro: pausing active decision')
    const pausedSession = await Promise.race([
      pauseRuntime.pause(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Pause did not settle: ${JSON.stringify(pauseRuntime.snapshot())}`)),
          5_000,
        ),
      ),
    ])
    assert.equal(pausedSession.state, 'paused')
    console.log('Browser Control repro: paused')
    assert((await browser.observe()).content.includes('Key released ArrowLeft'))
    console.log('Browser Control repro: input released')
    await pauseRuntime.resume()
    console.log('Browser Control repro: resumed')
    await waitForSession(pauseRuntime, (session) => session.state === 'completed')
    console.log('Browser Control repro: pause/resume PASS')

    for (const blocker of [
      'captcha',
      'two-factor',
      'authentication',
      'password-manager',
      'payment-confirmation',
      'secure-desktop',
    ] as const) {
      await browser.open(`${origin}/?blocker=${blocker}`)
      const blockerVisual = new ScriptedVisualAdapter(() => {
        throw new Error('A blocked page reached the action model')
      })
      const blockerRuntime = new BrowserComputerUseRuntime({ browser, visual: blockerVisual })
      await blockerRuntime.start(
        {
          goal: `Verify ${blocker} handoff`,
          maxSteps: 5,
          maxActions: 5,
          maxDurationMs: 30_000,
        },
        `blocker-${blocker}`,
        new AbortController().signal,
      )
      const waiting = await waitForSession(
        blockerRuntime,
        (session) => session.state === 'waiting-user',
      )
      assert.equal(waiting.lastErrorCode, blocker)
      assert.equal(blockerVisual.calls, 0)
      await blockerRuntime.stop()
    }
    console.log('Browser Control repro: blocker handoff PASS')

    await browser.open(`${origin}/?blocker=canvas-change`)
    const canvasObservation = await browser.captureComputerUseObservation(true)
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await assert.rejects(
      () =>
        browser.executeComputerUseDecision(
          scopedDecision(canvasObservation, {
            type: 'click',
            x: 80,
            y: 240,
            button: 'left',
          }),
          new AbortController().signal,
        ),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )
    assert((await browser.observe()).content.includes('Ready'))
    console.log('Browser Control repro: canvas visual stale detection PASS')

    await browser.open(origin)
    const slowRuntime = new BrowserComputerUseRuntime({
      browser,
      stopTimeoutMs: 100,
      visual: new ScriptedVisualAdapter((context) =>
        scopedDecision(context.observation, { type: 'navigate', url: `${origin}/slow` }),
      ),
    })
    await slowRuntime.start(
      {
        goal: 'Stop a slow navigation without a delayed mutation',
        maxSteps: 5,
        maxActions: 5,
        maxDurationMs: 30_000,
      },
      'slow-stop-action',
      new AbortController().signal,
    )
    await waitForSession(slowRuntime, (session) => session.activity === 'acting')
    assert.equal((await slowRuntime.stop()).state, 'stopped')
    assert.equal(browser.sessionSnapshot()?.status, 'closed')
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    assert.equal(browser.sessionSnapshot()?.status, 'closed')
    assert(!browser.sessionSnapshot()?.currentUrl?.includes('/slow'))
    console.log('Browser Control repro: no delayed mutation after Stop PASS')

    await browser.open(origin)
    const providerObservation = await browser.captureComputerUseObservation(true)
    const providerContext = { goal: 'Classify provider errors', observation: providerObservation }
    const capabilities = () => ({
      supportsReasoning: false,
      supportsStreaming: false,
      supportsTemperature: true,
      supportsSystemPrompt: true,
      supportsToolCalling: false,
      supportsVision: true,
      recommendedMaxTokens: 1_000,
    })
    const providerCases = [
      {
        expected: 'COMPUTER_USE_RATE_LIMITED',
        error: new LlmResponseError({
          provider: 'groq',
          code: 'RATE_LIMITED',
          message: 'rate limited',
        }),
      },
      {
        expected: 'COMPUTER_USE_MODEL_TIMEOUT',
        error: new LlmResponseError({ provider: 'groq', code: 'TIMEOUT', message: 'timeout' }),
      },
      { expected: 'COMPUTER_USE_PROVIDER_NETWORK', error: { code: 'ECONNRESET' } },
    ] as const
    for (const providerCase of providerCases) {
      const adapter = new LlmBrowserVisualActionAdapter({
        provider: () => ({
          capabilities,
          chat: async () => {
            throw providerCase.error
          },
        }),
        modelLabel: () => 'fixture-vision',
      })
      await assert.rejects(
        () => adapter.decide(providerContext, new AbortController().signal),
        (error) => error instanceof BrowserAutomationError && error.code === providerCase.expected,
      )
      if (providerCase.expected === 'COMPUTER_USE_RATE_LIMITED') {
        assert.equal(adapter.status().state, 'rate-limited')
      }
    }
    const unavailableProvider = new LlmBrowserVisualActionAdapter({
      provider: () => ({
        capabilities: () => ({ ...capabilities(), supportsVision: false }),
        chat: async () => '{}',
      }),
      modelLabel: () => 'text-only',
    })
    await assert.rejects(
      () => unavailableProvider.decide(providerContext, new AbortController().signal),
      (error) =>
        error instanceof BrowserAutomationError && error.code === 'COMPUTER_USE_MODEL_UNAVAILABLE',
    )
    const invalidProvider = new LlmBrowserVisualActionAdapter({
      provider: () => ({ capabilities, chat: async () => 'not-json' }),
      modelLabel: () => 'invalid-json',
    })
    await assert.rejects(
      () => invalidProvider.decide(providerContext, new AbortController().signal),
      (error) =>
        error instanceof BrowserAutomationError &&
        error.code === 'COMPUTER_USE_MODEL_INVALID_RESPONSE',
    )
    assert.equal((await browser.observe()).url, origin.endsWith('/') ? origin : `${origin}/`)
    console.log('Browser Control repro: typed provider failures PASS')

    await browser.open(origin)
    const staleObservation = await browser.captureComputerUseObservation(true)
    await browser.open(`${origin}/changed`)
    await assert.rejects(
      () =>
        browser.executeComputerUseDecision(
          scopedDecision(staleObservation, {
            type: 'click',
            x: 40,
            y: 40,
            button: 'left',
          } as Omit<BrowserComputerUseDecision, 'observationId' | 'pageId'>),
          new AbortController().signal,
        ),
      (error) => error instanceof BrowserAutomationError && error.code === 'TARGET_STALE',
    )

    await browser.close()
    reopened = new PlaywrightBrowserAdapter({ executablePath, profileDirectory })
    const persisted = (await reopened.open(origin)).observation
    assert(persisted?.content.includes('Persisted player: Ada'))
    await reopened.close()
    console.log('Browser Control deterministic repro: PASS')
  } finally {
    await Promise.allSettled([browser.close(), reopened?.close() ?? Promise.resolve()])
  }
}

export async function runDeterministicBrowserControl(): Promise<void> {
  const executablePath = resolveChromeExecutable()
  assert(executablePath, 'Google Chrome is required for Browser Control tests')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'shio-browser-control-'))
  const { server, origin } = await startFixture()
  try {
    await deterministicRepro(executablePath, profileDirectory, origin)
  } finally {
    await closeServer(server)
    await removeProfile(profileDirectory)
  }
}
