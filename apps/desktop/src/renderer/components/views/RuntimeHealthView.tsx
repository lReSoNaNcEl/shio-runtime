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

const PROJECT_STATUS_LABEL: Record<
  ProjectAwarenessStatus['state'],
  { label: string; tone: CardTone }
> = {
  disconnected: { label: 'Отключено', tone: 'neutral' },
  connecting: { label: 'Подключение…', tone: 'informative' },
  ready: { label: 'Готово', tone: 'positive' },
  syncing: { label: 'Синхронизация…', tone: 'informative' },
  indexing: { label: 'Индексация…', tone: 'informative' },
  stale: { label: 'Индекс устарел', tone: 'notice' },
  error: { label: 'Ошибка', tone: 'negative' },
}

const INDEX_STATE_LABEL: Record<ProjectAwarenessStatus['indexState'], string> = {
  not_built: 'Не построен',
  current: 'Актуален',
  stale: 'Устарел',
  building: 'Строится',
  error: 'Ошибка',
}

function projectActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function ProjectAwarenessCard({ status }: { status: ProjectAwarenessStatus }): React.JSX.Element {
  const [map, setMap] = useState<ProjectMap | null>(null)
  const [actionError, setActionError] = useState('')
  const [mapLoading, setMapLoading] = useState(false)
  const state = PROJECT_STATUS_LABEL[status.state]
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
            aria-label={state.label}
            UNSAFE_className="health-card-dot-busy"
          />
        ) : (
          <span
            className={`runtime-status-light runtime-status-${state.tone} health-card-dot`}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="health-card-status">{state.label}</span>
      <dl className="project-awareness-details">
        <div>
          <dt>Provider</dt>
          <dd>GitHub</dd>
        </div>
        <div>
          <dt>Enabled</dt>
          <dd>{status.enabled ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Repository</dt>
          <dd>{status.repository}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{status.branch}</dd>
        </div>
        <div>
          <dt>Remote HEAD</dt>
          <dd>{status.remoteHead?.slice(0, 7) ?? '—'}</dd>
        </div>
        <div>
          <dt>Indexed commit</dt>
          <dd>{status.indexedCommit?.slice(0, 7) ?? '—'}</dd>
        </div>
        <div>
          <dt>Index state</dt>
          <dd>{INDEX_STATE_LABEL[status.indexState]}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>Read-only</dd>
        </div>
        <div>
          <dt>Credential</dt>
          <dd>
            {status.credential.source === 'secure_store' ? 'Saved securely' : 'Not configured'}
          </dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>
            {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString('ru-RU') : '—'}
          </dd>
        </div>
      </dl>
      {(actionError || status.lastError) && (
        <span className="project-awareness-error">{actionError || status.lastError}</span>
      )}
      <div className="project-awareness-actions">
        <ActionButton isDisabled={!hasIndex || busy} onPress={openMap}>
          {mapLoading ? 'Opening…' : 'Open project map'}
        </ActionButton>
      </div>
      {map && (
        <details className="project-map-details" open>
          <summary>Project map · {map.snapshot.commitSha.slice(0, 7)}</summary>
          <p>{map.overview}</p>
          <ul>
            {map.architecture.map((section) => (
              <li key={section.name}>
                <strong>{section.name}</strong> · {section.paths.length} key files
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

const SPEECH_SERVICE_LABEL: Record<
  SpeechCapabilitiesState['service'],
  { label: string; tone: CardTone }
> = {
  unknown: { label: 'Проверка', tone: 'informative' },
  checking: { label: 'Проверка', tone: 'informative' },
  available: { label: 'Работает', tone: 'positive' },
  degraded: { label: 'Частично доступен', tone: 'notice' },
  unavailable: { label: 'Недоступен', tone: 'negative' },
}

function capabilityLabel(status: SpeechCapabilityStatus): { text: string; tone: CardTone } {
  switch (status) {
    case 'available':
      return { text: 'Работает', tone: 'positive' }
    case 'unavailable':
      return { text: 'Недоступен', tone: 'negative' }
    default:
      return { text: '—', tone: 'neutral' }
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
  const service = SPEECH_SERVICE_LABEL[capabilities.service]
  const rows: Array<{ id: string; label: string; status: SpeechCapabilityStatus }> = [
    { id: 'asr', label: 'ASR', status: capabilities.recognition },
    { id: 'tts', label: 'TTS', status: capabilities.synthesis },
    { id: 'streaming', label: 'Streaming', status: capabilities.streaming },
  ]
  const lastChecked = capabilities.lastCheckedAt
    ? new Date(capabilities.lastCheckedAt).toLocaleTimeString('ru-RU')
    : '—'
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
      <span className="health-card-status">{service.label}</span>

      <dl className="speech-capability-list">
        {rows.map((row) => {
          const value = capabilityLabel(row.status)
          return (
            <div className="speech-capability-row" key={row.id}>
              <dt>{row.label}</dt>
              <dd className={`speech-capability-${value.tone}`}>{value.text}</dd>
            </div>
          )
        })}
      </dl>
      <span className="health-card-detail">Последняя проверка: {lastChecked}</span>
      {hasProblem && (
        <span className="health-card-detail">Не удалось подключиться к локальному сервису</span>
      )}

      <div className="speech-card-actions">
        <ActionButton onPress={() => controller.recheckSpeechService()}>
          Проверить снова
        </ActionButton>
      </div>

      {capabilities.technicalMessage && (
        <details className="speech-technical-details">
          <summary>Технические детали</summary>
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

function buildCards(state: ControllerState): HealthCard[] {
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
        status: 'Проверка…',
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
        status: 'Доступно',
        detail: llm.detail,
      })
      break
    case 'error':
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: 'LLM',
        tone: 'negative',
        status: 'Ошибка',
        detail: llm.detail,
      })
      break
    default:
      cards.push({
        id: 'llm',
        icon: <DataIcon />,
        title: 'LLM',
        tone: 'neutral',
        status: 'Не проверено',
        detail: llm.detail,
      })
  }

  // Стриминг (continuous listening)
  switch (state.continuousListeningState) {
    case 'on':
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: 'Стриминг',
        tone: 'positive',
        status: 'Запущено',
        detail: `Режим: ${MODE_LABEL[state.continuousListeningMode]}`,
      })
      break
    case 'starting':
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: 'Стриминг',
        tone: 'informative',
        status: 'Запуск…',
        detail: 'Открываем микрофон',
        busy: true,
      })
      break
    case 'error':
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: 'Стриминг',
        tone: 'negative',
        status: 'Ошибка',
        detail: state.continuousListeningError || 'Не удалось открыть микрофон',
      })
      break
    default:
      cards.push({
        id: 'streaming',
        icon: <MicrophoneIcon />,
        title: 'Стриминг',
        tone: 'neutral',
        status: 'Выключено',
        detail: 'Режим не запущен',
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
  const cards = buildCards(state)
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
    ? { variant: 'informative', label: 'Проверка…' }
    : hasError
      ? { variant: 'negative', label: 'Есть проблемы' }
      : hasNotice
        ? { variant: 'notice', label: 'Требует внимания' }
        : { variant: 'positive', label: 'Всё работает' }

  return (
    <section className="health-dashboard">
      <header className="health-dashboard-header">
        <div className="health-dashboard-title">
          <Heading>Runtime Health</Heading>
          <Text UNSAFE_className="health-dashboard-subtitle">
            Состояние сервисов и компонентов Shio Runtime
          </Text>
        </div>
        <div className="health-dashboard-actions">
          <StatusLight role="status" variant={overall.variant} size="M">
            {overall.label}
          </StatusLight>
          <ActionButton
            onPress={onRetry}
            isDisabled={checking}
            aria-label={checking ? 'Проверяем…' : 'Повторить проверку'}
          >
            {checking ? (
              <ProgressCircle size="S" isIndeterminate aria-label="Проверяем" />
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
                  aria-label="Проверяется"
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
          <Heading>Некоторые компоненты требуют внимания</Heading>
          <Content>Откройте карточку или Debug для подробностей.</Content>
        </InlineAlert>
      )}
    </section>
  )
}
