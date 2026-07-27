import { useEffect, useState } from 'react'

import type { SettingsSection } from './settingsContracts'

export function useSettingsNavigation(isOpen: boolean, initialSection: SettingsSection) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection)

  useEffect(() => {
    if (isOpen) setActiveSection(initialSection)
  }, [initialSection, isOpen])

  return { activeSection, setActiveSection }
}
