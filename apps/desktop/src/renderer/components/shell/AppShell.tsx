import {
  ActionButton,
  Button,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import Apps from '@react-spectrum/s2/icons/Apps'
import Archive from '@react-spectrum/s2/icons/Archive'
import Bug from '@react-spectrum/s2/icons/Bug'
import Calendar from '@react-spectrum/s2/icons/Calendar'
import Chat from '@react-spectrum/s2/icons/Chat'
import Discover from '@react-spectrum/s2/icons/Discover'
import More from '@react-spectrum/s2/icons/More'
import Settings from '@react-spectrum/s2/icons/Settings'
import User from '@react-spectrum/s2/icons/User'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { type ReleaseInfo } from '../../../shared/system'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { type ApplicationHealth, type RuntimeHealthProjection } from '../../runtime/runtimeHealth'
import { RuntimeStatusIndicator, type SystemStatusActions } from './RuntimeStatusIndicator'

export type AppSection =
  | 'chat'
  | 'capabilities'
  | 'memory'
  | 'tasks'
  | 'avatar'
  | 'plugins'
  | 'debug'
  | 'settings'

function TelegramLogo() {
  return (
    <svg
      className="telegram-logo"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      slot="icon"
    >
      <path d="M9.78 18.65 10.06 14.42 17.74 7.5C18.08 7.2 17.67 7.05 17.22 7.33L7.74 13.3 3.64 12C2.76 11.75 2.74 11.14 3.84 10.7L19.82 4.54C20.56 4.27 21.2 4.72 20.97 5.84L18.25 18.64C18.06 19.55 17.51 19.77 16.75 19.34L12.61 16.28 10.61 18.21C10.39 18.43 10.21 18.61 9.78 18.65Z" />
    </svg>
  )
}

export function AppShell({
  section,
  onSectionChange,
  health,
  runtimeHealth,
  systemStatusActions,
  developerModeEnabled,
  children,
  heading,
  sidebarAction,
  headerAction,
  hideHeader = false,
  contentClassName,
}: {
  section: AppSection
  onSectionChange: (section: AppSection) => void
  health: { state: ApplicationHealth; text: string }
  runtimeHealth: RuntimeHealthProjection
  systemStatusActions: SystemStatusActions
  developerModeEnabled: boolean
  children: ReactNode
  heading?: ReactNode
  sidebarAction?: ReactNode
  headerAction?: ReactNode
  hideHeader?: boolean
  contentClassName?: string
}) {
  const { t } = useTranslation()
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo>()
  const [versionCopied, setVersionCopied] = useState(false)
  const versionCopiedTimer = useRef<number | null>(null)
  useEffect(() => {
    let active = true
    observeRendererPromise(
      window.api.system.getReleaseInfo().then((info) => {
        if (active) setReleaseInfo(info)
      }),
      'load Desktop release information',
    )
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
  const openCreator = (): void => {
    observeRendererPromise(
      window.api.system.openExternalLink('https://t.me/IReSoNaNcEI'),
      'open creator Telegram link',
    )
  }
  type NavigationItem = {
    id: AppSection
    label: string
    icon: ReactNode
    mobileOverflow?: boolean
  }
  const primary: NavigationItem[] = [
    { id: 'chat', label: t('app.nav.chat'), icon: <Chat /> },
    { id: 'capabilities', label: t('app.nav.capabilities'), icon: <Discover /> },
    { id: 'memory', label: t('app.nav.memory'), icon: <Archive /> },
    { id: 'tasks', label: t('app.nav.tasks'), icon: <Calendar /> },
    ...(developerModeEnabled
      ? [
          {
            id: 'avatar' as const,
            label: t('app.nav.avatar'),
            icon: <User />,
            mobileOverflow: true,
          },
        ]
      : []),
    { id: 'plugins', label: t('app.nav.plugins'), icon: <Apps /> },
  ]
  const utility: NavigationItem[] = [
    ...(developerModeEnabled
      ? [
          {
            id: 'debug' as const,
            label: t('app.nav.diagnostics'),
            icon: <Bug />,
            mobileOverflow: true,
          },
        ]
      : []),
  ]
  const settingsItem: NavigationItem = {
    id: 'settings',
    label: t('app.nav.settings'),
    icon: <Settings />,
    mobileOverflow: true,
  }
  const mobileOverflowItems: NavigationItem[] = [
    ...primary.filter((item) => item.mobileOverflow),
    ...utility.filter((item) => item.mobileOverflow),
    settingsItem,
  ]
  const mobileOverflowActive = mobileOverflowItems.some((item) => item.id === section)
  const renderItems = (items: NavigationItem[]) =>
    items.map((item) => (
      <ActionButton
        key={item.id}
        isQuiet
        UNSAFE_className={`sidebar-item${item.mobileOverflow ? ' sidebar-item-mobile-overflow' : ''}`}
        aria-label={item.label}
        aria-current={section === item.id ? 'page' : undefined}
        onPress={() => onSectionChange(item.id)}
      >
        <span className="sidebar-icon" aria-hidden="true">
          {item.icon}
        </span>
        <Text UNSAFE_className="sidebar-label">{item.label}</Text>
      </ActionButton>
    ))
  return (
    <div className="app-shell">
      <nav className="app-sidebar" aria-label={t('app.nav.label')}>
        <div className="sidebar-brand">Shio</div>
        {sidebarAction ? <div className="sidebar-primary-action">{sidebarAction}</div> : null}
        <div className="sidebar-group">{renderItems(primary)}</div>
        <div className="sidebar-utility">
          {renderItems(utility)}
          {renderItems([settingsItem])}
          <div className="sidebar-mobile-more">
            <MenuTrigger direction="top" align="end">
              <ActionButton
                isQuiet
                aria-label={t('app.nav.more')}
                aria-current={mobileOverflowActive ? 'page' : undefined}
                UNSAFE_className="sidebar-item"
              >
                <span className="sidebar-icon" aria-hidden="true">
                  <More />
                </span>
                <Text UNSAFE_className="sidebar-label">{t('app.nav.more')}</Text>
              </ActionButton>
              <Menu
                aria-label={t('app.nav.more')}
                onAction={(key) => {
                  if (key === 'creator') {
                    openCreator()
                    return
                  }
                  onSectionChange(String(key) as AppSection)
                }}
              >
                {mobileOverflowItems.map((item) => (
                  <MenuItem id={item.id} key={item.id} textValue={item.label}>
                    {item.icon}
                    <Text>{item.label}</Text>
                  </MenuItem>
                ))}
                <MenuItem id="creator" textValue={t('app.creator.mobile')}>
                  <TelegramLogo />
                  <Text>{t('app.creator.mobile')}</Text>
                </MenuItem>
              </Menu>
            </MenuTrigger>
          </div>
          <div className="sidebar-meta">
            <TooltipTrigger delay={500} placement="right" containerPadding={12}>
              <ActionButton
                size="M"
                isQuiet
                UNSAFE_className="sidebar-creator"
                aria-label={t('app.creator.label')}
                onPress={openCreator}
              >
                <TelegramLogo />
                <Text UNSAFE_className="sidebar-creator-title">{t('app.creator.badge')}</Text>
              </ActionButton>
              <Tooltip>{t('app.creator.tooltip')}</Tooltip>
            </TooltipTrigger>
            <TooltipTrigger delay={200} placement="right" containerPadding={12}>
              <ActionButton
                isQuiet
                UNSAFE_className="sidebar-version"
                isDisabled={!releaseInfo}
                aria-label={t('app.version.copy')}
                onPress={() => observeRendererPromise(copyVersion(), 'copy Desktop version')}
              >
                <Text UNSAFE_className="sidebar-version-number">
                  {releaseInfo ? `v${releaseInfo.version}` : 'v\u00a0—'}
                </Text>
              </ActionButton>
              <Tooltip>{t(versionCopied ? 'app.version.copied' : 'app.version.copy')}</Tooltip>
            </TooltipTrigger>
          </div>
          <span className="sidebar-version-status" role="status" aria-live="polite">
            {versionCopied ? t('app.version.copied') : ''}
          </span>
        </div>
      </nav>
      <main className={`app-main${hideHeader ? ' app-main-full' : ''}`}>
        {!hideHeader && (
          <header className="section-header">
            <div>{heading}</div>
            <div className="section-header-actions">
              <div id="action-runtime-status-slot" className="action-runtime-status-slot" />
              {headerAction}
              <RuntimeStatusIndicator
                health={health}
                projection={runtimeHealth}
                actions={systemStatusActions}
              />
            </div>
          </header>
        )}
        <div className={`section-content${contentClassName ? ` ${contentClassName}` : ''}`}>
          {children}
        </div>
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
        <Heading level={1}>{title}</Heading>
        {action}
      </div>
      {subtitle ? <Text>{subtitle}</Text> : null}
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
