import { type BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import { translate } from '../../shared/localization'
import type { ActionRuntime } from '../action/ActionRuntime'
import { getConfig, getRendererConfig } from '../config'
import {
  createModelCatalog,
  enrichModelCatalog,
  isLlmProviderId,
  type LlmCredentialStore,
  type LlmGateway,
  type LlmProviderId,
  ModelFetchError,
  type ModelInfo,
  PROVIDER_PROFILES,
  type ProviderProfile,
} from '../llm'
import { mainLog } from '../logging/safeLogger'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

interface RegisterLlmIpcOptions {
  actions: ActionRuntime
  llm: () => LlmGateway
  credentials: () => LlmCredentialStore
  window: BrowserWindow
  authorization: IpcAuthorization
}

export function registerLlmIpc({
  actions,
  llm,
  credentials,
  window,
  authorization,
}: RegisterLlmIpcOptions): void {
  ipcMain.handle(
    'llm:get-active-capabilities',
    authorization.handle('llm:get-active-capabilities', async () => {
      try {
        return await llm().refreshActiveCapabilities()
      } catch (error) {
        mainLog.warn('LLM capability catalog refresh failed; using fallback resolution', {
          error: error instanceof Error ? error.message : String(error),
        })
        return llm().getActiveCapabilities()
      }
    }),
  )

  ipcMain.handle(
    'llm:providers',
    authorization.handle('llm:providers', (): ProviderProfile[] => [...PROVIDER_PROFILES]),
  )
  ipcMain.handle(
    'llm:get-readiness',
    authorization.handle('llm:get-readiness', () => {
      const config = getRendererConfig().llm
      const provider = PROVIDER_PROFILES.find((item) => item.id === config.activeProvider)
      const credentialReady =
        provider?.requiresApiKey === false ||
        config.providers[config.activeProvider].credential.configured
      return {
        reason: credentialReady
          ? config.providers[config.activeProvider].model.trim()
            ? 'ready'
            : 'model-missing'
          : 'missing-credential',
        providerId: config.activeProvider,
        providerDisplayName: provider?.displayName ?? config.activeProvider,
      }
    }),
  )

  const providerSchema = z
    .string()
    .refine((provider): provider is LlmProviderId => isLlmProviderId(provider))

  ipcMain.handle(
    'llm:fetch-models',
    authorization.handlePayload(
      'llm:fetch-models',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const provider = providerSchema.parse(payload)
        const action = await actions.execute<
          { provider: string },
          { ok: boolean; models?: ModelInfo[]; error?: string; kind?: string }
        >({ name: 'llm.fetchModels', payload: { provider } })
        return action.status === 'success' ? action.result : { ok: false, error: action.error }
      },
    ),
  )

  const credentialSchema = z
    .object({
      provider: providerSchema,
      apiKey: z
        .string()
        .trim()
        .min(1)
        .max(2_000)
        .refine((value) => !/\s/.test(value)),
    })
    .strict()
  ipcMain.handle(
    'llm:save-credential',
    authorization.handlePayload(
      'llm:save-credential',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const { provider, apiKey } = credentialSchema.parse(payload)
        const status = await credentials().save(provider, apiKey)
        window.webContents.send('config:updated', getRendererConfig())
        return status
      },
    ),
  )
  ipcMain.handle(
    'llm:forget-credential',
    authorization.handlePayload(
      'llm:forget-credential',
      IPC_ONE_PAYLOAD,
      async (_event, provider: unknown) => {
        const status = await credentials().forget(providerSchema.parse(provider))
        window.webContents.send('config:updated', getRendererConfig())
        return status
      },
    ),
  )
  ipcMain.handle(
    'llm:get-credential-status',
    authorization.handlePayload(
      'llm:get-credential-status',
      IPC_ONE_PAYLOAD,
      (_event, provider: unknown) => credentials().getStatus(providerSchema.parse(provider)),
    ),
  )
  ipcMain.handle(
    'llm:validate-credential',
    authorization.handlePayload(
      'llm:validate-credential',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const { provider, apiKey } = credentialSchema.parse(payload)
        try {
          const catalog = createModelCatalog(provider)
          return {
            ok: true,
            models: enrichModelCatalog(provider, await catalog.fetchModels(apiKey)),
          }
        } catch (error) {
          if (error instanceof ModelFetchError) {
            return { ok: false, error: error.message, kind: error.kind }
          }
          return {
            ok: false,
            error: translate(getConfig().uiLocale, 'main.error.llmCredentialValidation'),
            kind: 'unknown',
          }
        }
      },
    ),
  )
}
