import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('all semantic cues have Fish tags and a native S22 expression', async () => {
  const contract=JSON.parse(await readFile(new URL('../emotion_manifest.json',import.meta.url),'utf8'))
  const runtime=await readFile(new URL('../public/shio-2d/runtime.mjs',import.meta.url),'utf8')
  const match=runtime.match(/const names=(\[[^;]+?\])/)
  assert(match,'S22 expression catalog missing')
  const names=Function(`return ${match[1]}`)()
  assert.equal(contract.schemaVersion,2)
  assert.equal(new Set(contract.emotions.map(entry=>entry.id)).size,25)
  for(const entry of contract.emotions) {
    assert(names.includes(entry.avatar.expression),entry.id)
    assert(Array.isArray(entry.speech.fishTags),entry.id)
    assert(entry.speech.fishTags.every(tag=>typeof tag==='string'&&!/[\[\]<>]/.test(tag)),entry.id)
  }
})
