// Capture bounded qualification phrases from the live Fish v2 transport.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const phrases = [
  { name: 'ru-short', language: 'ru', text: 'Привет! Я рада тебя видеть.' },
  {
    name: 'ru-pause-oov',
    language: 'ru',
    text: 'Сначала я покажу открытую ладонь... А потом скажу необычное слово: фломберик.',
  },
  {
    name: 'ru-long',
    language: 'ru',
    text:
      'Давай начнём с простого примера. Подними руку и покажи два пальца, словно приветствуешь друга. ' +
      'После короткой паузы спокойно опусти руку, сделай вдох и продолжай говорить в обычном темпе.',
  },
  { name: 'en-control', language: 'en', text: 'Hello! I raise my hand and wave to a friend.' },
]
const endpoint = new URL('http://127.0.0.1:8000')
const maxSamples = 44100 * 45

async function getJson(route) {
  const response = await fetch(new URL(route, endpoint), { signal: AbortSignal.timeout(5000) })
  assert(response.ok, `Speech API returned ${response.status} for ${route}`)
  return response.json()
}

function capture(phrase, voiceId) {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const sessionId = randomUUID()
    const turnId = randomUUID()
    const socket = new WebSocket('ws://127.0.0.1:8000/tts/stream')
    socket.binaryType = 'arraybuffer'
    const send = (value) => socket.send(JSON.stringify(value))
    const chunks = []
    const arrivals = []
    let total = 0
    let pending
    let completed = false
    let ready = false
    const timer = setTimeout(() => fail(new Error('Fish capture timeout')), 120000)
    function fail(error) {
      clearTimeout(timer)
      socket.close()
      reject(error)
    }
    socket.addEventListener('open', () =>
      send({
        type: 'start',
        protocolVersion: 2,
        sessionId,
        turnId,
        voiceId,
        language: phrase.language,
        delivery: { emotion: 'calm', pace: 'normal', energy: 'normal', volume: 'normal' },
      }),
    )
    socket.addEventListener('error', () => fail(new Error('Fish capture WebSocket error')))
    socket.addEventListener('message', ({ data }) => {
      try {
        if (typeof data !== 'string') {
          assert(pending && data.byteLength === pending.samples * 4)
          assert(total + pending.samples <= maxSamples)
          const bytes = Buffer.from(data)
          for (let offset = 0; offset < bytes.length; offset += 4) {
            assert(Number.isFinite(bytes.readFloatLE(offset)), 'Fish returned a nonfinite sample')
          }
          chunks.push(bytes)
          arrivals.push({
            sampleOffset: pending.sampleOffset,
            samples: pending.samples,
            arrivalMs: Math.round(performance.now() - started),
          })
          total += pending.samples
          send({ type: 'audio-ack', sequence: pending.sequence })
          pending = undefined
          return
        }
        const frame = JSON.parse(data)
        if (frame.type !== 'error') assert.equal(frame.sessionId, sessionId)
        switch (frame.type) {
          case 'ready':
            assert(!ready && frame.protocolVersion === 2 && frame.engine === 'fish-s2-pro')
            assert(
              frame.sampleRate === 44100 &&
                frame.sampleFormat === 'float32-le' &&
                frame.channels === 1,
            )
            ready = true
            send({ type: 'text', sequence: 0, text: phrase.text })
            send({ type: 'finish-input' })
            break
          case 'audio':
            assert(ready && !pending && !completed)
            assert.equal(frame.turnId, turnId)
            assert(frame.sequence === chunks.length && frame.sampleOffset === total)
            assert(Number.isSafeInteger(frame.samples) && frame.samples > 0)
            pending = frame
            break
          case 'complete':
            assert(ready && !pending && !completed && frame.sequence === chunks.length && total > 0)
            completed = true
            break
          case 'error':
            throw new Error(`Fish capture failed: ${frame.code}`)
        }
      } catch (error) {
        fail(error)
      }
    })
    socket.addEventListener('close', () => {
      clearTimeout(timer)
      if (completed) {
        resolve({ pcm: Buffer.concat(chunks), total, arrivals })
      } else {
        reject(new Error('Fish closed without complete'))
      }
    })
  })
}

async function main() {
  const argument = process.argv[2]
  assert(
    argument && process.argv.length === 3,
    'Usage: node capture-fish.cjs <new output directory>',
  )
  const output = path.resolve(argument)
  const health = await getJson('/health')
  assert(
    health.contractVersion === '2.1' &&
      health.synthesis?.ready &&
      health.synthesis?.mode === 'real',
  )
  const voices = await getJson('/voices')
  assert(voices.presets.some((entry) => entry.available && entry.voiceId === voices.defaultVoiceId))
  mkdirSync(output)
  for (const phrase of phrases) {
    const { pcm, total, arrivals } = await capture(phrase, voices.defaultVoiceId)
    writeFileSync(path.join(output, `${phrase.name}.f32le`), pcm, { flag: 'wx' })
    writeFileSync(
      path.join(output, `${phrase.name}.json`),
      `${JSON.stringify(
        {
          ...phrase,
          sampleRate: 44100,
          samples: total,
          arrivals,
          voiceId: voices.defaultVoiceId,
          fishModelRevision: health.synthesis.modelRevision,
          fishSourceRevision: health.synthesis.sourceRevision,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    )
    console.log(
      JSON.stringify({ case: phrase.name, samples: total, firstPcmMs: arrivals[0].arrivalMs }),
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
