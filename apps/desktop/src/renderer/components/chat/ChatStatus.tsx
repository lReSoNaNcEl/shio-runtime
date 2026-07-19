import { ProgressCircle, StatusLight } from '@react-spectrum/s2'

import { type ControllerState } from '../../Controller'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'

type StatusVariant = 'positive' | 'informative' | 'notice' | 'negative'

function deriveChatStatus(
  state: ControllerState,
  t: LocalizationContextValue['t'],
): { variant: StatusVariant; label: string } {
  if (state.continuousListeningState === 'error') {
    return { variant: 'negative', label: t('chat.status.error') }
  }
  switch (state.status) {
    case 'listening':
      return { variant: 'informative', label: t('chat.status.listening') }
    case 'recognizing':
    case 'thinking':
      return { variant: 'notice', label: t('chat.status.thinking') }
    case 'synthesizing':
    case 'speaking':
      return { variant: 'informative', label: t('chat.status.speaking') }
    default:
      return { variant: 'positive', label: t('chat.ready') }
  }
}

function voiceSuffix(state: ControllerState, t: LocalizationContextValue['t']): string | null {
  const asrDown = state.speechCapabilities.recognition === 'unavailable'
  const ttsDown = state.speechCapabilities.synthesis === 'unavailable'
  if (asrDown && ttsDown) return t('chat.voice.none')
  if (asrDown) return t('chat.voice.microphone')
  if (ttsDown) return t('chat.voice.synthesis')
  return null
}

export function ChatStatus({ state }: { state: ControllerState }) {
  const { t } = useTranslation()
  const busy = state.status !== 'idle'
  const chatStatus = deriveChatStatus(state, t)
  const suffix = voiceSuffix(state, t)
  const showSpeechProgress = state.status === 'speaking' || state.status === 'synthesizing'

  return (
    <div id="controls-status">
      <div className="status-row" title={suffix ? t('chat.voiceUnavailableTitle') : undefined}>
        <StatusLight variant={chatStatus.variant} size="S">
          {suffix && chatStatus.label === t('chat.ready')
            ? `${chatStatus.label} · ${suffix}`
            : chatStatus.label}
        </StatusLight>
        {busy && (
          <ProgressCircle
            aria-label={chatStatus.label}
            isIndeterminate
            size="S"
            UNSAFE_className="status-spinner"
          />
        )}
      </div>
      <div className={showSpeechProgress ? 'speech-progress visible' : 'speech-progress'}>
        <span style={{ width: `${Math.round(state.speechProgress * 100)}%` }} />
      </div>
    </div>
  )
}
