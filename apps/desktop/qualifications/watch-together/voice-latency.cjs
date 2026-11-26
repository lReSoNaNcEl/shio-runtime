const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const cases = [
  {
    phrase: 'Ну, ещё разок попробую, и потом уже пойду спать.',
    heard: /разок|пойду спать/iu,
    aside: true,
  },
  {
    phrase: 'Как называется страница, которую сейчас видно на моём экране?',
    heard: /экран|страниц/iu,
    answer: /spaces|hugging|хагги|хагин/iu,
  },
  {
    phrase: 'Шио, назови одну технологию для приложений, написанную на странице.',
    heard: /технологи/iu,
    answer: /gradio|streamlit|град[иь]о|стримлит/iu,
  },
  {
    phrase: 'Назови один пример приложения, которое видно на этой странице.',
    heard: /пример/iu,
    answer: /генер|изображ|реч|голос|синтез|speech|image/iu,
  },
  {
    phrase:
      'Опиши страницу тремя короткими предложениями, назови платформу и обе технологии, а в конце приведи пример приложения для синтеза речи.',
    heard: /технологи|платформ|предложени/iu,
    answer: /реч|speech|озвуч/iu,
    detailed: true,
  },
]

function preparePhrases(directory) {
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Speech
    $synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
    try {
      $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ru-RU' } | Select-Object -First 1
      if (!$voice) { throw 'Russian desktop speech voice required' }
      $synth.SelectVoice($voice.VoiceInfo.Name)
      $synth.Rate = -1
      $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(48000, 'Sixteen', 'Mono')
      $phrases = ConvertFrom-Json $env:SHIO_QA_PHRASES
      for ($i = 0; $i -lt $phrases.Count; $i++) {
        $synth.SetOutputToWaveFile((Join-Path $env:SHIO_QA_WAV_DIRECTORY "$i.wav"), $format)
        $synth.Speak($phrases[$i])
        $synth.SetOutputToNull()
      }
    } finally { $synth.Dispose() }
  `
  execFileSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: {
        ...process.env,
        SHIO_QA_WAV_DIRECTORY: directory,
        SHIO_QA_PHRASES: JSON.stringify(cases.map((item) => item.phrase)),
      },
      windowsHide: true,
    },
  )
}

async function install(application) {
  const page = await application.firstWindow()
  await page.getByRole('button', { name: 'Трансляция', exact: true }).waitFor()
  await page.addInitScript({ path: path.join(__dirname, 'fixtures/latency-hooks.js') })
  await page.reload()
  await page.getByRole('button', { name: 'Трансляция', exact: true }).waitFor()
  const url = pathToFileURL(path.join(__dirname, 'fixtures/latency-meter.js')).href
  await page.evaluate((url) => window.__watchVoiceLatency.setup(url), url)
}

function summarize(row, fixture, index) {
  assert.equal(
    row.end,
    row.expectedEnd,
    'Observed last nonzero injected sample differs from the scheduled audio',
  )
  assert(Number.isInteger(row.start) && row.start < row.end)
  const finals = row.asr.filter((event) => event.type === 'final')
  assert.equal(finals.length, 1, 'Expected one ASR final per injected phrase')
  const final = finals[0]
  assert.match(final.text, fixture.heard)
  const partials = row.asr.filter((event) => event.type === 'partial')
  assert(
    partials.every(
      (p, i) =>
        p.segmentId === final.segmentId &&
        p.sessionId === final.sessionId &&
        p.observedFrame <= final.observedFrame &&
        p.startMs === final.startMs &&
        p.endMs <= final.endMs &&
        p.revision < final.revision &&
        (i === 0 || p.revision > partials[i - 1].revision),
    ),
    'Partial offsets, revision or event order invalid',
  )
  assert(row.asr.some((e) => e.type === 'speech_started' && e.segmentId === final.segmentId))
  assert(final.startMs < final.endMs)
  const diff = (from, to) => Math.round(((to - from) * 1000) / row.rate)
  const normalized = (text) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const finalWords = normalized(final.text)
  const matches = (p) => normalized(p.text) === finalWords
  const matching = partials.filter(matches)
  const matchingPartial = matching[0]
  const stable = partials.slice(partials.findLastIndex((p) => !matches(p)) + 1)
  const firstStable = stable[0]
  const summary = {
    case: index,
    kind: fixture.aside ? 'aside' : 'question',
    rate: row.rate,
    lastInputFrame: row.end - 1,
    inputDurationMs: diff(row.start, row.end),
    asrSegmentStartMs: final.startMs,
    asrSegmentEndMs: final.endMs,
    partialsBeforeFinal: partials.length,
    firstPartialMinusEndMs: partials.length ? diff(row.end, partials[0].observedFrame) : null,
    lastPartialMinusEndMs: partials.length ? diff(row.end, partials.at(-1).observedFrame) : null,
    matchingPartials: matching.length,
    matchingPartialSourceEndMs: matchingPartial?.endMs ?? null,
    matchingPartialMinusInputEndMs: matchingPartial
      ? diff(row.end, matchingPartial.observedFrame)
      : null,
    stableMatchingPartials: stable.length,
    stablePartialLeadOverFinalMs: firstStable
      ? diff(firstStable.observedFrame, final.observedFrame)
      : null,
    matchingPartialLeadOverFinalMs: matchingPartial
      ? diff(matchingPartial.observedFrame, final.observedFrame)
      : null,
    finalMinusEndMs: diff(row.end, final.observedFrame),
  }
  assert(summary.finalMinusEndMs >= 0)
  if (fixture.aside) {
    assert.equal(row.playbacks.length, 0, 'An aside created an audible reply')
    return summary
  }
  assert(partials.length, 'Expected a real interim transcript before the final')
  assert.equal(row.playbacks.length, 1, 'Expected one AudioPlayer stream for the admitted turn')
  const playback = row.playbacks[0]
  assert.equal(playback.terminal, 'ended')
  assert.equal(playback.sourceSampleRate, 44100)
  assert(
    Number.isInteger(playback.audibleSourceSample) &&
      playback.audibleSourceSample < playback.pushedSamples,
  )
  assert(
    playback.firstFrame >= final.observedFrame && playback.firstFrame >= playback.firstPushedFrame,
  )
  return {
    ...summary,
    firstOutputFrame: playback.firstFrame,
    audibleSourceSample: playback.audibleSourceSample,
    pcmPushMinusEndMs: diff(row.end, playback.firstPushedFrame),
    firstNonzeroMinusFinalMs: diff(final.observedFrame, playback.firstFrame),
    firstNonzeroMinusEndMs: diff(row.end, playback.firstFrame),
  }
}

// Bind Main's clock to the same AudioContext used by the two worklets.
async function stageTimings(page, row, directory) {
  const final = row.asr.find((e) => e.type === 'final')
  const turnId = `${final.sessionId}:${final.segmentId}`
  const wallTime = (frame) => row.clockTime + ((frame - row.clockFrame) * 1000) / row.rate
  const end = wallTime(row.end)
  const pcm = wallTime(row.playbacks[0].firstFrame)
  const log = await fs.readFile(path.join(directory, 'profile/logs/main.log'), 'utf8')
  const completed = [
    ...log.matchAll(
      /\[([\d-]+ [\d:.]+)\] \[info\]\s+\[(CodexCLI|ConversationTrace)\] (reply_completed|provider_request_terminal) \{([^}]+)\}/gu,
    ),
  ].filter((match) => match[4].includes(`traceId: '${turnId}'`))
  const at = (event) => (event ? Date.parse(event[1].replace(' ', 'T')) : NaN)
  const codex = completed.filter((e) => e[2] === 'CodexCLI')
  const firstVisual = codex.find((e) => /imageCount: [1-9]/u.test(e[4]))
  const terminal = completed.findLast((e) => e[2] === 'ConversationTrace')
  const turnFinal = at(terminal)
  const stage = await page.evaluate(async (id) => {
    const snapshot = await window.api.latency.snapshot()
    const trace = snapshot.recentTraces.find((t) => t.turnId === id)
    const at = (name) => trace?.milestones.find((m) => m.name === name)?.at
    return {
      admitted: at('turn_admitted'),
      sentence: at('llm_first_sentence'),
      tts: at('tts_segment_requested'),
      audio: at('first_audio_ready'),
    }
  }, turnId)
  const sinceEnd = (at) => (Number.isFinite(at) ? Math.round(at - end) : null)
  return {
    mainProviderTerminalMinusFirstNonzeroMs: Number.isFinite(turnFinal)
      ? Math.round(turnFinal - pcm)
      : null,
    admittedMinusEndMs: sinceEnd(stage.admitted),
    firstVisualCompletionMinusEndMs: sinceEnd(at(firstVisual)),
    sentenceCommitMinusEndMs: sinceEnd(stage.sentence),
    ttsRequestMinusEndMs: sinceEnd(stage.tts),
    audioReadyMinusEndMs: sinceEnd(stage.audio),
    firstNonzeroMinusSentenceMs: Number.isFinite(stage.sentence)
      ? Math.round(pcm - stage.sentence)
      : null,
    codexCompletionsForThisTurn: codex.length,
    lastCodexCompletionMinusFirstNonzeroMs: codex.length
      ? Math.round(at(codex.at(-1)) - pcm)
      : null,
  }
}

async function verifyDetailedReply(page, row, endpoint, replyText) {
  assert.match(replyText, /spaces|hugging|хагги|хагин/iu)
  assert.match(replyText, /gradio|град[иь]о/iu)
  assert.match(replyText, /streamlit|стримлит/iu)
  assert.match(replyText, /синтез.*реч|текст.*реч|озвуч|text.to.speech/iu)
  await page.waitForFunction(() => window.__watchVoiceLatency.tailPcm, undefined, { timeout: 5000 })
  const pcm = Buffer.from(
    await page.evaluate(() => window.__watchVoiceLatency.takeTail()),
    'base64',
  )
  const session = row.playbacks[0]
  assert.equal(pcm.byteLength, (session.lastFrame - session.tailStart + 1) * 2)
  const wav = Buffer.alloc(44 + pcm.byteLength)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + pcm.byteLength, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(row.rate, 24)
  wav.writeUInt32LE(row.rate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(pcm.byteLength, 40)
  pcm.copy(wav, 44)
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'rendered-tail.wav')
  const recognition = await fetch(new URL('/recognize?language=ru', endpoint), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  })
  assert(recognition.ok, 'Expected speech recognition of the actual AudioPlayer output tail')
  const { text: spokenTail } = await recognition.json()
  assert.match(
    spokenTail,
    /синтез|реч|озвуч|спич/iu,
    'The speech-related closing detail must be audible in the rendered tail',
  )
  assert(
    Number.isInteger(row.chatFinalFrame) && row.chatFinalCharacters === replyText.length,
    'Missing final detailed reply update in the chat observer',
  )
  return {
    detailChatCharacters: replyText.length,
    tailRecognized: true,
    tailMs: Math.round((pcm.byteLength * 500) / row.rate),
    chatFinalMinusFirstNonzeroMs: Math.round(
      ((row.chatFinalFrame - session.firstFrame) * 1000) / row.rate,
    ),
  }
}

async function run(application, page, directory, installSource, startWatch, sourceTitle) {
  const label = process.env.SHIO_QA_LATENCY_LABEL || 'current'
  const startedAt = new Date().toISOString()
  const results = []
  const healthEndpoint = new URL(
    '/health',
    process.env.SHIO_SPEECH_API_URL || 'http://127.0.0.1:8000',
  )
  const healthResponse = await fetch(healthEndpoint, { signal: AbortSignal.timeout(5000) })
  assert(healthResponse.ok, 'Expected a reachable Speech API')
  const { asr, synthesis } = await healthResponse.json()
  assert(
    asr?.ready && synthesis?.engine === 'fish-s2-pro' && synthesis?.mode === 'real',
    'This qualification requires ready ASR and real Fish S2 Pro synthesis',
  )
  console.log(
    `WATCH_VOICE_SETUP ${JSON.stringify({ label, asrReady: asr.ready, engine: synthesis.engine, warmup: synthesis.warmup, ttsReady: synthesis.ready })}`,
  )
  await installSource(application)
  const users = page.locator('#chat-messages .message-user .msg-text')
  const assistants = page.locator(
    '#chat-messages .message-assistant:not(.message-loading):not([aria-busy="true"]) .msg-text',
  )
  try {
    await startWatch(page, sourceTitle)
    await page.locator('.watch-session[data-phase="live"]').waitFor({ timeout: 35000 })
    for (const [index, fixture] of cases.entries()) {
      if (process.argv.includes('--detailed-only') && !fixture.detailed) continue
      const beforeUsers = await users.count()
      const beforeReplies = await assistants.count()
      let replyText
      const encoded = (await fs.readFile(path.join(directory, `${index}.wav`))).toString('base64')
      await page.evaluate((input) => window.__watchVoiceLatency.speak(input), {
        encoded,
        detailed: fixture.detailed === true,
      })
      await page.waitForFunction(
        () => window.__watchVoiceLatency.active.asr.some((e) => e.type === 'final'),
        undefined,
        { timeout: 20000 },
      )
      if (fixture.aside) {
        await page
          .locator('.watch-session-mic')
          .getByText(/мысль вслух/u)
          .waitFor({ timeout: 25000 })
        assert.equal(await users.count(), beforeUsers)
        assert.equal(await assistants.count(), beforeReplies)
      } else {
        const reply = assistants.nth(beforeReplies)
        await reply.waitFor({ timeout: 90000 })
        assert.match((await users.nth(beforeUsers).textContent()) || '', fixture.heard)
        replyText = (await reply.textContent()) || ''
        assert.match(replyText, fixture.answer)
        await page.waitForFunction(
          () => window.__watchVoiceLatency.active.playbacks.some((p) => p.terminal),
          undefined,
          { timeout: 150000 },
        )
      }
      if (fixture.detailed)
        await page.waitForFunction(() => window.__watchVoiceLatency.tailPcm, undefined, {
          timeout: 5000,
        })
      const row = await page.evaluate(() => window.__watchVoiceLatency.active)
      const result = summarize(row, fixture, index)
      if (!fixture.aside) Object.assign(result, await stageTimings(page, row, directory))
      if (fixture.detailed) {
        result.kind = 'detailed'
        Object.assign(result, await verifyDetailedReply(page, row, healthEndpoint, replyText))
      }
      results.push(result)
      console.log(`WATCH_VOICE_SAMPLE ${JSON.stringify({ label, ...result })}`)
    }
    const sorted = results
      .filter((r) => r.kind === 'question')
      .map((r) => r.firstNonzeroMinusEndMs)
      .sort((a, b) => a - b)
    const leads = results
      .filter((r) => r.kind === 'question' && r.matchingPartialLeadOverFinalMs !== null)
      .map((r) => r.matchingPartialLeadOverFinalMs)
    console.log(
      'WATCH_VOICE_LATENCY ' +
        JSON.stringify({
          label,
          provider: 'codex-cli',
          model: 'gpt-6-luna',
          effort: 'low',
          endpoint:
            'last nonzero injected sample end to first nonzero AudioPlayer worklet output, pre-gain, shared AudioContext',
          startedAt,
          endedAt: new Date().toISOString(),
          asrReady: asr.ready,
          fishWarmup: synthesis.warmup,
          questions: sorted.length,
          detailed: results.find((r) => r.kind === 'detailed'),
          questionsWithMatchingPartial: leads.length,
          maxMatchingPartialLeadOverFinalMs: leads.length ? Math.max(...leads) : null,
          medianMs: sorted[1] ?? null,
          rangeMs: sorted.length ? [sorted[0], sorted.at(-1)] : null,
          asideSilent: results.some((r) => r.kind === 'aside') ? true : null,
        }),
    )
  } catch (error) {
    const row = await page
      .evaluate(() => {
        const row = window.__watchVoiceLatency?.active
        if (!row) return undefined
        return {
          ...row,
          asr: row.asr.map(({ text, ...timing }) => ({ ...timing, characters: text?.length })),
        }
      })
      .catch(() => undefined)
    console.error(`WATCH_VOICE_DIAGNOSTIC ${JSON.stringify({ label, case: results.length, row })}`)
    throw error
  } finally {
    const stop = page.getByRole('button', { name: 'Остановить трансляцию', exact: true })
    if (await stop.isVisible()) await stop.click()
  }
}

module.exports = { install, preparePhrases, run }
