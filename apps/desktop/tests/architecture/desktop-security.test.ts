import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it } from 'vitest'

import { IPC_CHANNEL_CAPABILITIES, IpcAuthorization } from '../../src/main/ipc/IpcAuthorization'
import { installRendererNavigationGuards } from '../../src/main/windows/windowSecurity'

function main(): void {
  const desktopRoot = process.cwd().endsWith('apps\\desktop')
    ? process.cwd()
    : join(process.cwd(), 'apps', 'desktop')
  const mainSourceRoot = join(desktopRoot, 'src', 'main')

  function collectTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const target = join(directory, entry.name)
      if (entry.isDirectory()) return collectTypeScriptFiles(target)
      return entry.isFile() && entry.name.endsWith('.ts') ? [target] : []
    })
  }

  function assertIpcInventory(): void {
    const registrations = new Map<string, string>()
    for (const filePath of collectTypeScriptFiles(mainSourceRoot)) {
      const source = readFileSync(filePath, 'utf8')
      for (const match of source.matchAll(/ipcMain\.(?:handle|on)\(\s*['"]([^'"]+)['"]/g)) {
        const channel = match[1]
        assert(!registrations.has(channel), `duplicate IPC handler: ${channel}`)
        registrations.set(channel, source.slice(match.index, match.index + 1_500))
      }
    }

    assert.deepEqual(
      [...registrations.keys()].sort(),
      Object.keys(IPC_CHANNEL_CAPABILITIES).sort(),
      'IPC inventory and capability matrix differ',
    )
    for (const [channel, registration] of registrations) {
      if (channel === 'tts:open-stream') {
        assert.match(registration, /authorization\.assert\(event, 'tts:open-stream'\)/)
        assert.match(registration, /streamStartSchema\.parse\(input\)/)
        continue
      }
      const escapedChannel = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      assert(
        new RegExp(`authorization\\.handle(?:Payload)?\\(\\s*['"]${escapedChannel}['"]`).test(
          registration,
        ),
        `IPC handler has no sender authorization: ${channel}`,
      )
    }
  }

  function assertSenderBoundaries(): void {
    const authorization = new IpcAuthorization({ main: () => 11, overlay: () => 22 })
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'llm:save-credential'),
      /not authorized/,
      'Overlay reached privileged credential IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 999 } } as never, 'config:get'),
      /not authorized/,
      'Unknown sender reached Main IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'plugins:enable'),
      /not authorized/,
      'Overlay reached Plugin Runtime IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'project-awareness:get-config'),
      /not authorized/,
      'Overlay reached Project Awareness configuration IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 999 } } as never, 'plugins:list'),
      /not authorized/,
      'Unknown sender reached Plugin Runtime IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'capabilities:snapshot'),
      /not authorized/,
      'Overlay reached capability catalog IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'system:open-external-link'),
      /not authorized/,
      'Overlay reached external navigation IPC',
    )
    assert.throws(
      () => authorization.assert({ sender: { id: 22 } } as never, 'desktop-control:start-runtime'),
      /not authorized/,
      'Overlay reached Desktop Control IPC',
    )
    for (const channel of ['actions:request-authority-mode', 'actions:emergency-stop'] as const) {
      assert.throws(
        () => authorization.assert({ sender: { id: 22 } } as never, channel),
        /not authorized/,
        `Overlay reached Action Runtime IPC: ${channel}`,
      )
    }
    assert.equal(authorization.assert({ sender: { id: 11 } } as never, 'plugins:list'), 'main')
    assert.equal(
      authorization.assert({ sender: { id: 11 } } as never, 'capabilities:snapshot'),
      'main',
    )
    assert.equal(
      authorization.assert({ sender: { id: 22 } } as never, 'avatar-state:get'),
      'overlay',
    )
    const noPayloadHandler = authorization.handle('config:get', () => ({ ok: true }))
    assert.throws(() => noPayloadHandler({ sender: { id: 11 } } as never, { injected: true }))
  }

  function assertOpaqueAssetBoundary(): void {
    const channels = Object.keys(IPC_CHANNEL_CAPABILITIES)
    assert(!channels.some((channel) => /vrm|vrma|avatar:read|avatar:pick/.test(channel)))
    const preload = readFileSync(join(desktopRoot, 'src/preload/index.ts'), 'utf8')
    assert(!preload.includes('vrm:read'))
    assert(!preload.includes('pickVrm'))
  }

  function assertWindowAndPreloadBoundaries(): void {
    let navigationListener: ((event: { preventDefault(): void }, url: string) => void) | undefined
    let openHandler: (() => { action: 'deny' }) | undefined
    installRendererNavigationGuards({
      webContents: {
        on: (
          _event: 'will-navigate',
          listener: (event: { preventDefault(): void }, url: string) => void,
        ) => {
          navigationListener = listener
        },
        setWindowOpenHandler: (handler: () => { action: 'deny' }) => {
          openHandler = handler
        },
      },
    })
    let prevented = false
    navigationListener?.(
      { preventDefault: () => (prevented = true) },
      'app:///C:/Users/attacker/arbitrary.vrm',
    )
    assert(prevented, 'arbitrary app: filesystem navigation was not rejected')
    assert.equal(openHandler?.().action, 'deny', 'new renderer window was not rejected')

    const mainWindow = readFileSync(join(mainSourceRoot, 'windows', 'MainWindowManager.ts'), 'utf8')
    const overlayWindow = readFileSync(
      join(mainSourceRoot, 'windows', 'OverlayWindowManager.ts'),
      'utf8',
    )
    for (const source of [mainWindow, overlayWindow]) {
      assert(source.includes('contextIsolation: true'))
      assert(source.includes('nodeIntegration: false'))
      assert(source.includes('sandbox: true'))
      assert(source.includes('webSecurity: true'))
      assert(source.includes('installRendererNavigationGuards'))
    }
    assert(overlayWindow.includes("preload: join(__dirname, '../preload/overlay.js')"))

    const overlayPreload = readFileSync(join(desktopRoot, 'src', 'preload', 'overlay.ts'), 'utf8')
    const mainPreload = readFileSync(join(desktopRoot, 'src', 'preload', 'index.ts'), 'utf8')
    const invokedChannels = [...overlayPreload.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)/g)]
      .map((match) => match[1])
      .sort()
    assert.deepEqual(invokedChannels, [
      'avatar-mouth:get',
      'avatar-state:get',
      'overlay-presentation:config:get',
    ])
    assert(!/credential|project-awareness|plugins:|config:save|overlay:toggle/.test(overlayPreload))
    assert(!overlayPreload.includes('capabilities:snapshot'))
    assert(!overlayPreload.includes('system:open-external-link'))
    assert(!overlayPreload.includes('actions:'))
    assert(!overlayPreload.includes('desktop-control:'))
    assert(!mainPreload.includes('parseShioCapabilitySnapshot'))

    const capabilitiesIpc = readFileSync(
      join(mainSourceRoot, 'ipc', 'registerCapabilitiesIpc.ts'),
      'utf8',
    )
    assert(capabilitiesIpc.includes('parseShioCapabilitySnapshot(await catalog.snapshot())'))
    assert(capabilitiesIpc.includes('parseShioCapabilitySnapshot(snapshot)'))

    const releaseSupport = readFileSync(join(mainSourceRoot, 'system', 'releaseSupport.ts'), 'utf8')
    assert.match(releaseSupport, /authorization\.handlePayload\(\s*'system:open-external-link'/)
    assert(releaseSupport.includes('externalHttpUrlSchema.parse(payload)'))
    assert(mainPreload.includes("ipcRenderer.invoke('system:open-external-link', url)"))

    const actionIpc = readFileSync(join(mainSourceRoot, 'ipc', 'registerActionIpc.ts'), 'utf8')
    assert(!actionIpc.includes('actions:request-desktop-workflow'))
    assert(!mainPreload.includes('actions:request-desktop-workflow'))
    assert(actionIpc.includes('actionConfirmationResponseSchema.parse(payload)'))
    assert(actionIpc.includes('authorityChangeResponseSchema.parse(payload)'))
    assert(actionIpc.includes('actionRuntimeSnapshotSchema.parse({'))
    assert(actionIpc.includes('pendingAuthorityChange: confirmations.pendingAuthority()'))

    const applicationBootstrap = readFileSync(
      join(mainSourceRoot, 'app', 'buildApplicationDependencies.ts'),
      'utf8',
    )
    assert(!applicationBootstrap.includes("protocol.handle('app'"))
    const rendererHtml = readFileSync(join(desktopRoot, 'src', 'renderer', 'index.html'), 'utf8')
    assert(!rendererHtml.includes(' app:'))
  }

  function assertPluginBoundaries(): void {
    const pluginIpc = readFileSync(join(mainSourceRoot, 'ipc', 'registerPluginIpc.ts'), 'utf8')
    const projectIpc = readFileSync(
      join(mainSourceRoot, 'ipc', 'registerProjectAwarenessIpc.ts'),
      'utf8',
    )
    const sharedApi = readFileSync(join(desktopRoot, 'src', 'shared', 'ipc', 'api.ts'), 'utf8')
    const projectApi = readFileSync(
      join(desktopRoot, 'src', 'shared', 'project-awareness', 'api.ts'),
      'utf8',
    )
    assert(pluginIpc.includes('z.enum(PLUGIN_IDS)'))
    assert(pluginIpc.includes('pluginIdSchema.parse(id)'))
    const browserControlIpc = readFileSync(
      join(mainSourceRoot, 'ipc', 'registerBrowserControlIpc.ts'),
      'utf8',
    )
    assert(browserControlIpc.includes("authorization.handle('browser-control:get-status'"))
    assert(browserControlIpc.includes("authorization.handle('browser-control:pause'"))
    assert(browserControlIpc.includes("authorization.handle('browser-control:resume'"))
    assert(browserControlIpc.includes("authorization.handle('browser-control:stop'"))
    assert(browserControlIpc.includes("name: 'browser.use-control'"))
    assert(browserControlIpc.includes('browserControlStatusSchema.parse'))
    assert(projectIpc.includes('configSchema.strict().parse(input)'))
    assert(projectIpc.includes('credentialSchema.parse(token)'))
    assert(projectApi.includes('saveCredential(token: string): Promise<ProjectAwarenessStatus>'))
    const desktopIpc = readFileSync(
      join(mainSourceRoot, 'ipc', 'registerDesktopControlIpc.ts'),
      'utf8',
    )
    assert(desktopIpc.includes('desktopControlStatusSchema.parse'))
    assert(!desktopIpc.includes('save-credential'))
    assert(!desktopIpc.includes('forget-credential'))
    assert(!/plugin\.invoke|plugins:invoke/.test(`${pluginIpc}\n${sharedApi}`))
  }

  assertIpcInventory()
  assertSenderBoundaries()
  assertOpaqueAssetBoundary()
  assertWindowAndPreloadBoundaries()
  assertPluginBoundaries()
  console.log('Desktop security repro passed')
}

describe('desktop security', () => {
  it('enforces IPC, asset, window, preload, and plugin boundaries', () => {
    main()
  })
})
