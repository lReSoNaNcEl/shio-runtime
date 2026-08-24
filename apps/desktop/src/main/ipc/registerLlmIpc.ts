import { type BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import { translate } from '../../shared/localization'
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
  resolveLlmProviderAccountId,
  resolveLlmReadiness,
} from '../llm'
import { mainLog } from '../logging/safeLogger'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

interface RegisterLlmIpcOptions {
  llm: () => LlmGateway
  credentials: () => LlmCredentialStore
  window: BrowserWindow
  authorization: IpcAuthorization
  onCapabilitiesChanged?: () => void
}

export function registerLlmIpc({
  llm,
  credentials,
  window,
  authorization,
  onCapabilitiesChanged,
}: RegisterLlmIpcOptions): void {
  ipcMain.handle(
    'llm:get-active-capabilities',
    authorization.handle('llm:get-active-capabilities', async () => {
      try {
        const capabilities = await llm().refreshActiveCapabilities()
        onCapabilitiesChanged?.()
        return capabilities
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
    authorization.handle('llm:get-readiness', () => resolveLlmReadiness(getRendererConfig().llm)),
  )

  const providerSchema = z
    .string()
    .refine((provider): provider is LlmProviderId => isLlmProviderId(provider))
  const accountIdSchema = z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/iu)
    .optional()
  const modelCatalogRequestSchema = z
    .object({
      provider: providerSchema,
      accountId: accountIdSchema,
    })
    .strict()

  const resolveAccountId = (provider: LlmProviderId, requested?: string): string =>
    resolveLlmProviderAccountId(
      provider,
      requested ?? getConfig().llm.providers[provider].accountId,
    )

  ipcMain.handle(
    'llm:fetch-models',
    authorization.handlePayload(
      'llm:fetch-models',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const { provider, accountId: requestedAccountId } = modelCatalogRequestSchema.parse(payload)
        const { apiKey } = credentials().resolve(provider)
        try {
          const accountId = resolveAccountId(provider, requestedAccountId)
          const catalog = createModelCatalog(provider, { accountId })
          const models: ModelInfo[] = enrichModelCatalog(
            provider,
            await catalog.fetchModels(apiKey),
          )
          return { ok: true, models }
        } catch (error) {
          if (error instanceof ModelFetchError) {
            return { ok: false, error: error.message, kind: error.kind }
          }
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            kind: 'unknown',
          }
        }
      },
    ),
  )

  const credentialSchema = z
    .object({
      provider: providerSchema,
      accountId: accountIdSchema,
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
        onCapabilitiesChanged?.()
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
        onCapabilitiesChanged?.()
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
        const { provider, apiKey, accountId: requestedAccountId } = credentialSchema.parse(payload)
        try {
          const accountId = resolveAccountId(provider, requestedAccountId)
          const catalog = createModelCatalog(provider, { accountId })
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
