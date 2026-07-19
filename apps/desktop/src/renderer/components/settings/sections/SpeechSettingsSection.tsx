import { Picker, PickerItem, TextField } from '@react-spectrum/s2'
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
  return (
    <div className="settings-grid">
      <TextField
        label={t('settings.speech.url')}
        value={state.speechUrl}
        onChange={actions.setSpeechUrl}
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
    </div>
  )
}
