import { AudioPlayer } from '../../src/renderer/audio/audioPlayer'
import { AvatarController } from '../../src/renderer/avatar/AvatarController'
import {
  deliveryIntent,
  RuntimeSpeechOutputPort,
} from '../../src/renderer/runtime/SpeechOutputPort'
import { SpeechRuntime } from '../../src/renderer/runtime/SpeechRuntime'
import {
  SafeCharacterStreamFilter,
  SpeechTextCommitBuffer,
} from '../../src/shared/character-stream'
import { cloneCharacterState, INITIAL_CHARACTER_STATE } from '../../src/shared/runtime'

/** Terminal-only qualification: no navigation, settings, screenshots or input. */
export async function run(): Promise<unknown> {
  const host = document.createElement('div')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '640px',
    height: '800px',
    pointerEvents: 'none',
  })
  const canvas = document.createElement('canvas')
  host.append(canvas)
  document.body.append(host)
  const avatar = new AvatarController()
  const mirror = new AvatarController({ overlayMode: true })
  const player = new AudioPlayer()
  const speech = new RuntimeSpeechOutputPort(new SpeechRuntime(), player)
  const state = cloneCharacterState(INITIAL_CHARACTER_STATE)
  state.mode = 'speaking'
  state.emotion = 'happy'
  state.conversationPresence.replyLength = 'long'
  state.conversationPresence.responsePhase = 'speaking'
  avatar.setEmbodimentIntent({ intensity: 'strong', gestureHint: 'tease', gazeHint: 'user' })
  const turnId = `s22-terminal:${Date.now()}`
  const began = performance.now()
  const cues: string[] = []
  const gestures = new Set<string>()
  const mouthValues = new Set<number>()
  const poses = new Set<string>()
  const attachments: unknown[] = []
  let peak = 0
  let mirrorPeak = 0
  let nativePeak = 0
  let firstAudibleMs: number | null = null
  let presentation: Promise<void> | undefined
  let presentationError: unknown
  let timer: number | undefined
  let timeout: number | undefined
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const stream = speech.openStream(turnId, deliveryIntent('happy', 'bright playful tone'), {
    turnId,
    onReady: (session) => {
      firstAudibleMs = performance.now() - began
      avatar.applyCharacterState(state, {
        lipSyncStart: {
          session,
          text: 'Проверяем голос, движения и синхронизацию губ при повторной загрузке модели.',
          emotionKey: 'happy',
        },
      })
      mirror.applyCharacterState(state)
      // Reproduce opening Avatar during actual playback, then reopening it.
      presentation = (async () => {
        for (let i = 0; i < 2; i += 1) {
          await wait(350)
          avatar.unloadPresentation()
          await avatar.loadPuppet(canvas)
          const snapshot = avatar.getDebugState()
          const sessionTurn = avatar.getSpeechPhraseSnapshot().turnId
          if (
            avatar.getMode() !== 'speaking' ||
            sessionTurn !== turnId ||
            snapshot.model2d.nativeState !== 'speaking'
          )
            throw new Error(
              `S22 attachment reset speech: ${JSON.stringify({ mode: avatar.getMode(), sessionTurn, nativeState: snapshot.model2d.nativeState })}`,
            )
          attachments.push({ nativeState: snapshot.model2d.nativeState, sessionPreserved: true })
        }
      })().catch((error: unknown) => {
        presentationError = error
      })
      timer = window.setInterval(() => {
        avatar.update(0.016, state)
        mirror.setMouthWeights(avatar.getMouthWeights())
        mirror.update(0.016, state)
        const snapshot = avatar.getDebugState()
        peak = Math.max(peak, ...Object.values(avatar.getMouthWeights()))
        mirrorPeak = Math.max(mirrorPeak, ...Object.values(mirror.getMouthWeights()))
        nativePeak = Math.max(nativePeak, snapshot.model2d.nativeMouthTarget)
        mouthValues.add(Math.round(snapshot.model2d.nativeMouthTarget * 100))
        if (snapshot.model2d.nativeGesture) gestures.add(snapshot.model2d.nativeGesture)
        if (snapshot.model2d.nativePose) poses.add(JSON.stringify(snapshot.model2d.nativePose))
      }, 16)
    },
    onDelivery: (emotion) => {
      cues.push(emotion)
      avatar.setSpeechDelivery(emotion)
      mirror.setSpeechDelivery(emotion)
    },
  })
  try {
    const text =
      '[happy][voice:bright playful tone]Привет! Проверяем голос, движения и синхронизацию губ. Я продолжаю говорить, пока модель загружается заново. [angry][voice:restrained angry tone]А теперь слушай внимательно. Новая эмоция должна совпадать с голосом и движением.'
    const filter = new SafeCharacterStreamFilter()
    const buffer = new SpeechTextCommitBuffer(turnId)
    for (const delta of [...filter.push(text), ...filter.flush()]) {
      for (const commit of buffer.push(delta)) stream.commit(commit)
    }
    for (const commit of buffer.flush()) stream.commit(commit)
    stream.finish()
    await Promise.race([
      stream.completion,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error('S22 speech qualification timeout')),
          90000,
        )
      }),
    ])
    await presentation
    if (presentationError) throw presentationError
    if (
      attachments.length !== 2 ||
      peak < 0.02 ||
      nativePeak < 0.02 ||
      mirrorPeak < 0.02 ||
      mouthValues.size < 4 ||
      poses.size < 5 ||
      gestures.size < 1 ||
      !cues.includes('happy') ||
      !cues.includes('angry')
    )
      throw new Error(
        `Missing speech embodiment: ${JSON.stringify({ attachments, peak, nativePeak, mirrorPeak, mouthChanges: mouthValues.size, poses: poses.size, gestures: [...gestures], cues })}`,
      )
    avatar.stopSpeaking()
    avatar.setSpeechDelivery(null)
    // LipSync release uses the playback clock, not a synthetic frame count.
    await wait(1200)
    const final = avatar.getDebugState()
    if (final.model2d.nativeState !== 'idle' || final.model2d.nativeMouthTarget > 0.01)
      throw new Error(
        `Mouth or speaking state remained active after completion: ${JSON.stringify({ state: final.model2d.nativeState, mouth: final.model2d.nativeMouthTarget })}`,
      )
    const result = {
      firstAudibleMs,
      attachments,
      peak,
      nativePeak,
      mirrorPeak,
      mouthChanges: mouthValues.size,
      poses: poses.size,
      gestures: [...gestures],
      cues,
      finalState: final.model2d.nativeState,
      finalMouth: final.model2d.nativeMouthTarget,
      elapsedMs: performance.now() - began,
    }
    console.info('[s22-terminal] PASS', JSON.stringify(result))
    return result
  } catch (error) {
    stream.cancel('stream-failed')
    throw error
  } finally {
    window.clearTimeout(timeout)
    window.clearInterval(timer)
    await presentation
    avatar.dispose()
    mirror.dispose()
    await player.dispose()
    host.remove()
  }
}
