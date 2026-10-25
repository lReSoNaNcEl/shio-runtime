import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { runtimeRoot, verifyAssets } from '../tools/verify-assets.mjs'

test('S22 asset closure is intact and has no dependency on the authoring directory', async () => {
  assert.ok(await verifyAssets() >= 298)
  const manifest = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'provenance.json'), 'utf8'))
  for (const entry of manifest.files.filter(entry => /\.(mjs|json)$/.test(entry.path))) {
    const text = await fs.readFile(path.join(runtimeRoot, entry.path), 'utf8')
    assert.doesNotMatch(text, /D:[\\/]AI-tools|['"]\/assets\//)
  }
})
