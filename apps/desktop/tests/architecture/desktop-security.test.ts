import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { IPC_CHANNEL_CAPABILITIES } from '../../src/main/ipc/IpcAuthorization'
import {
  type AstNode,
  importedBindings,
  memberName,
  memberPath,
  parseFile,
  sourceFilesBelow,
  walk,
} from '../support/architecture/sourceAst'
import { sourceRoot } from './context'

const mainRoot = join(sourceRoot, 'main')
const ast = (path: string) => parseFile(join(sourceRoot, path))
function calls(tree: AstNode): AstNode[] {
  const result: AstNode[] = []
  walk(tree, (node) => {
    if (node.type === 'CallExpression') result.push(node)
  })
  return result
}
function strings(tree: AstNode): unknown[] {
  const result: unknown[] = []
  walk(tree, (node) => {
    if (node.type === 'StringLiteral') result.push(node.value)
  })
  return result
}
function schemaCalls(path: string): string[] {
  return calls(ast(path)).map((node) => memberPath(node.callee) ?? '')
}

describe('Desktop security architecture', () => {
  it('matches every IPC registration to the inventory and authorization for that exact channel', () => {
    const registrations = new Map<string, string>()
    for (const file of sourceFilesBelow(mainRoot)) {
      const tree = parseFile(file)
      const ipcBindings = importedBindings(tree, 'electron', 'ipcMain')
      for (const call of calls(tree)) {
        const callee = call.callee
        if (
          !ipcBindings.has(memberName(callee?.object as AstNode) ?? '') ||
          !['handle', 'on'].includes(memberName(callee?.property) ?? '')
        )
          continue
        const [channelNode, handler] = call.arguments as AstNode[]
        expect(channelNode.type, `${file}: IPC channels must be literal inventory entries`).toBe(
          'StringLiteral',
        )
        const channel = channelNode.value as string
        expect(registrations.has(channel), `duplicate IPC handler: ${channel}`).toBe(false)
        registrations.set(channel, file)
        const guarded = calls(handler).some((candidate) => {
          const method = memberName(candidate.callee?.property)
          const args = candidate.arguments as AstNode[]
          return (
            (['handle', 'handlePayload'].includes(method ?? '') && args[0]?.value === channel) ||
            (method === 'assert' && args[1]?.value === channel)
          )
        })
        expect(guarded, `${file}: missing sender authorization for ${channel}`).toBe(true)
      }
    }
    expect([...registrations.keys()].sort()).toEqual(Object.keys(IPC_CHANNEL_CAPABILITIES).sort())
  })

  it.each(['MainWindowManager.ts', 'OverlayWindowManager.ts'])(
    'hardens every BrowserWindow in %s',
    (name) => {
      const tree = ast(`main/windows/${name}`)
      let windows = 0
      walk(tree, (node) => {
        if (node.type !== 'NewExpression' || memberName(node.callee) !== 'BrowserWindow') return
        windows += 1
        const options = (node.arguments as AstNode[])[0]
        const preferences = (options.properties as AstNode[]).find(
          (p) => memberName(p.key as AstNode) === 'webPreferences',
        )
        expect(preferences, `${name}: missing webPreferences`).toBeDefined()
        if (!preferences) throw new Error(`${name}: missing webPreferences`)
        const properties = (preferences.value as AstNode).properties as AstNode[]
        for (const [key, value] of Object.entries({
          sandbox: true,
          webSecurity: true,
          contextIsolation: true,
          nodeIntegration: false,
        })) {
          const property = properties.find((p) => memberName(p.key as AstNode) === key)
          expect((property?.value as AstNode)?.value, `${name}: ${key}`).toBe(value)
        }
      })
      expect(windows).toBeGreaterThan(0)
      expect(
        calls(tree).some((node) => memberName(node.callee) === 'installRendererNavigationGuards'),
      ).toBe(true)
      if (name === 'OverlayWindowManager.ts')
        expect(strings(tree)).toContain('../preload/overlay.js')
    },
  )

  it('exposes only presentation invocations from the Overlay preload', () => {
    const tree = ast('preload/overlay.ts')
    const ipcBindings = importedBindings(tree, 'electron', 'ipcRenderer')
    const channels = calls(tree)
      .filter(
        (node) =>
          ipcBindings.has(memberName(node.callee?.object as AstNode) ?? '') &&
          memberName(node.callee?.property) === 'invoke',
      )
      .map((node) => (node.arguments as AstNode[])[0]?.value)
    expect(channels.sort()).toEqual([
      'avatar-body:get',
      'avatar-mouth:get',
      'avatar-state:get',
      'overlay-presentation:config:get',
      'vrm:read',
    ])
    for (const value of strings(tree)) {
      expect(value).not.toMatch(
        /credential|project-awareness|plugins:|config:save|overlay:toggle|capabilities:snapshot|system:open-external-link|actions:|desktop-control:/,
      )
    }
  })

  it('retains Main-owned validation for capability, Action and Plugin IPC', () => {
    expect(
      schemaCalls('main/ipc/registerCapabilitiesIpc.ts').filter(
        (name) => name === 'parseShioCapabilitySnapshot',
      ),
    ).toHaveLength(2)
    expect(schemaCalls('preload/index.ts')).not.toContain('parseShioCapabilitySnapshot')
    for (const name of [
      'actionConfirmationResponseSchema.parse',
      'authorityChangeResponseSchema.parse',
      'actionRuntimeSnapshotSchema.parse',
    ]) {
      expect(schemaCalls('main/ipc/registerActionIpc.ts')).toContain(name)
    }
    const actionTree = ast('main/ipc/registerActionIpc.ts')
    let pendingAuthority = false
    walk(actionTree, (node) => {
      if (
        node.type === 'ObjectProperty' &&
        memberName(node.key as AstNode) === 'pendingAuthorityChange'
      ) {
        pendingAuthority =
          memberName((node.value as AstNode)?.callee?.property) === 'pendingAuthority'
      }
    })
    expect(pendingAuthority).toBe(true)
    expect(schemaCalls('main/ipc/registerPluginIpc.ts')).toEqual(
      expect.arrayContaining(['z.enum', 'pluginIdSchema.parse']),
    )
    for (const value of strings(ast('main/ipc/registerDesktopControlIpc.ts'))) {
      expect(value).not.toMatch(/save-credential|forget-credential/)
    }
    expect(schemaCalls('main/ipc/registerDesktopControlIpc.ts')).toContain(
      'desktopControlStatusSchema.parse',
    )
    expect(schemaCalls('main/ipc/registerBrowserControlIpc.ts')).toContain(
      'browserControlStatusSchema.parse',
    )
    expect(strings(ast('main/ipc/registerBrowserControlIpc.ts'))).toContain('browser.use-control')
    const project = calls(ast('main/ipc/registerProjectAwarenessIpc.ts'))
    expect(project.some((node) => memberPath(node.callee) === 'credentialSchema.parse')).toBe(true)
    expect(
      project.some(
        (node) =>
          memberName(node.callee?.property) === 'parse' &&
          memberPath((node.callee?.object as AstNode)?.callee) === 'configSchema.strict',
      ),
    ).toBe(true)
  })

  it('validates external URLs in Main before the registered Action boundary', () => {
    expect(schemaCalls('main/system/releaseSupport.ts')).toContain('externalHttpUrlSchema.parse')
    expect(strings(ast('preload/index.ts'))).toContain('system:open-external-link')
    expect(strings(ast('main/system/releaseSupport.ts'))).toContain('system:open-external-link')
  })

  it('does not restore generic Plugin dispatch, desktop workflow IPC or an app filesystem protocol', () => {
    for (const path of [
      'main/ipc/registerPluginIpc.ts',
      'shared/ipc/api.ts',
      'main/ipc/registerActionIpc.ts',
      'preload/index.ts',
    ]) {
      for (const value of strings(ast(path)))
        expect([
          'plugin.invoke',
          'plugins:invoke',
          'actions:request-desktop-workflow',
        ]).not.toContain(value)
    }
    const boot = calls(ast('main/app/buildApplicationDependencies.ts'))
    expect(
      boot.some(
        (node) =>
          memberPath(node.callee) === 'protocol.handle' &&
          (node.arguments as AstNode[])[0]?.value === 'app',
      ),
    ).toBe(false)
    expect(readFileSync(join(sourceRoot, 'renderer/index.html'), 'utf8')).not.toContain(' app:')
  })
})
