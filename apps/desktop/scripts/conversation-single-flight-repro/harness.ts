import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AudioPlayer } from '../../src/renderer/audio/audioPlayer'
import { BacklogSelector } from '../../src/renderer/continuousListening/BacklogSelector'
import { ConversationAdmissionCoordinator } from '../../src/renderer/continuousListening/ConversationAdmissionCoordinator'
import { UtteranceBacklog } from '../../src/renderer/continuousListening/UtteranceBacklog'
import type { BufferedUtterance, ConversationExecutionPhase, ConversationInput } from '../../src/renderer/continuousListening/types'
import { ConversationRuntime } from '../../src/renderer/runtime/ConversationRuntime'
import { LipSync } from '../../src/renderer/three/LipSync'
import { VrmModel } from '../../src/renderer/three/VrmModel'
import { normalizeLlmConfig } from '../../src/main/llm/config/normalizeConfig'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const deferred = <T = void>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => { resolve = done }), resolve }
}
const request = (turnId: string, source: ConversationInput['source'] = 'text_chat'): ConversationInput => ({
  turnId, source, text: turnId, createdAt: Date.now()
})
const completed = (turnId: string) => ({
  status: 'completed' as const, turnId, playbackCompleted: true as const, cleanupCompleted: true as const
})
const buffered = (id: string, priorityClass: BufferedUtterance['priorityClass']): BufferedUtterance => ({
  id, text: id, createdAt: Date.now(), expiresAt: Date.now() + 30_000,
  streamingSessionId: 'stream', segmentId: id,
  directAddress: true, question: priorityClass === 'P1', correctionHint: priorityClass === 'P0', followUpHint: true,
  attentionScore: priorityClass === 'P0' ? 100 : 80, attentionMode: 'streamer',
  capturedWhileShioBusy: true, capturedDuringPlayback: false, likelySelfEcho: false, priorityClass
})

class FakeSource {
  buffer: unknown
  onended: (() => void) | null = null
  connected = false
  started = false
  connect(): void { this.connected = true }
  disconnect(): void {}
  start(): void { this.started = true }
  stop(): void {}
}

class FakeAnalyser {
  fftSize = 256
  smoothingTimeConstant = 0
  frequencyBinCount = 128
  connect(): void {}
  getByteTimeDomainData(data: Uint8Array): void { data.fill(150) }
  getByteFrequencyData(data: Uint8Array): void { data.fill(100) }
}

class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}
  sources: FakeSource[] = []
  analyser = new FakeAnalyser()
  createAnalyser(): FakeAnalyser { return this.analyser }
  createBufferSource(): FakeSource {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
  async decodeAudioData(): Promise<{ duration: number }> { return { duration: 1 } }
  async resume(): Promise<void> {}
}

async function main(): Promise<void> {
  const audioContext = new FakeAudioContext()
  ;(globalThis as unknown as { AudioContext: new () => FakeAudioContext }).AudioContext = class {
    constructor() { return audioContext }
  } as unknown as new () => FakeAudioContext
  ;(globalThis as unknown as { window: unknown }).window = { setInterval: () => 1, clearInterval: () => undefined }

  // Audio graph is connected before LipSync/speaking readiness, and only then starts.
  const player = new AudioPlayer()
  let readySession: { turnId: string; playbackId: string } | null = null
  const playbackA = player.play(new ArrayBuffer(44), {
    turnId: 'turn-a',
    onReady: (session) => {
      const source = audioContext.sources[0]
      assert.equal(source.connected, true)
      assert.equal(source.started, false)
      readySession = session
    }
  })
  await flush()
  assert.equal(audioContext.sources[0].started, true)
  assert.equal(readySession?.turnId, 'turn-a')
  await assert.rejects(
    player.play(new ArrayBuffer(44), { turnId: 'turn-b', onReady: () => undefined }),
    /activeTurnId=turn-a requestedTurnId=turn-b/
  )
  const oldEnded = audioContext.sources[0].onended!
  oldEnded()
  await playbackA

  // A late ended callback from A cannot clear B ownership.
  const playbackB = player.play(new ArrayBuffer(44), { turnId: 'turn-b', onReady: () => undefined })
  await flush()
  oldEnded()
  assert.equal(player.getPlaybackDebug().turnId, 'turn-b')
  audioContext.sources[1].onended?.()
  await playbackB

  // One admission loop: text chat buffers; debug rejects; max execution remains one.
  {
    const release = deferred<void>()
    let active = 0
    let maxActive = 0
    const starts: string[] = []
    const coordinator = new ConversationAdmissionCoordinator(async (turn, reportPhase) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      starts.push(turn.turnId)
      reportPhase('generating')
      if (turn.turnId === 'production') await release.promise
      active -= 1
      return completed(turn.turnId)
    }, new UtteranceBacklog(), new BacklogSelector())
    const running = coordinator.admit(request('production'))
    await flush()
    assert.equal(await coordinator.admit(request('chat-during-playback')), 'queued_explicit')
    assert.equal(await coordinator.admit(request('debug-during-production', 'debug')), 'ignored_busy')
    assert.equal(coordinator.getActiveExecution()?.turnId, 'production')
    release.resolve()
    await running
    assert.deepEqual(starts, ['production', 'chat-during-playback'])
    assert.equal(maxActive, 1)
  }

  // Streaming arrivals during every execution phase remain buffered and yield at most one successor.
  for (const blockedPhase of ['generating', 'synthesizing', 'playing', 'cleaning_up'] as ConversationExecutionPhase[]) {
    const reached = deferred<void>()
    const release = deferred<void>()
    let active = 0
    let maxActive = 0
    const starts: string[] = []
    const coordinator = new ConversationAdmissionCoordinator(async (turn, reportPhase) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      starts.push(turn.turnId)
      if (turn.source === 'continuous_listening') {
        reportPhase(blockedPhase)
        reached.resolve()
        await release.promise
      }
      active -= 1
      return completed(turn.turnId)
    }, new UtteranceBacklog(), new BacklogSelector())
    coordinator.setContinuousEnabled(true)
    const running = coordinator.admit(request(`initial-${blockedPhase}`, 'continuous_listening'))
    await reached.promise
    await coordinator.admit(request(`u2-${blockedPhase}`, 'continuous_listening'), buffered(`u2-${blockedPhase}`, 'P1'))
    await coordinator.admit(request(`u3-${blockedPhase}`, 'continuous_listening'), buffered(`u3-${blockedPhase}`, 'P0'))
    release.resolve()
    await running
    assert.equal(starts.length, 2, `phase=${blockedPhase}`)
    assert.ok(starts[1].includes(`u3-${blockedPhase}`), `phase=${blockedPhase}`)
    assert.equal(maxActive, 1, `phase=${blockedPhase}`)
  }

  // Conversation Runtime attaches speaking/LipSync only inside AudioPlayer.onReady.
  {
    const timeline: string[] = []
    const playbackGate = deferred<void>()
    let characterState = { mode: 'idle', emotion: 'neutral' }
    const runtime = new ConversationRuntime({
      speechRuntime: {
        hasSpeakableContent: (text: string) => /[\p{L}\p{N}]/u.test(text),
        updateConversationPresence: () => undefined,
        getCharacterState: () => characterState,
        createAssistantReply: async () => ({
          replyText: '[neutral] ok', displayText: 'ok', speechText: 'ok', emotionKey: 'neutral',
          segments: [{ id: 'segment-0', index: 0, emotion: 'neutral', text: 'ok' }]
        }),
        synthesizeSegment: async () => ({ ok: true, audioBuffer: new ArrayBuffer(44), emotionKey: 'neutral' })
      },
      conversationPresenceRuntime: { update: (value: unknown) => value },
      avatarRuntime: {
        applyCharacterState: (value: { mode: string }, options?: { lipSyncSession?: unknown }) => {
          timeline.push(options?.lipSyncSession ? 'avatar:speaking+lipsync' : `avatar:${value.mode}`)
        },
        stopLipSync: () => { timeline.push('avatar:lipsync-stop'); return true },
        getMirrorState: () => ({})
      },
      overlayRuntime: { publishAvatarState: () => undefined },
      events: { publish: () => undefined },
      player: {
        play: async (_buffer: ArrayBuffer, options: { turnId: string; onReady: (session: object) => void }) => {
          timeline.push('audio:graph-ready')
          options.onReady({ turnId: options.turnId, playbackId: 'p1', analyser: {}, startedAt: 0 })
          timeline.push('audio:started')
          await playbackGate.promise
          return { turnId: options.turnId, playbackId: 'p1' }
        }
      },
      setStatus: () => undefined,
      pushMessage: () => undefined,
      recordRuntimeEvent: () => undefined,
      updateCharacterState: (patch: { mode: string; emotion: string }) => {
        characterState = { mode: patch.mode, emotion: patch.emotion }
        return characterState
      },
      rememberSpeechMetadata: () => undefined,
      updateSpeechPlaybackProgress: () => undefined,
      isContinuousCaptureAlive: () => false
    } as never)
    const orderedRunning = runtime.execute({
      turnId: 'ordered-turn', admissionCycleId: 'cycle', source: 'text_chat', text: 'test', createdAt: Date.now()
    }, () => undefined)
    await flush()
    const overlapResult = await runtime.execute({
      turnId: 'overlap-turn', admissionCycleId: 'other-cycle', source: 'text_chat', text: 'test', createdAt: Date.now()
    }, () => undefined)
    assert.equal(overlapResult.status, 'failed')
    playbackGate.resolve()
    const result = await orderedRunning
    assert.equal(result.status, 'completed')
    assert.ok(timeline.indexOf('audio:graph-ready') < timeline.indexOf('avatar:speaking+lipsync'))
    assert.ok(timeline.indexOf('avatar:speaking+lipsync') < timeline.indexOf('audio:started'))
    assert.ok(timeline.indexOf('audio:started') < timeline.indexOf('avatar:lipsync-stop'))
  }

  // LipSync stop is turn-aware: stale cleanup cannot detach the active session.
  {
    const lipSync = new LipSync(new VrmModel())
    const analyser = new FakeAnalyser() as unknown as AnalyserNode
    lipSync.attach({
      turnId: 'active', playbackId: 'active:p1', playbackItemId: 'active:item-1',
      analyser, startedAt: 0, normalizationReference: 0.12
    }, 'neutral')
    assert.equal(lipSync.detach('old-turn'), false)
    assert.equal(lipSync.getActiveSession()?.turnId, 'active')

    // One LipSync turn session accepts an atomic handoff from playback A to B.
    const nextAnalyser = new FakeAnalyser() as unknown as AnalyserNode
    lipSync.attach({
      turnId: 'active', playbackId: 'active:p2', playbackItemId: 'active:item-2',
      analyser: nextAnalyser, startedAt: 1, normalizationReference: 0.14
    }, 'sad')
    assert.equal(lipSync.getActiveSession()?.playbackId, 'active:p2')
    assert.equal(lipSync.getActiveSession()?.playbackItemId, 'active:item-2')
    assert.equal(lipSync.getActiveSession()?.analyser, nextAnalyser)

    assert.throws(() => lipSync.attach({
      turnId: 'other-turn', playbackId: 'other:p1', playbackItemId: 'other:item-1',
      analyser, startedAt: 2, normalizationReference: 0.12
    }, 'neutral'), /activeTurnId=active.*activePlaybackId=active:p2.*requestedTurnId=other-turn/)
    lipSync.update(1 / 60)
    assert.equal(lipSync.detach('active', true), true)
    assert.equal(lipSync.getActiveSession(), null)
    assert.deepEqual(lipSync.getMouthWeights(), { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
  }

  // Backlog Selector remains before the Overlay settings section and persisted
  // role values survive normalization.
  {
    const settingsSource = readFileSync('src/renderer/components/SettingsDialog.tsx', 'utf8')
    const backlogStart = settingsSource.indexOf('backlog-selector-title')
    const overlayStart = settingsSource.indexOf('overlay-panel', backlogStart)
    assert.ok(backlogStart >= 0 && overlayStart > backlogStart)

    // The overlay renderer must return from bootstrap before continuous input
    // registration. Otherwise it becomes a second admission/generation/audio
    // owner and reproduces the two-voice production failure.
    const controllerSource = readFileSync('src/renderer/Controller.ts', 'utf8')
    const overlayBootstrapGuard = controllerSource.indexOf('if (this.overlayRuntime.isOverlayWindow())')
    const continuousBootstrap = controllerSource.indexOf('await this.applyContinuousListeningSettings', overlayBootstrapGuard)
    const guardReturn = controllerSource.indexOf('return', overlayBootstrapGuard)
    assert.ok(overlayBootstrapGuard >= 0 && guardReturn > overlayBootstrapGuard && continuousBootstrap > guardReturn)

    const normalized = normalizeLlmConfig({
      activeProvider: 'groq',
      providers: {},
      roles: { backlogSelector: {
        enabled: true, providerId: 'mistral', model: 'selector-model', timeoutMs: 1750, minimumConfidence: 0.81
      } }
    })
    assert.deepEqual(normalized.roles.backlogSelector, {
      enabled: true, providerId: 'mistral', model: 'selector-model', timeoutMs: 1750, minimumConfidence: 0.81
    })
  }

  console.log('Conversation single-flight repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
