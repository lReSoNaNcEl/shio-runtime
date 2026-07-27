import {
  Button,
  Heading,
  Meter,
  Picker,
  PickerItem,
  StatusLight,
  Switch,
  Text,
  TextField,
} from '@react-spectrum/s2'
import Microphone from '@react-spectrum/s2/icons/Microphone'
import Play from '@react-spectrum/s2/icons/Play'
import { style } from '@react-spectrum/s2/style' with { type: 'macro' }

import { useTranslation } from '../../../localization/useTranslation'
import { type SpeechSettingsActions, type SpeechSettingsState } from '../state/settingsContracts'

const fullWidth = style({ width: 'full' })

export function SpeechSettingsSection({
  state,
  actions,
}: {
  state: SpeechSettingsState
  actions: SpeechSettingsActions
}) {
  const { t } = useTranslation()
  const isRecording = state.microphoneTestState === 'recording'
  const isPlaying = state.microphoneTestState === 'playing'
  const testDisabled = state.continuousListeningState !== 'off'
  const recordingAvailable =
    state.microphoneTestState === 'ready' ||
    state.microphoneTestState === 'playback-error' ||
    isPlaying
  const microphoneStatus =
    state.microphoneTestState === 'capture-error'
      ? { variant: 'negative' as const, text: t('settings.speech.test.captureError') }
      : state.microphoneTestState === 'playback-error'
        ? { variant: 'negative' as const, text: t('settings.speech.test.playbackError') }
        : state.microphoneTestState === 'ready'
          ? { variant: 'positive' as const, text: t('settings.speech.test.ready') }
          : isRecording
            ? { variant: 'notice' as const, text: t('settings.speech.test.recording') }
            : isPlaying
              ? { variant: 'informative' as const, text: t('settings.speech.test.playing') }
              : testDisabled
                ? {
                    variant: 'neutral' as const,
                    text: t('settings.speech.test.stopListening'),
                  }
                : null

  return (
    <div className="settings-grid">
      <TextField
        label={t('settings.speech.voice')}
        value={state.currentTtsVoice}
        onChange={actions.setCurrentTtsVoice}
        styles={fullWidth}
      />
      <Picker
        label={t('settings.speech.ttsLanguage')}
        selectedKey={state.language}
        onSelectionChange={(key) => actions.setLanguage(String(key))}
        styles={fullWidth}
      >
        <PickerItem id="ru">{t('settings.language.ru')}</PickerItem>
        <PickerItem id="en">{t('settings.language.en')}</PickerItem>
      </Picker>
      <Switch
        isSelected={state.continuousListeningState === 'on'}
        isDisabled={state.continuousListeningState === 'starting'}
        onChange={actions.toggleContinuousListening}
      >
        {t(
          state.continuousListeningState === 'on'
            ? 'streaming.state.listening'
            : 'streaming.state.notListening',
        )}
      </Switch>
      <section className="microphone-test-card" aria-labelledby="microphone-test-title">
        <div className="microphone-test-header">
          <div className="microphone-test-copy">
            <Heading id="microphone-test-title" level={3}>
              {t('settings.speech.test.title')}
            </Heading>
            <Text UNSAFE_className="settings-hint">{t('settings.speech.test.description')}</Text>
          </div>
          {microphoneStatus && (
            <StatusLight variant={microphoneStatus.variant}>{microphoneStatus.text}</StatusLight>
          )}
        </div>
        <Meter
          label={t('settings.speech.inputLevel')}
          value={state.microphoneLevel}
          minValue={0}
          maxValue={100}
          valueLabel={`${state.microphoneLevel}%`}
          variant={state.microphoneLevel > 85 ? 'notice' : 'positive'}
          size="L"
          styles={fullWidth}
        />
        <div className="microphone-test-actions">
          <Button
            variant="accent"
            fillStyle="outline"
            size="S"
            isPending={isRecording}
            isDisabled={isPlaying || testDisabled}
            onPress={() => void actions.recordMicrophoneTest()}
          >
            <Microphone />
            <Text>{t('settings.speech.test.record')}</Text>
          </Button>
          <Button
            variant="secondary"
            fillStyle="outline"
            size="S"
            isPending={isPlaying}
            isDisabled={!recordingAvailable || isRecording || testDisabled}
            onPress={() => void actions.playMicrophoneTest()}
          >
            <Play />
            <Text>{t('settings.speech.test.play')}</Text>
          </Button>
          <Text UNSAFE_className="microphone-test-privacy">
            {t('settings.speech.test.privacy')}
          </Text>
        </div>
      </section>
      <Picker
        label={t('settings.speech.microphone')}
        selectedKey={state.microphoneId}
        onSelectionChange={(key) => actions.setMicrophoneId(String(key))}
        styles={fullWidth}
      >
        {state.microphones.map((microphone) => (
          <PickerItem key={microphone.deviceId} id={microphone.deviceId}>
            {microphone.label}
          </PickerItem>
        ))}
      </Picker>
      {state.voiceWarmup.state !== 'idle' && (
        <StatusLight
          variant={
            state.voiceWarmup.state === 'ready'
              ? 'positive'
              : state.voiceWarmup.state === 'failed'
                ? 'negative'
                : 'neutral'
          }
        >
          {t(`settings.speech.voiceWarmup.${state.voiceWarmup.state}`)}
        </StatusLight>
      )}
    </div>
  )
}
