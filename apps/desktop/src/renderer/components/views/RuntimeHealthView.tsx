import {
  ActionButton,
  Button,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  ProgressCircle,
  StatusLight,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import AppsIcon from '@react-spectrum/s2/icons/Apps'
import AudioWaveIcon from '@react-spectrum/s2/icons/AudioWave'
import CopyIcon from '@react-spectrum/s2/icons/Copy'
import DataIcon from '@react-spectrum/s2/icons/Data'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import RefreshIcon from '@react-spectrum/s2/icons/Refresh'
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'

import { type TranslationKey } from '../../../shared/localization'
import {
  type PluginHealthState,
  type PluginLifecycleState,
  type RuntimePluginHealth,
  type RuntimePluginHealthDetailValue,
} from '../../../shared/plugins'
import { type RuntimeSupportBundle } from '../../../shared/system'
import { type ControllerState } from '../../controller/contracts'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'
import {
  type ApplicationHealth,
  formatRelativeTime,
  type HealthSeverity,
  type RuntimeHealthComponent,
  type RuntimeHealthProjection,
} from '../../runtime/runtimeHealth'
/*
 * Health presentation consumes explicit owner projections. It intentionally has
 * no Plugin-id-specific imports or configuration operations.
 */
import {
  type SpeechCapabilitiesState,
  type SpeechCapabilityStatus,
} from '../../runtime/speechCapabilities'

type CardTone = 'positive' | 'informative' | 'neutral' | 'notice' | 'negative'

const SEVERITY_TONE: Record<HealthSeverity, CardTone> = {
  healthy: 'positive',
  notice: 'notice',
  degraded: 'notice',
  error: 'negative',
}

const OVERALL_TONE: Record<ApplicationHealth, CardTone> = {
  healthy: 'positive',
  notice: 'notice',
  error: 'negative',
}

const OVERALL_KEY: Record<ApplicationHealth, TranslationKey> = {
  healthy: 'health.overall.ok',
  notice: 'health.overall.attention',
  error: 'health.overall.problems',
}

const PLUGIN_HEALTH_KEY: Record<PluginHealthState, TranslationKey> = {
  healthy: 'plugins.health.healthy',
  'needs-setup': 'plugins.health.needsSetup',
  degraded: 'plugins.health.degraded',
  error: 'plugins.health.error',
}

const LIFECYCLE_KEY: Record<PluginLifecycleState, TranslationKey> = {
  registered: 'plugins.lifecycle.registered',
  initializing: 'plugins.lifecycle.initializing',
  disabled: 'plugins.lifecycle.disabled',
  starting: 'plugins.lifecycle.starting',
  active: 'plugins.lifecycle.active',
  stopping: 'plugins.lifecycle.stopping',
  error: 'plugins.lifecycle.error',
  disposed: 'plugins.lifecycle.disposed',
}

function exactTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp)
}

function RelativeTimestamp({
  timestamp,
  labelKey,
}: {
  timestamp?: number
  labelKey: TranslationKey
}) {
  const { intlLocale, t } = useTranslation()
  if (!timestamp) return <Text UNSAFE_className="health-metadata">{t('common.none')}</Text>
  const relative = formatRelativeTime(timestamp, intlLocale, t('health.time.justNow'))
  const label = t(labelKey, { time: relative })
  const exact = exactTime(timestamp, intlLocale)
  return (
    <TooltipTrigger delay={200}>
      <ActionButton
        isQuiet
        aria-label={`${label}. ${exact}`}
        UNSAFE_className="health-time-trigger"
      >
        <Text>{label}</Text>
      </ActionButton>
      <Tooltip>{exact}</Tooltip>
    </TooltipTrigger>
  )
}

function HealthCardShell({
  icon,
  title,
  tone,
  status,
  busy = false,
  children,
  className = '',
}: {
  icon: ReactElement
  title: string
  tone: CardTone
  status: string
  busy?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <article className={`health-card health-card-${tone}${className ? ` ${className}` : ''}`}>
      <div className="health-card-top">
        <span className="health-card-icon" aria-hidden="true">
          {icon}
        </span>
        <Heading level={3} UNSAFE_className="health-card-name">
          {title}
        </Heading>
        {busy ? (
          <ProgressCircle size="S" isIndeterminate aria-label={status} />
        ) : (
          <StatusLight variant={tone} size="S">
            <span className="visually-hidden">{status}</span>
          </StatusLight>
        )}
      </div>
      <StatusLight variant={tone} size="S" UNSAFE_className="health-card-status">
        {status}
      </StatusLight>
      {children}
    </article>
  )
}

const SPEECH_SERVICE: Record<
  SpeechCapabilitiesState['service'],
  { key: TranslationKey; tone: CardTone }
> = {
  unknown: { key: 'common.checking', tone: 'informative' },
  checking: { key: 'common.checking', tone: 'informative' },
  available: { key: 'health.speech.available', tone: 'positive' },
  degraded: { key: 'health.speech.degraded', tone: 'notice' },
  unavailable: { key: 'common.unavailable', tone: 'negative' },
}

function capabilityLabel(
  status: SpeechCapabilityStatus,
  t: LocalizationContextValue['t'],
): { text: string; tone: CardTone } {
  if (status === 'available') return { text: t('health.speech.available'), tone: 'positive' }
  if (status === 'unavailable') return { text: t('common.unavailable'), tone: 'negative' }
  return { text: t('common.notChecked'), tone: 'neutral' }
}

function SpeechApiCard({
  capabilities,
  onRetry,
}: {
  capabilities: SpeechCapabilitiesState
  onRetry: () => void
}) {
  const { intlLocale, t } = useTranslation()
  const service = SPEECH_SERVICE[capabilities.service]
  const serviceLabel = t(service.key)
  const rows: Array<{ id: string; label: string; status: SpeechCapabilityStatus }> = [
    { id: 'asr', label: t('health.speech.capability.asr'), status: capabilities.recognition },
    { id: 'tts', label: t('health.speech.capability.tts'), status: capabilities.synthesis },
    {
      id: 'streaming',
      label: t('health.speech.capability.streaming'),
      status: capabilities.streaming,
    },
  ]
  const hasProblem = capabilities.service === 'unavailable' || capabilities.service === 'degraded'
  const exactAttempt = capabilities.lastCheckedAt
    ? exactTime(capabilities.lastCheckedAt, intlLocale)
    : t('common.none')

  return (
    <HealthCardShell
      icon={<AudioWaveIcon />}
      title={t('health.speech.title')}
      tone={service.tone}
      status={serviceLabel}
      busy={capabilities.service === 'checking' || capabilities.service === 'unknown'}
      className="health-card-speech"
    >
      {hasProblem ? (
        <Text UNSAFE_className="health-card-detail">{t('health.speech.connectionFailed')}</Text>
      ) : null}
      <dl className="health-detail-list">
        {rows.map((row) => {
          const value = capabilityLabel(row.status, t)
          return (
            <div className="health-detail-row" key={row.id}>
              <dt>{row.label}</dt>
              <dd className={`health-value-${value.tone}`}>{value.text}</dd>
            </div>
          )
        })}
      </dl>
      <RelativeTimestamp
        timestamp={capabilities.lastCheckedAt}
        labelKey="health.speech.checkedRelative"
      />
      <div className="health-card-actions">
        <Button
          variant="secondary"
          isDisabled={capabilities.service === 'checking'}
          onPress={onRetry}
        >
          {t('health.speech.retry')}
        </Button>
      </div>
      <Disclosure isQuiet UNSAFE_className="health-technical-details">
        <DisclosureTitle level={4}>{t('health.speech.technicalDetails')}</DisclosureTitle>
        <DisclosurePanel>
          <dl className="health-detail-list health-detail-list-technical">
            <div className="health-detail-row">
              <dt>{t('health.technical.lastAttempt')}</dt>
              <dd>{exactAttempt}</dd>
            </div>
            <div className="health-detail-row">
              <dt>{t('health.technical.errorCode')}</dt>
              <dd>{capabilities.lastErrorCode ?? t('common.none')}</dd>
            </div>
          </dl>
          {capabilities.technicalMessage ? (
            <code className="health-technical-message">{capabilities.technicalMessage}</code>
          ) : null}
        </DisclosurePanel>
      </Disclosure>
    </HealthCardShell>
  )
}

function LlmCard({
  state,
  support,
  onOpenSettings,
}: {
  state: ControllerState
  support: RuntimeSupportBundle | null
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const readiness = state.llmReadiness.reason
  const needsSetup =
    readiness === 'missing-account-id' ||
    readiness === 'missing-credential' ||
    readiness === 'model-missing'
  const checking = readiness === 'checking' || state.llmHealth.state === 'checking'
  const failed =
    readiness === 'auth-error' || readiness === 'access-error' || readiness === 'network-error'
  const tone: CardTone = failed
    ? 'negative'
    : needsSetup
      ? 'notice'
      : checking
        ? 'informative'
        : state.llmHealth.state === 'ok'
          ? 'positive'
          : 'notice'
  const status = failed
    ? t('common.error')
    : needsSetup
      ? t('plugins.health.needsSetup')
      : checking
        ? t('health.llm.checking')
        : state.llmHealth.state === 'ok'
          ? t('common.available')
          : t('common.notChecked')
  const provider = state.llmReadiness.providerDisplayName
  const model = support?.llm.model

  return (
    <HealthCardShell
      icon={<DataIcon />}
      title={t('health.llm.title')}
      tone={tone}
      status={status}
      busy={checking}
    >
      <div className="health-identity-details">
        <Text>{provider}</Text>
        {model ? <code>{model}</code> : null}
      </div>
      {failed ? <Text UNSAFE_className="health-card-detail">{state.llmHealth.detail}</Text> : null}
      {needsSetup ? (
        <div className="health-card-actions">
          <Button variant="secondary" onPress={onOpenSettings}>
            {t('health.llm.openSettings')}
          </Button>
        </div>
      ) : null}
    </HealthCardShell>
  )
}

function StreamingCard({ state }: { state: ControllerState }) {
  const { t } = useTranslation()
  const presentation =
    state.continuousListeningState === 'on'
      ? {
          tone: 'positive' as const,
          status: t('health.streaming.active'),
          detail: t('health.streaming.listeningDetail'),
          busy: false,
        }
      : state.continuousListeningState === 'starting'
        ? {
            tone: 'informative' as const,
            status: t('health.streaming.starting'),
            detail: t('health.streaming.openingMicrophone'),
            busy: true,
          }
        : state.continuousListeningState === 'error'
          ? {
              tone: 'negative' as const,
              status: t('common.error'),
              detail: state.continuousListeningError || t('health.streaming.openFailed'),
              busy: false,
            }
          : {
              tone: 'neutral' as const,
              status: t('health.streaming.off'),
              detail: t('health.streaming.offDetail'),
              busy: false,
            }
  return (
    <HealthCardShell
      icon={<MicrophoneIcon />}
      title={t('health.streaming.title')}
      tone={presentation.tone}
      status={presentation.status}
      busy={presentation.busy}
    >
      <Text UNSAFE_className="health-card-detail">{presentation.detail}</Text>
    </HealthCardShell>
  )
}

function renderPluginDetailValue(
  value: RuntimePluginHealthDetailValue,
  t: LocalizationContextValue['t'],
  locale: string,
): ReactNode {
  if (value.kind === 'translation') return t(value.key)
  if (value.kind === 'timestamp') return exactTime(value.value, locale)
  return value.code ? <code>{value.value}</code> : value.value
}

function PluginHealthCard({
  plugin,
  onNavigate,
}: {
  plugin: RuntimePluginHealth
  onNavigate: (target: NonNullable<RuntimePluginHealth['navigationTarget']>) => void
}) {
  const { intlLocale, t } = useTranslation()
  const presentation = plugin.presentation
  const severity: HealthSeverity =
    plugin.lifecycle === 'error'
      ? 'error'
      : plugin.health.state === 'degraded'
        ? 'degraded'
        : plugin.health.state === 'needs-setup'
          ? 'notice'
          : plugin.health.state
  const tone = SEVERITY_TONE[severity]
  const status = t(plugin.health.detailKey ?? PLUGIN_HEALTH_KEY[plugin.health.state])
  const busy = ['initializing', 'starting', 'stopping'].includes(plugin.lifecycle)
  const navigationTarget = plugin.navigationTarget
  return (
    <HealthCardShell
      icon={<AppsIcon />}
      title={t(plugin.displayNameKey)}
      tone={tone}
      status={status}
      busy={busy}
      className="health-card-plugin"
    >
      {presentation?.summary ? (
        <Text UNSAFE_className="health-plugin-summary">{presentation.summary}</Text>
      ) : null}
      {presentation?.context ? (
        presentation.contextCode ? (
          <code className="health-plugin-context">{presentation.context}</code>
        ) : (
          <Text UNSAFE_className="health-plugin-context">{presentation.context}</Text>
        )
      ) : null}
      {presentation?.statusKey ? (
        <Text UNSAFE_className="health-card-detail">{t(presentation.statusKey)}</Text>
      ) : null}
      {plugin.health.detail && plugin.health.state === 'error' ? (
        <Text UNSAFE_className="health-card-detail health-card-error-detail">
          {plugin.health.detail}
        </Text>
      ) : null}
      {presentation?.lastActivityLabelKey ? (
        <RelativeTimestamp
          timestamp={presentation.lastActivityAt}
          labelKey={presentation.lastActivityLabelKey}
        />
      ) : null}
      {navigationTarget ? (
        <div className="health-card-actions">
          <Button variant="secondary" onPress={() => onNavigate(navigationTarget)}>
            {t('health.plugin.open')}
          </Button>
        </div>
      ) : null}
      <Disclosure isQuiet UNSAFE_className="health-technical-details">
        <DisclosureTitle level={4}>{t('health.speech.technicalDetails')}</DisclosureTitle>
        <DisclosurePanel>
          <dl className="health-detail-list health-detail-list-technical">
            <div className="health-detail-row">
              <dt>{t('plugins.lifecycle.label')}</dt>
              <dd>{t(LIFECYCLE_KEY[plugin.lifecycle])}</dd>
            </div>
            {presentation?.details?.map((detail) => (
              <div className="health-detail-row" key={detail.id}>
                <dt>{t(detail.labelKey)}</dt>
                <dd>{renderPluginDetailValue(detail.value, t, intlLocale)}</dd>
              </div>
            ))}
          </dl>
        </DisclosurePanel>
      </Disclosure>
    </HealthCardShell>
  )
}

function SystemIssueCard({ component }: { component: RuntimeHealthComponent }) {
  const { t } = useTranslation()
  return (
    <HealthCardShell
      icon={<DataIcon />}
      title={t(component.titleKey)}
      tone={SEVERITY_TONE[component.severity]}
      status={t(component.summaryKey)}
      busy={component.id === 'support-projection'}
    />
  )
}

export function RuntimeHealthView({
  state,
  support,
  projection,
  onRefresh,
  onRetrySpeech,
  onOpenLlmSettings,
  onOpenPlugin,
  getSupportReport,
}: {
  state: ControllerState
  support: RuntimeSupportBundle | null
  projection: RuntimeHealthProjection
  onRefresh: () => Promise<void>
  onRetrySpeech: () => void
  onOpenLlmSettings: () => void
  onOpenPlugin: (pluginId: RuntimePluginHealth['pluginId']) => void
  getSupportReport: () => Promise<RuntimeSupportBundle>
}) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const [copying, setCopying] = useState(false)
  const [supportStatus, setSupportStatus] = useState('')
  const statusTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current)
    },
    [],
  )

  const announceSupportStatus = (message: string): void => {
    setSupportStatus(message)
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setSupportStatus(''), 2_000)
  }

  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  const copyReport = async (): Promise<void> => {
    if (copying) return
    setCopying(true)
    try {
      const report = await getSupportReport()
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      announceSupportStatus(t('health.support.copied'))
    } catch {
      announceSupportStatus(t('health.support.copyFailed'))
    } finally {
      setCopying(false)
    }
  }

  const systemIssues = projection.components.filter(
    (component) =>
      component.enabled &&
      component.category === 'runtime' &&
      component.id !== 'streaming' &&
      component.severity !== 'healthy',
  )

  return (
    <section className="health-dashboard">
      <div className="health-dashboard-toolbar">
        <StatusLight
          role="status"
          aria-live="polite"
          variant={OVERALL_TONE[projection.overall]}
          size="M"
          UNSAFE_className="health-overall-status"
        >
          {t(OVERALL_KEY[projection.overall])}
        </StatusLight>
        <div className="health-dashboard-actions">
          <TooltipTrigger delay={200}>
            <ActionButton
              isQuiet
              isDisabled={refreshing}
              aria-label={t('health.refresh')}
              onPress={() => {
                void refresh().catch(() => announceSupportStatus(t('health.refreshFailed')))
              }}
            >
              {refreshing ? (
                <ProgressCircle size="S" isIndeterminate aria-label={t('health.checkingNow')} />
              ) : (
                <RefreshIcon />
              )}
            </ActionButton>
            <Tooltip>{t('health.refresh')}</Tooltip>
          </TooltipTrigger>
          <Button variant="secondary" isPending={copying} onPress={() => void copyReport()}>
            <CopyIcon />
            <Text>{t('health.support.copyReport')}</Text>
          </Button>
        </div>
        <span className="health-support-status" role="status" aria-live="polite">
          {supportStatus}
        </span>
      </div>

      <div className="health-card-grid">
        <SpeechApiCard capabilities={state.speechCapabilities} onRetry={onRetrySpeech} />
        {projection.plugins.map((plugin) => (
          <PluginHealthCard
            key={plugin.pluginId}
            plugin={plugin}
            onNavigate={(target) => onOpenPlugin(target.pluginId)}
          />
        ))}
        <LlmCard state={state} support={support} onOpenSettings={onOpenLlmSettings} />
        <StreamingCard state={state} />
        {systemIssues.map((component) => (
          <SystemIssueCard key={component.id} component={component} />
        ))}
      </div>
    </section>
  )
}
