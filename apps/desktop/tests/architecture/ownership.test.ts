import { readFileSync } from 'node:fs'
import { join, normalize, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  importedSource,
  isBelow,
  memberName,
  parseFile,
  sourceFilesBelow,
  walk,
} from '../support/architecture/sourceAst'
import { desktopRoot, sourceFiles, sourceRoot } from './context'

function expectNoImports(relativePath: string, forbidden: readonly string[]): void {
  const file = join(sourceRoot, ...relativePath.split('/'))
  walk(parseFile(file), (node) => {
    const specifier = importedSource(node)
    if (!specifier) return
    for (const fragment of forbidden) {
      expect(
        !specifier.includes(fragment),
        `${relativePath} imports forbidden owner ${specifier}`,
      ).toBe(true)
    }
  })
}

describe('Desktop runtime ownership', () => {
  it('keeps ProjectKnowledgeStore free of semantic orchestration', () => {
    const store = join(sourceRoot, 'main', 'project-awareness', 'ProjectKnowledgeStore.ts')
    walk(parseFile(store), (node) => {
      const specifier = importedSource(node)
      if (!specifier) return
      expect(
        !specifier.includes('character-tools') &&
          !specifier.includes('orchestrator') &&
          !specifier.includes('ProjectRelevanceGate'),
        `ProjectKnowledgeStore imports semantic orchestration: ${specifier}`,
      ).toBe(true)
    })
  })

  it('keeps AvatarExpressionMixer as the sole final facial-expression writer', () => {
    const avatarRoot = join(sourceRoot, 'renderer', 'avatar')
    const owner = normalize(join(avatarRoot, 'embodiment', 'facial', 'AvatarExpressionMixer.ts'))
    for (const file of sourceFiles.filter(
      (path) => isBelow(path, avatarRoot) && normalize(path) !== owner,
    )) {
      walk(parseFile(file), (node) => {
        if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return
        expect(
          memberName(node.callee.property),
          `${relative(desktopRoot, file)} writes a final expression outside AvatarExpressionMixer`,
        ).not.toBe('setValue')
      })
    }
  })

  it('keeps renderer runtimes within their domain ownership', () => {
    expectNoImports('renderer/runtime/ConversationRuntime.ts', [
      'AvatarRuntime',
      'OverlayRuntime',
      'SpeechRuntime',
      'AudioPlayer',
    ])
    expectNoImports('renderer/speech/conversation/ConversationInputCoordinator.ts', [
      'AvatarRuntime',
      'OverlayRuntime',
    ])
    expectNoImports('renderer/runtime/SpeechRuntime.ts', [
      'CharacterStateStore',
      'character-response',
      '/llm',
      'orchestrator',
    ])
    expectNoImports('renderer/runtime/SpeechInputRuntime.ts', ['ConversationStateWriter'])

    const rendererRoot = join(sourceRoot, 'renderer')
    for (const file of sourceFiles.filter((path) => isBelow(path, rendererRoot))) {
      walk(parseFile(file), (node) => {
        if (node.type === 'Identifier') {
          expect(
            node.name,
            `${relative(desktopRoot, file)} reintroduces the decorative RuntimeRegistry`,
          ).not.toBe('RuntimeRegistry')
        }
        if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return
        expect(
          memberName(node.callee.property),
          `${relative(desktopRoot, file)} introduces an unbounded Character State writer`,
        ).not.toBe('patchCharacterState')
      })
    }
  })

  it('keeps Action Runtime construction in Electron Main composition', () => {
    const ipcIndex = join(sourceRoot, 'main', 'ipc', 'index.ts')
    walk(parseFile(ipcIndex), (node) => {
      if (node.type !== 'NewExpression') return
      expect(
        memberName(node.callee),
        'IPC transport constructs ActionRuntime instead of receiving the composition-owned instance',
      ).not.toBe('ActionRuntime')
    })
  })

  it('keeps Browser Control isolated from other concrete runtime owners', () => {
    const removedBrowserGameRoot = normalize(join('src', 'main', 'browser-game'))
    for (const file of sourceFiles) {
      expect(
        !normalize(file).includes(removedBrowserGameRoot),
        `${relative(desktopRoot, file)} reintroduces the removed browser gameplay runtime`,
      ).toBe(true)
    }

    for (const file of sourceFilesBelow(join(sourceRoot, 'main', 'browser-control'))) {
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (!specifier) return
        expect(
          !specifier.includes('renderer/avatar') && !specifier.includes('AvatarRuntime'),
          `${relative(desktopRoot, file)} imports concrete Avatar internals: ${specifier}`,
        ).toBe(true)
        expect(
          !specifier.includes('/memory'),
          `${relative(desktopRoot, file)} crosses into Memory: ${specifier}`,
        ).toBe(true)
        expect(
          !specifier.includes('desktop-control') && !specifier.includes('DshHarnessAdapter'),
          `${relative(desktopRoot, file)} crosses into Desktop Control: ${specifier}`,
        ).toBe(true)
      })
    }

    for (const file of sourceFilesBelow(
      join(sourceRoot, 'main', 'browser-control', 'computer-use'),
    )) {
      expectNoImports(relative(sourceRoot, file), ['CharacterTool', 'orchestrator'])
    }
    expectNoImports('main/alive/ExperienceRuntime.ts', [
      'PlaywrightBrowserAdapter',
      'BrowserComputerUseRuntime',
    ])
  })

  it('keeps continuous browser frames and tracking inside the Main-owned Browser Control boundary', () => {
    const browserControlRoot = join(sourceRoot, 'main', 'browser-control')
    const trackerOwner = normalize(
      join(browserControlRoot, 'computer-use', 'BrowserReactiveTracker.ts'),
    )
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8')
      if (source.includes('BrowserCdpFrame')) {
        expect(
          isBelow(file, browserControlRoot),
          `${relative(desktopRoot, file)} exposes transient CDP frame data outside Browser Control`,
        ).toBe(true)
      }
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (specifier !== 'node:worker_threads') return
        expect(
          normalize(file) === trackerOwner || file.endsWith('browserReactiveTrackerWorker.ts'),
          `${relative(desktopRoot, file)} creates an unowned Browser Control worker`,
        ).toBe(true)
      })
    }

    const worker = join(browserControlRoot, 'computer-use', 'browserReactiveTrackerWorker.ts')
    expectNoImports(relative(sourceRoot, worker), [
      'CharacterTool',
      '/action',
      '/alive',
      '/memory',
      '/goals',
      'desktop-control',
      'DshHarnessAdapter',
      'renderer',
    ])
  })

  it('keeps conversation threads ephemeral and domain-independent', () => {
    for (const file of sourceFilesBelow(join(sourceRoot, 'main', 'conversation-threads'))) {
      walk(parseFile(file), (node) => {
        const specifier = importedSource(node)
        if (!specifier) return
        expect(
          !specifier.includes('/memory') &&
            !specifier.includes('/goals') &&
            !specifier.includes('/alive'),
          `${relative(desktopRoot, file)} crosses ephemeral Thread ownership: ${specifier}`,
        ).toBe(true)
      })
    }
  })
})
