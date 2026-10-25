import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const root = resolve(fileURLToPath(new URL('../public/shio-2d', import.meta.url)))
const output = resolve(fileURLToPath(new URL('../../..', import.meta.url)), '.work/qualification-2d')
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm' }
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<style>html,body{margin:0;width:100%;height:100%;background:#dadada}canvas{width:100%;height:100%}</style><canvas></canvas>')
      return
    }
    const target = resolve(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1)))
    if (!target.startsWith(root + sep)) throw Error('Invalid asset path')
    response.setHeader('Content-Type', mime[extname(target)] ?? 'application/octet-stream')
    response.end(await readFile(target))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
let browser
try {
  await mkdir(output, { recursive: true })
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const catalog = await page.evaluate(async () => {
    const module = await import('/runtime.mjs')
    globalThis.puppet = new module.ShioPuppet(document.querySelector('canvas'))
    await puppet.load()
    return { emotions: Object.keys(module.EXPRESSIONS), gestures: Object.keys(module.GESTURES), durations: module.GESTURE_DURATIONS }
  })
  assert.equal(catalog.emotions.length, 17)
  assert.equal(catalog.gestures.length, 19)
  const checks = []
  for (const emotion of catalog.emotions) {
    assert(await page.evaluate((name) => puppet.setEmotion(name, 0.9), emotion))
    await page.waitForTimeout(180)
    checks.push(await inspect(page, `emotion:${emotion}`))
    await page.screenshot({ path: resolve(output, `emotion-${emotion}.png`) })
  }
  for (const gesture of catalog.gestures) {
    assert(await page.evaluate((name) => puppet.react(name), gesture))
    await page.waitForTimeout(150)
    checks.push(await inspect(page, `gesture:${gesture}`))
    await page.evaluate((duration) => {
      // Exercise middle and terminal poses without waiting 12 seconds per gesture.
      puppet.gesture && (puppet.gesture.start = puppet.time - duration * 0.55)
      puppet.facialGesture && (puppet.facialGesture.start = puppet.time - duration * 0.55)
    }, catalog.durations[gesture])
    await page.waitForTimeout(100)
    checks.push(await inspect(page, `gesture-middle:${gesture}`))
    await page.evaluate(() => puppet.stop())
  }
  for (const viseme of ['a', 'e', 'o', 'u', 'laugh', 'grin']) {
    assert(await page.evaluate((name) => puppet.setMouth(0.8, name), viseme))
    await page.waitForTimeout(100)
    checks.push(await inspect(page, `mouth:${viseme}`))
  }
  for (const tail of ['side', 'back']) {
    assert(await page.evaluate((name) => puppet.setTailStyle(name), tail))
    await page.waitForTimeout(100)
    checks.push(await inspect(page, `tail:${tail}`))
  }
  for (const state of ['idle', 'listening', 'thinking', 'speaking']) {
    assert(await page.evaluate((value) => puppet.setState(value), state))
    await page.waitForTimeout(100)
    checks.push(await inspect(page, `state:${state}`))
  }
  assert(await page.evaluate(() => !puppet.setEmotion('injected') && !puppet.setGaze(NaN, 0) && !puppet.setMouth(Infinity)))
  const stopped = await page.evaluate(async () => {
    puppet.dispose(); puppet.dispose()
    const time = puppet.time
    await new Promise((done) => setTimeout(done, 100))
    return puppet.disposed && puppet.time === time && puppet.onFrame === null
  })
  assert(stopped, 'S22 teardown must stop animation and release callbacks')
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ catalog, checks, teardown: stopped, errors }, null, 2))
  console.log(`S22 GPU qualification passed: ${checks.length} poses, disposal; ${output}`)
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}

async function inspect(page, label) {
  const result = await page.evaluate(() => {
    const finite = (value) => typeof value === 'number' ? Number.isFinite(value) : Array.isArray(value) ? value.every(finite) : value && typeof value === 'object' ? Object.values(value).every(finite) : true
    return { finite: finite(puppet.pose), error: puppet.mesh.gl.getError(), width: puppet.canvas.width, height: puppet.canvas.height }
  })
  assert(result.finite, `${label}: nonfinite pose`)
  assert.equal(result.error, 0, `${label}: WebGL error`)
  assert(result.width > 0 && result.height > 0)
  return { label, ...result }
}
