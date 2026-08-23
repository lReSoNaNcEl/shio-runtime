import { ActionButton, Text } from '@react-spectrum/s2'
import CodeIcon from '@react-spectrum/s2/icons/Code'
import DataIcon from '@react-spectrum/s2/icons/Data'
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone'
import SettingsIcon from '@react-spectrum/s2/icons/Settings'
import UserAvatarIcon from '@react-spectrum/s2/icons/UserAvatar'
import { type ReactElement } from 'react'

import { type SettingsSection } from './state/settingsContracts'

const icons: Record<SettingsSection, ReactElement> = {
  general: <SettingsIcon />,
  speech: <MicrophoneIcon />,
  llm: <DataIcon />,
  avatar: <UserAvatarIcon />,
  advanced: <CodeIcon />,
}

const sections: readonly SettingsSection[] = ['general', 'llm', 'speech', 'avatar', 'advanced']

export function SettingsNavigation({
  activeSection,
  labels,
  onSelect,
  ariaLabel,
}: {
  activeSection: SettingsSection
  labels: Record<SettingsSection, string>
  onSelect: (section: SettingsSection) => void
  ariaLabel: string
}) {
  return (
    <aside className="settings-nav" aria-label={ariaLabel}>
      {sections.map((section) => (
        <ActionButton
          key={section}
          isQuiet
          UNSAFE_className={activeSection === section ? 'active' : undefined}
          aria-current={activeSection === section ? 'page' : undefined}
          onPress={() => onSelect(section)}
        >
          <span className="settings-nav-icon">{icons[section]}</span>
          <Text>{labels[section]}</Text>
        </ActionButton>
      ))}
    </aside>
  )
}
