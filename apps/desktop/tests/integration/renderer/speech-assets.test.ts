import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { describe, it } from 'vitest'

function verifyFixture(
  reference: string,
  { includeWorklet = true, duplicateWorklet = false } = {},
) {
  const desktopRoot = resolve(import.meta.dirname, '../../..')
  const output = join(desktopRoot, 'out')
  mkdirSync(output, { recursive: true })
  const root = mkdtempSync(join(output, 'speech-assets-test-'))
  try {
    mkdirSync(join(root, 'assets'))
    writeFileSync(
      join(root, 'index.html'),
      `<meta http-equiv="Content-Security-Policy" content="script-src 'self'"><script type="module" src="./assets/index.js"></script>`,
    )
    writeFileSync(
      join(root, 'assets/index.js'),
      `this.audioCtx.audioWorklet.addModule(new URL(${JSON.stringify(reference)}, import.meta.url).href)`,
    )
    if (includeWorklet)
      writeFileSync(
        join(root, 'assets/pcmStreamWorklet-test.js'),
        "registerProcessor('shio-pcm-stream-player', Player)",
      )
    if (duplicateWorklet) writeFileSync(join(root, 'assets/pcmStreamWorklet-duplicate.js'), '')
    return spawnSync(
      process.execPath,
      [join(desktopRoot, 'scripts/verify-speech-assets.mjs'), root],
      {
        encoding: 'utf8',
        timeout: 10_000,
      },
    )
  } finally {
    assert.equal(dirname(root), output)
    assert(root.startsWith(join(output, 'speech-assets-test-')))
    rmSync(root, { recursive: true, force: true })
  }
}

describe('production speech assets', () => {
  it('rejects a worklet inlined into a data URL', () => {
    const result = verifyFixture('data:text/javascript;base64,Zm9v')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /PCM worklet must be an emitted file/u)
  })

  it('accepts the emitted worklet next to the renderer entry', () => {
    const result = verifyFixture('./pcmStreamWorklet-test.js')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /assets\/pcmStreamWorklet-test\.js/u)
  })

  it('rejects a missing worklet instead of substituting its source', () => {
    const result = verifyFixture('./pcmStreamWorklet-test.js', { includeWorklet: false })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ENOENT/u)
  })

  it('rejects a second emitted PCM worklet', () => {
    const result = verifyFixture('./pcmStreamWorklet-test.js', { duplicateWorklet: true })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Build must emit exactly one PCM worklet/u)
  })
})
