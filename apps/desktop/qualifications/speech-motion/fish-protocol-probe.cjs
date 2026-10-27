const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// Transport qualification only: PCM is measured and acknowledged, never played.
const endpoint = new URL(process.env.SHIO_SPEECH_API_URL || 'http://127.0.0.1:8000')
const directory = path.resolve(
  __dirname,
  '../../motion/.artifacts',
  `fish-protocol-${new Date().toISOString().replace(/[:.]/gu, '-')}`,
)
fs.mkdirSync(directory, { recursive: true })
const report = { startedAt: new Date().toISOString(), sessions: [], passed: false }
const firstText =
  'Мы спокойно проверяем потоковую речь. Сначала приходит одна часть текста, затем другая. ' +
  'Звук должен появиться до завершения ввода, а отмена должна остановить настоящее вычисление. '
const delivery = { emotion: 'calm', pace: 'normal', energy: 'normal', volume: 'normal' }

async function health() {
  const response = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(5000) })
  assert(response.ok, 'Speech health endpoint failed')
  const value = await response.json()
  assert.equal(value.synthesis.engine, 'fish-s2-pro')
  assert.equal(value.synthesis.mode, 'real')
  return value
}
async function waitReady() {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    const value = await health()
    if (value.synthesis.ready) return value
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Fish did not become ready after owned cancellation')
}

function session(voiceId, cancelOnFirstPcm) {
  return new Promise((resolve, reject) => {
    const sessionId = randomUUID()
    const turnId = randomUUID()
    const url = new URL('/tts/stream', endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    const startedAt = Date.now()
    const result = { cancelOnFirstPcm, chunks: 0, samples: 0, peak: 0, rms: 0 }
    let metadata = null,
      squared = 0,
      finishedInput = false,
      cancelledAt = null,
      outcome = null,
      settled = false
    const send = (value) => socket.send(JSON.stringify(value))
    const fail = (failure) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      reject(failure)
    }
    const timer = setTimeout(
      () => fail(new Error('Real Fish session exceeded 120 seconds')),
      120000,
    )
    socket.addEventListener('open', () => {
      if (settled) return
      try {
        send({
          type: 'start',
          protocolVersion: 2,
          sessionId,
          turnId,
          voiceId,
          language: 'ru',
          delivery,
        })
      } catch (failure) {
        fail(failure)
      }
    })
    socket.addEventListener('error', (event) => {
      const cause = event.error?.cause
      result.transportFailure = {
        name: String(event.error?.name ?? '').slice(0, 80),
        message: String(event.error?.message ?? event.message ?? '').slice(0, 240),
        cause: String(cause?.message ?? cause ?? '').slice(0, 240),
        code: String(cause?.code ?? '').slice(0, 80),
      }
      console.error(JSON.stringify({ transportFailure: result.transportFailure }))
      fail(new Error(`Real Fish WebSocket failed: ${JSON.stringify(result.transportFailure)}`))
    })
    socket.addEventListener('message', (event) => {
      if (settled) return
      try {
        if (typeof event.data === 'string') {
          const value = JSON.parse(event.data)
          if (value.type === 'error') throw new Error(`Fish protocol error: ${value.code}`)
          if (value.type === 'ready') {
            assert.equal(value.protocolVersion, 2)
            assert.equal(value.engine, 'fish-s2-pro')
            assert.equal(value.sampleRate, 44100)
            assert.equal(value.channels, 1)
            assert.equal(value.sampleFormat, 'float32-le')
            send({ type: 'text', sequence: 0, text: firstText })
          } else if (value.type === 'audio') {
            assert.equal(metadata, null, 'Metadata must have exactly one binary pair')
            assert.equal(value.sequence, result.chunks)
            assert.equal(value.sampleOffset, result.samples)
            metadata = value
          } else if (value.type === 'complete') {
            assert(!cancelOnFirstPcm && finishedInput)
            assert.equal(value.sequence, result.chunks)
            assert.equal(metadata, null)
            outcome = 'complete'
            // Await the server's close: terminal output precedes release of its
            // admission slot. Client-initiated close can race the next session.
          } else if (value.type === 'cancelled') {
            assert(cancelledAt !== null)
            result.cancellationSettledMs = Date.now() - cancelledAt
            assert(
              result.cancellationSettledMs <= 5000,
              'Fish cancellation exceeded the client budget',
            )
            outcome = 'cancelled'
          }
          return
        }
        assert(metadata, 'Binary PCM must follow metadata')
        assert.equal(event.data.byteLength, metadata.samples * 4)
        const samples = new Float32Array(event.data)
        for (const sample of samples) {
          assert(Number.isFinite(sample) && Math.abs(sample) <= 4, 'Invalid real PCM sample')
          squared += sample * sample
          result.peak = Math.max(result.peak, Math.abs(sample))
        }
        const sequence = metadata.sequence
        result.samples += metadata.samples
        result.chunks++
        metadata = null
        send({ type: 'audio-ack', sequence })
        if (result.chunks === 1) {
          result.firstPcmMs = Date.now() - startedAt
          result.firstPcmBeforeFinishInput = !finishedInput
          if (cancelOnFirstPcm) {
            cancelledAt = Date.now()
            send({ type: 'cancel', reason: 'qualification-owned-session' })
          } else {
            send({ type: 'text', sequence: 1, text: 'Проверка продолжения потока завершена.' })
            finishedInput = true
            send({ type: 'finish-input' })
          }
        }
      } catch (failure) {
        fail(failure)
      }
    })
    socket.addEventListener('close', () => {
      if (settled) return
      try {
        assert(outcome, 'Fish closed without an owned terminal acknowledgement')
        assert(result.firstPcmBeforeFinishInput && result.samples > 0 && result.peak > 0.0001)
        result.rms = Math.sqrt(squared / result.samples)
        result.outcome = outcome
        result.elapsedMs = Date.now() - startedAt
        settled = true
        clearTimeout(timer)
        resolve(result)
      } catch (failure) {
        fail(failure)
      }
    })
  })
}

;(async () => {
  report.healthBefore = await waitReady()
  const response = await fetch(new URL('/voices', endpoint), { signal: AbortSignal.timeout(5000) })
  assert(response.ok)
  const voices = await response.json()
  const voice = voices.presets.find(
    (entry) => entry.available && entry.voiceId === voices.defaultVoiceId,
  )
  assert(voice, 'Default voice reference is unavailable')
  report.voiceId = voice.voiceId
  for (const cancel of [false, true, false]) {
    await waitReady()
    const result = await session(voice.voiceId, cancel)
    report.sessions.push(result)
    console.log(JSON.stringify(result))
  }
  report.healthAfter = await waitReady()
  report.passed = true
})()
  .catch((failure) => {
    report.failure = failure.message
    process.exitCode = 1
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
    console.log(
      JSON.stringify({ report: path.join(directory, 'report.json'), passed: report.passed }),
    )
  })
  .catch((failure) => {
    console.error(failure.message)
    process.exitCode = 1
  })
