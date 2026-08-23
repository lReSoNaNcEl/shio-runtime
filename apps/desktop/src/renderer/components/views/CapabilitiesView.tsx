import {
  Badge,
  Button,
  Content,
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Text,
} from '@react-spectrum/s2'

import {
  type CapabilityAvailability,
  type CapabilityNavigationTarget,
  type ShioCapabilityDescriptor,
  type ShioCapabilitySnapshot,
} from '../../../shared/capabilities'
import { type TranslationKey } from '../../../shared/localization'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

type StatusTone = 'positive' | 'neutral' | 'notice' | 'negative'
type CapabilityGroup = 'available' | 'disabled' | 'needsSetup' | 'problems'

const STATUS: Record<
  CapabilityAvailability,
  { label: TranslationKey; tone: StatusTone; group: CapabilityGroup }
> = {
  available: {
    label: 'capabilities.availability.available',
    tone: 'positive',
    group: 'available',
  },
  disabled: {
    label: 'capabilities.availability.disabled',
    tone: 'neutral',
    group: 'disabled',
  },
  'needs-setup': {
    label: 'capabilities.availability.needsSetup',
    tone: 'notice',
    group: 'needsSetup',
  },
  degraded: {
    label: 'capabilities.availability.degraded',
    tone: 'notice',
    group: 'problems',
  },
  unavailable: {
    label: 'capabilities.availability.unavailable',
    tone: 'negative',
    group: 'problems',
  },
}

const GROUPS: Array<{ id: CapabilityGroup; label: TranslationKey; summary: TranslationKey }> = [
  {
    id: 'available',
    label: 'capabilities.group.available',
    summary: 'capabilities.summary.available',
  },
  {
    id: 'disabled',
    label: 'capabilities.group.disabled',
    summary: 'capabilities.summary.disabled',
  },
  {
    id: 'needsSetup',
    label: 'capabilities.group.needsSetup',
    summary: 'capabilities.summary.needsSetup',
  },
  {
    id: 'problems',
    label: 'capabilities.group.problems',
    summary: 'capabilities.summary.problems',
  },
]

function actionLabel(target: CapabilityNavigationTarget): TranslationKey {
  switch (target.kind) {
    case 'settings':
      return 'capabilities.action.configure'
    case 'plugin':
      return 'capabilities.action.openPlugin'
    case 'view':
      return 'capabilities.action.openView'
  }
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
  return (
    <article className="capability-card">
      <div className="capability-card-heading">
        <Heading level={3}>{t(capability.titleKey)}</Heading>
        <StatusLight variant={status.tone} size="S">
          {t(status.label)}
        </StatusLight>
      </div>
      <Text UNSAFE_className="capability-description">{t(capability.descriptionKey)}</Text>
      {capability.category === 'action' && capability.authority && (
        <Badge size="S" variant={capability.authority === 'full' ? 'negative' : 'gray'}>
          {t(
            capability.authority === 'full'
              ? 'capabilities.authority.full'
              : 'capabilities.authority.confirm',
          )}
        </Badge>
      )}
      {capability.reasonKey && (
        <Text UNSAFE_className="capability-reason">{t(capability.reasonKey)}</Text>
      )}
      {navigationTarget && (
        <Button size="S" variant="secondary" onPress={() => onNavigate(navigationTarget)}>
          {t(actionLabel(navigationTarget))}
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

  if (!snapshot && !error) {
    return (
      <div className="capabilities-loading">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )
  }

  return (
    <section className="capabilities-view" aria-label={t('app.nav.capabilities')}>
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
      {snapshot && (
        <>
          <div className="capabilities-summary">
            {GROUPS.map((group) => {
              const count = snapshot.capabilities.filter(
                (capability) => STATUS[capability.availability].group === group.id,
              ).length
              return (
                <div className="capabilities-summary-item" key={group.id}>
                  <Text>{t(group.summary)}</Text>
                  <Badge size="S" variant={group.id === 'available' ? 'positive' : 'gray'}>
                    {count}
                  </Badge>
                </div>
              )
            })}
          </div>
          {GROUPS.map((group) => {
            const capabilities = snapshot.capabilities.filter(
              (capability) => STATUS[capability.availability].group === group.id,
            )
            if (capabilities.length === 0) return null
            return (
              <section className="capability-group" key={group.id}>
                <Heading level={2}>{t(group.label)}</Heading>
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
