import axios from 'axios'

import { ModelFetchError } from '../errors'
import { CloudflareModelsResponseSchema } from '../openai-compatible/schemas'
import type { ModelCatalogEntry, ProviderConnectionSettings, ProviderDefinition } from '../types'

const CLOUDFLARE_API_ROOT = 'https://api.cloudflare.com/client/v4/accounts'
const CLOUDFLARE_HOSTED_SOURCE_ID = 1
const CLOUDFLARE_MODEL_PREFIX = '@cf/'
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/iu
const MODEL_PAGE_SIZE = 100
const MAX_MODEL_PAGES = 10

function normalizedAccountId(connection: ProviderConnectionSettings): string {
  const accountId = connection.accountId?.trim() ?? ''
  if (!CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new ModelFetchError(
      'configuration',
      'Cloudflare Workers AI: Account ID is missing or invalid.',
    )
  }
  return accountId.toLowerCase()
}

function aiBaseUrl(connection: ProviderConnectionSettings): string {
  return `${CLOUDFLARE_API_ROOT}/${normalizedAccountId(connection)}/ai`
}

function chatBaseUrl(connection: ProviderConnectionSettings): string {
  const accountId = connection.accountId?.trim().toLowerCase() ?? ''
  const safeAccountId = CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId) ? accountId : '__missing__'
  return `${CLOUDFLARE_API_ROOT}/${safeAccountId}/ai/v1`
}

function propertyBoolean(
  properties: ReadonlyArray<{ property_id: string; value: unknown }> | undefined,
  propertyId: string,
): boolean | undefined {
  const value = properties?.find((property) => property.property_id === propertyId)?.value
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function isCloudflareHostedTextModel(model: {
  source?: number | string
  name: string
  task: { name: string }
}): boolean {
  return (
    Number(model.source) === CLOUDFLARE_HOSTED_SOURCE_ID &&
    model.name.startsWith(CLOUDFLARE_MODEL_PREFIX) &&
    model.task.name === 'Text Generation'
  )
}

function toModelEntry(model: {
  name: string
  properties?: ReadonlyArray<{ property_id: string; value: unknown }>
}): ModelCatalogEntry {
  return {
    id: model.name,
    displayName: model.name,
    capabilities: {
      supportsVision: propertyBoolean(model.properties, 'vision'),
      supportsReasoning: propertyBoolean(model.properties, 'reasoning'),
      supportsToolCalling: propertyBoolean(model.properties, 'function_calling'),
    },
  }
}

export const cloudflareProvider: ProviderDefinition = {
  profile: {
    id: 'cloudflare',
    displayName: 'Cloudflare Workers AI',
    requiresApiKey: true,
    modelsRequireApiKey: true,
    requiresAccountId: true,
  },
  chat: {
    baseUrl: 'https://api.cloudflare.com',
    path: '/chat/completions',
    singleLeadingSystemMessage: true,
    resolveBaseUrl: chatBaseUrl,
  },
  normalizeAccountId: (accountId) => {
    const normalized = accountId.trim().toLowerCase()
    return CLOUDFLARE_ACCOUNT_ID_PATTERN.test(normalized) ? normalized : ''
  },
  fetchModels: async (http, apiKey, connection = {}) => {
    if (!apiKey.trim()) {
      throw new ModelFetchError('auth', 'Cloudflare Workers AI: API token is missing.')
    }
    const models: ModelCatalogEntry[] = []
    const baseUrl = aiBaseUrl(connection)
    try {
      for (let page = 1; page <= MAX_MODEL_PAGES; page += 1) {
        const response = await http.get(`${baseUrl}/models/search`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          params: {
            source: CLOUDFLARE_HOSTED_SOURCE_ID,
            task: 'Text Generation',
            hide_experimental: true,
            include_deprecated: false,
            page,
            per_page: MODEL_PAGE_SIZE,
          },
        })
        const parsed = CloudflareModelsResponseSchema.parse(response.data)
        if (!parsed.success) {
          throw new ModelFetchError(
            'invalid_response',
            'Cloudflare Workers AI model catalog returned success=false.',
          )
        }
        const pageModels = parsed.result.filter(isCloudflareHostedTextModel).map(toModelEntry)
        models.push(...pageModels)

        const resultInfo = parsed.result_info
        const reachedTotal =
          resultInfo?.total_count !== undefined && models.length >= resultInfo.total_count
        if (parsed.result.length === 0 || parsed.result.length < MODEL_PAGE_SIZE || reachedTotal)
          break
      }
      return models
    } catch (error) {
      if (error instanceof ModelFetchError) throw error
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new ModelFetchError('auth', 'Cloudflare Workers AI: authentication failed.')
        }
        if (error.response?.status === 403) {
          throw new ModelFetchError('access', 'Cloudflare Workers AI: account access was denied.')
        }
        if (error.response) {
          throw new ModelFetchError(
            'invalid_response',
            `Cloudflare Workers AI models error ${error.response.status}`,
          )
        }
        throw new ModelFetchError(
          'network',
          'Could not load the Cloudflare Workers AI model catalog.',
        )
      }
      throw new ModelFetchError(
        'invalid_response',
        'Cloudflare Workers AI returned an invalid model catalog.',
      )
    }
  },
}
