const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright-core')

const desktop = path.resolve(__dirname, '../..')
const sourceTitle = 'Shio qualification · Spaces'
const questionPatterns = [/расскажи.*экран/iu, /страниц.*открыта/iu, /пиши.*экран/iu]
const screenEvidence =
  /spaces|hugging\s*face|хаггинг|хаггин|gradio|streamlit|град[иь]о|генераци[ияю]|синтез речи/iu

function synthesizeMicrophone(wav) {
  const shell = path.join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const generate = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Speech
    $synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
    try {
      $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ru-RU' } | Select-Object -First 1
      if (!$voice) { throw 'Install a Russian desktop speech voice for this qualification.' }
      $synth.SelectVoice($voice.VoiceInfo.Name)
      $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(48000, 'Sixteen', 'Mono')
      $synth.SetOutputToWaveFile($env:SHIO_QUALIFICATION_WAV, $format)
      $prompt = [System.Speech.Synthesis.PromptBuilder]::new($voice.VoiceInfo.Culture)
      $phrases = @('Ну, ещё разок.', 'Расскажи, что сейчас на экране.', 'Что это за страница у меня открыта?', 'Опиши экран прямо сейчас.')
      $pauses = @(4, 8, 18, 18)
      for ($i = 0; $i -lt $phrases.Length; $i++) {
        $prompt.AppendBreak([TimeSpan]::FromSeconds($pauses[$i]))
        $prompt.AppendText($phrases[$i])
      }
      $prompt.AppendBreak([TimeSpan]::FromSeconds(80))
      $synth.Speak($prompt)
    } finally { $synth.Dispose() }
  `
  execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', generate], {
    env: { ...process.env, SHIO_QUALIFICATION_WAV: wav },
    windowsHide: true,
  })
}

async function installSource(application) {
  await application.evaluate(async ({ BrowserWindow, desktopCapturer }, title) => {
    const fixture = new BrowserWindow({
      width: 650,
      height: 480,
      frame: false,
      show: false,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    const html = `<title>${title}</title><body style="background:#efe9ff;color:#171326;font:24px sans-serif"><h1>Hugging Face · Spaces</h1><p>Discover amazing ML apps made by the community</p><p>Image Generation · Text-to-Speech</p><p>Gradio · Streamlit</p></body>`
    await fixture.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    fixture.showInactive()
    const list = desktopCapturer.getSources.bind(desktopCapturer)
    desktopCapturer.getSources = async ({ thumbnailSize }) => {
      // The picker and native grant see only the fixture. Other windows have no thumbnails.
      const windows = await list({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      })
      const source = windows.find((item) => item.id === fixture.getMediaSourceId())
      if (!source) return []
      if (!thumbnailSize?.width) return [source]
      return [
        { ...source, thumbnail: (await fixture.webContents.capturePage()).resize(thumbnailSize) },
      ]
    }
  }, sourceTitle)
}

async function checkConversation(application) {
  const page = await application.firstWindow()
  await page.getByRole('button', { name: 'Трансляция', exact: true }).waitFor()
  const inference = await page.evaluate(async () => {
    const { llm, speechVolumePercent } = await window.api.config.get()
    const provider = llm.activeProvider
    const { model, codexReasoningByModel } = llm.providers[provider]
    return { provider, model, effort: codexReasoningByModel?.[model], speechVolumePercent }
  })
  assert.deepEqual(inference, {
    provider: 'codex-cli',
    model: 'gpt-6-luna',
    effort: 'low',
    speechVolumePercent: 0,
  })
  await installSource(application)
  // Exercise the real video grant; system playback is outside this microphone fixture.
  await page.evaluate(() => {
    const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getDisplayMedia = async (constraints) => {
      const stream = await capture(constraints)
      for (const track of stream.getAudioTracks()) {
        stream.removeTrack(track)
        track.stop()
      }
      return stream
    }
  })
  const transport = await page.context().newCDPSession(page)
  const sockets = new Set()
  const finals = []
  await transport.send('Network.enable')
  transport.on('Network.webSocketCreated', ({ requestId, url }) => {
    if (new URL(url).pathname === '/ws/asr') sockets.add(requestId)
  })
  transport.on('Network.webSocketFrameReceived', ({ requestId, response }) => {
    if (!sockets.has(requestId) || response.opcode !== 1) return
    const event = JSON.parse(response.payloadData)
    if (event.type === 'final') finals.push(event.text)
  })
  await page.getByRole('button', { name: 'Трансляция', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(sourceTitle) }).click()
  await page.getByRole('button', { name: 'Начать трансляцию', exact: true }).click()
  const user = page.locator('#chat-messages .message-user .msg-text')
  const assistant = page.locator(
    '#chat-messages .message-assistant:not(.message-loading):not([aria-busy="true"]) .msg-text',
  )
  try {
    await user.nth(2).waitFor({ timeout: 95000 })
    await assistant.nth(2).waitFor({ timeout: 30000 })
    const questions = await user.allTextContents()
    const replies = await assistant.allTextContents()
    assert.equal(questions.length, 3, 'Expected exactly three user turns')
    assert.equal(replies.length, 3, 'Expected a separate reply to each user turn')
    assert.equal(finals.length, 4, 'Expected the aside and three recognized questions')
    assert.match(finals[0], /разок/iu, 'The fixture should begin with the spoken aside')
    for (const [index, pattern] of questionPatterns.entries()) {
      assert.match(finals[index + 1], pattern, `ASR final for question ${index + 1}`)
      assert.match(questions[index], pattern, `Chat admission of question ${index + 1}`)
      assert.match(replies[index], screenEvidence, `Visible evidence in reply ${index + 1}`)
    }
    console.log(
      `ASR finals ${finals.length}, user questions ${questions.length}, grounded replies ${replies.length}; Codex CLI gpt-6-luna low`,
    )
  } finally {
    await transport.detach()
    const stop = page.getByRole('button', { name: 'Остановить трансляцию', exact: true })
    if (await stop.isVisible()) await stop.click()
  }
}

async function qualify() {
  assert.equal(process.platform, 'win32', 'This qualification requires Windows window capture')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shio-watch-voice-'))
  let application
  try {
    const wav = path.join(directory, 'voice.wav')
    synthesizeMicrophone(wav)
    const profile = path.join(directory, 'profile')
    await fs.mkdir(profile)
    const role = { providerId: 'codex-cli', model: 'gpt-6-luna' }
    await fs.writeFile(
      path.join(profile, 'config.json'),
      JSON.stringify({
        setup: { completed: true },
        uiLocale: 'ru',
        uiTheme: 'light',
        micDeviceId: 'default',
        speechVolumePercent: 0,
        llm: {
          activeProvider: role.providerId,
          providers: {
            [role.providerId]: {
              model: role.model,
              codexReasoningByModel: { [role.model]: 'low' },
            },
          },
          roles: { characterFallbacks: [], backlogSelector: role, computerUseVision: role },
        },
      }),
    )
    const env = { ...process.env, SHIO_DESKTOP_USER_DATA_ROOT: profile, SHIO_MOTION_ENABLED: '0' }
    delete env.ELECTRON_RUN_AS_NODE
    application = await _electron.launch({
      executablePath: require('electron'),
      cwd: desktop,
      args: [
        desktop,
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${wav}`,
      ],
      env,
    })
    await checkConversation(application)
  } finally {
    try {
      await application?.close()
    } finally {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
}

qualify().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
