import { useState } from 'react'

export function useDeveloperSettings() {
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false)
  const [developerOverlayAnimationHudEnabled, setDeveloperOverlayAnimationHudEnabledState] =
    useState(true)

  return {
    developerModeEnabled,
    developerOverlayAnimationHudEnabled,
    setDeveloperModeEnabled,
    setDeveloperOverlayAnimationHudEnabledState,
  }
}
