const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const desktop = path.resolve(__dirname, '../..')
const repository = path.resolve(desktop, '../..')
const currentPins = JSON.parse(fs.readFileSync(path.join(desktop, 'motion/research-pins.json')))
assert(
  currentPins.motion.skeleton === 'CoreSkeleton27',
  'Historical Core8 A/B preparation requires its original Core8 source snapshot; the current tree uses SOMA.',
)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const root = path.join(repository, 'tmp', `motion-ab-${stamp}`)
assert(root.startsWith(path.join(repository, 'tmp') + path.sep))
fs.mkdirSync(root, { recursive: true })
const hash = (filename) => createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const protectedFiles = [
  'motion/research-pins.json',
  'motion/backend.py',
  'motion/worker.py',
  'motion/protocol.py',
  'motion/motion-profiles.json',
  'src/shared/motion/index.ts',
  'src/shared/motion/catalogSchema.ts',
  'src/main/motion/ArdyMotionService.ts',
  'src/renderer/avatar/rendering/three/GeneratedBodyPlayback.ts',
  'src/renderer/Controller.ts',
]
const report = {
  root,
  createdAt: new Date().toISOString(),
  productionHashes: Object.fromEntries(
    protectedFiles.map((file) => [file, hash(path.join(desktop, file))]),
  ),
  variants: {},
}
for (const variant of ['core8', 'soma60']) {
  const target = path.join(root, variant, 'apps/desktop')
  fs.mkdirSync(target, { recursive: true })
  for (const dir of ['src', 'scripts', 'qualifications'])
    fs.cpSync(path.join(desktop, dir), path.join(target, dir), { recursive: true })
  for (const file of [
    'package.json',
    'package-lock.json',
    'electron.vite.config.ts',
    'emotion_manifest.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'tsconfig.web.json',
    'tsconfig.test.json',
    'biome.jsonc',
  ])
    if (fs.existsSync(path.join(desktop, file)))
      fs.copyFileSync(path.join(desktop, file), path.join(target, file))
  fs.cpSync(path.join(repository, 'contracts'), path.join(root, variant, 'contracts'), {
    recursive: true,
  })
  fs.copyFileSync(path.join(repository, 'package.json'), path.join(root, variant, 'package.json'))
  const motion = path.join(target, 'motion')
  fs.mkdirSync(motion)
  for (const file of [
    'worker.py',
    'backend.py',
    'protocol.py',
    'research.py',
    'research-pins.json',
    'motion-profiles.json',
  ])
    fs.copyFileSync(path.join(desktop, 'motion', file), path.join(motion, file))
  fs.mkdirSync(path.join(motion, '.tmp'))
  for (const dir of ['.venv', '.cache'])
    fs.symlinkSync(path.join(desktop, 'motion', dir), path.join(motion, dir), 'junction')
  fs.symlinkSync(path.join(desktop, 'node_modules'), path.join(target, 'node_modules'), 'junction')
  const changes = []
  const edit = (file, before, after) => {
    const filename = path.join(target, file)
    const text = fs.readFileSync(filename, 'utf8')
    assert(text.includes(before), `Missing exact qualification transform in ${file}: ${before}`)
    const count = text.split(before).length - 1
    fs.writeFileSync(filename, text.replaceAll(before, after))
    changes.push({ file, before, after, count })
  }
  edit(
    'src/renderer/Controller.ts',
    'export const controller = new Controller()',
    'export const controller = new Controller()\n;(window as unknown as { __motionAbController: unknown }).__motionAbController = controller',
  )
  if (variant === 'soma60') {
    const revision = '244215084b22fcd29ab743017330e87411fe168a'
    const pinsPath = path.join(motion, 'research-pins.json')
    const pins = JSON.parse(fs.readFileSync(pinsPath))
    pins.motion = {
      ...pins.motion,
      repository: 'nvidia/ARDY-SOMA-RP-30FPS-Horizon60',
      revision,
      skeleton: 'SOMASkeleton30',
      fps: 30,
      horizonFrames: 60,
      historyFrames: 60,
    }
    fs.writeFileSync(pinsPath, JSON.stringify(pins, null, 2))
    const catalogPath = path.join(motion, 'motion-profiles.json')
    const catalog = JSON.parse(fs.readFileSync(catalogPath))
    catalog.format = {
      ...catalog.format,
      modelRevision: revision,
      skeleton: 'soma30-standard-tpose-v1',
      fps: 30,
      horizonFrames: 60,
      historyFrames: 60,
    }
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
    const format = 'src/shared/motion/catalogSchema.ts'
    edit(
      format,
      "z.literal('9acbfc61f93fb5fd392019a7487c3d7bf4f74e6d')",
      `z.literal('${revision}')`,
    )
    edit(format, "z.literal('core27-standard-tpose-v1')", "z.literal('soma30-standard-tpose-v1')")
    edit(format, 'fps: z.literal(20)', 'fps: z.literal(30)')
    edit(format, 'horizonFrames: z.literal(8)', 'horizonFrames: z.literal(60)')
    edit(format, 'historyFrames: z.literal(40)', 'historyFrames: z.literal(60)')
    const shared = 'src/shared/motion/index.ts'
    edit(shared, "z.literal('core27-standard-tpose-v1')", "z.literal('soma30-standard-tpose-v1')")
    edit(shared, 'fps: z.literal(20)', 'fps: z.literal(30)')
    edit(shared, '.length(27)', '.length(30)')
    edit(shared, '.length(8)', '.length(60)')
    edit(
      shared,
      'queueFrames: z.number().int().min(0).max(32)',
      'queueFrames: z.number().int().min(0).max(120)',
    )
    const main = 'src/main/motion/ArdyMotionService.ts'
    edit(main, 'Buffer.byteLength(buffer) > 65_536', 'Buffer.byteLength(buffer) > 262_144')
    edit(main, 'this.expectedFrame - 32', 'this.expectedFrame - 120')
    const backend = 'motion/backend.py'
    edit(
      backend,
      'history_length = 0 if self.history is None else self.history.shape[1]',
      'history = None if self.history is None else self.history[:, -60:]\n            history_length = 0 if history is None else history.shape[1]',
    )
    edit(backend, 'frames = history_length + 8', 'frames = history_length + 60')
    edit(backend, 'init_history_sequence=self.history', 'init_history_sequence=history')
    edit(
      backend,
      'self.history = samples[:, -40:].clone()',
      'fresh = samples[:, -60:]\n            self.history = fresh.clone() if self.history is None else torch.cat((self.history, fresh), dim=1)[:, -120:].clone()',
    )
    edit(backend, '[0, -8:]', '[0, -60:]')
    edit(backend, '.reshape(8, 27, 4)', '.reshape(60, 30, 4)')
    edit(backend, '"fps": 20', '"fps": 30')
    edit(
      backend,
      '"skeleton": "core27-standard-tpose-v1"',
      '"skeleton": "soma30-standard-tpose-v1"',
    )
    edit(backend, 'self.frame += 8', 'self.frame += 60')
    const body = 'src/renderer/avatar/rendering/three/GeneratedBodyPlayback.ts'
    const text = fs.readFileSync(path.join(target, body), 'utf8')
    const bones = text.match(
      /const BONES: ReadonlyArray<\[number, VRMHumanBoneName\]> = \[[\s\S]*?\n\]/,
    )?.[0]
    assert(bones, 'Missing source mapping')
    edit(
      body,
      bones,
      `const BONES: ReadonlyArray<[number, VRMHumanBoneName]> = [
  [0, 'hips'], [1, 'spine'], [2, 'chest'], [3, 'upperChest'],
  [16, 'rightShoulder'], [17, 'rightUpperArm'], [18, 'rightLowerArm'], [19, 'rightHand'],
  [10, 'leftShoulder'], [11, 'leftUpperArm'], [12, 'leftLowerArm'], [13, 'leftHand'],
  [26, 'rightUpperLeg'], [27, 'rightLowerLeg'], [28, 'rightFoot'], [29, 'rightToes'],
  [22, 'leftUpperLeg'], [23, 'leftLowerLeg'], [24, 'leftFoot'], [25, 'leftToes'],
]`,
    )
    edit(body, '0.9544128', '0.9887084839474641')
    edit(body, '* 20', '* 30')
    edit(body, '/ 20', '/ 30')
    edit(body, 'chunk.startFrame + 8', 'chunk.startFrame + 60')
    edit(body, 'this.cursor + 8', 'this.cursor + 60')
    edit(body, 'tail.startFrame + 8', 'tail.startFrame + 60')
    edit(body, 'remaining.startFrame + 8', 'remaining.startFrame + 60')
    edit(body, 'this.queue[0].startFrame + 8', 'this.queue[0].startFrame + 60')
    edit(body, 'item.startFrame + 8', 'item.startFrame + 60')
    edit(body, 'Math.min(7, Math.floor(offset))', 'Math.min(59, Math.floor(offset))')
    edit(body, 'frame < 7', 'frame < 59')
    edit(body, 'binding.index <= 4', 'binding.index <= 3')
    edit(body, 'this.generatedEnd - this.cursor >= 24', 'this.generatedEnd - this.cursor >= 36')
    edit(body, 'this.queue.length >= 4', 'this.queue.length >= 2')
    edit(body, '/ 50', '/ (1000 / 30)')
    changes.push({
      qualificationBounds: {
        modelHistoryFrames: 60,
        rollbackHistoryFrames: 120,
        maximumQueuedHorizons: 2,
        maximumQueueFrames: 120,
        audibleDeadlineMs: 400,
        producerDeadlineMs: 2500,
        prefetchThresholdFrames: 36,
      },
    })
  }
  report.variants[variant] = {
    desktop: target,
    motionRoot: motion,
    changes,
    hashes: Object.fromEntries(protectedFiles.map((file) => [file, hash(path.join(target, file))])),
  }
}
fs.writeFileSync(path.join(root, 'snapshot.json'), JSON.stringify(report, null, 2))
fs.writeFileSync(path.join(__dirname, '.latest-root'), root)
console.log(JSON.stringify({ root, variants: Object.keys(report.variants) }))
