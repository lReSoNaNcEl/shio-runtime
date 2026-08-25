import {
  type WebSearchInput,
  type WebSearchResult,
  type WebSearchStatus,
  webSearchInputSchema,
} from '../../shared/web-search'
import { mainLog } from '../logging/safeLogger'
import type { WebSearchAdapter } from './WebSearchAdapter'

/** Provider-neutral owner for bounded, read-only public web discovery. */
export class WebSearchRuntime {
  constructor(private readonly adapter: WebSearchAdapter | null) {}

  status(): WebSearchStatus {
    return (
      this.adapter?.status() ?? {
        availability: 'unavailable',
        reason: 'adapter-unavailable',
      }
    )
  }

  async search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult> {
    const request = webSearchInputSchema.parse(input)
    if (!this.adapter) throw new Error('WEB_SEARCH_ADAPTER_UNAVAILABLE')
    const result = await this.adapter.search(request, signal)
    mainLog.info('[WebSearchRuntime] search completed', {
      resultCount: result.results.length,
      truncated: result.truncated,
      provider: result.provider,
    })
    return result
  }
}
