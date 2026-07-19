import { ActionButton, Menu, MenuItem, MenuTrigger, SearchField, Text } from '@react-spectrum/s2'
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown'
import Erase from '@react-spectrum/s2/icons/Erase'
import Filter from '@react-spectrum/s2/icons/Filter'
import Pause from '@react-spectrum/s2/icons/Pause'
import Play from '@react-spectrum/s2/icons/Play'
import type * as React from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { RuntimeDebugSnapshot, RuntimeTimelineEvent } from '../../Controller'
import { controller } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'

type DiagnosticsTab = 'events' | 'snapshot'

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
  conversationSpeech: ['speechTimeline', 'ttsLatencyMs', 'ttsCache'],
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
  embodiment: ['lipsyncWeights', 'facial', 'lookAt', 'headMotion', 'earBehavior', 'performance'],
  invariants: ['runtimeHealth'],
} as const

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
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

function SnapshotValue({ value }: { value: unknown }): React.JSX.Element {
  const { t } = useTranslation()
  if (value === null || value === undefined) return <span>{t('common.none')}</span>
  if (typeof value === 'boolean') return <span>{value ? t('common.yes') : t('common.no')}</span>
  if (typeof value === 'object')
    return <pre className="diagnostics-json">{JSON.stringify(value, null, 2)}</pre>
  return <span>{String(value)}</span>
}

export function DiagnosticsView(): React.JSX.Element {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<RuntimeDebugSnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>('events')
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('')
  const [pausedEvents, setPausedEvents] = useState<DisplayEvent[] | null>(null)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set())
  const [clearedEventIds, setClearedEventIds] = useState<Set<string>>(() => new Set())
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
    const refresh = (): void => {
      void controller.getRuntimeDebug().then((next) => {
        if (active) setSnapshot(next)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 500)
    return () => {
      active = false
      window.clearInterval(timer)
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

  useEffect(() => {
    if (domain && !domains.includes(domain)) setDomain('')
  }, [domain, domains])

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

  return (
    <section className="diagnostics-view">
      <div className="diagnostics-tabs" role="tablist" aria-label={t('app.nav.diagnostics')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'events'}
          className={activeTab === 'events' ? 'active' : undefined}
          onClick={() => setActiveTab('events')}
        >
          {t('diagnostics.tabs.events')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'snapshot'}
          className={activeTab === 'snapshot' ? 'active' : undefined}
          onClick={() => setActiveTab('snapshot')}
        >
          {t('diagnostics.tabs.snapshot')}
        </button>
      </div>

      {activeTab === 'events' ? (
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
                <button
                  type="button"
                  className="diagnostics-event-row"
                  aria-expanded={expandedEvents.has(event.id)}
                  onClick={() => toggleEvent(event.id)}
                >
                  <span>{formatTime(event.time)}</span>
                  <span>{event.domain}</span>
                  <strong>{event.name}</strong>
                  <span>{event.summary}</span>
                </button>
                {expandedEvents.has(event.id) && (
                  <pre className="diagnostics-json">{JSON.stringify(event.payload, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
          {visibleEvents.length === 0 && (
            <p className="diagnostics-empty">{t('diagnostics.events.empty')}</p>
          )}
          {visibleEvents.length > 0 && filteredEvents.length === 0 && (
            <p className="diagnostics-empty">{t('diagnostics.events.noMatches')}</p>
          )}
        </div>
      ) : (
        <div className="diagnostics-snapshot">
          {snapshotSections.map((section) => {
            const collapsed = collapsedSections.has(section.id)
            return (
              <section className="diagnostics-snapshot-section" key={section.id}>
                <button
                  type="button"
                  className="diagnostics-snapshot-heading"
                  aria-expanded={!collapsed}
                  onClick={() => toggleSection(section.id)}
                >
                  <strong>{section.title}</strong>
                  <span>
                    {t('diagnostics.snapshot.fieldCount', { count: section.fields.length })}
                  </span>
                </button>
                {!collapsed && (
                  <div className="diagnostics-snapshot-fields">
                    {section.fields.map((field) => (
                      <div className="diagnostics-snapshot-field" key={field.label}>
                        <span>{field.label}</span>
                        <SnapshotValue value={field.value} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
