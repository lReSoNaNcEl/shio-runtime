import { AudioPlayer } from '../../src/renderer/audio/audioPlayer'
import { AvatarController } from '../../src/renderer/avatar/AvatarController'
import {
  deliveryIntent,
  RuntimeSpeechOutputPort,
} from '../../src/renderer/runtime/SpeechOutputPort'
import { SpeechRuntime } from '../../src/renderer/runtime/SpeechRuntime'

export async function run(): Promise<unknown> {
  const host = document.createElement('div')
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    background: 'var(--app-bg)',
  })
  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, { width: '100%', height: '100%' })
  host.append(canvas)
  document.body.append(host)
  const avatar = new AvatarController()
  const player = new AudioPlayer()
  const speech = new RuntimeSpeechOutputPort(new SpeechRuntime(), player)
  const cues: Array<{ emotion: string; time: number }> = []
  const began = performance.now()
  let firstAudible: number | null = null
  let mouthPeak = 0
  let timer: number | undefined
  try {
    await avatar.loadPuppet(canvas)
    timer = window.setInterval(() => {
      avatar.update(0.016)
      const mouth = avatar.getMouthWeights()
      mouthPeak = Math.max(mouthPeak, ...Object.values(mouth))
      void window.api.avatarMouth
        .publish(mouth)
        .catch((error) => console.error('qualification mirror', error))
    }, 16)
    const turnId = `qualification:${Date.now()}`
    const stream = speech.openStream(turnId, deliveryIntent('happy'), {
      turnId,
      onReady: (session) => {
        firstAudible = performance.now()
        avatar.startSpeaking(
          { session, text: 'Привет! Я Шио. А теперь я говорю спокойнее.', emotionKey: 'happy' },
          'happy',
        )
      },
      onDelivery: (emotion) => {
        cues.push({ emotion, time: performance.now() })
        avatar.setSpeechDelivery(emotion)
        void window.api.avatarState
          .publish({ mode: 'speaking', emotionKey: 'happy', speechDeliveryEmotion: emotion })
          .catch((error) => console.error('qualification mirror', error))
      },
    })
    stream.commit({
      id: `${turnId}:0`,
      boundary: 'sentence',
      turnId,
      sequence: 0,
      text: 'Привет! Я Шио. Проверяем потоковую речь.',
      emotion: 'happy',
    })
    stream.commit({
      id: `${turnId}:1`,
      boundary: 'final',
      turnId,
      sequence: 1,
      text: 'А теперь я говорю спокойнее. Проверка закончена.',
      emotion: 'sad',
    })
    stream.finish()
    await stream.completion
    if (!firstAudible || cues.length !== 2 || mouthPeak < 0.02)
      throw new Error(
        `Speech qualification failed ${JSON.stringify({ firstAudible, cues, mouthPeak })}`,
      )
    avatar.stopSpeaking()
    avatar.setSpeechDelivery(null)
    await window.api.avatarState.publish({
      mode: 'idle',
      emotionKey: 'neutral',
      speechDeliveryEmotion: null,
    })
    const cancelId = `${turnId}:cancel`
    const cancelled = speech.openStream(cancelId, deliveryIntent('neutral'), {
      turnId: cancelId,
      onReady: () => undefined,
    })
    const rejected = cancelled.completion.catch(() => 'cancelled')
    cancelled.commit({
      id: `${cancelId}:0`,
      boundary: 'final',
      turnId: cancelId,
      sequence: 0,
      text: 'Эта фраза должна быть прервана сразу после запуска.',
      emotion: 'neutral',
    })
    await new Promise((done) => setTimeout(done, 300))
    cancelled.cancel('conversation-interrupted')
    if (player.isBusy()) throw new Error('Cancellation left local audio active')
    await rejected
    return {
      firstAudibleMs: firstAudible - began,
      cues,
      mouthPeak,
      elapsedMs: performance.now() - began,
      cancellation: 'flushed synchronously',
    }
  } finally {
    window.clearInterval(timer)
    avatar.dispose()
    await player.dispose()
    host.remove()
  }
}
