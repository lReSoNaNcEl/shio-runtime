import { app, ipcMain, shell } from 'electron'

import { LLM_PROVIDER_IDS } from '../../shared/llm'
import type { AvatarRuntimeHealth } from '../../shared/runtime'
import type { ReleaseInfo, RuntimeSupportBundle } from '../../shared/system'
import { getConfig } from '../config'
import type { IpcAuthorization } from '../ipc/IpcAuthorization'
import type { LlmCredentialStore } from '../llm'
import { getRecentSafeErrors } from '../logging/safeLogger'
import type { ProjectAwarenessPlugin } from '../project-awareness'
import { deriveCapabilities, type SpeechClient } from '../speech/speechClient'

interface ReleaseSupportDependencies {
  llmCredentials: () => LlmCredentialStore
  projectAwareness: () => ProjectAwarenessPlugin
  speech: () => SpeechClient
  isOverlayVisible: () => boolean
  avatarRuntimeHealth: () => AvatarRuntimeHealth | null
  mainRendererHealth: () => RuntimeSupportBundle['renderers']['main']
  overlayRendererHealth: () => RuntimeSupportBundle['renderers']['overlay']
}

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
): void {
  ipcMain.handle(
    'system:get-release-info',
    authorization.handle('system:get-release-info', () => releaseInfo()),
  )
  ipcMain.handle(
    'system:open-logs-folder',
    authorization.handle('system:open-logs-folder', async () => ({
      ok: (await shell.openPath(app.getPath('logs'))) === '',
    })),
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
          release: releaseInfo(),
          speech,
          llm: {
            provider: activeProvider,
            model: config.llm.providers[activeProvider].model,
            credentialConfigured,
          },
          projectAwareness: dependencies.projectAwareness().getStatus(),
          avatarRuntime: {
            reportFresh: mainRenderer.status === 'ready' && avatarRuntimeHealth !== null,
            health: avatarRuntimeHealth,
          },
          renderers: {
            main: mainRenderer,
            overlay: dependencies.overlayRendererHealth(),
          },
          microphoneConfigured: Boolean(config.micDeviceId),
          overlayVisible: dependencies.isOverlayVisible(),
          latestRuntimeErrors: getRecentSafeErrors(),
          paths: {
            userData: app.getPath('userData'),
            logs: app.getPath('logs'),
          },
        }
      },
    ),
  )
}
