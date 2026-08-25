import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { VrmAssetRegistry } from '../../src/main/assets/VrmAssetRegistry'
import { IPC_CHANNEL_CAPABILITIES, IpcAuthorization } from '../../src/main/ipc/IpcAuthorization'
import { vrmAssetHandleSchema } from '../../src/main/ipc/payloadSchemas'
import { installRendererNavigationGuards } from '../../src/main/windows/windowSecurity'

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
    for (const match of source.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)) {
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
  assert.equal(authorization.assert({ sender: { id: 22 } } as never, 'avatar-state:get'), 'overlay')
  const noPayloadHandler = authorization.handle('config:get', () => ({ ok: true }))
  assert.throws(() => noPayloadHandler({ sender: { id: 11 } } as never, { injected: true }))
}

function assertOpaqueAssetBoundary(): void {
  assert.throws(
    () => vrmAssetHandleSchema.parse('C:\\Users\\attacker\\arbitrary.vrm'),
    /Invalid VRM asset handle/,
  )

  const directory = mkdtempSync(join(tmpdir(), 'shio-security-repro-'))
  const selectedPath = join(directory, 'selected.vrm')
  const expected = Buffer.from([0x67, 0x6c, 0x54, 0x46])
  try {
    writeFileSync(selectedPath, expected)
    const registry = new VrmAssetRegistry()
    const selected = registry.registerSelectedAsset(selectedPath)
    assert(vrmAssetHandleSchema.safeParse(selected.assetHandle).success)
    assert.deepEqual(Buffer.from(registry.readAsset(selected.assetHandle)), expected)
    assert.throws(() => registry.readAsset(selectedPath), /Unknown VRM asset handle/)
  } finally {
    unlinkSync(selectedPath)
    rmdirSync(directory)
  }
}

function assertWindowAndPreloadBoundaries(): void {
  let navigationListener: ((event: { preventDefault(): void }, url: string) => void) | undefined
  let openHandler: (() => { action: 'deny' }) | undefined
  installRendererNavigationGuards({
    webContents: {
      on: (_event, listener) => {
        navigationListener = listener
      },
      setWindowOpenHandler: (handler) => {
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
    'vrm:read',
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
  const browserGameIpc = readFileSync(
    join(mainSourceRoot, 'ipc', 'registerBrowserGameIpc.ts'),
    'utf8',
  )
  assert(browserGameIpc.includes("authorization.handle('browser-game:get-status'"))
  assert(browserGameIpc.includes("authorization.handle('browser-game:pause'"))
  assert(browserGameIpc.includes("authorization.handle('browser-game:stop'"))
  assert(browserGameIpc.includes("name: 'browser.game-control'"))
  assert(browserGameIpc.includes('browserGameDiagnosticsSchema.parse'))
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
