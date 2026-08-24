import {
  Badge,
  Button,
  Content,
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Text,
  ToggleButton,
} from '@react-spectrum/s2'
import Chat from '@react-spectrum/s2/icons/Chat'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
import Project from '@react-spectrum/s2/icons/Project'
import RocketQuickActions from '@react-spectrum/s2/icons/RocketQuickActions'
import UserAvatar from '@react-spectrum/s2/icons/UserAvatar'
import { type ReactNode, useMemo, useState } from 'react'

import {
  type CapabilityAvailability,
  type CapabilityCategory,
  type CapabilityNavigationTarget,
  type ShioCapabilityDescriptor,
  type ShioCapabilitySnapshot,
} from '../../../shared/capabilities'
import { type TranslationKey } from '../../../shared/localization'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

type StatusTone = 'positive' | 'neutral' | 'notice' | 'negative'
type AvailabilityFilter = 'all' | 'available' | 'setup' | 'problems'

const STATUS: Record<CapabilityAvailability, { label: TranslationKey; tone: StatusTone }> = {
  available: { label: 'capabilities.availability.available', tone: 'positive' },
  disabled: { label: 'capabilities.availability.disabled', tone: 'neutral' },
  'needs-setup': { label: 'capabilities.availability.needsSetup', tone: 'notice' },
  degraded: { label: 'capabilities.availability.degraded', tone: 'notice' },
  unavailable: { label: 'capabilities.availability.unavailable', tone: 'negative' },
}

const FILTERS: Array<{ id: AvailabilityFilter; label: TranslationKey }> = [
  { id: 'all', label: 'capabilities.filter.all' },
  { id: 'available', label: 'capabilities.filter.available' },
  { id: 'setup', label: 'capabilities.filter.setup' },
  { id: 'problems', label: 'capabilities.filter.problems' },
]

const CATEGORIES: Array<{ id: CapabilityCategory; label: TranslationKey; icon: ReactNode }> = [
  { id: 'communication', label: 'capabilities.category.communication', icon: <Chat /> },
  { id: 'perception', label: 'capabilities.category.perception', icon: <DeviceDesktop /> },
  { id: 'knowledge', label: 'capabilities.category.knowledge', icon: <Project /> },
  { id: 'action', label: 'capabilities.category.action', icon: <RocketQuickActions /> },
  { id: 'presence', label: 'capabilities.category.presence', icon: <UserAvatar /> },
]

function matchesFilter(capability: ShioCapabilityDescriptor, filter: AvailabilityFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'available') return capability.availability === 'available'
  if (filter === 'setup') {
    return capability.availability === 'disabled' || capability.availability === 'needs-setup'
  }
  return capability.availability === 'degraded' || capability.availability === 'unavailable'
}

function actionLabel(
  target: CapabilityNavigationTarget,
  availability: CapabilityAvailability,
): TranslationKey {
  switch (target.kind) {
    case 'settings':
      return availability === 'available'
        ? 'capabilities.action.openSettings'
        : 'capabilities.action.configure'
    case 'plugin':
      return 'capabilities.action.openPlugin'
    case 'view':
      return 'capabilities.action.openView'
  }
}

function authorityLabel(capability: ShioCapabilityDescriptor): TranslationKey | null {
  if (capability.authority === 'read-only') return 'capabilities.authority.readOnly'
  if (capability.authority === 'confirm') return 'capabilities.authority.confirm'
  if (capability.authority === 'full') return 'capabilities.authority.full'
  return null
}

function CapabilityCard({
  capability,
  onNavigate,
}: {
  capability: ShioCapabilityDescriptor
  onNavigate: (target: CapabilityNavigationTarget) => void
}) {
  const { t } = useTranslation()
  const status = STATUS[capability.availability]
  const navigationTarget = capability.navigationTarget
  const authority = authorityLabel(capability)
  return (
    <article className={`capability-card capability-card-${capability.availability}`}>
      <div className="capability-card-heading">
        <Heading level={3}>{t(capability.titleKey)}</Heading>
        <StatusLight variant={status.tone} size="S">
          {t(status.label)}
        </StatusLight>
      </div>
      <Text UNSAFE_className="capability-description">{t(capability.descriptionKey)}</Text>
      {authority && (
        <Badge
          size="S"
          variant="gray"
          UNSAFE_className={`capability-authority capability-authority-${capability.authority}`}
        >
          {t(authority)}
        </Badge>
      )}
      {capability.reasonKey && (
        <Text UNSAFE_className="capability-reason">{t(capability.reasonKey)}</Text>
      )}
      {navigationTarget && (
        <Button
          size="S"
          variant={capability.availability === 'available' ? 'secondary' : 'accent'}
          onPress={() => onNavigate(navigationTarget)}
          UNSAFE_className={`capability-action${
            capability.availability === 'available' ? '' : ' shio-accent-button'
          }`}
        >
          {t(actionLabel(navigationTarget, capability.availability))}
        </Button>
      )}
    </article>
  )
}

export function CapabilitiesView({
  snapshot,
  error,
  onRefresh,
  onNavigate,
}: {
  snapshot: ShioCapabilitySnapshot | null
  error: string | null
  onRefresh: () => Promise<void>
  onNavigate: (target: CapabilityNavigationTarget) => void
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<AvailabilityFilter>('all')
  const counts = useMemo(() => {
    const capabilities = snapshot?.capabilities ?? []
    return Object.fromEntries(
      FILTERS.map(({ id }) => [id, capabilities.filter((item) => matchesFilter(item, id)).length]),
    ) as Record<AvailabilityFilter, number>
  }, [snapshot])
  const visibleCapabilities = useMemo(
    () => snapshot?.capabilities.filter((capability) => matchesFilter(capability, filter)) ?? [],
    [filter, snapshot],
  )
  const attentionCount = counts.setup + counts.problems

  if (!snapshot && !error) {
    return (
      <div className="capabilities-loading">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  return (
    <section className="capabilities-view page-container" aria-label={t('app.nav.capabilities')}>
      <Text>{t('capabilities.catalog.description')}</Text>
      {error && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
          <Button
            variant="secondary"
            onPress={() => observeRendererPromise(onRefresh(), 'refresh capability catalog')}
          >
            {t('common.retry')}
          </Button>
        </InlineAlert>
      )}
      {snapshot && attentionCount > 0 && filter === 'all' && (
        <InlineAlert variant="notice" fillStyle="subtleFill">
          <Heading>{t('capabilities.attention.title')}</Heading>
          <Content>{t('capabilities.attention.description', { count: attentionCount })}</Content>
        </InlineAlert>
      )}
      {snapshot && (
        <>
          <fieldset className="capabilities-summary">
            <legend className="visually-hidden">{t('capabilities.filter.label')}</legend>
            {FILTERS.map((item) => (
              <ToggleButton
                key={item.id}
                size="S"
                isSelected={filter === item.id}
                isEmphasized={filter === item.id}
                onChange={(selected) => {
                  if (selected) setFilter(item.id)
                }}
                UNSAFE_className="capabilities-filter"
              >
                {`${t(item.label)} · ${counts[item.id]}`}
              </ToggleButton>
            ))}
          </fieldset>
          {visibleCapabilities.length === 0 && (
            <div className="capabilities-empty">
              <Text>{t('capabilities.filter.empty')}</Text>
            </div>
          )}
          {CATEGORIES.map((category) => {
            const capabilities = visibleCapabilities.filter(
              (capability) => capability.category === category.id,
            )
            if (capabilities.length === 0) return null
            return (
              <section className="capability-group" key={category.id}>
                <div className="capability-group-heading">
                  <span className="capability-group-icon" aria-hidden="true">
                    {category.icon}
                  </span>
                  <Heading level={2}>{t(category.label)}</Heading>
                  <Badge size="S" variant="gray">
                    {capabilities.length}
                  </Badge>
                </div>
                <div className="capability-grid">
                  {capabilities.map((capability) => (
                    <CapabilityCard
                      capability={capability}
                      key={capability.id}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}
    </section>
  )
}
