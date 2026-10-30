import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchModels: vi.fn(), adapterCapabilities: vi.fn() }))
vi.mock('../../../src/main/llm/AiSdkAdapter', () => ({
  createModelCatalogClient: (config: { connection: { accountId?: string } }) => ({
    fetchModels: (apiKey: string) => mocks.fetchModels(apiKey, config.connection.accountId),
  }),
  createAiSdkAdapter: (config: { capabilities: unknown }) => {
    mocks.adapterCapabilities(config.capabilities)
    return { chat: async () => 'ok' }
  },
}))

import { LlmCapabilityError, LlmCredentialMissingError } from '../../../src/main/llm/errors'
import { LlmGateway } from '../../../src/main/llm/LlmGateway'
import {
  enrichModelCatalog,
  hasLoadedModelCatalog,
  invalidateModelCatalog,
  resolveModelCapabilities,
} from '../../../src/main/llm/registry'
import type { ChatMessage, LlmGatewaySettings } from '../../../src/main/llm/types'

const ACCOUNT_A = 'a'.repeat(32)
const ACCOUNT_B = 'b'.repeat(32)
const MODEL = '@cf/fixture/catalog-only-model'

afterEach(() => {
  invalidateModelCatalog('cloudflare')
  invalidateModelCatalog('mistral')
  mocks.fetchModels.mockReset()
  mocks.adapterCapabilities.mockReset()
})

describe('LLM model catalog capability identity', () => {
  it('applies catalog hints only to the account whose catalog produced them', () => {
    enrichModelCatalog('cloudflare', [{ id: MODEL, capabilities: { supportsVision: true } }], {
      accountId: ACCOUNT_A,
    })
    expect(
      resolveModelCapabilities('cloudflare', MODEL, { accountId: ACCOUNT_A }).supportsVision,
    ).toBe(true)
    expect(
      resolveModelCapabilities('cloudflare', MODEL, { accountId: ACCOUNT_B }).supportsVision,
    ).toBe(false)
    expect(hasLoadedModelCatalog('cloudflare', { accountId: ACCOUNT_A })).toBe(true)
    expect(hasLoadedModelCatalog('cloudflare', { accountId: ACCOUNT_B })).toBe(false)
  })

  it('drops hints of models removed from a refreshed catalog', () => {
    enrichModelCatalog('mistral', [
      { id: 'fixture-removed', capabilities: { supportsVision: true } },
      { id: 'fixture-kept', capabilities: { supportsVision: true } },
    ])
    enrichModelCatalog('mistral', [{ id: 'fixture-kept', capabilities: { supportsVision: true } }])
    expect(resolveModelCapabilities('mistral', 'fixture-removed').supportsVision).toBe(false)
    expect(resolveModelCapabilities('mistral', 'fixture-kept').supportsVision).toBe(true)
  })

  it('updates capabilities when a refreshed catalog changes a model hint', () => {
    enrichModelCatalog('mistral', [{ id: 'fixture-model', capabilities: { supportsVision: true } }])
    enrichModelCatalog('mistral', [
      { id: 'fixture-model', capabilities: { supportsVision: false } },
    ])
    expect(resolveModelCapabilities('mistral', 'fixture-model').supportsVision).toBe(false)
  })

  it('forgets catalog hints after a credential change', () => {
    enrichModelCatalog('mistral', [{ id: 'fixture-model', capabilities: { supportsVision: true } }])
    invalidateModelCatalog('mistral')
    expect(hasLoadedModelCatalog('mistral')).toBe(false)
    expect(resolveModelCapabilities('mistral', 'fixture-model').supportsVision).toBe(false)
  })

  it('reloads the active catalog when the configured account changes', async () => {
    mocks.fetchModels.mockImplementation(async (_apiKey: string, accountId?: string) => [
      { id: MODEL, capabilities: { supportsVision: accountId === ACCOUNT_A } },
    ])
    let settings: LlmGatewaySettings = {
      provider: 'cloudflare',
      apiKey: 'test-key',
      model: MODEL,
      accountId: ACCOUNT_A,
    }
    const gateway = new LlmGateway(() => settings)

    expect((await gateway.refreshActiveCapabilities()).supportsVision).toBe(true)
    await gateway.refreshActiveCapabilities()
    expect(mocks.fetchModels).toHaveBeenCalledTimes(1)

    settings = { ...settings, accountId: ACCOUNT_B }
    expect(gateway.getActiveCapabilities().supportsVision).toBe(false)
    expect((await gateway.refreshActiveCapabilities()).supportsVision).toBe(false)
    expect(mocks.fetchModels).toHaveBeenCalledTimes(2)
    expect(mocks.fetchModels).toHaveBeenLastCalledWith('test-key', ACCOUNT_B)
  })

  it('reloads the active catalog after credentials are invalidated', async () => {
    mocks.fetchModels.mockResolvedValue([])
    const gateway = new LlmGateway(() => ({
      provider: 'mistral',
      apiKey: 'test-key',
      model: 'fixture-model',
    }))
    await gateway.refreshActiveCapabilities()
    invalidateModelCatalog('mistral')
    await gateway.refreshActiveCapabilities()
    expect(mocks.fetchModels).toHaveBeenCalledTimes(2)
  })
})

describe('LLM gateway request admission', () => {
  const image: ChatMessage = {
    role: 'user',
    content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) }],
  }

  it('rejects missing credentials before capability checks or adapter creation', async () => {
    const gateway = new LlmGateway(() => ({ provider: 'mistral', apiKey: ' ', model: 'm' }))
    await expect(gateway.chat([image])).rejects.toBeInstanceOf(LlmCredentialMissingError)
    await expect(gateway.complete([image])).rejects.toBeInstanceOf(LlmCredentialMissingError)
    expect(() => gateway.stream([image])).toThrow(LlmCredentialMissingError)
    const cloudflare = new LlmGateway(() => ({ provider: 'cloudflare', apiKey: 'k', model: MODEL }))
    await expect(cloudflare.chat([])).rejects.toBeInstanceOf(LlmCredentialMissingError)
    expect(mocks.adapterCapabilities).not.toHaveBeenCalled()
  })

  it('rejects unsupported streaming before unsupported vision', () => {
    enrichModelCatalog('mistral', [
      { id: 'fixture-model', capabilities: { supportsStreaming: false, supportsVision: false } },
    ])
    const gateway = new LlmGateway(() => ({
      provider: 'mistral',
      apiKey: 'k',
      model: 'fixture-model',
    }))
    expect(() => gateway.stream([image])).toThrow(LlmCapabilityError)
    expect(mocks.adapterCapabilities).not.toHaveBeenCalled()
  })

  it('rejects images for a non-vision model and hands account-scoped capabilities to the adapter', async () => {
    enrichModelCatalog('cloudflare', [{ id: MODEL, capabilities: { supportsVision: true } }], {
      accountId: ACCOUNT_A,
    })
    const settings = (accountId: string) => () => ({
      provider: 'cloudflare' as const,
      apiKey: 'k',
      model: MODEL,
      accountId,
    })
    await expect(new LlmGateway(settings(ACCOUNT_B)).chat([image])).rejects.toBeInstanceOf(
      LlmCapabilityError,
    )
    await expect(new LlmGateway(settings(ACCOUNT_A)).chat([image])).resolves.toBe('ok')
    expect(mocks.adapterCapabilities).toHaveBeenCalledOnce()
    expect(mocks.adapterCapabilities.mock.calls[0][0]).toMatchObject({ supportsVision: true })
  })
})
