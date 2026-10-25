import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/shio-2d')
export async function verifyAssets() {
  const manifest = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'provenance.json'), 'utf8'))
  if (manifest.version !== 22) throw new Error('Expected S22')
  for (const entry of manifest.files) {
    const file = path.resolve(runtimeRoot, entry.path)
    if (!file.startsWith(`${runtimeRoot}${path.sep}`)) throw new Error('Invalid asset path')
    const bytes = await fs.readFile(file)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== entry.sha256) throw new Error(`S22 integrity mismatch: ${entry.path}`)
  }
  return manifest.files.length
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`S22 verified: ${await verifyAssets()} bundled files`)
