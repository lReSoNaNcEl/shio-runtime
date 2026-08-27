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

import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

export interface DiagnosticsDisplayEvent {
  id: string
  time: number
  domain: string
  name: string
  summary: string
  payload: unknown
}

export function EventsDiagnostics({
  search,
  onSearchChange,
  domain,
  domains,
  onDomainChange,
  paused,
  onTogglePause,
  onClear,
  currentCount,
  totalCount,
  events,
  expanded,
  onToggleEvent,
  onCopy,
}: {
  search: string
  onSearchChange(value: string): void
  domain: string
  domains: readonly string[]
  onDomainChange(value: string): void
  paused: boolean
  onTogglePause(): void
  onClear(): void
  currentCount: number
  totalCount: number
  events: readonly DiagnosticsDisplayEvent[]
  expanded: ReadonlySet<string>
  onToggleEvent(id: string): void
  onCopy(value: unknown): Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <div className="diagnostics-events">
      <div className="diagnostics-toolbar">
        <div className="diagnostics-toolbar-filters">
          <SearchField
            aria-label={t('diagnostics.events.searchPlaceholder')}
            value={search}
            onChange={onSearchChange}
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
                onDomainChange(key === '__all__' ? '' : String(key))
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
          <StatusLight variant={paused ? 'notice' : 'positive'} size="S">
            {t(paused ? 'diagnostics.stream.paused' : 'diagnostics.stream.live')}
          </StatusLight>
          <Text UNSAFE_className="diagnostics-result-count">
            {t('diagnostics.results', { count: currentCount, total: totalCount })}
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
      <div className="diagnostics-event-table">
        <div className="diagnostics-event-header">
          <span>{t('diagnostics.events.time')}</span>
          <span>{t('diagnostics.events.domain')}</span>
          <span>{t('diagnostics.events.event')}</span>
          <span>{t('diagnostics.events.summary')}</span>
        </div>
        {events.map((event) => (
          <div className="diagnostics-event" key={event.id}>
            <ActionButton
              UNSAFE_className="diagnostics-event-row"
              aria-expanded={expanded.has(event.id)}
              onPress={() => onToggleEvent(event.id)}
            >
              <span>{formatTime(event.time)}</span>
              <span>{event.domain}</span>
              <span className="diagnostics-row-primary">
                {expanded.has(event.id) ? <ChevronDown /> : <ChevronRight />}
                <strong>{event.name}</strong>
              </span>
              <span>{event.summary}</span>
            </ActionButton>
            {expanded.has(event.id) && (
              <div className="diagnostics-expanded-detail">
                <div className="diagnostics-detail-actions">
                  <ActionButton
                    onPress={() =>
                      observeRendererPromise(onCopy(event.payload), 'copy diagnostic event')
                    }
                  >
                    <Copy />
                    <Text>{t('diagnostics.copy.json')}</Text>
                  </ActionButton>
                </div>
                <pre className="diagnostics-json">{JSON.stringify(event.payload, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
      {totalCount === 0 && (
        <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.events.empty')}</Text>
      )}
      {totalCount > 0 && currentCount === 0 && (
        <Text UNSAFE_className="diagnostics-empty">{t('diagnostics.events.noMatches')}</Text>
      )}
    </div>
  )
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
