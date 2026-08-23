import {
  ActionButton,
  Button,
  Content,
  Divider,
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Switch,
  Text,
  TextField,
} from '@react-spectrum/s2'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'
import DataIcon from '@react-spectrum/s2/icons/Data'
import { useEffect, useState } from 'react'

import {
  type PluginHealthState,
  type PluginLifecycleState,
  type PluginStatus,
  PROJECT_AWARENESS_PLUGIN_ID,
} from '../../../shared/plugins'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectAwarenessPublicConfig,
  type ProjectAwarenessStatus,
} from '../../../shared/project-awareness'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

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

const LIFECYCLE_KEY: Record<PluginLifecycleState, Parameters<LocalizationContextValue['t']>[0]> = {
  registered: 'plugins.lifecycle.registered',
  initializing: 'plugins.lifecycle.initializing',
  disabled: 'plugins.lifecycle.disabled',
  starting: 'plugins.lifecycle.starting',
  active: 'plugins.lifecycle.active',
  stopping: 'plugins.lifecycle.stopping',
  error: 'plugins.lifecycle.error',
  disposed: 'plugins.lifecycle.disposed',
}

const PROJECT_STATE_KEY: Record<
  ProjectAwarenessStatus['state'],
  Parameters<LocalizationContextValue['t']>[0]
> = {
  disconnected: 'health.project.state.disconnected',
  connecting: 'health.project.state.connecting',
  ready: 'health.project.state.ready',
  syncing: 'health.project.state.syncing',
  indexing: 'health.project.state.indexing',
  stale: 'health.project.state.stale',
  error: 'common.error',
}

const PROJECT_INDEX_STATE_KEY: Record<
  ProjectAwarenessStatus['indexState'],
  Parameters<LocalizationContextValue['t']>[0]
> = {
  not_built: 'health.project.index.notBuilt',
  current: 'health.project.index.current',
  stale: 'health.project.index.stale',
  building: 'health.project.index.building',
  error: 'common.error',
}

const EMPTY_PROJECT_STATUS: ProjectAwarenessStatus = {
  enabled: false,
  state: 'disconnected',
  provider: 'github',
  repository: '',
  branch: 'main',
  indexState: 'not_built',
  access: 'read-only',
  indexedFileCount: 0,
  credential: {
    configured: false,
    source: 'none',
    secureStorageAvailable: false,
  },
}

function rendererError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function PluginSummary({ plugin }: { plugin: PluginStatus }) {
  const { t } = useTranslation()
  const health = HEALTH[plugin.health.state]
  const detail = plugin.health.detailKey ? t(plugin.health.detailKey) : plugin.health.detail
  return (
    <dl className="plugin-status-list">
      <div>
        <dt>{t('common.enabled')}</dt>
        <dd>{plugin.enabled ? t('common.yes') : t('common.no')}</dd>
      </div>
      <div>
        <dt>{t('plugins.health.label')}</dt>
        <dd>
          <StatusLight variant={health.tone} size="S">
            {detail || t(health.key)}
          </StatusLight>
        </dd>
      </div>
      <div>
        <dt>{t('plugins.lifecycle.label')}</dt>
        <dd>{t(LIFECYCLE_KEY[plugin.lifecycle])}</dd>
      </div>
    </dl>
  )
}

function PluginToggle({
  plugin,
  onChange,
}: {
  plugin: PluginStatus
  onChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Switch isSelected={plugin.enabled} isDisabled={plugin.busy} onChange={onChange}>
      {t('plugins.enabledLabel')}
    </Switch>
  )
}

function ProjectAwarenessDetails({
  plugin,
  onBack,
  onPluginChange,
}: {
  plugin: PluginStatus
  onBack: () => void
  onPluginChange: (enabled: boolean) => void
}) {
  const { intlLocale, t } = useTranslation()
  const [config, setConfig] = useState<ProjectAwarenessPublicConfig>({
    provider: 'github',
    repository: '',
    branch: 'main',
  })
  const [status, setStatus] = useState<ProjectAwarenessStatus>(EMPTY_PROJECT_STATUS)
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmForget, setConfirmForget] = useState(false)

  useEffect(() => {
    let active = true
    observeRendererPromise(
      Promise.all([
        window.api.projectAwareness.getConfig(),
        window.api.projectAwareness.getStatus(),
      ]).then(([nextConfig, nextStatus]) => {
        if (!active) return
        setConfig(nextConfig)
        setStatus(nextStatus)
      }),
      'load Project Awareness plugin details',
      (reason) => {
        if (active) setError(rendererError(reason))
      },
    )
    const intervalId = window.setInterval(() => {
      observeRendererPromise(
        window.api.projectAwareness.getStatus().then((nextStatus) => {
          if (active) setStatus(nextStatus)
        }),
        'refresh Project Awareness plugin status',
      )
    }, 3_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  const run = async (operation: () => Promise<unknown>, successMessage = ''): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await operation()
      setStatus(await window.api.projectAwareness.getStatus())
      setMessage(successMessage)
    } catch (reason) {
      setError(rendererError(reason))
    } finally {
      setBusy(false)
    }
  }

  const saveConfig = async (): Promise<void> => {
    await run(async () => {
      const next = await window.api.projectAwareness.configure({
        ...config,
        repository: config.repository.trim(),
        branch: config.branch.trim(),
      })
      setStatus(next)
      setConfig({ provider: next.provider, repository: next.repository, branch: next.branch })
    }, t('plugins.project.applied'))
  }

  const saveCredential = async (): Promise<void> => {
    await run(async () => {
      setStatus(await window.api.projectAwareness.saveCredential(credential))
      setCredential('')
      setConfirmForget(false)
    }, t('common.saved'))
  }

  const forgetCredential = async (): Promise<void> => {
    if (!confirmForget) {
      setConfirmForget(true)
      return
    }
    await run(async () => {
      setStatus(await window.api.projectAwareness.forgetCredential())
      setCredential('')
      setConfirmForget(false)
    })
  }

  const validTarget =
    isValidProjectRepository(config.repository) && isValidProjectBranch(config.branch)
  const runtimeDisabled = busy || plugin.busy || !plugin.enabled
  const connected = ['ready', 'syncing', 'indexing', 'stale'].includes(status.state)

  return (
    <section className="plugin-detail">
      <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
        <ChevronLeftIcon />
        <Text>{t('plugins.backToCatalog')}</Text>
      </ActionButton>
      <div className="plugin-detail-heading">
        <span className="plugin-icon" aria-hidden="true">
          <DataIcon />
        </span>
        <div>
          <Heading level={2}>{t(plugin.manifest.nameKey)}</Heading>
          <Text>{t(plugin.manifest.descriptionKey)}</Text>
        </div>
        <PluginToggle plugin={plugin} onChange={onPluginChange} />
      </div>
      <PluginSummary plugin={plugin} />
      <Divider />

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.project.configTitle')}</Heading>
        <Text>{t('plugins.project.configDescription')}</Text>
        <div className="plugin-project-fields">
          <TextField
            label={t('common.repository')}
            value={config.repository}
            onChange={(repository) => setConfig((current) => ({ ...current, repository }))}
            isDisabled={busy}
          />
          <TextField
            label={t('common.branch')}
            value={config.branch}
            onChange={(branch) => setConfig((current) => ({ ...current, branch }))}
            isDisabled={busy}
          />
        </div>
        <Button
          variant="secondary"
          onPress={() => void saveConfig()}
          isDisabled={!validTarget || busy}
        >
          {busy ? t('plugins.project.applying') : t('plugins.project.apply')}
        </Button>
      </section>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.project.credentialTitle')}</Heading>
        <Text>{t('plugins.project.credentialDescription')}</Text>
        <StatusLight variant={status.credential.configured ? 'positive' : 'neutral'} size="S">
          {status.credential.configured ? t('common.saved') : t('common.notConfigured')}
        </StatusLight>
        <TextField
          label={t('plugins.project.credentialTitle')}
          aria-label={t('plugins.project.credentialTitle')}
          placeholder={t('plugins.project.credentialPlaceholder')}
          type="password"
          value={credential}
          onChange={setCredential}
          isDisabled={busy}
        />
        <div className="plugin-action-row">
          <Button
            variant="secondary"
            onPress={() => void saveCredential()}
            isDisabled={credential.trim().length < 20 || busy}
          >
            {t('plugins.project.saveCredential')}
          </Button>
          <ActionButton
            onPress={() => void forgetCredential()}
            isDisabled={!status.credential.configured || busy}
          >
            {confirmForget
              ? t('plugins.project.confirmForget')
              : t('plugins.project.forgetCredential')}
          </ActionButton>
          <ActionButton
            onPress={() =>
              observeRendererPromise(
                window.api.projectAwareness.openTokenSettings(),
                'open GitHub token settings',
              )
            }
          >
            {t('plugins.project.openTokenSettings')}
          </ActionButton>
        </div>
      </section>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.project.runtimeTitle')}</Heading>
        {!plugin.enabled && <Text>{t('plugins.project.disabledHint')}</Text>}
        <dl className="plugin-status-list plugin-runtime-status">
          <div>
            <dt>{t('plugins.lifecycle.label')}</dt>
            <dd>{t(PROJECT_STATE_KEY[status.state])}</dd>
          </div>
          <div>
            <dt>{t('health.project.indexState')}</dt>
            <dd>{t(PROJECT_INDEX_STATE_KEY[status.indexState])}</dd>
          </div>
          <div>
            <dt>{t('health.project.access')}</dt>
            <dd>{t('common.readOnly')}</dd>
          </div>
        </dl>
        {status.indexedCommit && (
          <Text>{t('plugins.project.knownCommit', { sha: status.indexedCommit.slice(0, 7) })}</Text>
        )}
        {status.lastSyncAt && (
          <Text>
            {t('plugins.project.lastSync', {
              time: new Date(status.lastSyncAt).toLocaleTimeString(intlLocale),
            })}
          </Text>
        )}
        <div className="plugin-action-row">
          <Button
            variant="secondary"
            onPress={() => void run(() => window.api.projectAwareness.connect())}
            isDisabled={
              runtimeDisabled || connected || !validTarget || !status.credential.configured
            }
          >
            {t('common.connect')}
          </Button>
          <ActionButton
            onPress={() => void run(() => window.api.projectAwareness.disconnect())}
            isDisabled={runtimeDisabled || !connected}
          >
            {t('common.disconnect')}
          </ActionButton>
          <ActionButton
            onPress={() => void run(() => window.api.projectAwareness.sync())}
            isDisabled={runtimeDisabled || !status.credential.configured || !validTarget}
          >
            {t('plugins.project.sync')}
          </ActionButton>
          <ActionButton
            onPress={() => void run(() => window.api.projectAwareness.rebuildIndex())}
            isDisabled={runtimeDisabled || !status.credential.configured || !validTarget}
          >
            {t('plugins.project.rebuild')}
          </ActionButton>
        </div>
      </section>

      {(error || plugin.lastError || status.lastError) && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error || plugin.lastError || status.lastError}</Content>
        </InlineAlert>
      )}
      {message && (
        <StatusLight variant="positive" role="status">
          {message}
        </StatusLight>
      )}
    </section>
  )
}

export function PluginsView({
  showProjectDetails,
  onShowProjectDetails,
  onBack,
}: {
  showProjectDetails: boolean
  onShowProjectDetails: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [plugins, setPlugins] = useState<PluginStatus[]>([])
  const [error, setError] = useState('')

  const refresh = (): void => {
    observeRendererPromise(
      window.api.plugins.list().then(setPlugins),
      'refresh Plugin catalog',
      (reason) => setError(rendererError(reason)),
    )
  }

  useEffect(() => {
    let active = true
    const load = (): void => {
      observeRendererPromise(
        window.api.plugins.list().then((items) => {
          if (active) setPlugins(items)
        }),
        'load Plugin catalog',
        (reason) => {
          if (active) setError(rendererError(reason))
        },
      )
    }
    load()
    const intervalId = window.setInterval(load, 3_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  const projectPlugin = plugins.find((plugin) => plugin.manifest.id === PROJECT_AWARENESS_PLUGIN_ID)
  const toggle = (enabled: boolean): void => {
    if (!projectPlugin || projectPlugin.busy) return
    setError('')
    setPlugins((items) =>
      items.map((item) =>
        item.manifest.id === projectPlugin.manifest.id ? { ...item, busy: true } : item,
      ),
    )
    observeRendererPromise(
      (enabled
        ? window.api.plugins.enable(projectPlugin.manifest.id)
        : window.api.plugins.disable(projectPlugin.manifest.id)
      ).then((next) => {
        setPlugins((items) =>
          items.map((item) => (item.manifest.id === next.manifest.id ? next : item)),
        )
      }),
      'toggle Project Awareness plugin',
      (reason) => {
        setError(rendererError(reason))
        refresh()
      },
    )
  }

  if (!projectPlugin) {
    return (
      <div className="plugins-loading">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
        {error && <Text>{error}</Text>}
      </div>
    )
  }

  if (showProjectDetails) {
    return (
      <ProjectAwarenessDetails plugin={projectPlugin} onBack={onBack} onPluginChange={toggle} />
    )
  }

  return (
    <section className="plugins-catalog">
      <Text>{t('plugins.catalog.description')}</Text>
      <article className="plugin-card">
        <div className="plugin-card-heading">
          <span className="plugin-icon" aria-hidden="true">
            <DataIcon />
          </span>
          <div>
            <Heading level={2}>{t(projectPlugin.manifest.nameKey)}</Heading>
            <Text>{t(projectPlugin.manifest.descriptionKey)}</Text>
          </div>
          <PluginToggle plugin={projectPlugin} onChange={toggle} />
        </div>
        <PluginSummary plugin={projectPlugin} />
        <div className="plugin-capabilities">
          <Heading level={3}>{t('plugins.capabilities.title')}</Heading>
          <Text>{t('plugins.capability.projectContext')}</Text>
        </div>
        <Button variant="secondary" onPress={onShowProjectDetails}>
          {t('plugins.openDetails')}
        </Button>
      </article>
      {error && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}
    </section>
  )
}
