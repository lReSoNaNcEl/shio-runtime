import {
  ActionButton,
  Badge,
  Button,
  Content,
  Heading,
  InlineAlert,
  ProgressCircle,
  Text,
  ToggleButton,
  ToggleButtonGroup,
} from '@react-spectrum/s2'
import AlertDiamond from '@react-spectrum/s2/icons/AlertDiamond'
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle'
import Chat from '@react-spectrum/s2/icons/Chat'
import Checkmark from '@react-spectrum/s2/icons/Checkmark'
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight'
import DeviceDesktop from '@react-spectrum/s2/icons/DeviceDesktop'
import Plugin from '@react-spectrum/s2/icons/Plugin'
import Project from '@react-spectrum/s2/icons/Project'
import RemoveCircle from '@react-spectrum/s2/icons/RemoveCircle'
import RocketQuickActions from '@react-spectrum/s2/icons/RocketQuickActions'
import UserAvatar from '@react-spectrum/s2/icons/UserAvatar'
import { type ReactNode, useId, useRef, useState } from 'react'

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
import { settingsSections } from '../settings/state/settingsContracts'

type StatusTone = 'neutral' | 'positive' | 'notice' | 'negative'
type AvailabilityFilter = 'all' | 'attention'

const STATUS: Record<
  CapabilityAvailability,
  { label: TranslationKey; tone: StatusTone; icon: ReactNode }
> = {
  available: {
    label: 'capabilities.availability.available',
    tone: 'positive',
    icon: <Checkmark />,
  },
  disabled: {
    label: 'capabilities.availability.disabled',
    tone: 'neutral',
    icon: <RemoveCircle />,
  },
  'needs-setup': {
    label: 'capabilities.availability.needsSetup',
    tone: 'notice',
    icon: <AlertTriangle />,
  },
  degraded: {
    label: 'capabilities.availability.degraded',
    tone: 'notice',
    icon: <AlertTriangle />,
  },
  unavailable: {
    label: 'capabilities.availability.unavailable',
    tone: 'negative',
    icon: <AlertDiamond />,
  },
}

const FILTERS: Array<{ id: AvailabilityFilter; label: TranslationKey }> = [
  { id: 'all', label: 'capabilities.filter.all' },
  { id: 'attention', label: 'capabilities.attention.title' },
]

const EMPTY_MESSAGE: Record<AvailabilityFilter, TranslationKey> = {
  all: 'capabilities.filter.empty',
  attention: 'capabilities.filter.emptyAttention',
}

const CATEGORIES: Array<{ id: CapabilityCategory; label: TranslationKey; icon: ReactNode }> = [
  { id: 'communication', label: 'capabilities.category.communication', icon: <Chat /> },
  { id: 'perception', label: 'capabilities.category.perception', icon: <DeviceDesktop /> },
  { id: 'knowledge', label: 'capabilities.category.knowledge', icon: <Project /> },
  { id: 'action', label: 'capabilities.category.action', icon: <RocketQuickActions /> },
  { id: 'presence', label: 'capabilities.category.presence', icon: <UserAvatar /> },
]

function actionLabel(target: CapabilityNavigationTarget): TranslationKey | undefined {
  switch (target.kind) {
    case 'settings': {
      const section = settingsSections.find((id) => id === target.id)
      return section ? `settings.section.${section}` : undefined
    }
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

function CapabilityEntry({
  capability,
  onNavigate,
}: {
  capability: ShioCapabilityDescriptor
  onNavigate: (target: CapabilityNavigationTarget) => void
}) {
  const { t } = useTranslation()
  const status = STATUS[capability.availability]
  const navigationTarget = capability.navigationTarget
  const opensPlugin = navigationTarget?.kind === 'plugin'
  const authority = authorityLabel(capability)
  const isVisualBrowserControl = capability.details?.kind === 'browser-computer-use'
  const title = t(isVisualBrowserControl ? 'capabilities.browserVisual.title' : capability.titleKey)
  const description = t(
    isVisualBrowserControl ? 'capabilities.browserVisual.description' : capability.descriptionKey,
  )
  const label = navigationTarget && actionLabel(navigationTarget)
  const action =
    label &&
    (navigationTarget?.kind === 'settings'
      ? t('capabilities.action.openSettingsSection', { section: t(label) })
      : t(label))
  return (
    <article className="capability-entry">
      <div className="capability-entry-copy">
        <div className="capability-entry-heading">
          <Heading level={3}>{title}</Heading>
          <div className="capability-entry-tags">
            <Badge size="S" variant={status.tone} fillStyle="subtle">
              {status.icon}
              <Text>{t(status.label)}</Text>
            </Badge>
            {authority && (
              <Badge size="S" variant="neutral" fillStyle="outline">
                {t(authority)}
              </Badge>
            )}
          </div>
        </div>
        <Text UNSAFE_className="capability-description">{description}</Text>
        {capability.reasonKey && (
          <Text UNSAFE_className="capability-reason">{t(capability.reasonKey)}</Text>
        )}
      </div>
      {navigationTarget && action && (
        <div className="capability-entry-action">
          <ActionButton
            isQuiet={!opensPlugin && capability.availability === 'available'}
            aria-label={t('capabilities.action.forCapability', { action, capability: title })}
            onPress={() => onNavigate(navigationTarget)}
          >
            {opensPlugin ? <Plugin /> : <ChevronRight />}
            <Text>{action}</Text>
          </ActionButton>
        </div>
      )}
    </article>
  )
}

function CapabilityGroup({
  title,
  icon,
  capabilities,
  onNavigate,
}: {
  title: string
  icon: ReactNode
  capabilities: readonly ShioCapabilityDescriptor[]
  onNavigate: (target: CapabilityNavigationTarget) => void
}) {
  const headingId = useId()
  if (capabilities.length === 0) return null

  return (
    <section className="capability-group" aria-labelledby={headingId}>
      <div className="capability-group-heading">
        <span className="capability-group-icon" aria-hidden="true">
          {icon}
        </span>
        <Heading level={2} id={headingId}>
          {title}
        </Heading>
      </div>
      <ul className="capability-list">
        {capabilities.map((capability) => (
          <li key={capability.id}>
            <CapabilityEntry capability={capability} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </section>
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
  const catalogRef = useRef<HTMLElement>(null)
  // Avatar has a dedicated view and autonomous reactions describe internal behavior.
  const capabilities =
    snapshot?.capabilities.filter(
      ({ id }) => id !== 'avatar-presence' && id !== 'alive-autonomy',
    ) ?? []
  const attention = capabilities.filter(({ availability }) => availability !== 'available')
  const visible = filter === 'attention' ? attention : capabilities
  const counts = {
    all: capabilities.length,
    attention: attention.length,
  }

  if (!snapshot && !error) {
    return (
      <div className="capabilities-loading">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  return (
    <section
      className="capabilities-view page-container"
      aria-label={t('app.nav.capabilities')}
      ref={catalogRef}
    >
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
      {snapshot && (
        <>
          <div className="capabilities-toolbar">
            <ToggleButtonGroup
              aria-label={t('capabilities.filter.label')}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[filter]}
              onSelectionChange={(keys) => {
                setFilter(keys.has('attention') ? 'attention' : 'all')
                catalogRef.current?.scrollIntoView?.({ block: 'start' })
              }}
              UNSAFE_className="capabilities-filters"
            >
              {FILTERS.map(({ id, label }) => (
                <ToggleButton id={id} key={id}>
                  {`${t(label)} · ${counts[id]}`}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </div>
          {counts[filter] === 0 && (
            <div className="capabilities-empty" role="status">
              <Text>{t(EMPTY_MESSAGE[filter])}</Text>
            </div>
          )}
          {visible.length > 0 && (
            <div className="capabilities-overview">
              {CATEGORIES.map(({ id, label, icon }) => (
                <CapabilityGroup
                  key={id}
                  title={t(label)}
                  icon={icon}
                  capabilities={visible.filter(({ category }) => category === id)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
