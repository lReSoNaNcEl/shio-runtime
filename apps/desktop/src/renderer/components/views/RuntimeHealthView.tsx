import { ActionButton, Content, Heading, InlineAlert, ProgressCircle, StatusLight, Text } from '@react-spectrum/s2'
import AudioWaveIcon from '@react-spectrum/s2/icons/AudioWave'
import DataIcon from '@react-spectrum/s2/icons/Data'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import RefreshIcon from '@react-spectrum/s2/icons/Refresh'
import type { ControllerState } from '../../Controller'

type CardTone = 'positive' | 'informative' | 'neutral' | 'notice' | 'negative'

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
  streamer: 'Streamer'
}

function buildCards(state: ControllerState): HealthCard[] {
  const cards: HealthCard[] = []

  // ASR / TTS
  const health = state.health
  if (health.state === 'checking') {
    cards.push({ id: 'asr', icon: <AudioWaveIcon />, title: 'ASR / TTS', tone: 'informative', status: 'Проверка…', detail: 'Проверяем подключение', busy: true })
  } else if (health.state === 'ok') {
    cards.push({ id: 'asr', icon: <AudioWaveIcon />, title: 'ASR / TTS', tone: 'positive', status: 'Подключено', detail: 'Сервер отвечает' })
  } else if (health.state === 'warn') {
    cards.push({ id: 'asr', icon: <AudioWaveIcon />, title: 'ASR / TTS', tone: 'notice', status: 'Внимание', detail: health.text })
  } else {
    cards.push({ id: 'asr', icon: <AudioWaveIcon />, title: 'ASR / TTS', tone: 'negative', status: 'Недоступно', detail: 'Не удалось подключиться к серверу' })
  }

  // LLM
  const llm = state.llmHealth
  switch (llm.state) {
    case 'checking':
      cards.push({ id: 'llm', icon: <DataIcon />, title: 'LLM', tone: 'informative', status: 'Проверка…', detail: llm.detail, busy: true })
      break
    case 'ok':
      cards.push({ id: 'llm', icon: <DataIcon />, title: 'LLM', tone: 'positive', status: 'Доступно', detail: llm.detail })
      break
    case 'error':
      cards.push({ id: 'llm', icon: <DataIcon />, title: 'LLM', tone: 'negative', status: 'Ошибка', detail: llm.detail })
      break
    default:
      cards.push({ id: 'llm', icon: <DataIcon />, title: 'LLM', tone: 'neutral', status: 'Не проверено', detail: llm.detail })
  }

  // Стриминг (continuous listening)
  switch (state.continuousListeningState) {
    case 'on':
      cards.push({ id: 'streaming', icon: <MicrophoneIcon />, title: 'Стриминг', tone: 'positive', status: 'Запущено', detail: `Режим: ${MODE_LABEL[state.continuousListeningMode]}` })
      break
    case 'starting':
      cards.push({ id: 'streaming', icon: <MicrophoneIcon />, title: 'Стриминг', tone: 'informative', status: 'Запуск…', detail: 'Открываем микрофон', busy: true })
      break
    case 'error':
      cards.push({ id: 'streaming', icon: <MicrophoneIcon />, title: 'Стриминг', tone: 'negative', status: 'Ошибка', detail: state.continuousListeningError || 'Не удалось открыть микрофон' })
      break
    default:
      cards.push({ id: 'streaming', icon: <MicrophoneIcon />, title: 'Стриминг', tone: 'neutral', status: 'Выключено', detail: 'Режим не запущен' })
  }

  return cards
}

export function RuntimeHealthView({ state, onRetry }: { state: ControllerState; onRetry: () => void }): React.JSX.Element {
  const cards = buildCards(state)
  const checking = state.health.state === 'checking' || state.llmHealth.state === 'checking'
  const hasError = cards.some((card) => card.tone === 'negative')
  const hasNotice = cards.some((card) => card.tone === 'notice')

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
          <Text UNSAFE_className="health-dashboard-subtitle">Состояние сервисов и компонентов Shio Runtime</Text>
        </div>
        <div className="health-dashboard-actions">
          <StatusLight role="status" variant={overall.variant} size="M">{overall.label}</StatusLight>
          <ActionButton onPress={onRetry} isDisabled={checking} aria-label={checking ? 'Проверяем…' : 'Повторить проверку'}>
            {checking ? <ProgressCircle size="S" isIndeterminate aria-label="Проверяем" /> : <RefreshIcon />}
          </ActionButton>
        </div>
      </header>

      <div className="health-card-grid">
        {cards.map((card) => (
          <article className={`health-card health-card-${card.tone}`} key={card.id}>
            <div className="health-card-top">
              <span className="health-card-icon" aria-hidden="true">{card.icon}</span>
              <span className="health-card-name">{card.title}</span>
              {card.busy
                ? <ProgressCircle size="S" isIndeterminate aria-label="Проверяется" UNSAFE_className="health-card-dot-busy" />
                : <span className={`runtime-status-light runtime-status-${card.tone} health-card-dot`} aria-hidden="true" />}
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
