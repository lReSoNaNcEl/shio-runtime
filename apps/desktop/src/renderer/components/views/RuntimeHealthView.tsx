import {
  ActionButton,
  Content,
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
import { useEffect, useState } from 'react'

import type { ProjectAwarenessStatus, ProjectMap } from '../../../shared/projectAwareness'
import { type ControllerState, controller } from '../../Controller'
import type { LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'
import type {
  SpeechCapabilitiesState,
  SpeechCapabilityStatus,
} from '../../runtime/speechCapabilities'

type CardTone = 'positive' | 'informative' | 'neutral' | 'notice' | 'negative'

const EMPTY_PROJECT_STATUS: ProjectAwarenessStatus = {
  enabled: true,
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

function projectActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function ProjectAwarenessCard({ status }: { status: ProjectAwarenessStatus }): React.JSX.Element {
  const { intlLocale, t } = useTranslation()
  const [map, setMap] = useState<ProjectMap | null>(null)
  const [actionError, setActionError] = useState('')
  const [mapLoading, setMapLoading] = useState(false)
  const state = PROJECT_STATUS[status.state]
  const stateLabel = t(state.key)
  const busy = mapLoading || ['connecting', 'syncing', 'indexing'].includes(status.state)
  const hasIndex = Boolean(status.indexedCommit)

  const openMap = async (): Promise<void> => {
    setActionError('')
    setMapLoading(true)
    try {
      setMap((await window.api.projectAwareness.getProjectMap()) ?? null)
    } catch (error) {
      setActionError(projectActionError(error))
    } finally {
      setMapLoading(false)
    }
  }

  return (
    <article className={`health-card health-card-${state.tone} health-card-project-awareness`}>
      <div className="health-card-top">
        <span className="health-card-icon" aria-hidden="true">
          <DataIcon />
        </span>
        <span className="health-card-name">Project Awareness</span>
        {busy ? (
          <ProgressCircle
            size="S"
            isIndeterminate
            aria-label={stateLabel}
            UNSAFE_className="health-card-dot-busy"
          />
        ) : (
          <span
            className={`runtime-status-light runtime-status-${state.tone} health-card-dot`}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="health-card-status">{stateLabel}</span>
      <dl className="project-awareness-details">
        <div>
          <dt>{t('common.provider')}</dt>
          <dd>GitHub</dd>
        </div>
        <div>
          <dt>{t('common.enabled')}</dt>
          <dd>{status.enabled ? t('common.yes') : t('common.no')}</dd>
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
      {(actionError || status.lastError) && (
        <span className="project-awareness-error">{actionError || status.lastError}</span>
      )}
      <div className="project-awareness-actions">
        <ActionButton isDisabled={!hasIndex || busy} onPress={openMap}>
          {mapLoading ? t('health.project.openingMap') : t('health.project.openMap')}
        </ActionButton>
      </div>
      {map && (
        <details className="project-map-details" open>
          <summary>
            {t('health.project.mapSummary', { commit: map.snapshot.commitSha.slice(0, 7) })}
          </summary>
          <p>{map.overview}</p>
          <ul>
            {map.architecture.map((section) => (
              <li key={section.name}>
                <strong>{section.name}</strong> ·{' '}
                {t('health.project.keyFiles', { count: section.paths.length })}
              </li>
            ))}
          </ul>
        </details>
      )}
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
function SpeechApiCard({
  capabilities,
}: {
  capabilities: SpeechCapabilitiesState
}): React.JSX.Element {
  const { intlLocale, t } = useTranslation()
  const service = SPEECH_SERVICE[capabilities.service]
  const serviceLabel = t(service.key)
  const rows: Array<{ id: string; label: string; status: SpeechCapabilityStatus }> = [
    { id: 'asr', label: 'ASR', status: capabilities.recognition },
    { id: 'tts', label: 'TTS', status: capabilities.synthesis },
    { id: 'streaming', label: 'Streaming', status: capabilities.streaming },
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
        <span className="health-card-name">Speech API</span>
        <span
          className={`runtime-status-light runtime-status-${service.tone} health-card-dot`}
          aria-hidden="true"
        />
      </div>
      <span className="health-card-status">{serviceLabel}</span>

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
      <span className="health-card-detail">
        {t('health.speech.lastCheck', { time: lastChecked })}
      </span>
      {hasProblem && (
        <span className="health-card-detail">{t('health.speech.connectionFailed')}</span>
      )}

      <div className="speech-card-actions">
        <ActionButton onPress={() => controller.recheckSpeechService()}>
          {t('health.speech.retry')}
        </ActionButton>
      </div>

      {capabilities.technicalMessage && (
        <details className="speech-technical-details">
          <summary>{t('health.speech.technicalDetails')}</summary>
          <code>{capabilities.technicalMessage}</code>
        </details>
      )}
    </article>
  )
}

interface HealthCard {
  id: string
  icon: React.JSX.Element
  title: string
  tone: CardTone
  status: string
  detail: string
  busy?: boolean
}

const MODE_LABEL: Record<ControllerState['continuousListeningMode'], string> = {
  silent: 'Silent',
  passive: 'Passive',
  active: 'Active',
  streamer: 'Streamer',
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
        title: 'LLM',
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
        title: 'LLM',
        tone: 'positive',
        status: t('common.available'),
        detail: llm.detail,
      })
      break
    case 'error':
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: 'LLM',
        tone: 'negative',
        status: t('common.error'),
        detail: llm.detail,
      })
      break
    default:
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: 'LLM',
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
        detail: t('health.streaming.mode', {
          mode: MODE_LABEL[state.continuousListeningMode],
        }),
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
}: {
  state: ControllerState
  onRetry: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [projectStatus, setProjectStatus] = useState<ProjectAwarenessStatus>(EMPTY_PROJECT_STATUS)
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.api.projectAwareness.getStatus().then((status) => {
        if (active) setProjectStatus(status)
      })
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
    ['connecting', 'syncing', 'indexing'].includes(projectStatus.state)
  const hasError =
    cards.some((card) => card.tone === 'negative') ||
    speechService === 'unavailable' ||
    projectStatus.state === 'error'
  const hasNotice =
    cards.some((card) => card.tone === 'notice') ||
    speechService === 'degraded' ||
    projectStatus.state === 'stale'

  const overall: { variant: CardTone; label: string } = checking
    ? { variant: 'informative', label: t('common.checkingEllipsis') }
    : hasError
      ? { variant: 'negative', label: t('health.overall.problems') }
      : hasNotice
        ? { variant: 'notice', label: t('health.overall.attention') }
        : { variant: 'positive', label: t('health.overall.ok') }

  return (
    <section className="health-dashboard">
      <header className="health-dashboard-header">
        <div className="health-dashboard-title">
          <Heading>Runtime Health</Heading>
          <Text UNSAFE_className="health-dashboard-subtitle">{t('health.subtitle')}</Text>
        </div>
        <div className="health-dashboard-actions">
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
      </header>

      <div className="health-card-grid">
        <SpeechApiCard capabilities={state.speechCapabilities} />
        <ProjectAwarenessCard status={projectStatus} />
        {cards.map((card) => (
          <article className={`health-card health-card-${card.tone}`} key={card.id}>
            <div className="health-card-top">
              <span className="health-card-icon" aria-hidden="true">
                {card.icon}
              </span>
              <span className="health-card-name">{card.title}</span>
              {card.busy ? (
                <ProgressCircle
                  size="S"
                  isIndeterminate
                  aria-label={t('health.cardChecking')}
                  UNSAFE_className="health-card-dot-busy"
                />
              ) : (
                <span
                  className={`runtime-status-light runtime-status-${card.tone} health-card-dot`}
                  aria-hidden="true"
                />
              )}
            </div>
            <span className="health-card-status">{card.status}</span>
            <span className="health-card-detail">{card.detail}</span>
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
