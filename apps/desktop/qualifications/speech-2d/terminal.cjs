const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const path = require('node:path')

;(async () => {
  const output = path.resolve('../../.work/qualification-s22-terminal')
  await fs.mkdir(output, { recursive: true })
  const { verifySpeechAssets } = await import('../../scripts/verify-speech-assets.mjs')
  const { workletReference } = verifySpeechAssets(path.resolve('out/renderer'))
  const fixture = 'out/renderer/qualification-s22-terminal.mjs'
  const source = await fs.readFile(fixture, 'utf8')
  const parts = source.split('./pcmStreamWorklet.js?no-inline')
  if (parts.length !== 2) throw new Error('Expected one production worklet reference')
  await fs.writeFile(fixture, parts.join(`./${workletReference}`))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const healthUrl = new URL('/health', env.SHIO_SPEECH_API_URL || 'http://127.0.0.1:8000')
  const deadline = Date.now() + 300000
  while (true) {
    const health = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
      .then((response) => response.json())
      .catch(() => null)
    if (health?.synthesis?.status === 'ready') break
    if (Date.now() >= deadline) throw new Error('Speech API did not become ready')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [process.cwd()],
    cwd: path.resolve('../..'),
    env,
  })
  const errors = []
  const journal = []
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().startsWith('[s22-terminal]')) journal.push(message.text())
  })
  try {
    await page.waitForFunction(() => typeof window.api?.tts?.openStream === 'function')
    const result = await page.evaluate(async () => {
      const probe = await import(new URL('./qualification-s22-terminal.mjs', location.href).href)
      return probe.run()
    })
    if (errors.length) throw new Error(errors.join('; '))
    const report = { ok: true, pid: app.process().pid, workletReference, result, journal, errors }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  } catch (error) {
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        { ok: false, pid: app.process().pid, error: error.message, journal, errors },
        null,
        2,
      ),
    )
    throw error
  } finally {
    if (process.argv.includes('--keep-open'))
      await new Promise((resolve) => app.once('close', resolve))
    else await app.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
