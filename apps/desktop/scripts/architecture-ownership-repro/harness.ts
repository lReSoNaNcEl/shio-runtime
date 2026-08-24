import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'

import { parse } from '@babel/parser'

import { CharacterStateStore } from '../../src/renderer/runtime/CharacterStateStore'
import { PassiveEventBus } from '../../src/renderer/runtime/EventBus'

const desktopRoot = process.cwd().endsWith('apps\\desktop')
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop')
const sourceRoot = join(desktopRoot, 'src')

interface AstNode {
  type?: string
  source?: { value?: unknown }
  callee?: AstNode
  property?: AstNode
  name?: string
  value?: unknown
  [key: string]: unknown
}

function sourceFilesBelow(root: string): string[] {
  const pending = [root]
  const files: string[] = []
  while (pending.length > 0) {
    const directory = pending.pop()
    assert.ok(directory)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path)
    }
  }
  return files.sort()
}

function parseFile(path: string): AstNode {
  return parse(readFileSync(path, 'utf8'), {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  }) as unknown as AstNode
}

function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  const astNode = node as AstNode
  if (typeof astNode.type === 'string') visit(astNode)
  for (const [key, child] of Object.entries(astNode)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue
    walk(child, visit)
  }
}

function importedSource(node: AstNode): string | null {
  if (
    !['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
      node.type ?? '',
    )
  ) {
    return null
  }
  return typeof node.source?.value === 'string' ? node.source.value : null
}

function resolvedImport(fromFile: string, specifier: string): string | null {
  return specifier.startsWith('.') ? normalize(resolve(dirname(fromFile), specifier)) : null
}

function isBelow(path: string, root: string): boolean {
  const pathFromRoot = relative(root, path)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

function assertProcessBoundaries(files: readonly string[]): void {
  const sharedRoot = join(sourceRoot, 'shared')
  const rendererRoot = join(sourceRoot, 'renderer')
  const mainRoot = join(sourceRoot, 'main')
  for (const file of files) {
    walk(parseFile(file), (node) => {
      const specifier = importedSource(node)
      if (!specifier) return
      const target = resolvedImport(file, specifier)
      if (!target) return
      if (isBelow(file, sharedRoot)) {
        assert.ok(
          !isBelow(target, mainRoot) && !isBelow(target, rendererRoot),
          `${relative(desktopRoot, file)} crosses from shared into a process implementation: ${specifier}`,
        )
      }
      if (isBelow(file, rendererRoot)) {
        assert.ok(
          !isBelow(target, mainRoot),
          `${relative(desktopRoot, file)} imports Electron Main implementation: ${specifier}`,
        )
      }
    })
  }
}

function assertProjectStoreIsolation(): void {
  const store = join(sourceRoot, 'main', 'project-awareness', 'ProjectKnowledgeStore.ts')
  walk(parseFile(store), (node) => {
    const specifier = importedSource(node)
    if (!specifier) return
    assert.ok(
      !specifier.includes('character-tools') &&
        !specifier.includes('orchestrator') &&
        !specifier.includes('ProjectRelevanceGate'),
      `ProjectKnowledgeStore imports semantic orchestration: ${specifier}`,
    )
  })
}

function memberName(node: AstNode | undefined): string | null {
  if (!node) return null
  if (node.type === 'Identifier') return node.name ?? null
  if (node.type === 'StringLiteral') return typeof node.value === 'string' ? node.value : null
  return null
}

function assertFinalFacialWriter(files: readonly string[]): void {
  const avatarRoot = join(sourceRoot, 'renderer', 'avatar')
  const owner = normalize(join(avatarRoot, 'embodiment', 'facial', 'AvatarExpressionMixer.ts'))
  for (const file of files.filter(
    (path) => isBelow(path, avatarRoot) && normalize(path) !== owner,
  )) {
    walk(parseFile(file), (node) => {
      if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return
      assert.notEqual(
        memberName(node.callee.property),
        'setValue',
        `${relative(desktopRoot, file)} writes a final expression outside AvatarExpressionMixer`,
      )
    })
  }
}

function assertNoApplicationSemanticRouters(files: readonly string[]): void {
  const forbiddenNames = new Set([
    'ProjectRelevanceGate.ts',
    'ProjectContextRequirementResolver.ts',
  ])
  for (const file of files) {
    assert.ok(
      !forbiddenNames.has(file.split(/[\\/]/u).at(-1) ?? ''),
      `${relative(desktopRoot, file)} reintroduces application-owned semantic routing`,
    )
  }
}

function assertNoGenericPluginInvoke(files: readonly string[]): void {
  for (const file of files) {
    walk(parseFile(file), (node) => {
      if (!['StringLiteral', 'Literal'].includes(node.type ?? '')) return
      assert.notEqual(
        node.value,
        'plugin.invoke',
        `${relative(desktopRoot, file)} introduces forbidden generic Plugin dispatch`,
      )
    })
  }
}

function assertForbiddenImports(relativePath: string, forbidden: readonly string[]): void {
  const file = join(sourceRoot, ...relativePath.split('/'))
  walk(parseFile(file), (node) => {
    const specifier = importedSource(node)
    if (!specifier) return
    for (const fragment of forbidden) {
      assert.ok(
        !specifier.includes(fragment),
        `${relativePath} imports forbidden owner ${specifier}`,
      )
    }
  })
}

function assertRendererRuntimeOwnership(files: readonly string[]): void {
  assertForbiddenImports('renderer/runtime/ConversationRuntime.ts', [
    'AvatarRuntime',
    'OverlayRuntime',
    'SpeechRuntime',
    'AudioPlayer',
  ])
  assertForbiddenImports('renderer/speech/conversation/ConversationInputCoordinator.ts', [
    'AvatarRuntime',
    'OverlayRuntime',
  ])
  assertForbiddenImports('renderer/runtime/SpeechRuntime.ts', [
    'CharacterStateStore',
    'character-response',
    '/llm',
    'orchestrator',
  ])
  assertForbiddenImports('renderer/runtime/SpeechInputRuntime.ts', ['ConversationStateWriter'])

  const rendererRoot = join(sourceRoot, 'renderer')
  for (const file of files.filter((path) => isBelow(path, rendererRoot))) {
    walk(parseFile(file), (node) => {
      if (node.type === 'Identifier') {
        assert.notEqual(
          node.name,
          'RuntimeRegistry',
          `${relative(desktopRoot, file)} reintroduces the decorative RuntimeRegistry`,
        )
      }
      if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return
      assert.notEqual(
        memberName(node.callee.property),
        'patchCharacterState',
        `${relative(desktopRoot, file)} introduces an unbounded Character State writer`,
      )
    })
  }
}

function assertMainCompositionOwnership(): void {
  const ipcIndex = join(sourceRoot, 'main', 'ipc', 'index.ts')
  walk(parseFile(ipcIndex), (node) => {
    if (node.type !== 'NewExpression') return
    assert.notEqual(
      memberName(node.callee),
      'ActionRuntime',
      'IPC transport constructs ActionRuntime instead of receiving the composition-owned instance',
    )
  })
}

function assertCharacterStateWriterBehavior(): void {
  const store = new CharacterStateStore(new PassiveEventBus())
  store.conversation.transition({ status: 'thinking', mode: 'thinking', emotion: 'happy' })
  const thinking = store.get()
  assert.equal(thinking.emotion, 'happy')
  assert.equal(thinking.speechState.status, 'generating')

  store.speech.transitionInput('listening', 'listening')
  const listening = store.get()
  assert.equal(listening.mode, 'listening')
  assert.equal(listening.speechState.status, 'listening')
  assert.equal(listening.emotion, 'happy', 'Speech writer must not overwrite conversation emotion')

  store.admission.setAttention({ focus: 'user', confidence: 0.42 })
  const attended = store.get()
  assert.deepEqual(attended.attention, { focus: 'user', confidence: 0.42 })
  assert.equal(attended.emotion, 'happy')

  store.avatar.sync({
    avatar: { loaded: true },
    animation: attended.animation,
    posture: 'relaxed',
  })
  const projected = store.get()
  assert.equal(projected.avatar.loaded, true)
  assert.equal(projected.emotion, 'happy', 'Avatar writer must not overwrite semantic emotion')
}

const files = sourceFilesBelow(sourceRoot)
assertProcessBoundaries(files)
assertProjectStoreIsolation()
assertFinalFacialWriter(files)
assertNoApplicationSemanticRouters(files)
assertNoGenericPluginInvoke(files)
assertRendererRuntimeOwnership(files)
assertMainCompositionOwnership()
assertCharacterStateWriterBehavior()

console.log('Architecture Ownership Guards: PASS')
