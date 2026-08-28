import { app, ipcMain, shell } from 'electron'
import { z } from 'zod'

import { LLM_PROVIDER_IDS } from '../../shared/llm'
import type { AvatarRuntimeHealth } from '../../shared/runtime'
import type { ReleaseInfo, RuntimeSupportBundle } from '../../shared/system'
import type { ActionRuntime } from '../action'
import { getConfig } from '../config'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from '../ipc/IpcAuthorization'
import type { LlmCredentialStore } from '../llm'
import { getRecentSafeErrors } from '../logging/safeLogger'
import type { PluginRuntime } from '../plugins'
import type { SpeechClientManager } from '../speech/SpeechClientManager'
import { deriveCapabilities } from '../speech/speechClient'
import { externalHttpUrlSchema } from './externalNavigation'

interface ReleaseSupportDependencies {
  llmCredentials: () => LlmCredentialStore
  plugins: () => PluginRuntime
  speech: () => SpeechClientManager
  isOverlayVisible: () => boolean
  avatarRuntimeHealth: () => AvatarRuntimeHealth | null
  aliveRuntime: () => RuntimeSupportBundle['aliveRuntime']
  mainRendererHealth: () => RuntimeSupportBundle['renderers']['main']
  overlayRendererHealth: () => RuntimeSupportBundle['renderers']['overlay']
  recentIncidents: () => RuntimeSupportBundle['recentIncidents']
}

const externalNavigationResultSchema = z.object({ ok: z.literal(true) }).strict()

function releaseInfo(): ReleaseInfo {
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    isPackaged: app.isPackaged,
  }
}

export function registerReleaseSupportHandlers(
  dependencies: ReleaseSupportDependencies,
  authorization: IpcAuthorization,
  actions: ActionRuntime,
): void {
  actions.register<string, { ok: true }>({
    name: 'system.openExternalLink',
    description: 'Open a validated HTTP(S) link in the operating-system browser.',
    validate: (payload) => externalHttpUrlSchema.parse(payload),
    adapter: 'electron-shell',
    execute: async (url) => {
      await shell.openExternal(url)
      return { ok: true }
    },
  })
  actions.register<void, { ok: boolean }>({
    name: 'system.openLogsFolder',
    description: 'Open the main-owned application logs folder.',
    validate: (payload) => z.undefined().parse(payload),
    adapter: 'electron-shell',
    execute: async () => ({ ok: (await shell.openPath(app.getPath('logs'))) === '' }),
  })
  ipcMain.handle(
    'system:get-release-info',
    authorization.handle('system:get-release-info', () => releaseInfo()),
  )
  ipcMain.handle(
    'system:open-external-link',
    authorization.handlePayload(
      'system:open-external-link',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const url = externalHttpUrlSchema.parse(payload)
        const action = await actions.execute<string, { ok: true }>({
          name: 'system.openExternalLink',
          payload: url,
        })
        if (action.status !== 'success') throw new Error(action.error)
        return externalNavigationResultSchema.parse(action.result)
      },
    ),
  )
  ipcMain.handle(
    'system:open-logs-folder',
    authorization.handle('system:open-logs-folder', async () => {
      const action = await actions.execute<void, { ok: boolean }>({
        name: 'system.openLogsFolder',
        payload: undefined,
      })
      return action.status === 'success' ? action.result : { ok: false }
    }),
  )
  ipcMain.handle(
    'system:get-runtime-support-bundle',
    authorization.handle(
      'system:get-runtime-support-bundle',
      async (): Promise<RuntimeSupportBundle> => {
        const config = getConfig()
        const activeProvider = config.llm.activeProvider
        const credentialConfigured = Object.fromEntries(
          LLM_PROVIDER_IDS.map((provider) => [
            provider,
            dependencies.llmCredentials().getStatus(provider).configured,
          ]),
        ) as Record<(typeof LLM_PROVIDER_IDS)[number], boolean>

        let speech: RuntimeSupportBundle['speech']
        try {
          speech = { capabilities: deriveCapabilities(await dependencies.speech().health()) }
        } catch (error) {
          speech = {
            capabilities: {
              serviceReachable: false,
              recognition: false,
              synthesis: false,
              streaming: false,
            },
            error: error instanceof Error ? error.message : 'Speech health check failed',
          }
        }

        const mainRenderer = dependencies.mainRendererHealth()
        const avatarRuntimeHealth = dependencies.avatarRuntimeHealth()
        return {
          generatedAt: Date.now(),
          release: releaseInfo(),
          speech,
          llm: {
            provider: activeProvider,
            model: config.llm.providers[activeProvider].model,
            credentialConfigured,
          },
          plugins: await dependencies.plugins().listEnabledHealth(),
          avatarRuntime: {
            reportFresh: mainRenderer.status === 'ready' && avatarRuntimeHealth !== null,
            health: avatarRuntimeHealth,
          },
          aliveRuntime: dependencies.aliveRuntime(),
          renderers: {
            main: mainRenderer,
            overlay: dependencies.overlayRendererHealth(),
          },
          microphoneConfigured: Boolean(config.micDeviceId),
          overlayVisible: dependencies.isOverlayVisible(),
          latestRuntimeErrors: getRecentSafeErrors(),
          recentIncidents: dependencies.recentIncidents(),
          paths: {
            userData: app.getPath('userData'),
            logs: app.getPath('logs'),
          },
        }
      },
    ),
  )
}
