const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// Build an isolated Desktop snapshot. Test hooks never enter the production
// build, packaged runtime or renderer IPC surface.
const desktop = path.resolve(__dirname, '../..')
const repository = path.resolve(desktop, '../..')
const root = path.join(repository, 'tmp', `living-motion-${Date.now()}`)
const target = path.join(root, 'apps/desktop')
fs.mkdirSync(target, { recursive: true })
for (const directory of ['src', 'scripts'])
  fs.cpSync(path.join(desktop, directory), path.join(target, directory), { recursive: true })
for (const file of [
  'package.json',
  'electron.vite.config.ts',
  'emotion_manifest.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'biome.jsonc',
])
  if (fs.existsSync(path.join(desktop, file)))
    fs.copyFileSync(path.join(desktop, file), path.join(target, file))
for (const directory of ['motion', 'motionbricks', 'qualifications', 'node_modules'])
  fs.symlinkSync(path.join(desktop, directory), path.join(target, directory), 'junction')
fs.cpSync(path.join(repository, 'contracts'), path.join(root, 'contracts'), { recursive: true })
fs.copyFileSync(path.join(repository, 'package.json'), path.join(root, 'package.json'))
const edit = (relative, before, after) => {
  const filename = path.join(target, relative)
  const text = fs.readFileSync(filename, 'utf8')
  assert.equal(text.split(before).length, 2, `Unique qualification transform required: ${relative}`)
  fs.writeFileSync(filename, text.replace(before, after))
}
edit(
  'src/renderer/Controller.ts',
  'export const controller = new Controller()',
  'export const controller = new Controller()\n;(window as unknown as { __motionAbController: unknown }).__motionAbController = controller',
)
edit(
  'src/renderer/avatar/rendering/three/VrmModel.ts',
  '  async load(scene:',
  '  constructor() { const host = window as unknown as { __qualificationModels?: unknown[] }; (host.__qualificationModels ??= []).push(this) }\n  async load(scene:',
)
edit(
  'src/main/orchestrator.ts',
  "    mainLog.info('[emotion] LLM reply tag', { emotionKey, replyCharacters: replyText.length })",
  "    mainLog.info('[emotion] LLM reply tag', { emotionKey, replyCharacters: replyText.length })\n    const qualificationHost=globalThis as unknown as {__qualificationTurnKinds?:Record<string,string>}; const origins=qualificationHost.__qualificationTurnKinds??={}; origins[traceId]=assistantTurnKind; for(const key of Object.keys(origins).slice(0,-64))delete origins[key]",
)
fs.writeFileSync(
  path.join(root, 'snapshot.json'),
  JSON.stringify(
    {
      target,
      productionUnchanged: true,
      transforms: [
        'test-only Controller reference',
        'test-only loaded-model references',
        'test-only bounded Main assistant origin',
      ],
    },
    null,
    2,
  ),
)
execFileSync(
  process.execPath,
  [path.join(desktop, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'],
  {
    cwd: target,
    env: process.env,
    windowsHide: true,
    stdio: 'inherit',
  },
)
fs.mkdirSync(path.join(desktop, 'motion/.artifacts/living-motion'), { recursive: true })
fs.writeFileSync(path.join(desktop, 'motion/.artifacts/living-motion/latest-snapshot.txt'), target)
console.log(JSON.stringify({ target }))
