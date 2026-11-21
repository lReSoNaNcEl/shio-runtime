const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

async function main() {
  const [, , trackFile, output, vrmFile, support] = process.argv
  assert(
    trackFile && output && vrmFile,
    'Usage: node preview.cjs <motion.json> <new output directory> <model.vrm> [--plant-feet]',
  )
  assert(support === undefined || support === '--plant-feet')
  const previewUrl = support
    ? 'http://flashmotion.local/?support=standing'
    : 'http://flashmotion.local/'
  const samples = JSON.parse(fs.readFileSync(trackFile, 'utf8'))
  assert(samples.fps === 20 || samples.fps === 30, 'Unexpected FlashMotion source frame rate')
  const isSpeech = samples.fps === 30
  const frameCount = isSpeech ? 1350 : 200
  const clip = isSpeech ? samples.localAxisAngleRaw : samples.joints
  assert(Array.isArray(clip) && clip.length >= 4 && clip.length <= frameCount)
  const vectorIsFinite = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  assert(
    clip.every((frame) => frame.length === (isSpeech ? 55 : 22) && frame.every(vectorIsFinite)),
  )
  if (isSpeech) {
    assert(
      Array.isArray(samples.root) &&
        samples.root.length === clip.length &&
        samples.root.every(vectorIsFinite),
    )
  }
  const { build } = await import('vite')
  const bundle = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: path.join(__dirname, 'preview.ts'),
        output: { format: 'iife', inlineDynamicImports: true },
      },
    },
  })
  const script = bundle.output.find((entry) => entry.type === 'chunk')
  assert(script)
  fs.mkdirSync(output)
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 720 } })
    await page.route('**/*', async (route) => {
      switch (route.request().url()) {
        case previewUrl:
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><script defer src="/preview.js"></script>',
          })
        case 'http://flashmotion.local/preview.js':
          return route.fulfill({ contentType: 'text/javascript', body: script.code })
        case 'http://flashmotion.local/model.vrm':
          return route.fulfill({ contentType: 'model/gltf-binary', path: path.resolve(vrmFile) })
        default:
          return route.abort()
      }
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(previewUrl)
    const identity = await page.evaluate(async () => {
      const result = await window.flashMotionPreview
      return { vrmVersion: result.vrmVersion, height: result.height, left: result.left }
    })
    const trace = []
    const first = clip[0]
    for (const [frameIndex, frame] of clip.entries()) {
      trace.push(
        await page.evaluate(
          async ({ pose, start, root, firstRoot }) => {
            const preview = await window.flashMotionPreview
            return root ? preview.poseS2g(pose, root, firstRoot) : preview.pose(pose, start)
          },
          {
            pose: frame,
            start: first,
            root: samples.root?.[frameIndex],
            firstRoot: samples.root?.[0],
          },
        ),
      )
      await page.screenshot({
        path: path.join(output, `frame-${String(frameIndex).padStart(3, '0')}.png`),
      })
    }
    assert.deepEqual(errors, [])
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          ...identity,
          fps: samples.fps,
          frames: trace.length,
          standingSupport: Boolean(support),
          trace,
          scope: isSpeech
            ? 'offline VRM preview from raw SMPL-X rotations before the SMPL-X hand pose mean'
            : 'offline VRM preview from HumanML3D joint directions',
        },
        null,
        2,
      ),
    )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
