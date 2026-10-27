import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const existing = [...new Set(listed)].filter(name => fs.existsSync(path.join(root, name)))
assert(!existing.some(name => /\.vrma$/i.test(name)), 'Legacy VRMA resource remains in the worktree')
for (const name of ['apps/api/app/tts/f5_local.py', 'apps/api/app/routes/synthesize.py', 'apps/desktop/src/renderer/avatar/rendering/three/VrmBodyPlayback.ts', 'apps/desktop/src/renderer/avatar/rendering/three/AvatarAnimationLoader.ts', 'apps/desktop/src/renderer/runtime/StreamingSpeechPipeline.ts', 'apps/desktop/src/renderer/avatar/OverlayAnimationPolicy.ts', 'apps/desktop/src/renderer/avatar/rendering/three/RootMotionController.ts', 'apps/desktop/src/renderer/avatar/rendering/three/VrmAnimationTypes.ts', 'apps/desktop/src/renderer/avatar/rendering/three/AnimationDebugTypes.ts']) {
  assert(!fs.existsSync(path.join(root, name)), `Legacy execution path remains: ${name}`)
}
for (const name of existing) {
  if (!/^apps\/desktop\/package(?:-lock)?\.json$/.test(name) && name !== 'apps/desktop/.env.example' && !/^(apps\/(api\/app|desktop\/src)\/|apps\/api\/requirements|apps\/api\/\.env\.(example|release)$|launcher\/|scripts\/(api-runner|motion-research))/.test(name)) continue
  if (!/\.(ts|tsx|js|mjs|py|json|txt|ps1|example|release)$/.test(name)) continue
  const source = fs.readFileSync(path.join(root, name), 'utf8')
  if (name.startsWith('apps/desktop/src/renderer/')) assert(!/rootMotionPolicy|legacyBlendDuration|activeFileName|currentBodyAnimationFile|animationAssetCache|clipCache|currentClip|lastLoadFile|ownershipGapCount|OverlayAnimationPolicy/.test(source), `Obsolete clip projection: ${name}`)
  assert(!/\bF5_|TTS_ENGINE\s*=\s*f5|f5[_-]tts|f5_local|cosyvoice|ruaccent|\bvocos\b|three-vrm-animation|import\.meta\.glob[^\n]*vrma|pickVrma|loadExternalAnimation/i.test(source), `Obsolete runtime/dependency reference: ${name}`)
}
for (const script of ['sync-motion.mjs', 'sync-emotions.mjs']) execFileSync(process.execPath, [path.join(root, 'scripts', script), '--check'], { stdio: 'inherit' })
const worklet = fs.readdirSync(path.join(root, 'apps/desktop/out/renderer/assets')).filter(name => /^pcmStreamWorklet-.*\.js$/.test(name))
assert.equal(worklet.length, 1, 'Clean build must emit exactly one AudioWorklet')
const deleted = execFileSync('git', ['ls-files', '--deleted', '*.vrma'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
console.log(JSON.stringify({ passed: true, existingVrma: 0, pendingTrackedDeletions: deleted.length, worklet: worklet[0] }))
