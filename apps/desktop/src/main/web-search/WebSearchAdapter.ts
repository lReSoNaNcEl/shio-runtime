import type { WebSearchInput, WebSearchResult, WebSearchStatus } from '../../shared/web-search'

export interface WebSearchAdapter {
  status(): WebSearchStatus
  search(input: WebSearchInput, signal?: AbortSignal): Promise<WebSearchResult>
}
