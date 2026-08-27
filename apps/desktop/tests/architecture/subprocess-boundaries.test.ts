import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { importedSource, memberName, parseFile, walk } from '../support/architecture/sourceAst'
import { sourceRoot } from './context'

describe('Owned subprocess boundaries', () => {
  it('uses the persistent spawn-based System Context worker without execFile', () => {
    const file = join(sourceRoot, 'main', 'alive', 'WindowsSystemContextWorker.ts')
    let importsChildProcess = false
    let spawnCalls = 0
    walk(parseFile(file), (node) => {
      if (importedSource(node) === 'node:child_process') importsChildProcess = true
      if (node.type !== 'CallExpression') return
      const name = memberName(node.callee)
      if (name === 'spawn') spawnCalls += 1
      expect(name).not.toBe('execFile')
    })
    expect(importsChildProcess).toBe(true)
    expect(spawnCalls).toBe(1)
  })
})
