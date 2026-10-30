import { readFileSync } from 'node:fs'
import { join, normalize, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { desktopRoot, sourceFiles, sourceRoot } from './context'

const mainRoot = join(sourceRoot, 'main')
const owners = new Set(
  [
    join(mainRoot, 'llm', 'LlmGateway.ts'),
    join(mainRoot, 'llm', 'registry.ts'),
    join(mainRoot, 'llm', 'index.ts'),
  ].map((path) => normalize(path)),
)

describe('LLM provider ownership', () => {
  it('creates provider adapters only inside LlmGateway', () => {
    for (const file of sourceFiles) {
      if (owners.has(normalize(file))) continue
      expect(
        readFileSync(file, 'utf8').includes('createLLMProvider('),
        `${relative(desktopRoot, file)} creates an LLM provider outside LlmGateway`,
      ).toBe(false)
    }
  })

  it('resolves role provider settings only through resolveLlmRoleSettings in composition', () => {
    const composition = readFileSync(
      join(mainRoot, 'app', 'buildApplicationDependencies.ts'),
      'utf8',
    )
    expect(composition.match(/CredentialStore\(\)\.resolve\(/gu)?.length ?? 0).toBe(1)
    expect(composition).not.toContain('resolveLlmProviderAccountId(')
    const constructions = composition.split('new LlmGateway(').slice(1)
    expect(constructions.length).toBeGreaterThan(0)
    for (const construction of constructions)
      expect(construction.slice(0, 160)).toMatch(/resolveRoleSettings|resolveVisualModel/u)
  })
})
