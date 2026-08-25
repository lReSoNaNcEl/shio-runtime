import {
  ActionButton,
  Menu,
  MenuItem,
  MenuTrigger,
  SearchField,
  StatusLight,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from '@react-spectrum/s2'
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown'
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight'
import Copy from '@react-spectrum/s2/icons/Copy'
import Erase from '@react-spectrum/s2/icons/Erase'
import Filter from '@react-spectrum/s2/icons/Filter'
import Pause from '@react-spectrum/s2/icons/Pause'
import Play from '@react-spectrum/s2/icons/Play'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  type NetworkBodyDiagnostic,
  type NetworkHeaderDiagnostic,
  type NetworkRequestDiagnostic,
  type NetworkRequestDiagnosticDetails,
  type NetworkRequestOutcome,
  type NetworkRequestSource,
} from '../../../shared/diagnostics'
import { type LatencySnapshot } from '../../../shared/latency'
import { controller, type RuntimeDebugSnapshot, type RuntimeTimelineEvent } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

type DiagnosticsTab = 'events' | 'network' | 'latency' | 'snapshot'

interface DisplayEvent {
  id: string
  time: number
  domain: string
  name: string
  summary: string
  payload: unknown
}

interface SnapshotField {
  label: string
  value: unknown
}

interface SnapshotSection {
  id: string
  title: string
  fields: SnapshotField[]
}

const MAX_VISIBLE_EVENTS = 500

const SNAPSHOT_GROUPS = {
  character: ['appStatus', 'characterState', 'emotionKey', 'vrmEmotion'],
  conversationSpeech: ['speechTimeline', 'speechPolish', 'ttsLatencyMs', 'ttsCache'],
  avatarPlayback: [
    'avatarMode',
    'currentBodyAnimation',
    'currentBodyAnimationFile',
    'currentBodyAnimationLoop',
    'currentBodyAnimationStatus',
    'previousBodyAnimation',
    'activeTransitionPolicy',
    'activeBlendDuration',
    'behaviorEngine',
    'currentBehaviorId',
    'behaviorSelectionReason',
    'selectedBehaviorAnimation',
    'currentGesture',
    'idleOrchestrator',
  ],
  queueOwnership: [
    'bodyActions',
    'animationAssetCache',
    'animationQueue',
    'speakingGestureScheduler',
    'currentBehaviorCandidates',
    'activeAnimationCooldowns',
    'playbackRequests',
    'controllers',
    'behaviorTimeline',
  ],
  embodiment: [
    'lipsyncWeights',
    'facial',
    'lookAt',
    'headMotion',
    'earBehavior',
    'tailBehavior',
    'performance',
  ],
  invariants: ['avatarRuntimeHealth', 'runtimeHealth'],
} as const

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

function timelineEvent(event: RuntimeTimelineEvent): DisplayEvent {
  return {
    id: `timeline:${event.id}`,
    time: event.at,
    domain: 'system',
    name: event.label,
    summary: event.detail ?? '',
    payload: event,
  }
}

function collectEvents(snapshot: RuntimeDebugSnapshot | null): DisplayEvent[] {
  if (!snapshot) return []
  const runtimeEvents: DisplayEvent[] = snapshot.eventHistory.map((event) => ({
    id: `event:${event.id}`,
    time: event.occurredAt,
    domain: event.category,
    name: event.type,
    summary: event.detail ?? event.source,
    payload: event,
  }))
  return [...runtimeEvents, ...snapshot.timeline.map(timelineEvent)]
    .sort((left, right) => right.time - left.time)
    .slice(0, MAX_VISIBLE_EVENTS)
}

function humanizeFieldName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
}

function fieldsFor(snapshot: RuntimeDebugSnapshot, keys: readonly string[]): SnapshotField[] {
  const record = snapshot as unknown as Record<string, unknown>
  return keys.map((key) => ({ label: humanizeFieldName(key), value: record[key] }))
}

function SnapshotValue({ value }: { value: unknown }) {
  const { t } = useTranslation()
  if (value === null || value === undefined) return <span>{t('common.none')}</span>
  if (typeof value === 'boolean') return <span>{value ? t('common.yes') : t('common.no')}</span>
  if (typeof value === 'object')
    return <pre className="diagnostics-json">{JSON.stringify(value, null, 2)}</pre>
  return <span>{String(value)}</span>
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
        {state === 'failed'
          ? t('diagnostics.network.detail.failed')
          : t('diagnostics.network.detail.unavailable')}
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

export function DiagnosticsView() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<RuntimeDebugSnapshot | null>(null)
  const [networkRequests, setNetworkRequests] = useState<NetworkRequestDiagnostic[]>([])
  const [latency, setLatency] = useState<LatencySnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>('events')
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('')
  const [pausedEvents, setPausedEvents] = useState<DisplayEvent[] | null>(null)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set())
  const [clearedEventIds, setClearedEventIds] = useState<Set<string>>(() => new Set())
  const [networkSearch, setNetworkSearch] = useState('')
  const [networkSource, setNetworkSource] = useState<NetworkRequestSource | ''>('')
  const [pausedNetworkRequests, setPausedNetworkRequests] = useState<
    NetworkRequestDiagnostic[] | null
  >(null)
  const [clearedNetworkRequestIds, setClearedNetworkRequestIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [expandedNetworkRequestId, setExpandedNetworkRequestId] = useState<string | null>(null)
  const [networkRequestDetails, setNetworkRequestDetails] =
    useState<NetworkRequestDiagnosticDetails | null>(null)
  const [networkRequestDetailState, setNetworkRequestDetailState] = useState<
    'loading' | 'ready' | 'missing' | 'failed'
  >('missing')
  const networkDetailRequestVersion = useRef(0)
  const [copyNotice, setCopyNotice] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () =>
      new Set([
        'conversationSpeech',
        'avatarPlayback',
        'queueOwnership',
        'embodiment',
        'invariants',
        'other',
      ]),
  )

  useEffect(() => {
    let active = true
    let networkRefreshInFlight = false
    const refresh = (): void => {
      observeRendererPromise(
        controller.getRuntimeDebug().then((nextSnapshot) => {
          if (active) setSnapshot(nextSnapshot)
        }),
        'refresh Runtime diagnostics',
      )
      if (networkRefreshInFlight) return
      networkRefreshInFlight = true
      observeRendererPromise(
        window.api.diagnostics
          .getNetworkRequests()
          .then((nextNetworkRequests) => {
            if (active) setNetworkRequests(nextNetworkRequests)
          })
          .finally(() => {
            networkRefreshInFlight = false
          }),
        'refresh network diagnostics',
      )
    }
    refresh()
    const timer = window.setInterval(refresh, 500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(
    () => () => {
      networkDetailRequestVersion.current += 1
    },
    [],
  )

  useEffect(() => {
    let active = true
    observeRendererPromise(
      window.api.latency.snapshot().then((next) => {
        if (active) setLatency(next)
      }),
      'load latency diagnostics',
    )
    const unsubscribe = window.api.latency.onChanged((next) => {
      if (active) setLatency(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const currentEvents = useMemo(() => collectEvents(snapshot), [snapshot])
  const presentedEvents = pausedEvents ?? currentEvents
  const visibleEvents = useMemo(
    () => presentedEvents.filter((event) => !clearedEventIds.has(event.id)),
    [clearedEventIds, presentedEvents],
  )
  const domains = useMemo(
    () => [...new Set(visibleEvents.map((event) => event.domain))].sort(),
    [visibleEvents],
  )
  const filteredEvents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return visibleEvents.filter((event) => {
      if (domain && event.domain !== domain) return false
      if (!query) return true
      return [event.name, event.domain, event.summary, JSON.stringify(event.payload)]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    })
  }, [domain, search, visibleEvents])

  const presentedNetworkRequests = pausedNetworkRequests ?? networkRequests
  const visibleNetworkRequests = useMemo(
    () => presentedNetworkRequests.filter((request) => !clearedNetworkRequestIds.has(request.id)),
    [clearedNetworkRequestIds, presentedNetworkRequests],
  )
  const networkSources = useMemo(
    () => [...new Set(visibleNetworkRequests.map((request) => request.source))].sort(),
    [visibleNetworkRequests],
  )
  const filteredNetworkRequests = useMemo(() => {
    const query = networkSearch.trim().toLocaleLowerCase()
    return visibleNetworkRequests.filter((request) => {
      if (networkSource && request.source !== networkSource) return false
      if (!query) return true
      return [request.source, request.method, request.target, request.outcome, request.status]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    })
  }, [networkSearch, networkSource, visibleNetworkRequests])

  useEffect(() => {
    if (domain && !domains.includes(domain)) setDomain('')
  }, [domain, domains])

  useEffect(() => {
    if (networkSource && !networkSources.includes(networkSource)) setNetworkSource('')
  }, [networkSource, networkSources])

  const snapshotSections = useMemo<SnapshotSection[]>(() => {
    if (!snapshot) return []
    const assigned = new Set<string>([
      'eventHistory',
      'timeline',
      ...Object.values(SNAPSHOT_GROUPS).flat(),
    ])
    const otherKeys = Object.keys(snapshot).filter((key) => !assigned.has(key))
    return [
      {
        id: 'character',
        title: t('diagnostics.snapshot.character'),
        fields: fieldsFor(snapshot, SNAPSHOT_GROUPS.character),
      },
      {
        id: 'conversationSpeech',
        title: t('diagnostics.snapshot.conversationSpeech'),
        fields: fieldsFor(snapshot, SNAPSHOT_GROUPS.conversationSpeech),
      },
      {
        id: 'avatarPlayback',
        title: t('diagnostics.snapshot.avatarPlayback'),
        fields: fieldsFor(snapshot, SNAPSHOT_GROUPS.avatarPlayback),
      },
      {
        id: 'queueOwnership',
        title: t('diagnostics.snapshot.queueOwnership'),
        fields: fieldsFor(snapshot, SNAPSHOT_GROUPS.queueOwnership),
      },
      {
        id: 'embodiment',
        title: t('diagnostics.snapshot.embodiment'),
        fields: fieldsFor(snapshot, SNAPSHOT_GROUPS.embodiment),
      },
      {
        id: 'invariants',
        title: t('diagnostics.snapshot.invariants'),
        fields: fieldsFor(snapshot, SNAPSHOT_GROUPS.invariants),
      },
      {
        id: 'other',
        title: t('diagnostics.snapshot.other'),
        fields: fieldsFor(snapshot, otherKeys),
      },
    ]
  }, [snapshot, t])

  const toggleEvent = (id: string): void => {
    setExpandedEvents((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSection = (id: string): void => {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearView = (): void => {
    setClearedEventIds((current) => {
      const next = new Set(current)
      for (const event of presentedEvents) next.add(event.id)
      return next
    })
    setExpandedEvents(new Set())
  }

  const clearNetworkView = (): void => {
    setClearedNetworkRequestIds((current) => {
      const next = new Set(current)
      for (const request of presentedNetworkRequests) next.add(request.id)
      return next
    })
    networkDetailRequestVersion.current += 1
    setExpandedNetworkRequestId(null)
    setNetworkRequestDetails(null)
    setNetworkRequestDetailState('missing')
  }

  const toggleNetworkRequest = (id: string): void => {
    if (expandedNetworkRequestId === id) {
      networkDetailRequestVersion.current += 1
      setExpandedNetworkRequestId(null)
      setNetworkRequestDetails(null)
      setNetworkRequestDetailState('missing')
      return
    }
    const requestVersion = ++networkDetailRequestVersion.current
    setExpandedNetworkRequestId(id)
    setNetworkRequestDetails(null)
    setNetworkRequestDetailState('loading')
    observeRendererPromise(
      window.api.diagnostics
        .getNetworkRequestDetails(id)
        .then((details) => {
          if (networkDetailRequestVersion.current !== requestVersion) return
          setNetworkRequestDetails(details)
          setNetworkRequestDetailState(details ? 'ready' : 'missing')
        })
        .catch((error: unknown) => {
          if (networkDetailRequestVersion.current !== requestVersion) return
          setNetworkRequestDetails(null)
          setNetworkRequestDetailState('failed')
          throw error
        }),
      'load network request details',
    )
  }

  const networkSourceLabel = (source: NetworkRequestSource): string =>
    t(`diagnostics.network.source.${source}`)

  const networkOutcomeLabel = (outcome: NetworkRequestOutcome): string =>
    t(`diagnostics.network.outcome.${outcome}`)

  const copyDiagnostic = async (value: unknown): Promise<void> => {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
    setCopyNotice(t('diagnostics.copy.copied'))
  }

  return (
    <section className="diagnostics-view page-container">
      <span className="visually-hidden" role="status" aria-live="polite">
        {copyNotice}
      </span>
      <Tabs
        aria-label={t('app.nav.diagnostics')}
        selectedKey={activeTab}
        onSelectionChange={(key) => {
          if (key === 'network' || key === 'latency' || key === 'snapshot') setActiveTab(key)
          else setActiveTab('events')
        }}
      >
        <TabList UNSAFE_className="diagnostics-tabs">
          <Tab id="events">{t('diagnostics.tabs.events')}</Tab>
          <Tab id="network">{t('diagnostics.tabs.network')}</Tab>
          <Tab id="latency">{t('diagnostics.tabs.latency')}</Tab>
          <Tab id="snapshot">{t('diagnostics.tabs.snapshot')}</Tab>
        </TabList>
        <TabPanel id="events">
          <div className="diagnostics-events">
            <div className="diagnostics-toolbar">
              <div className="diagnostics-toolbar-filters">
                <SearchField
                  aria-label={t('diagnostics.events.searchPlaceholder')}
                  value={search}
                  onChange={setSearch}
                  placeholder={t('diagnostics.events.searchPlaceholder')}
                  size="M"
                  UNSAFE_className="diagnostics-search"
                />
                <MenuTrigger>
                  <ActionButton
                    aria-label={t('diagnostics.events.domain')}
                    UNSAFE_className="diagnostics-domain-trigger"
                  >
                    <Filter />
                    <Text>{domain || t('diagnostics.events.allDomains')}</Text>
                    <ChevronDown />
                  </ActionButton>
                  <Menu
                    aria-label={t('diagnostics.events.domain')}
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[domain || '__all__']}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const [key] = keys
                      setDomain(key === '__all__' ? '' : String(key))
                    }}
                  >
                    <MenuItem id="__all__">{t('diagnostics.events.allDomains')}</MenuItem>
                    {domains.map((item) => (
                      <MenuItem key={item} id={item}>
                        {item}
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuTrigger>
              </div>
              <div className="diagnostics-toolbar-actions">
                <StatusLight variant={pausedEvents === null ? 'positive' : 'notice'} size="S">
                  {t(
                    pausedEvents === null ? 'diagnostics.stream.live' : 'diagnostics.stream.paused',
                  )}
                </StatusLight>
                <Text UNSAFE_className="diagnostics-result-count">
                  {t('diagnostics.results', {
                    count: filteredEvents.length,
                    total: visibleEvents.length,
                  })}
                </Text>
                <ActionButton
                  aria-label={
                    pausedEvents === null
                      ? t('diagnostics.events.pause')
                      : t('diagnostics.events.resume')
                  }
                  aria-pressed={pausedEvents !== null}
                  onPress={() =>
                    setPausedEvents((current) => (current === null ? [...currentEvents] : null))
                  }
                  UNSAFE_className={
                    pausedEvents === null
                      ? 'diagnostics-toolbar-action'
                      : 'diagnostics-toolbar-action diagnostics-toolbar-action-active'
                  }
                >
                  {pausedEvents === null ? <Pause /> : <Play />}
                  <Text>
                    {pausedEvents === null
                      ? t('diagnostics.events.pause')
                      : t('diagnostics.events.resume')}
                  </Text>
                </ActionButton>
                <ActionButton
                  aria-label={t('diagnostics.events.clear')}
                  onPress={clearView}
                  UNSAFE_className="diagnostics-toolbar-action"
                >
                  <Erase />
                  <Text>{t('diagnostics.events.clear')}</Text>
                </ActionButton>
              </div>
            </div>
            <div className="diagnostics-event-table">
              <div className="diagnostics-event-header">
                <span>{t('diagnostics.events.time')}</span>
                <span>{t('diagnostics.events.domain')}</span>
                <span>{t('diagnostics.events.event')}</span>
                <span>{t('diagnostics.events.summary')}</span>
              </div>
              {filteredEvents.map((event) => (
                <div className="diagnostics-event" key={event.id}>
                  <ActionButton
                    UNSAFE_className="diagnostics-event-row"
                    aria-expanded={expandedEvents.has(event.id)}
                    onPress={() => toggleEvent(event.id)}
                  >
                    <span>{formatTime(event.time)}</span>
                    <span>{event.domain}</span>
                    <span className="diagnostics-row-primary">
                      {expandedEvents.has(event.id) ? <ChevronDown /> : <ChevronRight />}
                      <strong>{event.name}</strong>
                    </span>
                    <span>{event.summary}</span>
                  </ActionButton>
                  {expandedEvents.has(event.id) && (
                    <div className="diagnostics-expanded-detail">
                      <div className="diagnostics-detail-actions">
                        <ActionButton
                          onPress={() =>
                            observeRendererPromise(
                              copyDiagnostic(event.payload),
                              'copy diagnostic event',
                            )
                          }
                        >
                          <Copy />
                          <Text>{t('diagnostics.copy.json')}</Text>
                        </ActionButton>
                      </div>
                      <pre className="diagnostics-json">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {visibleEvents.length === 0 && (
              <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.events.empty')}</Text>
            )}
            {visibleEvents.length > 0 && filteredEvents.length === 0 && (
              <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.events.noMatches')}</Text>
            )}
          </div>
        </TabPanel>
        <TabPanel id="network">
          <div className="diagnostics-network">
            <div className="diagnostics-toolbar diagnostics-network-toolbar">
              <SearchField
                aria-label={t('diagnostics.network.searchPlaceholder')}
                value={networkSearch}
                onChange={setNetworkSearch}
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
                  <Text>
                    {networkSource
                      ? networkSourceLabel(networkSource)
                      : t('diagnostics.network.allSources')}
                  </Text>
                  <ChevronDown />
                </ActionButton>
                <Menu
                  aria-label={t('diagnostics.network.source')}
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[networkSource || '__all__']}
                  onSelectionChange={(keys) => {
                    if (keys === 'all') return
                    const [key] = keys
                    setNetworkSource(key === '__all__' ? '' : (String(key) as NetworkRequestSource))
                  }}
                >
                  <MenuItem id="__all__">{t('diagnostics.network.allSources')}</MenuItem>
                  {networkSources.map((source) => (
                    <MenuItem id={source} key={source}>
                      {networkSourceLabel(source)}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
              <div className="diagnostics-toolbar-actions diagnostics-network-actions">
                <StatusLight
                  variant={pausedNetworkRequests === null ? 'positive' : 'notice'}
                  size="S"
                >
                  {t(
                    pausedNetworkRequests === null
                      ? 'diagnostics.stream.live'
                      : 'diagnostics.stream.paused',
                  )}
                </StatusLight>
                <Text UNSAFE_className="diagnostics-result-count">
                  {t('diagnostics.results', {
                    count: filteredNetworkRequests.length,
                    total: visibleNetworkRequests.length,
                  })}
                </Text>
                <ActionButton
                  aria-label={
                    pausedNetworkRequests === null
                      ? t('diagnostics.events.pause')
                      : t('diagnostics.events.resume')
                  }
                  aria-pressed={pausedNetworkRequests !== null}
                  onPress={() =>
                    setPausedNetworkRequests((current) =>
                      current === null ? [...networkRequests] : null,
                    )
                  }
                  UNSAFE_className={
                    pausedNetworkRequests === null
                      ? 'diagnostics-toolbar-action'
                      : 'diagnostics-toolbar-action diagnostics-toolbar-action-active'
                  }
                >
                  {pausedNetworkRequests === null ? <Pause /> : <Play />}
                  <Text>
                    {t(
                      pausedNetworkRequests === null
                        ? 'diagnostics.events.pause'
                        : 'diagnostics.events.resume',
                    )}
                  </Text>
                </ActionButton>
                <ActionButton
                  aria-label={t('diagnostics.events.clear')}
                  onPress={clearNetworkView}
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
              {filteredNetworkRequests.map((request) => (
                <div className="diagnostics-network-entry" key={request.id}>
                  <ActionButton
                    UNSAFE_className="diagnostics-network-row"
                    aria-expanded={expandedNetworkRequestId === request.id}
                    aria-controls={`network-details-${request.id}`}
                    onPress={() => toggleNetworkRequest(request.id)}
                  >
                    <span>{formatTime(request.startedAt)}</span>
                    <span>{networkSourceLabel(request.source)}</span>
                    <strong>{request.method}</strong>
                    <span className="diagnostics-row-primary" title={request.target}>
                      {expandedNetworkRequestId === request.id ? <ChevronDown /> : <ChevronRight />}
                      <span>{request.target}</span>
                    </span>
                    <StatusLight variant={networkOutcomeTone(request.outcome)} size="S">
                      {request.status ?? networkOutcomeLabel(request.outcome)}
                    </StatusLight>
                    <span>
                      {request.durationMs === undefined
                        ? t('diagnostics.network.pendingDuration')
                        : `${request.durationMs} ms`}
                    </span>
                  </ActionButton>
                  {expandedNetworkRequestId === request.id && (
                    <div
                      className="diagnostics-network-detail"
                      id={`network-details-${request.id}`}
                    >
                      <NetworkRequestDetailPanel
                        details={networkRequestDetails}
                        state={networkRequestDetailState}
                        onCopy={() =>
                          observeRendererPromise(
                            copyDiagnostic(networkRequestDetails),
                            'copy network diagnostics',
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {visibleNetworkRequests.length === 0 && (
              <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.network.empty')}</Text>
            )}
            {visibleNetworkRequests.length > 0 && filteredNetworkRequests.length === 0 && (
              <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.network.noMatches')}</Text>
            )}
          </div>
        </TabPanel>
        <TabPanel id="latency">
          <div className="diagnostics-latency">
            <Text UNSAFE_className="diagnostics-network-privacy">
              {t('diagnostics.latency.description')}
            </Text>
            <div className="diagnostics-latency-grid">
              {latency && Object.entries(latency.metrics).length > 0 ? (
                Object.entries(latency.metrics).map(([name, metric]) => (
                  <article className="diagnostics-latency-card" key={name}>
                    <Text UNSAFE_className="diagnostics-latency-title">{name}</Text>
                    <Text>
                      p50 {metric.p50Ms} ms · p95 {metric.p95Ms} ms · max {metric.maxMs} ms
                    </Text>
                    <Text>{t('diagnostics.latency.samples', { count: metric.count })}</Text>
                  </article>
                ))
              ) : (
                <Text>{t('diagnostics.latency.empty')}</Text>
              )}
            </div>
            <div className="diagnostics-latency-traces">
              {latency?.recentTraces.map((trace) => (
                <article className="diagnostics-latency-card" key={trace.turnId}>
                  <Text UNSAFE_className="diagnostics-latency-title">
                    {trace.turnId} · {trace.status ?? 'active'}
                  </Text>
                  <Text>
                    {trace.provider ?? '—'} · {trace.model ?? '—'} · {trace.milestones.length}{' '}
                    milestones
                  </Text>
                </article>
              ))}
            </div>
          </div>
        </TabPanel>
        <TabPanel id="snapshot">
          <div className="diagnostics-snapshot">
            <div className="diagnostics-snapshot-toolbar">
              <Text>{t('diagnostics.snapshot.technicalKeys')}</Text>
              <ActionButton
                isDisabled={!snapshot}
                onPress={() =>
                  observeRendererPromise(copyDiagnostic(snapshot), 'copy Runtime snapshot')
                }
              >
                <Copy />
                <Text>{t('diagnostics.copy.snapshot')}</Text>
              </ActionButton>
            </div>
            {snapshotSections.map((section) => {
              const collapsed = collapsedSections.has(section.id)
              return (
                <section className="diagnostics-snapshot-section" key={section.id}>
                  <ActionButton
                    UNSAFE_className="diagnostics-snapshot-heading"
                    aria-expanded={!collapsed}
                    onPress={() => toggleSection(section.id)}
                  >
                    <strong>{section.title}</strong>
                    <span>
                      {t('diagnostics.snapshot.fieldCount', { count: section.fields.length })}
                    </span>
                  </ActionButton>
                  {!collapsed && (
                    <div className="diagnostics-snapshot-fields">
                      {section.fields.map((field) => (
                        <div className="diagnostics-snapshot-field" key={field.label}>
                          <code>{field.label}</code>
                          <SnapshotValue value={field.value} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </TabPanel>
      </Tabs>
    </section>
  )
}
