import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Check the emitted renderer, not a source-file substitute for the worklet. */
export function verifySpeechAssets(rendererRoot) {
  const root = resolve(rendererRoot)
  const html = readFileSync(resolve(root, 'index.html'), 'utf8')
  const entry = html.match(/<script\b[^>]*\bsrc=["']([^"']+\.js)["']/u)?.[1]
  assert(entry, 'Built renderer has no JavaScript entry')
  const entryPath = resolve(root, entry)
  assert(entryPath.startsWith(root + sep), 'Renderer entry escapes its output directory')
  const source = readFileSync(entryPath, 'utf8')
  const call = source.match(/audioWorklet\.addModule\(([\s\S]*?)(?:\);|$)/u)?.[1] ?? ''
  // Vite can nest a built URL inside the original new URL(..., import.meta.url).
  const references = [...call.matchAll(/new URL\(\s*["']([^"']+)["']/gu)].map((match) => match[1])
  assert.equal(references.length, 1, 'Expected one literal PCM worklet asset URL')
  const [reference] = references
  assert(reference, 'Built renderer has no PCM worklet module reference')
  assert(
    !/^(?:data|blob):/u.test(reference),
    'PCM worklet must be an emitted file allowed by the self-only script CSP',
  )
  const resource = new URL(reference, pathToFileURL(entryPath))
  assert.equal(resource.protocol, 'file:', 'PCM worklet must be a bundled local resource')
  const workletPath = fileURLToPath(resource)
  assert(workletPath.startsWith(root + sep), 'PCM worklet escapes its output directory')
  const worklet = readFileSync(workletPath, 'utf8')
  assert.match(worklet, /registerProcessor\(["']shio-pcm-stream-player["']/u)
  assert.match(html, /script-src\s+'self'(?=[\s;"'])/u)
  return {
    entryPath,
    workletPath,
    workletReference: relative(root, workletPath).split(sep).join('/'),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root =
    process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../out/renderer')
  const result = verifySpeechAssets(root)
  console.log(`Speech assets verified: ${result.workletReference}`)
}
