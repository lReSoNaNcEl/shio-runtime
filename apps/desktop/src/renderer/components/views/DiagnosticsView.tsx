import { Tab, TabList, TabPanel, Tabs } from '@react-spectrum/s2'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  type NetworkRequestDiagnostic,
  type NetworkRequestDiagnosticDetails,
  type NetworkRequestSource,
} from '../../../shared/diagnostics'
import { type LatencySnapshot } from '../../../shared/latency'
import { controller, type RuntimeDebugSnapshot, type RuntimeTimelineEvent } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { type DiagnosticsDisplayEvent, EventsDiagnostics } from '../diagnostics/EventsDiagnostics'
import { LatencyDiagnostics } from '../diagnostics/LatencyDiagnostics'
import { NetworkDiagnostics } from '../diagnostics/NetworkDiagnostics'
import {
  type DiagnosticsSnapshotSection,
  RuntimeSnapshotDiagnostics,
} from '../diagnostics/RuntimeSnapshotDiagnostics'
import { StreamingDiagnostics } from '../diagnostics/StreamingDiagnostics'
import { SystemDiagnostics } from '../diagnostics/SystemDiagnostics'

type DiagnosticsTab = 'events' | 'network' | 'latency' | 'snapshot' | 'system' | 'streaming'

interface SnapshotField {
  label: string
  value: unknown
}

const MAX_VISIBLE_EVENTS = 500

const SNAPSHOT_GROUPS = {
  character: ['appStatus', 'characterState', 'emotionKey', 'avatarEmotion'],
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
    'model2d',
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

function timelineEvent(event: RuntimeTimelineEvent): DiagnosticsDisplayEvent {
  return {
    id: `timeline:${event.id}`,
    time: event.at,
    domain: 'system',
    name: event.label,
    summary: event.detail ?? '',
    payload: event,
  }
}

function collectEvents(snapshot: RuntimeDebugSnapshot | null): DiagnosticsDisplayEvent[] {
  if (!snapshot) return []
  const runtimeEvents: DiagnosticsDisplayEvent[] = snapshot.eventHistory.map((event) => ({
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

export function DiagnosticsView() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<RuntimeDebugSnapshot | null>(null)
  const [networkRequests, setNetworkRequests] = useState<NetworkRequestDiagnostic[]>([])
  const [latency, setLatency] = useState<LatencySnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>('events')
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('')
  const [pausedEvents, setPausedEvents] = useState<DiagnosticsDisplayEvent[] | null>(null)
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

  const snapshotSections = useMemo<DiagnosticsSnapshotSection[]>(() => {
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
          if (
            key === 'network' ||
            key === 'latency' ||
            key === 'snapshot' ||
            key === 'system' ||
            key === 'streaming'
          ) {
            setActiveTab(key)
          } else setActiveTab('events')
        }}
      >
        <TabList UNSAFE_className="diagnostics-tabs">
          <Tab id="events">{t('diagnostics.tabs.events')}</Tab>
          <Tab id="network">{t('diagnostics.tabs.network')}</Tab>
          <Tab id="latency">{t('diagnostics.tabs.latency')}</Tab>
          <Tab id="snapshot">{t('diagnostics.tabs.snapshot')}</Tab>
          <Tab id="system">{t('diagnostics.tabs.system')}</Tab>
          <Tab id="streaming">{t('diagnostics.tabs.streaming')}</Tab>
        </TabList>
        <TabPanel id="events">
          <EventsDiagnostics
            search={search}
            onSearchChange={setSearch}
            domain={domain}
            domains={domains}
            onDomainChange={setDomain}
            paused={pausedEvents !== null}
            onTogglePause={() =>
              setPausedEvents((current) => (current === null ? [...currentEvents] : null))
            }
            onClear={clearView}
            currentCount={filteredEvents.length}
            totalCount={visibleEvents.length}
            events={filteredEvents}
            expanded={expandedEvents}
            onToggleEvent={toggleEvent}
            onCopy={copyDiagnostic}
          />
        </TabPanel>
        <TabPanel id="network">
          <NetworkDiagnostics
            search={networkSearch}
            onSearchChange={setNetworkSearch}
            source={networkSource}
            sources={networkSources}
            onSourceChange={setNetworkSource}
            paused={pausedNetworkRequests !== null}
            onTogglePause={() =>
              setPausedNetworkRequests((current) =>
                current === null ? [...networkRequests] : null,
              )
            }
            onClear={clearNetworkView}
            allRequests={visibleNetworkRequests}
            requests={filteredNetworkRequests}
            expandedRequestId={expandedNetworkRequestId}
            onToggleRequest={toggleNetworkRequest}
            details={networkRequestDetails}
            detailState={networkRequestDetailState}
            onCopy={copyDiagnostic}
          />
        </TabPanel>
        <TabPanel id="latency">
          <LatencyDiagnostics latency={latency} />
        </TabPanel>
        <TabPanel id="snapshot">
          <RuntimeSnapshotDiagnostics
            snapshot={snapshot}
            sections={snapshotSections}
            collapsed={collapsedSections}
            onToggleSection={toggleSection}
            onCopy={copyDiagnostic}
          />
        </TabPanel>
        <TabPanel id="system">
          <SystemDiagnostics />
        </TabPanel>
        <TabPanel id="streaming">
          <StreamingDiagnostics snapshot={snapshot} />
        </TabPanel>
      </Tabs>
    </section>
  )
}
