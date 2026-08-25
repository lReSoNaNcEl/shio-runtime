import { z } from 'zod'

export const WEB_SEARCH_FRESHNESS_VALUES = ['day', 'week', 'month', 'year'] as const
export type WebSearchFreshness = (typeof WEB_SEARCH_FRESHNESS_VALUES)[number]

export interface WebSearchInput {
  query: string
  freshness?: WebSearchFreshness
  domains?: readonly string[]
  limit?: number
}

export interface WebSearchResultItem {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
  source?: string
}

export interface WebSearchResult {
  results: readonly WebSearchResultItem[]
  truncated: boolean
  provider: string
}

export type WebSearchStatus =
  | { availability: 'available' }
  | { availability: 'needs-setup'; reason: 'missing-credential' }
  | { availability: 'unavailable'; reason: 'adapter-unavailable' }

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform(
    (value) =>
      value
        .toLocaleLowerCase()
        .replace(/^https?:\/\//u, '')
        .split('/')[0],
  )
  .pipe(
    z
      .string()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u),
  )

export const webSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    freshness: z.enum(WEB_SEARCH_FRESHNESS_VALUES).optional(),
    domains: z.array(domainSchema).max(8).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict()
