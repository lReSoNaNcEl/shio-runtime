import { Button } from '@react-spectrum/s2'
import Bug from '@react-spectrum/s2/icons/Bug'
import Chat from '@react-spectrum/s2/icons/Chat'
import Heart from '@react-spectrum/s2/icons/Heart'
import Settings from '@react-spectrum/s2/icons/Settings'
import User from '@react-spectrum/s2/icons/User'
import { type ReactNode } from 'react'

import { type HealthState } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { RuntimeStatusIndicator } from './RuntimeStatusIndicator'

export type AppSection = 'chat' | 'avatar' | 'health' | 'debug' | 'settings'

export function AppShell({
  section,
  onSectionChange,
  health,
  developerModeEnabled,
  children,
  headerAction,
}: {
  section: AppSection
  onSectionChange: (section: AppSection) => void
  health: { state: HealthState; text: string }
  developerModeEnabled: boolean
  children: ReactNode
  headerAction?: ReactNode
}) {
  const { t } = useTranslation()
  const primary: Array<{ id: AppSection; label: string; icon: ReactNode }> = [
    { id: 'chat', label: t('app.nav.chat'), icon: <Chat /> },
    { id: 'avatar', label: t('app.nav.avatar'), icon: <User /> },
    { id: 'health', label: t('app.nav.health'), icon: <Heart /> },
  ]
  const utility: Array<{ id: AppSection; label: string; icon: ReactNode }> = [
    ...(developerModeEnabled
      ? [{ id: 'debug' as const, label: t('app.nav.diagnostics'), icon: <Bug /> }]
      : []),
    { id: 'settings', label: t('app.nav.settings'), icon: <Settings /> },
  ]
  const renderItems = (items: typeof primary) =>
    items.map((item) => (
      <button
        key={item.id}
        className="sidebar-item"
        type="button"
        aria-current={section === item.id ? 'page' : undefined}
        onClick={() => onSectionChange(item.id)}
      >
        <span className="sidebar-icon" aria-hidden="true">
          {item.icon}
        </span>
        {item.label}
      </button>
    ))
  return (
    <div className="app-shell">
      <nav className="app-sidebar" aria-label={t('app.nav.label')}>
        <div className="sidebar-brand">Shio</div>
        <div className="sidebar-group">{renderItems(primary)}</div>
        <div className="sidebar-utility">{renderItems(utility)}</div>
      </nav>
      <main className="app-main">
        <header className="section-header">
          <div>{children}</div>
          <div className="section-header-actions">
            {headerAction}
            <RuntimeStatusIndicator health={health} onPress={() => onSectionChange('health')} />
          </div>
        </header>
      </main>
    </div>
  )
}

export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </>
  )
}

export function OpenSettingsButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant="secondary" onPress={onPress}>
      {t('app.openAvatarSettings')}
    </Button>
  )
}
