export interface DeveloperModeDefaults {
  developerModeEnabled: string
  developerOverlayAnimationHudEnabled: string
}

export function developerModeDefaults(isPackaged: boolean): DeveloperModeDefaults {
  const enabled = isPackaged ? 'false' : 'true'
  return {
    developerModeEnabled: enabled,
    developerOverlayAnimationHudEnabled: enabled,
  }
}

export function resolveDeveloperModeSettings(
  saved: {
    developerModeEnabled?: string
    developerOverlayAnimationHudEnabled?: string
  },
  isPackaged: boolean,
): DeveloperModeDefaults {
  const defaults = developerModeDefaults(isPackaged)
  return {
    developerModeEnabled:
      saved.developerModeEnabled === undefined
        ? defaults.developerModeEnabled
        : saved.developerModeEnabled === 'true'
          ? 'true'
          : 'false',
    developerOverlayAnimationHudEnabled:
      saved.developerOverlayAnimationHudEnabled === undefined
        ? defaults.developerOverlayAnimationHudEnabled
        : saved.developerOverlayAnimationHudEnabled === 'false'
          ? 'false'
          : 'true',
  }
}
