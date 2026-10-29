import {
  ActionButton,
  Badge,
  Button,
  Content,
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'
import DeviceDesktopIcon from '@react-spectrum/s2/icons/DeviceDesktop'
import DiscoverIcon from '@react-spectrum/s2/icons/Discover'
import ProjectIcon from '@react-spectrum/s2/icons/Project'
import { type ReactNode, useEffect, useState } from 'react'

import { type BrowserControlStatus } from '../../../shared/browser-control'
import { type DesktopControlStatus, DSH_RUNTIME_VERSION } from '../../../shared/desktop-control'
import {
  BROWSER_CONTROL_PLUGIN_ID,
  DESKTOP_CONTROL_PLUGIN_ID,
  type PluginHealthState,
  type PluginId,
  type PluginStatus,
  PROJECT_AWARENESS_PLUGIN_ID,
  WEB_SEARCH_PLUGIN_ID,
} from '../../../shared/plugins'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { BrowserControlPluginView } from './browser-control/BrowserControlPluginView'
import { DesktopControlPluginView } from './desktop-control/DesktopControlPluginView'
import { PluginToggle } from './PluginSummary'
import { ProjectAwarenessPluginView } from './project-awareness/ProjectAwarenessPluginView'
import { WebSearchPluginView } from './web-search/WebSearchPluginView'

type Tone = 'positive' | 'informative' | 'neutral' | 'notice' | 'negative'

const HEALTH: Record<
  PluginHealthState,
  { key: Parameters<LocalizationContextValue['t']>[0]; tone: Tone }
> = {
  healthy: { key: 'plugins.health.healthy', tone: 'positive' },
  'needs-setup': { key: 'plugins.health.needsSetup', tone: 'notice' },
  degraded: { key: 'plugins.health.degraded', tone: 'notice' },
  error: { key: 'plugins.health.error', tone: 'negative' },
}

const EMPTY_DESKTOP_STATUS: DesktopControlStatus = {
  enabled: false,
  runtime: { state: 'stopped', packagedRuntimeAvailable: false, version: DSH_RUNTIME_VERSION },
  automationEngine: 'needs-setup',
  computerControl: 'needs-setup',
  shell: { executableAvailable: false },
  authorityMode: 'confirm',
  model: { provider: 'groq', providerDisplayName: 'Groq', model: '', configured: false },
}

const EMPTY_BROWSER_STATUS: BrowserControlStatus = {
  enabled: false,
  browserName: 'Google Chrome',
  backend: 'playwright',
  backendVersion: '1.62.1',
  executableAvailable: false,
  isolatedProfile: true,
  semanticControl: 'unavailable',
  visualControl: 'needs-setup',
  visualModel: 'Auto',
  session: null,
}

function rendererError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function PluginCatalogStatus({ plugin }: { plugin: PluginStatus }) {
  const { t } = useTranslation()
  if (!plugin.enabled) return <Badge variant="gray">{t('common.disabled')}</Badge>
  const health = HEALTH[plugin.health.state]
  return (
    <StatusLight variant={health.tone} size="S">
      {plugin.health.detailKey ? t(plugin.health.detailKey) : plugin.health.detail || t(health.key)}
    </StatusLight>
  )
}

function PluginCatalogCard({
  plugin,
  icon,
  nameKey,
  descriptionKey,
  onToggle,
  onOpen,
  onRetry,
}: {
  plugin?: PluginStatus
  icon: ReactNode
  nameKey: Parameters<LocalizationContextValue['t']>[0]
  descriptionKey: Parameters<LocalizationContextValue['t']>[0]
  onToggle(enabled: boolean): void
  onOpen(): void
  onRetry(): void
}) {
  const { t } = useTranslation()
  return (
    <article className="plugin-card plugin-card-compact">
      <div className="plugin-card-title">
        <span className="plugin-icon" aria-hidden="true">
          {icon}
        </span>
        <Heading level={2}>{t(nameKey)}</Heading>
        {plugin ? <PluginToggle plugin={plugin} onChange={onToggle} /> : null}
      </div>
      <div className="plugin-card-description">
        <Text>{t(descriptionKey)}</Text>
      </div>
      <div className="plugin-card-footer">
        {plugin ? (
          <PluginCatalogStatus plugin={plugin} />
        ) : (
          <StatusLight variant="negative" size="S">
            {t('plugins.catalog.unavailable')}
          </StatusLight>
        )}
        <Button size="S" variant="secondary" onPress={plugin ? onOpen : onRetry}>
          {t(plugin ? 'plugins.openDetails' : 'common.retry')}
        </Button>
      </div>
    </article>
  )
}

function MissingPlugin({
  nameKey,
  onBack,
  onRetry,
}: {
  nameKey: Parameters<LocalizationContextValue['t']>[0]
  onBack(): void
  onRetry(): void
}) {
  const { t } = useTranslation()
  return (
    <section className="plugin-detail page-container">
      <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
        <ChevronLeftIcon />
        <Text>{t('plugins.backToCatalog')}</Text>
      </ActionButton>
      <InlineAlert variant="negative" fillStyle="subtleFill">
        <Heading>{t(nameKey)}</Heading>
        <Content>{t('plugins.catalog.unavailable')}</Content>
        <Button variant="secondary" onPress={onRetry}>
          {t('common.retry')}
        </Button>
      </InlineAlert>
    </section>
  )
}

export function PluginsView({
  detailPluginId,
  onShowDetails,
  onBack,
  onOpenLlmSettings,
}: {
  detailPluginId: PluginId | null
  onShowDetails(id: PluginId): void
  onBack(): void
  onOpenLlmSettings(): void
}) {
  const { t } = useTranslation()
  const [plugins, setPlugins] = useState<PluginStatus[]>([])
  const [desktopStatus, setDesktopStatus] = useState(EMPTY_DESKTOP_STATUS)
  const [browserStatus, setBrowserStatus] = useState(EMPTY_BROWSER_STATUS)
  const [browserOperation, setBrowserOperation] = useState<'pause' | 'resume' | 'stop' | null>(null)
  const [browserError, setBrowserError] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const refresh = (): void => {
    observeRendererPromise(
      window.api.plugins.list().then(async (items) => {
        setPlugins(items)
        if (detailPluginId === DESKTOP_CONTROL_PLUGIN_ID) {
          setDesktopStatus(await window.api.desktopControl.getStatus())
        }
        if (detailPluginId === BROWSER_CONTROL_PLUGIN_ID) {
          setBrowserStatus(await window.api.browserControl.getStatus())
        }
        setError('')
        setLoaded(true)
      }),
      'refresh Plugin catalog',
      (reason) => {
        setError(rendererError(reason))
        setLoaded(true)
      },
    )
  }

  useEffect(() => {
    let active = true
    const load = (): void => {
      observeRendererPromise(
        Promise.all([
          window.api.plugins.list(),
          detailPluginId === DESKTOP_CONTROL_PLUGIN_ID
            ? window.api.desktopControl.getStatus()
            : Promise.resolve(null),
          detailPluginId === BROWSER_CONTROL_PLUGIN_ID
            ? window.api.browserControl.getStatus()
            : Promise.resolve(null),
        ]).then(([items, desktop, browser]) => {
          if (!active) return
          setPlugins(items)
          if (desktop) setDesktopStatus(desktop)
          if (browser) setBrowserStatus(browser)
          setError('')
          setLoaded(true)
        }),
        'load Plugin catalog',
        (reason) => {
          if (active) {
            setError(rendererError(reason))
            setLoaded(true)
          }
        },
      )
    }
    load()
    const intervalId = window.setInterval(
      load,
      detailPluginId === BROWSER_CONTROL_PLUGIN_ID ? 1_000 : 3_000,
    )
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [detailPluginId])

  const byId = (id: PluginId): PluginStatus | undefined =>
    plugins.find((plugin) => plugin.manifest.id === id)
  const projectPlugin = byId(PROJECT_AWARENESS_PLUGIN_ID)
  const desktopPlugin = byId(DESKTOP_CONTROL_PLUGIN_ID)
  const webSearchPlugin = byId(WEB_SEARCH_PLUGIN_ID)
  const browserPlugin = byId(BROWSER_CONTROL_PLUGIN_ID)

  const togglePlugin = (id: PluginId, enabled: boolean): void => {
    const target = byId(id)
    if (!target || target.busy) return
    setPlugins((items) =>
      items.map((item) => (item.manifest.id === id ? { ...item, busy: true } : item)),
    )
    observeRendererPromise(
      (enabled ? window.api.plugins.enable(id) : window.api.plugins.disable(id)).then((next) => {
        setPlugins((items) => items.map((item) => (item.manifest.id === id ? next : item)))
        if (id === BROWSER_CONTROL_PLUGIN_ID)
          return window.api.browserControl.getStatus().then(setBrowserStatus)
        if (id === DESKTOP_CONTROL_PLUGIN_ID)
          return window.api.desktopControl.getStatus().then(setDesktopStatus)
      }),
      'toggle Plugin',
      (reason) => {
        setError(rendererError(reason))
        refresh()
      },
    )
  }

  const controlBrowser = (operation: 'pause' | 'resume' | 'stop'): void => {
    if (browserOperation) return
    setBrowserOperation(operation)
    setBrowserError('')
    observeRendererPromise(
      window.api.browserControl[operation]().then((status) => {
        setBrowserStatus(status)
        setBrowserOperation(null)
      }),
      `control Browser: ${operation}`,
      (reason) => {
        setBrowserOperation(null)
        setBrowserError(rendererError(reason))
      },
    )
  }

  if (!loaded)
    return (
      <div className="plugins-loading page-container">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
      </div>
    )

  if (detailPluginId === PROJECT_AWARENESS_PLUGIN_ID) {
    return projectPlugin ? (
      <ProjectAwarenessPluginView
        plugin={projectPlugin}
        onBack={onBack}
        onPluginChange={(enabled) => togglePlugin(PROJECT_AWARENESS_PLUGIN_ID, enabled)}
      />
    ) : (
      <MissingPlugin nameKey="plugins.projectAwareness.name" onBack={onBack} onRetry={refresh} />
    )
  }
  if (detailPluginId === DESKTOP_CONTROL_PLUGIN_ID) {
    return desktopPlugin ? (
      <DesktopControlPluginView
        plugin={desktopPlugin}
        status={desktopStatus}
        onBack={onBack}
        onPluginChange={(enabled) => togglePlugin(DESKTOP_CONTROL_PLUGIN_ID, enabled)}
        onStatusChange={setDesktopStatus}
        onOpenLlmSettings={onOpenLlmSettings}
      />
    ) : (
      <MissingPlugin nameKey="plugins.desktopControl.name" onBack={onBack} onRetry={refresh} />
    )
  }
  if (detailPluginId === WEB_SEARCH_PLUGIN_ID) {
    return webSearchPlugin ? (
      <WebSearchPluginView
        plugin={webSearchPlugin}
        onBack={onBack}
        onPluginChange={(enabled) => togglePlugin(WEB_SEARCH_PLUGIN_ID, enabled)}
      />
    ) : (
      <MissingPlugin nameKey="plugins.webSearch.name" onBack={onBack} onRetry={refresh} />
    )
  }
  if (detailPluginId === BROWSER_CONTROL_PLUGIN_ID) {
    return browserPlugin ? (
      <BrowserControlPluginView
        plugin={browserPlugin}
        status={browserStatus}
        operation={browserOperation}
        error={browserError}
        onBack={onBack}
        onPluginChange={(enabled) => togglePlugin(BROWSER_CONTROL_PLUGIN_ID, enabled)}
        onPause={() => controlBrowser('pause')}
        onResume={() => controlBrowser('resume')}
        onStop={() => controlBrowser('stop')}
      />
    ) : (
      <MissingPlugin nameKey="plugins.browserControl.name" onBack={onBack} onRetry={refresh} />
    )
  }

  return (
    <section className="plugins-catalog page-container">
      <Text>{t('plugins.catalog.description')}</Text>
      <div className="plugin-catalog-grid">
        <PluginCatalogCard
          plugin={projectPlugin}
          icon={<ProjectIcon />}
          nameKey="plugins.projectAwareness.name"
          descriptionKey="plugins.projectAwareness.description"
          onToggle={(enabled) => togglePlugin(PROJECT_AWARENESS_PLUGIN_ID, enabled)}
          onOpen={() => onShowDetails(PROJECT_AWARENESS_PLUGIN_ID)}
          onRetry={refresh}
        />
        <PluginCatalogCard
          plugin={desktopPlugin}
          icon={<DeviceDesktopIcon />}
          nameKey="plugins.desktopControl.name"
          descriptionKey="plugins.desktopControl.description"
          onToggle={(enabled) => togglePlugin(DESKTOP_CONTROL_PLUGIN_ID, enabled)}
          onOpen={() => onShowDetails(DESKTOP_CONTROL_PLUGIN_ID)}
          onRetry={refresh}
        />
        <PluginCatalogCard
          plugin={webSearchPlugin}
          icon={<DiscoverIcon />}
          nameKey="plugins.webSearch.name"
          descriptionKey="plugins.webSearch.description"
          onToggle={(enabled) => togglePlugin(WEB_SEARCH_PLUGIN_ID, enabled)}
          onOpen={() => onShowDetails(WEB_SEARCH_PLUGIN_ID)}
          onRetry={refresh}
        />
        <PluginCatalogCard
          plugin={browserPlugin}
          icon={<DeviceDesktopIcon />}
          nameKey="plugins.browserControl.name"
          descriptionKey="plugins.browserControl.description"
          onToggle={(enabled) => togglePlugin(BROWSER_CONTROL_PLUGIN_ID, enabled)}
          onOpen={() => onShowDetails(BROWSER_CONTROL_PLUGIN_ID)}
          onRetry={refresh}
        />
      </div>
      {error ? (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      ) : null}
    </section>
  )
}
