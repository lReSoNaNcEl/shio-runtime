import { useState } from 'react'

import { DEFAULT_SPEECH_URL } from '../../../../shared/config'
import type { SettingsDialogViewModel } from './settingsContracts'
import { defaultSettingsForm } from './settingsDefaults'

export function useVoiceSettings() {
  const [speechUrl, setSpeechUrl] = useState(DEFAULT_SPEECH_URL)
  const [lang, setLang] = useState(defaultSettingsForm.ttsLanguage)
  const [mics, setMics] = useState<Array<{ deviceId: string; label: string }>>([])
  const [micId, setMicId] = useState(defaultSettingsForm.microphoneId)
  const [microphoneTestState, setMicrophoneTestState] =
    useState<SettingsDialogViewModel['speech']['state']['microphoneTestState']>('idle')
  const [microphoneLevel, setMicrophoneLevel] = useState(0)

  return {
    lang,
    microphoneLevel,
    microphoneTestState,
    micId,
    mics,
    setLang,
    setMicrophoneLevel,
    setMicrophoneTestState,
    setMicId,
    setMics,
    setSpeechUrl,
    speechUrl,
  }
}
