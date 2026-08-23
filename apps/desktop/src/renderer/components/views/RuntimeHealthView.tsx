import {
  ActionButton,
  Content,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import AudioWaveIcon from '@react-spectrum/s2/icons/AudioWave'
import DataIcon from '@react-spectrum/s2/icons/Data'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import RefreshIcon from '@react-spectrum/s2/icons/Refresh'
import { type ReactElement, useEffect, useState } from 'react'

import { type PluginStatus, PROJECT_AWARENESS_PLUGIN_ID } from '../../../shared/plugins'
import { type ProjectAwarenessStatus } from '../../../shared/project-awareness'
import { type ControllerState, controller } from '../../Controller'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import {
  type SpeechCapabilitiesState,
  type SpeechCapabilityStatus,
} from '../../runtime/speechCapabilities'

type CardTone = 'positive' | 'informative' | 'neutral' | 'notice' | 'negative'

const EMPTY_PROJECT_STATUS: ProjectAwarenessStatus = {
  enabled: false,
  state: 'disconnected',
  provider: 'github',
  repository: '',
  branch: 'main',
  indexState: 'not_built',
  access: 'read-only',
  indexedFileCount: 0,
  credential: {
    configured: false,
    source: 'none',
    secureStorageAvailable: false,
  },
}

const PROJECT_STATUS: Record<
  ProjectAwarenessStatus['state'],
  { key: Parameters<LocalizationContextValue['t']>[0]; tone: CardTone }
> = {
  disconnected: { key: 'health.project.state.disconnected', tone: 'neutral' },
  connecting: { key: 'health.project.state.connecting', tone: 'informative' },
  ready: { key: 'health.project.state.ready', tone: 'positive' },
  syncing: { key: 'health.project.state.syncing', tone: 'informative' },
  indexing: { key: 'health.project.state.indexing', tone: 'informative' },
  stale: { key: 'health.project.state.stale', tone: 'notice' },
  error: { key: 'common.error', tone: 'negative' },
}

const INDEX_STATE_KEY: Record<
  ProjectAwarenessStatus['indexState'],
  Parameters<LocalizationContextValue['t']>[0]
> = {
  not_built: 'health.project.index.notBuilt',
  current: 'health.project.index.current',
  stale: 'health.project.index.stale',
  building: 'health.project.index.building',
  error: 'common.error',
}

function ProjectAwarenessCard({
  plugin,
  status,
  onOpenPlugin,
}: {
  plugin: PluginStatus | null
  status: ProjectAwarenessStatus
  onOpenPlugin: () => void
}) {
  const { intlLocale, t } = useTranslation()
  const state = plugin?.enabled
    ? PROJECT_STATUS[status.state]
    : ({ key: 'common.disabled', tone: 'neutral' } as const)
  const stateLabel = t(state.key)
  const busy = Boolean(plugin?.busy) || ['connecting', 'syncing', 'indexing'].includes(status.state)
  const healthLabel = plugin
    ? plugin.health.detailKey
      ? t(plugin.health.detailKey)
      : plugin.health.detail || t('plugins.health.healthy')
    : t('common.loading')

  return (
    <article className={`health-card health-card-${state.tone} health-card-project-awareness`}>
      <div className="health-card-top">
        <span className="health-card-icon" aria-hidden="true">
          <DataIcon />
        </span>
        <Heading level={3} UNSAFE_className="health-card-name">
          {t('health.project.title')}
        </Heading>
        {busy ? (
          <ProgressCircle
            size="S"
            isIndeterminate
            aria-label={stateLabel}
            UNSAFE_className="health-card-dot-busy"
          />
        ) : (
          <StatusLight variant={state.tone} size="S">
            <span className="visually-hidden">{stateLabel}</span>
          </StatusLight>
        )}
      </div>
      <StatusLight variant={state.tone} size="S" UNSAFE_className="health-card-status">
        {stateLabel}
      </StatusLight>
      <dl className="project-awareness-details">
        <div>
          <dt>{t('common.provider')}</dt>
          <dd>{t('common.github')}</dd>
        </div>
        <div>
          <dt>{t('common.enabled')}</dt>
          <dd>{plugin?.enabled ? t('common.yes') : t('common.no')}</dd>
        </div>
        <div>
          <dt>{t('plugins.health.label')}</dt>
          <dd>{healthLabel}</dd>
        </div>
        <div>
          <dt>{t('common.repository')}</dt>
          <dd>{status.repository}</dd>
        </div>
        <div>
          <dt>{t('common.branch')}</dt>
          <dd>{status.branch}</dd>
        </div>
        <div>
          <dt>{t('health.project.remoteHead')}</dt>
          <dd>{status.remoteHead?.slice(0, 7) ?? t('common.none')}</dd>
        </div>
        <div>
          <dt>{t('health.project.indexedCommit')}</dt>
          <dd>{status.indexedCommit?.slice(0, 7) ?? t('common.none')}</dd>
        </div>
        <div>
          <dt>{t('health.project.indexState')}</dt>
          <dd>{t(INDEX_STATE_KEY[status.indexState])}</dd>
        </div>
        <div>
          <dt>{t('health.project.access')}</dt>
          <dd>{t('common.readOnly')}</dd>
        </div>
        <div>
          <dt>{t('health.project.credential')}</dt>
          <dd>
            {status.credential.source === 'secure_store'
              ? t('health.project.credentialSaved')
              : t('common.notConfigured')}
          </dd>
        </div>
        <div>
          <dt>{t('health.project.lastSync')}</dt>
          <dd>
            {status.lastSyncAt
              ? new Date(status.lastSyncAt).toLocaleTimeString(intlLocale)
              : t('common.none')}
          </dd>
        </div>
      </dl>
      {(plugin?.lastError || status.lastError) && (
        <Text UNSAFE_className="health-project-error">{plugin?.lastError || status.lastError}</Text>
      )}
      <div className="health-project-actions">
        <ActionButton isDisabled={busy} onPress={onOpenPlugin}>
          {t('health.project.openPlugin')}
        </ActionButton>
      </div>
    </article>
  )
}

const SPEECH_SERVICE: Record<
  SpeechCapabilitiesState['service'],
  { key: Parameters<LocalizationContextValue['t']>[0]; tone: CardTone }
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
  switch (status) {
    case 'available':
      return { text: t('health.speech.available'), tone: 'positive' }
    case 'unavailable':
      return { text: t('common.unavailable'), tone: 'negative' }
    default:
      return { text: t('common.none'), tone: 'neutral' }
  }
}

/**
 * Dedicated Speech API card (ТЗ §7): aggregated service state plus per-capability
 * ASR/TTS/Streaming detail, last-check time, a recheck button, and an expandable —
 * closed by default — technical-details block. No IP/port shown outside it.
 */
function SpeechApiCard({ capabilities }: { capabilities: SpeechCapabilitiesState }) {
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
  const lastChecked = capabilities.lastCheckedAt
    ? new Date(capabilities.lastCheckedAt).toLocaleTimeString(intlLocale)
    : t('common.none')
  const hasProblem = capabilities.service === 'unavailable' || capabilities.service === 'degraded'

  return (
    <article className={`health-card health-card-${service.tone} health-card-speech`}>
      <div className="health-card-top">
        <span className="health-card-icon" aria-hidden="true">
          <AudioWaveIcon />
        </span>
        <Heading level={3} UNSAFE_className="health-card-name">
          {t('health.speech.title')}
        </Heading>
        <StatusLight variant={service.tone} size="S">
          <span className="visually-hidden">{serviceLabel}</span>
        </StatusLight>
      </div>
      <StatusLight variant={service.tone} size="S" UNSAFE_className="health-card-status">
        {serviceLabel}
      </StatusLight>

      <dl className="speech-capability-list">
        {rows.map((row) => {
          const value = capabilityLabel(row.status, t)
          return (
            <div className="speech-capability-row" key={row.id}>
              <dt>{row.label}</dt>
              <dd className={`speech-capability-${value.tone}`}>{value.text}</dd>
            </div>
          )
        })}
      </dl>
      <Text UNSAFE_className="health-card-detail">
        {t('health.speech.lastCheck', { time: lastChecked })}
      </Text>
      {hasProblem && (
        <Text UNSAFE_className="health-card-detail">{t('health.speech.connectionFailed')}</Text>
      )}

      <div className="speech-card-actions">
        <ActionButton onPress={() => controller.recheckSpeechService()}>
          {t('health.speech.retry')}
        </ActionButton>
      </div>

      {capabilities.technicalMessage && (
        <Disclosure isQuiet UNSAFE_className="speech-technical-details">
          <DisclosureTitle level={4}>{t('health.speech.technicalDetails')}</DisclosureTitle>
          <DisclosurePanel>
            <code>{capabilities.technicalMessage}</code>
          </DisclosurePanel>
        </Disclosure>
      )}
    </article>
  )
}

interface HealthCard {
  id: string
  icon: ReactElement
  title: string
  tone: CardTone
  status: string
  detail: string
  busy?: boolean
}

function buildCards(state: ControllerState, t: LocalizationContextValue['t']): HealthCard[] {
  const cards: HealthCard[] = []

  // Speech API is rendered separately as a richer card (see SpeechApiCard) and is
  // intentionally not part of this uniform card list.

  // LLM
  const llm = state.llmHealth
  switch (llm.state) {
    case 'checking':
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: t('health.llm.title'),
        tone: 'informative',
        status: t('health.llm.checking'),
        detail: llm.detail,
        busy: true,
      })
      break
    case 'ok':
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: t('health.llm.title'),
        tone: 'positive',
        status: t('common.available'),
        detail: llm.detail,
      })
      break
    case 'error':
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: t('health.llm.title'),
        tone: 'negative',
        status: t('common.error'),
        detail: llm.detail,
      })
      break
    default:
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: t('health.llm.title'),
        tone: 'neutral',
        status: t('common.notChecked'),
        detail: llm.detail,
      })
  }

  // Стриминг (continuous listening)
  switch (state.continuousListeningState) {
    case 'on':
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: t('health.streaming.title'),
        tone: 'positive',
        status: t('health.streaming.running'),
        detail: t('health.streaming.listeningDetail'),
      })
      break
    case 'starting':
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: t('health.streaming.title'),
        tone: 'informative',
        status: t('health.streaming.starting'),
        detail: t('health.streaming.openingMicrophone'),
        busy: true,
      })
      break
    case 'error':
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: t('health.streaming.title'),
        tone: 'negative',
        status: t('common.error'),
        detail: state.continuousListeningError || t('health.streaming.openFailed'),
      })
      break
    default:
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: t('health.streaming.title'),
        tone: 'neutral',
        status: t('health.streaming.off'),
        detail: t('health.streaming.notRunning'),
      })
  }

  return cards
}

export function RuntimeHealthView({
  state,
  onRetry,
  onOpenProjectPlugin,
}: {
  state: ControllerState
  onRetry: () => void
  onOpenProjectPlugin: () => void
}) {
  const { t } = useTranslation()
  const [projectStatus, setProjectStatus] = useState<ProjectAwarenessStatus>(EMPTY_PROJECT_STATUS)
  const [projectPlugin, setProjectPlugin] = useState<PluginStatus | null>(null)
  const [supportStatus, setSupportStatus] = useState('')
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      observeRendererPromise(
        Promise.all([
          window.api.projectAwareness.getStatus(),
          window.api.plugins.get(PROJECT_AWARENESS_PLUGIN_ID),
        ]).then(([status, plugin]) => {
          if (!active) return
          setProjectStatus(status)
          setProjectPlugin(plugin)
        }),
        'refresh Project Awareness health',
      )
    }
    refresh()
    const intervalId = window.setInterval(refresh, 3_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])
  const cards = buildCards(state, t)
  const speechService = state.speechCapabilities.service
  const checking =
    speechService === 'checking' ||
    speechService === 'unknown' ||
    state.llmHealth.state === 'checking' ||
    Boolean(projectPlugin?.busy) ||
    (Boolean(projectPlugin?.enabled) &&
      ['connecting', 'syncing', 'indexing'].includes(projectStatus.state))
  const hasError =
    cards.some((card) => card.tone === 'negative') ||
    speechService === 'unavailable' ||
    projectPlugin?.health.state === 'error'
  const hasNotice =
    cards.some((card) => card.tone === 'notice') ||
    speechService === 'degraded' ||
    projectPlugin?.health.state === 'degraded'

  const overall: { variant: CardTone; label: string } = checking
    ? { variant: 'informative', label: t('common.checkingEllipsis') }
    : hasError
      ? { variant: 'negative', label: t('health.overall.problems') }
      : hasNotice
        ? { variant: 'notice', label: t('health.overall.attention') }
        : { variant: 'positive', label: t('health.overall.ok') }

  const copyText = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    setSupportStatus(t('health.support.copied'))
    window.setTimeout(() => setSupportStatus(''), 2_000)
  }

  return (
    <section className="health-dashboard">
      <div className="health-dashboard-toolbar">
        <div className="health-dashboard-actions">
          <ActionButton
            onPress={() =>
              observeRendererPromise(
                window.api.system
                  .getRuntimeSupportBundle()
                  .then((bundle) => copyText(JSON.stringify(bundle, null, 2))),
                'copy Runtime Support Bundle',
                () => setSupportStatus(t('health.support.copyFailed')),
              )
            }
          >
            {t('health.support.copyRuntimeHealth')}
          </ActionButton>
          {supportStatus ? (
            <span role="status">
              <Text>{supportStatus}</Text>
            </span>
          ) : null}
          <StatusLight role="status" variant={overall.variant} size="M">
            {overall.label}
          </StatusLight>
          <ActionButton
            onPress={onRetry}
            isDisabled={checking}
            aria-label={checking ? t('health.checkingNow') : t('health.retryCheck')}
          >
            {checking ? (
              <ProgressCircle size="S" isIndeterminate aria-label={t('common.checking')} />
            ) : (
              <RefreshIcon />
            )}
          </ActionButton>
        </div>
      </div>

      <div className="health-card-grid">
        <SpeechApiCard capabilities={state.speechCapabilities} />
        <ProjectAwarenessCard
          plugin={projectPlugin}
          status={projectStatus}
          onOpenPlugin={onOpenProjectPlugin}
        />
        {cards.map((card) => (
          <article className={`health-card health-card-${card.tone}`} key={card.id}>
            <div className="health-card-top">
              <span className="health-card-icon" aria-hidden="true">
                {card.icon}
              </span>
              <Heading level={3} UNSAFE_className="health-card-name">
                {card.title}
              </Heading>
              {card.busy ? (
                <ProgressCircle
                  size="S"
                  isIndeterminate
                  aria-label={t('health.cardChecking')}
                  UNSAFE_className="health-card-dot-busy"
                />
              ) : (
                <StatusLight variant={card.tone} size="S">
                  <span className="visually-hidden">{card.status}</span>
                </StatusLight>
              )}
            </div>
            <StatusLight variant={card.tone} size="S" UNSAFE_className="health-card-status">
              {card.status}
            </StatusLight>
            <Text UNSAFE_className="health-card-detail">{card.detail}</Text>
          </article>
        ))}
      </div>

      {hasError && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('health.alert.title')}</Heading>
          <Content>{t('health.alert.description')}</Content>
        </InlineAlert>
      )}
    </section>
  )
}
