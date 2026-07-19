import {
  ActionButton,
  Button,
  ProgressCircle,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import ImageAdd from '@react-spectrum/s2/icons/ImageAdd'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import Send from '@react-spectrum/s2/icons/Send'
import Stop from '@react-spectrum/s2/icons/StopProcessing'

import { useTranslation } from '../../localization/useTranslation'

export interface ChatComposerProps {
  text: string
  busy: boolean
  gateOpen: boolean
  listening: boolean
  canInterrupt: boolean
  interruptionPending: boolean
  onTextChange: (text: string) => void
  onSubmit: () => void
  onAttachScreen: () => void
  onToggleMicrophone: () => void
  onInterrupt: () => void
  microphoneUnavailable?: boolean
  microphoneDisabled?: boolean
}

export function ChatComposer({
  text,
  busy,
  gateOpen,
  listening,
  canInterrupt,
  interruptionPending,
  onTextChange,
  onSubmit,
  onAttachScreen,
  onToggleMicrophone,
  onInterrupt,
  microphoneUnavailable = false,
  microphoneDisabled = false,
}: ChatComposerProps) {
  const { t } = useTranslation()
  const showResponseControl = canInterrupt || interruptionPending
  const microphoneLabel = microphoneUnavailable
    ? t('chat.recognitionUnavailable')
    : listening
      ? t('chat.stopRecording')
      : t('chat.voiceInput')

  return (
    <div id="controls-input">
      <TooltipTrigger>
        <ActionButton
          isQuiet
          aria-label={t('screenContext.attach.action')}
          isDisabled={gateOpen || busy}
          onPress={onAttachScreen}
        >
          <ImageAdd />
        </ActionButton>
        <Tooltip>{t('screenContext.attach.action')}</Tooltip>
      </TooltipTrigger>
      <TextField
        aria-label={t('chat.message')}
        size="XL"
        value={text}
        onChange={onTextChange}
        placeholder={t('chat.placeholder')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSubmit()
          }
        }}
        UNSAFE_className="chat-input"
      />
      {showResponseControl ? (
        <TooltipTrigger>
          <ActionButton
            isQuiet
            aria-label={t('chat.stopResponse')}
            isDisabled={interruptionPending}
            onPress={onInterrupt}
          >
            {interruptionPending ? (
              <ProgressCircle aria-label={t('chat.stopResponse')} isIndeterminate size="S" />
            ) : (
              <Stop />
            )}
          </ActionButton>
          <Tooltip>{t('chat.stopResponse')}</Tooltip>
        </TooltipTrigger>
      ) : (
        <TooltipTrigger>
          <ActionButton
            isQuiet
            aria-label={microphoneLabel}
            isDisabled={!microphoneUnavailable && microphoneDisabled}
            onPress={onToggleMicrophone}
            UNSAFE_className={
              microphoneUnavailable ? 'mic-unavailable' : listening ? 'mic-recording' : undefined
            }
          >
            <Microphone />
          </ActionButton>
          <Tooltip>{microphoneLabel}</Tooltip>
        </TooltipTrigger>
      )}
      <TooltipTrigger>
        <Button
          variant="accent"
          isDisabled={!text.trim()}
          onPress={onSubmit}
          aria-label={t('chat.send')}
        >
          <Send />
        </Button>
        <Tooltip>{t('chat.send')}</Tooltip>
      </TooltipTrigger>
    </div>
  )
}
