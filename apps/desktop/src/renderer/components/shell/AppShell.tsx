import { Button, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2'
import Bug from '@react-spectrum/s2/icons/Bug'
import Chat from '@react-spectrum/s2/icons/Chat'
import Heart from '@react-spectrum/s2/icons/Heart'
import Settings from '@react-spectrum/s2/icons/Settings'
import User from '@react-spectrum/s2/icons/User'
import { type ReactNode, useEffect, useRef, useState } from 'react'

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
  hideHeader = false,
}: {
  section: AppSection
  onSectionChange: (section: AppSection) => void
  health: { state: HealthState; text: string }
  developerModeEnabled: boolean
  children: ReactNode
  headerAction?: ReactNode
  hideHeader?: boolean
}) {
  const { t } = useTranslation()
  const [releaseInfo, setReleaseInfo] = useState<
    Awaited<ReturnType<Window['api']['system']['getReleaseInfo']>> | undefined
  >()
  const [versionCopied, setVersionCopied] = useState(false)
  const versionCopiedTimer = useRef<number | null>(null)
  useEffect(() => {
    let active = true
    void window.api.system.getReleaseInfo().then((info) => {
      if (active) setReleaseInfo(info)
    })
    return () => {
      active = false
    }
  }, [])
  useEffect(
    () => () => {
      if (versionCopiedTimer.current !== null) window.clearTimeout(versionCopiedTimer.current)
    },
    [],
  )
  const copyVersion = async (): Promise<void> => {
    if (!releaseInfo) return
    await navigator.clipboard.writeText(releaseInfo.version)
    setVersionCopied(true)
    if (versionCopiedTimer.current !== null) window.clearTimeout(versionCopiedTimer.current)
    versionCopiedTimer.current = window.setTimeout(() => setVersionCopied(false), 2_000)
  }
  const primary: Array<{ id: AppSection; label: string; icon: ReactNode }> = [
    { id: 'chat', label: t('app.nav.chat'), icon: <Chat /> },
    ...(developerModeEnabled
      ? [{ id: 'avatar' as const, label: t('app.nav.avatar'), icon: <User /> }]
      : []),
    { id: 'health', label: t('app.nav.health'), icon: <Heart /> },
  ]
  const utility: Array<{ id: AppSection; label: string; icon: ReactNode }> = [
    ...(developerModeEnabled
      ? [{ id: 'debug' as const, label: t('app.nav.diagnostics'), icon: <Bug /> }]
      : []),
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
        <div className="sidebar-utility">
          {renderItems(utility)}
          {renderItems([{ id: 'settings', label: t('app.nav.settings'), icon: <Settings /> }])}
          <TooltipTrigger delay={200}>
            <button
              className="sidebar-version"
              type="button"
              disabled={!releaseInfo}
              aria-label={t('app.version.copy')}
              onClick={() => void copyVersion()}
            >
              <Text UNSAFE_className="sidebar-version-number">
                {releaseInfo ? `v${releaseInfo.version}` : 'v\u00a0—'}
              </Text>
            </button>
            <Tooltip>{t(versionCopied ? 'app.version.copied' : 'app.version.copy')}</Tooltip>
          </TooltipTrigger>
          <span className="sidebar-version-status" role="status" aria-live="polite">
            {versionCopied ? t('app.version.copied') : ''}
          </span>
        </div>
      </nav>
      <main className="app-main">
        {!hideHeader && (
          <header className="section-header">
            <div>{children}</div>
            <div className="section-header-actions">
              {headerAction}
              <RuntimeStatusIndicator health={health} onPress={() => onSectionChange('health')} />
            </div>
          </header>
        )}
      </main>
    </div>
  )
}

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="section-heading-copy">
      <div className="section-title-row">
        <h1>{title}</h1>
        {action}
      </div>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
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
