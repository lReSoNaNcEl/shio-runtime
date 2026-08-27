import {
  ActionButton,
  Menu,
  MenuItem,
  MenuTrigger,
  SearchField,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown'
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight'
import Copy from '@react-spectrum/s2/icons/Copy'
import Erase from '@react-spectrum/s2/icons/Erase'
import Filter from '@react-spectrum/s2/icons/Filter'
import Pause from '@react-spectrum/s2/icons/Pause'
import Play from '@react-spectrum/s2/icons/Play'

import {
  type NetworkBodyDiagnostic,
  type NetworkHeaderDiagnostic,
  type NetworkRequestDiagnostic,
  type NetworkRequestDiagnosticDetails,
  type NetworkRequestOutcome,
  type NetworkRequestSource,
} from '../../../shared/diagnostics'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

export function NetworkDiagnostics({
  search,
  onSearchChange,
  source,
  sources,
  onSourceChange,
  paused,
  onTogglePause,
  onClear,
  allRequests,
  requests,
  expandedRequestId,
  onToggleRequest,
  details,
  detailState,
  onCopy,
}: {
  search: string
  onSearchChange(value: string): void
  source: NetworkRequestSource | ''
  sources: readonly NetworkRequestSource[]
  onSourceChange(value: NetworkRequestSource | ''): void
  paused: boolean
  onTogglePause(): void
  onClear(): void
  allRequests: readonly NetworkRequestDiagnostic[]
  requests: readonly NetworkRequestDiagnostic[]
  expandedRequestId: string | null
  onToggleRequest(id: string): void
  details: NetworkRequestDiagnosticDetails | null
  detailState: 'loading' | 'ready' | 'missing' | 'failed'
  onCopy(value: unknown): Promise<void>
}) {
  const { t } = useTranslation()
  const sourceLabel = (value: NetworkRequestSource): string =>
    t(`diagnostics.network.source.${value}`)
  const outcomeLabel = (value: NetworkRequestOutcome): string =>
    t(`diagnostics.network.outcome.${value}`)

  return (
    <div className="diagnostics-network">
      <div className="diagnostics-toolbar diagnostics-network-toolbar">
        <SearchField
          aria-label={t('diagnostics.network.searchPlaceholder')}
          value={search}
          onChange={onSearchChange}
          placeholder={t('diagnostics.network.searchPlaceholder')}
          size="M"
          UNSAFE_className="diagnostics-search"
        />
        <MenuTrigger>
          <ActionButton
            aria-label={t('diagnostics.network.source')}
            UNSAFE_className="diagnostics-domain-trigger"
          >
            <Filter />
            <Text>{source ? sourceLabel(source) : t('diagnostics.network.allSources')}</Text>
            <ChevronDown />
          </ActionButton>
          <Menu
            aria-label={t('diagnostics.network.source')}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[source || '__all__']}
            onSelectionChange={(keys) => {
              if (keys === 'all') return
              const [key] = keys
              onSourceChange(key === '__all__' ? '' : (String(key) as NetworkRequestSource))
            }}
          >
            <MenuItem id="__all__">{t('diagnostics.network.allSources')}</MenuItem>
            {sources.map((item) => (
              <MenuItem id={item} key={item}>
                {sourceLabel(item)}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        <div className="diagnostics-toolbar-actions diagnostics-network-actions">
          <StatusLight variant={paused ? 'notice' : 'positive'} size="S">
            {t(paused ? 'diagnostics.stream.paused' : 'diagnostics.stream.live')}
          </StatusLight>
          <Text UNSAFE_className="diagnostics-result-count">
            {t('diagnostics.results', { count: requests.length, total: allRequests.length })}
          </Text>
          <ActionButton
            aria-label={t(paused ? 'diagnostics.events.resume' : 'diagnostics.events.pause')}
            aria-pressed={paused}
            onPress={onTogglePause}
            UNSAFE_className={
              paused
                ? 'diagnostics-toolbar-action diagnostics-toolbar-action-active'
                : 'diagnostics-toolbar-action'
            }
          >
            {paused ? <Play /> : <Pause />}
            <Text>{t(paused ? 'diagnostics.events.resume' : 'diagnostics.events.pause')}</Text>
          </ActionButton>
          <ActionButton
            aria-label={t('diagnostics.events.clear')}
            onPress={onClear}
            UNSAFE_className="diagnostics-toolbar-action"
          >
            <Erase />
            <Text>{t('diagnostics.events.clear')}</Text>
          </ActionButton>
        </div>
      </div>
      <Text UNSAFE_className="diagnostics-network-privacy">
        {t('diagnostics.network.safeMetadata')}
      </Text>
      <div className="diagnostics-network-table">
        <div className="diagnostics-network-header">
          <span>{t('diagnostics.events.time')}</span>
          <span>{t('diagnostics.network.source')}</span>
          <span>{t('diagnostics.network.method')}</span>
          <span>{t('diagnostics.network.target')}</span>
          <span>{t('diagnostics.network.status')}</span>
          <span>{t('diagnostics.network.duration')}</span>
        </div>
        {requests.map((request) => (
          <div className="diagnostics-network-entry" key={request.id}>
            <ActionButton
              UNSAFE_className="diagnostics-network-row"
              aria-expanded={expandedRequestId === request.id}
              aria-controls={`network-details-${request.id}`}
              onPress={() => onToggleRequest(request.id)}
            >
              <span>{formatTime(request.startedAt)}</span>
              <span>{sourceLabel(request.source)}</span>
              <strong>{request.method}</strong>
              <span className="diagnostics-row-primary" title={request.target}>
                {expandedRequestId === request.id ? <ChevronDown /> : <ChevronRight />}
                <span>{request.target}</span>
              </span>
              <StatusLight variant={networkOutcomeTone(request.outcome)} size="S">
                {request.status ?? outcomeLabel(request.outcome)}
              </StatusLight>
              <span>
                {request.durationMs === undefined
                  ? t('diagnostics.network.pendingDuration')
                  : `${request.durationMs} ms`}
              </span>
            </ActionButton>
            {expandedRequestId === request.id && (
              <div className="diagnostics-network-detail" id={`network-details-${request.id}`}>
                <NetworkRequestDetailPanel
                  details={details}
                  state={detailState}
                  onCopy={() => observeRendererPromise(onCopy(details), 'copy network diagnostics')}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {allRequests.length === 0 && (
        <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.network.empty')}</Text>
      )}
      {allRequests.length > 0 && requests.length === 0 && (
        <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.network.noMatches')}</Text>
      )}
    </div>
  )
}

function NetworkRequestDetailPanel({
  details,
  state,
  onCopy,
}: {
  details: NetworkRequestDiagnosticDetails | null
  state: 'loading' | 'ready' | 'missing' | 'failed'
  onCopy: () => void
}) {
  const { t } = useTranslation()
  if (state === 'loading') {
    return (
      <Text UNSAFE_className="diagnostics-network-detail-state">
        {t('diagnostics.network.detail.loading')}
      </Text>
    )
  }
  if (state === 'missing' || state === 'failed' || !details) {
    return (
      <StatusLight
        variant={state === 'failed' ? 'negative' : 'notice'}
        size="S"
        UNSAFE_className="diagnostics-network-detail-state"
      >
        {t(
          state === 'failed'
            ? 'diagnostics.network.detail.failed'
            : 'diagnostics.network.detail.unavailable',
        )}
      </StatusLight>
    )
  }
  return (
    <div className="diagnostics-network-detail-ready">
      <div className="diagnostics-detail-actions">
        <ActionButton onPress={onCopy}>
          <Copy />
          <Text>{t('diagnostics.copy.request')}</Text>
        </ActionButton>
      </div>
      <div className="diagnostics-network-detail-grid">
        <NetworkExchangeDetail
          title={t('diagnostics.network.detail.request')}
          headers={details.requestHeaders}
          body={details.requestBody}
        />
        <NetworkExchangeDetail
          title={t('diagnostics.network.detail.response')}
          headers={details.responseHeaders}
          body={details.responseBody}
        />
      </div>
    </div>
  )
}

function NetworkExchangeDetail({
  title,
  headers,
  body,
}: {
  title: string
  headers: NetworkHeaderDiagnostic[]
  body: NetworkBodyDiagnostic
}) {
  const { t } = useTranslation()
  const metadata = [
    body.contentType,
    body.byteLength === undefined
      ? undefined
      : t('diagnostics.network.detail.bytes', { count: body.byteLength }),
    body.truncated ? t('diagnostics.network.detail.truncated') : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const bodyText = body.text ?? t(`diagnostics.network.detail.body.${body.kind}`)
  return (
    <section className="diagnostics-network-detail-column">
      <Text UNSAFE_className="diagnostics-network-detail-title">{title}</Text>
      <div className="diagnostics-network-detail-block">
        <Text UNSAFE_className="diagnostics-network-detail-label">
          {t('diagnostics.network.detail.headers')}
        </Text>
        <pre className="diagnostics-network-detail-content">
          {formatNetworkHeaders(headers, t('diagnostics.network.detail.noHeaders'))}
        </pre>
      </div>
      <div className="diagnostics-network-detail-block">
        <div className="diagnostics-network-detail-body-heading">
          <Text UNSAFE_className="diagnostics-network-detail-label">
            {t('diagnostics.network.detail.body')}
          </Text>
          {metadata && <Text UNSAFE_className="diagnostics-network-detail-meta">{metadata}</Text>}
        </div>
        <pre className="diagnostics-network-detail-content diagnostics-network-detail-body">
          {bodyText}
        </pre>
      </div>
    </section>
  )
}

function formatNetworkHeaders(headers: NetworkHeaderDiagnostic[], emptyLabel: string): string {
  if (headers.length === 0) return emptyLabel
  return headers.map((header) => `${header.name}: ${header.value}`).join('\n')
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function networkOutcomeTone(
  outcome: NetworkRequestOutcome,
): 'informative' | 'positive' | 'negative' | 'notice' | 'neutral' {
  switch (outcome) {
    case 'pending':
      return 'informative'
    case 'success':
      return 'positive'
    case 'timeout':
      return 'notice'
    case 'failure':
      return 'negative'
    case 'cancelled':
      return 'neutral'
  }
}
