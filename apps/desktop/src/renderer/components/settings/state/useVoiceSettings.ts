import { useState } from 'react'

import type { SettingsDialogViewModel } from './settingsContracts'
import { defaultSettingsForm } from './settingsDefaults'

export function useVoiceSettings() {
  const [speechVolumePercent, setSpeechVolumePercent] = useState<number | null>(null)
  const [mics, setMics] = useState<Array<{ deviceId: string; label: string }>>([])
  const [micId, setMicId] = useState(defaultSettingsForm.microphoneId)
  const [microphoneTestState, setMicrophoneTestState] =
    useState<SettingsDialogViewModel['speech']['state']['microphoneTestState']>('idle')
  const [microphoneLevel, setMicrophoneLevel] = useState(0)
  const [microphoneTestFailure, setMicrophoneTestFailure] =
    useState<SettingsDialogViewModel['speech']['state']['microphoneTestFailure']>(null)

  return {
    speechVolumePercent,
    setSpeechVolumePercent,
    microphoneLevel,
    microphoneTestState,
    microphoneTestFailure,
    micId,
    mics,
    setMicrophoneLevel,
    setMicrophoneTestState,
    setMicrophoneTestFailure,
    setMicId,
    setMics,
  }
}
