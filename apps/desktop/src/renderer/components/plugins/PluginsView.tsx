import {
  ActionButton,
  Badge,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Divider,
  Footer,
  Heading,
  InlineAlert,
  ProgressCircle,
  StatusLight,
  Switch,
  Text,
  TextField,
} from '@react-spectrum/s2'
import CheckmarkIcon from '@react-spectrum/s2/icons/Checkmark'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'
import DeviceDesktopIcon from '@react-spectrum/s2/icons/DeviceDesktop'
import ProjectIcon from '@react-spectrum/s2/icons/Project'
import { type ReactNode, useEffect, useState } from 'react'

import { type DesktopControlStatus } from '../../../shared/desktop-control'
import {
  DESKTOP_CONTROL_PLUGIN_ID,
  type PluginHealthState,
  type PluginId,
  type PluginLifecycleState,
  type PluginStatus,
  PROJECT_AWARENESS_PLUGIN_ID,
} from '../../../shared/plugins'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectAwarenessPublicConfig,
  type ProjectAwarenessStatus,
  type ProjectSnapshotDelta,
  type ProjectSnapshotFreshness,
} from '../../../shared/project-awareness'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { formatRelativeTime } from '../../runtime/runtimeHealth'

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

const PROJECT_FRESHNESS: Record<
  ProjectSnapshotFreshness,
  { key: Parameters<LocalizationContextValue['t']>[0]; tone: Tone }
> = {
  unknown: { key: 'plugins.project.freshness.unknown', tone: 'neutral' },
  checking: { key: 'plugins.project.freshness.checking', tone: 'informative' },
  fresh: { key: 'plugins.project.freshness.fresh', tone: 'positive' },
  stale: { key: 'plugins.project.freshness.stale', tone: 'notice' },
}

const EMPTY_PROJECT_STATUS: ProjectAwarenessStatus = {
  enabled: false,
  state: 'disconnected',
  provider: 'github',
  repository: '',
  branch: 'main',
  freshness: 'unknown',
  indexState: 'not_built',
  access: 'read-only',
  indexedFileCount: 0,
  credential: {
    configured: false,
    source: 'none',
    secureStorageAvailable: false,
  },
}

const EMPTY_DESKTOP_STATUS: DesktopControlStatus = {
  enabled: false,
  runtime: {
    state: 'stopped',
    packagedRuntimeAvailable: false,
    version: '0.1.1-rc.2',
  },
  automationEngine: 'needs-setup',
  browserControl: 'needs-setup',
  computerControl: 'needs-setup',
  browser: {
    version: '0.34.0',
    packagedBinaryAvailable: false,
    executableAvailable: false,
    isolatedProfile: true,
  },
  shell: {
    executableAvailable: false,
  },
  authorityMode: 'confirm',
  model: {
    provider: 'groq',
    providerDisplayName: 'Groq',
    model: '',
    configured: false,
  },
}

const DESKTOP_RUNTIME_KEY: Record<
  DesktopControlStatus['runtime']['state'],
  Parameters<LocalizationContextValue['t']>[0]
> = {
  stopped: 'plugins.desktopControl.runtime.stopped',
  starting: 'plugins.desktopControl.runtime.starting',
  ready: 'plugins.desktopControl.runtime.ready',
  running: 'plugins.desktopControl.runtime.running',
  stopping: 'plugins.desktopControl.runtime.stopping',
  error: 'plugins.desktopControl.runtime.error',
}

const DESKTOP_CAPABILITY_KEY: Record<
  DesktopControlStatus['automationEngine'],
  Parameters<LocalizationContextValue['t']>[0]
> = {
  ready: 'plugins.desktopControl.capability.ready',
  'needs-setup': 'plugins.desktopControl.capability.needsSetup',
  unavailable: 'plugins.desktopControl.capability.unavailable',
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
    <Switch size="S" isSelected={plugin.enabled} isDisabled={plugin.busy} onChange={onChange}>
      {plugin.enabled ? t('common.enabled') : t('common.disabled')}
    </Switch>
  )
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
  onToggle: (enabled: boolean) => void
  onOpen: () => void
  onRetry: () => void
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

function relativeTime(timestamp: number | undefined, intlLocale: string, justNow: string): string {
  return timestamp ? formatRelativeTime(timestamp, intlLocale, justNow) : '—'
}

function ChangedFilesSummary({ delta }: { delta: ProjectSnapshotDelta }) {
  const { t } = useTranslation()
  const marker = {
    added: '+',
    modified: '~',
    deleted: '−',
    renamed: '↪',
  } as const
  return (
    <section className="plugin-project-delta">
      <Heading level={4}>{t('plugins.project.delta.title')}</Heading>
      <Text>{t('plugins.project.delta.total', { count: delta.total })}</Text>
      <div className="plugin-project-delta-counts">
        <Badge size="S" variant="positive">
          + {delta.added}
        </Badge>
        <Badge size="S" variant="informative">
          ~ {delta.modified}
        </Badge>
        <Badge size="S" variant="negative">
          − {delta.deleted}
        </Badge>
        {delta.renamed > 0 && (
          <Badge size="S" variant="gray">
            ↪ {delta.renamed}
          </Badge>
        )}
      </div>
      <ul className="plugin-project-delta-files">
        {delta.files.map((file) => (
          <li key={`${file.status}:${file.path}`}>
            <span aria-hidden="true">{marker[file.status]}</span>
            <span>{file.path}</span>
          </li>
        ))}
      </ul>
      {delta.omitted > 0 && (
        <Text>{t('plugins.project.delta.more', { count: delta.omitted })}</Text>
      )}
    </section>
  )
}

function ProjectKnowledge({
  status,
  compact = false,
  busy,
  onSync,
  onRefresh,
  disabledReason,
}: {
  status: ProjectAwarenessStatus
  compact?: boolean
  busy: boolean
  onSync: () => void
  onRefresh?: () => void
  disabledReason?: string
}) {
  const { intlLocale, t } = useTranslation()
  const freshness = PROJECT_FRESHNESS[status.freshness]
  const snapshot = status.indexedCommit?.slice(0, 7)
  const remote = status.remoteHead?.slice(0, 7)
  const justNow = t('health.time.justNow')
  return (
    <section className={compact ? 'plugin-project-knowledge compact' : 'plugin-project-knowledge'}>
      {!compact && <Heading level={3}>{t('plugins.project.knowledgeTitle')}</Heading>}
      {status.repository && (
        <Text UNSAFE_className="plugin-project-repository">{status.repository}</Text>
      )}
      {(status.branch || snapshot) && (
        <Text UNSAFE_className="plugin-project-commit">
          {[status.branch, snapshot].filter(Boolean).join(' · ')}
        </Text>
      )}
      <StatusLight variant={freshness.tone} size="S">
        {t(freshness.key)}
      </StatusLight>
      {status.freshness === 'stale' && remote && (
        <Text UNSAFE_className="plugin-project-commit">
          {t('plugins.project.remoteHeadValue', { sha: remote })}
        </Text>
      )}
      {!compact && (
        <dl className="plugin-status-list plugin-project-knowledge-grid">
          <div>
            <dt>{t('plugins.project.snapshot')}</dt>
            <dd className="plugin-project-code">{status.indexedCommit ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('health.project.remoteHead')}</dt>
            <dd className="plugin-project-code">{status.remoteHead ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('plugins.project.lastSyncLabel')}</dt>
            <dd>{relativeTime(status.lastSyncAt, intlLocale, justNow)}</dd>
          </div>
          <div>
            <dt>{t('plugins.project.lastCheckLabel')}</dt>
            <dd>{relativeTime(status.lastFreshnessCheckAt, intlLocale, justNow)}</dd>
          </div>
        </dl>
      )}
      {compact && status.lastSyncAt && (
        <Text UNSAFE_className="plugin-project-relative">
          {t('health.project.syncedRelative', {
            time: relativeTime(status.lastSyncAt, intlLocale, justNow),
          })}
        </Text>
      )}
      <div className="plugin-action-row">
        {(!compact || status.freshness === 'stale') && (
          <Button variant="secondary" onPress={onSync} isDisabled={busy}>
            {t('plugins.project.sync')}
          </Button>
        )}
        {!compact && onRefresh && (
          <ActionButton onPress={onRefresh} isDisabled={busy}>
            {t('plugins.project.refreshFreshness')}
          </ActionButton>
        )}
      </div>
      {busy && disabledReason ? (
        <Text UNSAFE_className="plugin-action-hint">{disabledReason}</Text>
      ) : null}
      {status.freshness === 'stale' && status.snapshotDelta && (
        <ChangedFilesSummary delta={status.snapshotDelta} />
      )}
    </section>
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
  const { t } = useTranslation()
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
  const [forgetDialogOpen, setForgetDialogOpen] = useState(false)

  useEffect(() => {
    let active = true
    observeRendererPromise(
      Promise.all([
        window.api.projectAwareness.getConfig(),
        plugin.enabled
          ? window.api.projectAwareness.refreshSnapshotStatus(false)
          : window.api.projectAwareness.getStatus(),
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
  }, [plugin.enabled])

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
      setForgetDialogOpen(false)
    }, t('common.saved'))
  }

  const forgetCredential = async (): Promise<void> => {
    await run(async () => {
      setStatus(await window.api.projectAwareness.forgetCredential())
      setCredential('')
      setForgetDialogOpen(false)
    })
  }

  const validTarget =
    isValidProjectRepository(config.repository) && isValidProjectBranch(config.branch)
  const savedTarget =
    validTarget &&
    status.repository === config.repository.trim() &&
    status.branch === config.branch.trim()
  const runtimeDisabled = busy || plugin.busy || !plugin.enabled
  const projectActionsDisabled = runtimeDisabled || !status.credential.configured || !savedTarget
  const connected = ['ready', 'syncing', 'indexing', 'stale'].includes(status.state)
  const projectActionDisabledReason = !plugin.enabled
    ? t('plugins.project.requirement.enable')
    : !status.credential.configured
      ? t('plugins.project.requirement.credential')
      : !savedTarget
        ? t('plugins.project.requirement.repository')
        : ''

  return (
    <section className="plugin-detail page-container">
      <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
        <ChevronLeftIcon />
        <Text>{t('plugins.backToCatalog')}</Text>
      </ActionButton>
      <div className="plugin-detail-heading">
        <span className="plugin-icon" aria-hidden="true">
          <ProjectIcon />
        </span>
        <div>
          <Heading level={2}>{t(plugin.manifest.nameKey)}</Heading>
          <Text>{t(plugin.manifest.descriptionKey)}</Text>
        </div>
        <PluginToggle plugin={plugin} onChange={onPluginChange} />
      </div>
      <PluginSummary plugin={plugin} />
      <Divider />

      {(error || plugin.lastError || status.lastError || message) && (
        <div className="plugin-feedback">
          {error || plugin.lastError || status.lastError ? (
            <InlineAlert variant="negative" fillStyle="subtleFill">
              <Heading>{t('common.error')}</Heading>
              <Content>{error || plugin.lastError || status.lastError}</Content>
            </InlineAlert>
          ) : (
            <StatusLight variant="positive" role="status">
              {message}
            </StatusLight>
          )}
        </div>
      )}

      <section className="plugin-setup-overview" aria-label={t('plugins.setup.title')}>
        <Heading level={3}>{t('plugins.setup.title')}</Heading>
        <ol className="plugin-setup-steps">
          {[
            { label: t('plugins.setup.enable'), complete: plugin.enabled },
            { label: t('plugins.setup.credential'), complete: status.credential.configured },
            { label: t('plugins.setup.repository'), complete: savedTarget },
            { label: t('plugins.setup.connect'), complete: connected },
          ].map((step, index) => (
            <li className={step.complete ? 'is-complete' : ''} key={step.label}>
              <span className="plugin-setup-step-number" aria-hidden="true">
                {step.complete ? <CheckmarkIcon /> : index + 1}
              </span>
              <Text>{step.label}</Text>
              <span className="visually-hidden">
                {t(step.complete ? 'plugins.setup.done' : 'plugins.setup.pending')}
              </span>
            </li>
          ))}
        </ol>
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
            onPress={() => setForgetDialogOpen(true)}
            isDisabled={!status.credential.configured || busy}
          >
            {t('plugins.project.forgetCredential')}
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
        <Heading level={3}>{t('plugins.project.configTitle')}</Heading>
        <Text>{t('plugins.project.configDescription')}</Text>
        <div className="plugin-project-fields">
          <TextField
            label={t('common.repository')}
            value={config.repository}
            onChange={(repository) => setConfig((current) => ({ ...current, repository }))}
            isDisabled={busy}
            isInvalid={config.repository.length > 0 && !isValidProjectRepository(config.repository)}
            errorMessage={t('plugins.project.repositoryInvalid')}
            description={t('plugins.project.repositoryHint')}
          />
          <TextField
            label={t('common.branch')}
            value={config.branch}
            onChange={(branch) => setConfig((current) => ({ ...current, branch }))}
            isDisabled={busy}
            isInvalid={config.branch.length > 0 && !isValidProjectBranch(config.branch)}
            errorMessage={t('plugins.project.branchInvalid')}
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
        <div className="plugin-action-row">
          <Button
            variant="secondary"
            onPress={() => void run(() => window.api.projectAwareness.connect())}
            isDisabled={
              runtimeDisabled || connected || !savedTarget || !status.credential.configured
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
            onPress={() => void run(() => window.api.projectAwareness.rebuildIndex())}
            isDisabled={runtimeDisabled || !status.credential.configured || !savedTarget}
          >
            {t('plugins.project.rebuild')}
          </ActionButton>
        </div>
        {projectActionDisabledReason ? (
          <Text UNSAFE_className="plugin-action-hint">{projectActionDisabledReason}</Text>
        ) : null}
      </section>

      <ProjectKnowledge
        status={status}
        busy={projectActionsDisabled}
        disabledReason={projectActionDisabledReason}
        onSync={() => void run(() => window.api.projectAwareness.sync())}
        onRefresh={() => void run(() => window.api.projectAwareness.refreshSnapshotStatus(true))}
      />

      <DialogContainer
        onDismiss={() => {
          if (!busy) setForgetDialogOpen(false)
        }}
      >
        {forgetDialogOpen && (
          <Dialog>
            <Heading>{t('plugins.project.forgetDialog.title')}</Heading>
            <Content>{t('plugins.project.forgetDialog.description')}</Content>
            <Footer>
              <ButtonGroup>
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => setForgetDialogOpen(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button variant="negative" isPending={busy} onPress={() => void forgetCredential()}>
                  {t('plugins.project.forgetCredential')}
                </Button>
              </ButtonGroup>
            </Footer>
          </Dialog>
        )}
      </DialogContainer>
    </section>
  )
}

function DesktopControlDetails({
  plugin,
  status,
  onBack,
  onPluginChange,
  onStatusChange,
  onOpenLlmSettings,
}: {
  plugin: PluginStatus
  status: DesktopControlStatus
  onBack: () => void
  onPluginChange: (enabled: boolean) => void
  onStatusChange: (status: DesktopControlStatus) => void
  onOpenLlmSettings: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const run = (
    operation: () => Promise<DesktopControlStatus>,
    successKey?: Parameters<LocalizationContextValue['t']>[0],
  ): void => {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    observeRendererPromise(
      operation()
        .then((next) => {
          onStatusChange(next)
          if (successKey) setMessage(t(successKey))
        })
        .finally(() => setBusy(false)),
      'update Desktop Control',
      (reason) => setError(rendererError(reason)),
    )
  }

  const changeAuthority = (full: boolean): void => {
    if (busy) return
    setBusy(true)
    setError('')
    observeRendererPromise(
      window.api.actions
        .requestAuthorityMode(full ? 'full' : 'confirm')
        .then(() => window.api.desktopControl.getStatus())
        .then(onStatusChange)
        .finally(() => setBusy(false)),
      'change Desktop Control authority',
      (reason) => setError(rendererError(reason)),
    )
  }

  const runtimeTone: Tone =
    status.runtime.state === 'ready'
      ? 'positive'
      : status.runtime.state === 'error'
        ? 'negative'
        : status.runtime.state === 'running' || status.runtime.state === 'starting'
          ? 'informative'
          : 'neutral'

  return (
    <section className="plugin-detail page-container">
      <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
        <ChevronLeftIcon />
        <Text>{t('plugins.backToCatalog')}</Text>
      </ActionButton>
      <div className="plugin-detail-heading">
        <span className="plugin-icon" aria-hidden="true">
          <DeviceDesktopIcon />
        </span>
        <div>
          <Heading level={2}>{t(plugin.manifest.nameKey)}</Heading>
          <Text>{t(plugin.manifest.descriptionKey)}</Text>
        </div>
        <PluginToggle plugin={plugin} onChange={onPluginChange} />
      </div>
      <PluginSummary plugin={plugin} />
      <Divider size="S" />

      {(error ||
        plugin.lastError ||
        status.runtime.lastError ||
        status.model.lastError ||
        message) && (
        <div className="plugin-feedback">
          {error || plugin.lastError || status.runtime.lastError || status.model.lastError ? (
            <InlineAlert variant="negative" fillStyle="subtleFill">
              <Heading>{t('common.error')}</Heading>
              <Content>
                {error || plugin.lastError || status.runtime.lastError || status.model.lastError}
              </Content>
            </InlineAlert>
          ) : (
            <StatusLight variant="positive" role="status">
              {message}
            </StatusLight>
          )}
        </div>
      )}

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.desktopControl.stateTitle')}</Heading>
        <dl className="plugin-status-list plugin-runtime-status">
          <div>
            <dt>{t('plugins.desktopControl.automationEngine')}</dt>
            <dd>{t(DESKTOP_CAPABILITY_KEY[status.automationEngine])}</dd>
          </div>
          <div>
            <dt>{t('plugins.desktopControl.harnessRuntime')}</dt>
            <dd>
              <StatusLight variant={runtimeTone} size="S">
                {t(DESKTOP_RUNTIME_KEY[status.runtime.state])}
              </StatusLight>
            </dd>
          </div>
          <div>
            <dt>{t('capabilities.browser.title')}</dt>
            <dd>{t(DESKTOP_CAPABILITY_KEY[status.browserControl])}</dd>
          </div>
          <div>
            <dt>{t('capabilities.computer.title')}</dt>
            <dd>{t(DESKTOP_CAPABILITY_KEY[status.computerControl])}</dd>
          </div>
        </dl>
      </section>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.desktopControl.modelTitle')}</Heading>
        <Text>{t('plugins.desktopControl.modelDescription')}</Text>
        <StatusLight variant={status.model.configured ? 'positive' : 'notice'} size="S">
          {status.model.configured
            ? t('plugins.desktopControl.modelReady')
            : t('plugins.desktopControl.modelNeedsSetup')}
        </StatusLight>
        <dl className="plugin-status-list plugin-model-status">
          <div>
            <dt>{t('plugins.desktopControl.modelProvider')}</dt>
            <dd>{status.model.providerDisplayName}</dd>
          </div>
          <div>
            <dt>{t('common.model')}</dt>
            <dd>{status.model.model || t('common.notConfigured')}</dd>
          </div>
        </dl>
        <Text>{t('plugins.desktopControl.modelSettingsHint')}</Text>
        {!status.model.configured && (
          <Button variant="secondary" onPress={onOpenLlmSettings}>
            {t('plugins.desktopControl.openModelSettings')}
          </Button>
        )}
      </section>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.desktopControl.accessTitle')}</Heading>
        <div className="plugin-access-control">
          <div className="plugin-access-copy">
            <Switch
              isSelected={status.authorityMode === 'full'}
              isDisabled={busy}
              onChange={changeAuthority}
            >
              {t('plugins.desktopControl.fullAccess')}
            </Switch>
            <Text>{t('plugins.desktopControl.fullAccessDescription')}</Text>
          </div>
          <StatusLight variant={status.authorityMode === 'full' ? 'notice' : 'positive'} size="S">
            {status.authorityMode === 'full'
              ? t('plugins.desktopControl.accessMode.full')
              : t('plugins.desktopControl.accessMode.confirm')}
          </StatusLight>
        </div>
        {status.authorityMode === 'full' && (
          <InlineAlert variant="notice" fillStyle="subtleFill">
            <Heading>{t('plugins.desktopControl.fullAccessWarningTitle')}</Heading>
            <Content>{t('plugins.desktopControl.fullAccessWarningDescription')}</Content>
          </InlineAlert>
        )}
      </section>

      <section className="plugin-detail-section">
        <div className="plugin-section-heading">
          <Heading level={3}>{t('plugins.desktopControl.runtimeTitle')}</Heading>
          <StatusLight variant={runtimeTone} size="S">
            {t(DESKTOP_RUNTIME_KEY[status.runtime.state])}
          </StatusLight>
        </div>
        <Text>{t('plugins.desktopControl.runtimeDescription')}</Text>
        <div className="plugin-action-row">
          <Button
            variant="secondary"
            onPress={() => run(() => window.api.desktopControl.startRuntime())}
            isDisabled={
              busy ||
              !plugin.enabled ||
              !status.model.configured ||
              !status.runtime.packagedRuntimeAvailable ||
              ['ready', 'running', 'starting'].includes(status.runtime.state)
            }
          >
            {t('plugins.desktopControl.startRuntime')}
          </Button>
          <ActionButton
            onPress={() => run(() => window.api.desktopControl.stopRuntime())}
            isDisabled={busy || ['stopped', 'stopping'].includes(status.runtime.state)}
          >
            {t('plugins.desktopControl.stopRuntime')}
          </ActionButton>
        </div>
        {status.runtime.state === 'running' && (
          <InlineAlert variant="notice" fillStyle="subtleFill">
            <Heading>{t('plugins.desktopControl.activeTask')}</Heading>
            <Content>{t('plugins.desktopControl.activeTaskDescription')}</Content>
            <Button
              variant="negative"
              onPress={() => {
                observeRendererPromise(
                  window.api.actions.emergencyStop(),
                  'stop active Desktop Control task',
                )
              }}
            >
              {t('actions.emergencyStop')}
            </Button>
          </InlineAlert>
        )}
      </section>

      <Disclosure UNSAFE_className="plugin-technical-details">
        <DisclosureTitle level={3}>{t('plugins.desktopControl.technicalTitle')}</DisclosureTitle>
        <DisclosurePanel>
          <dl className="plugin-status-list plugin-runtime-status">
            <div>
              <dt>{t('plugins.desktopControl.dshVersion')}</dt>
              <dd>{status.runtime.version}</dd>
            </div>
            <div>
              <dt>{t('plugins.desktopControl.browserBackend')}</dt>
              <dd>agent-browser {status.browser.version}</dd>
            </div>
            <div>
              <dt>{t('plugins.desktopControl.browserBinary')}</dt>
              <dd>
                {status.browser.packagedBinaryAvailable
                  ? t('plugins.desktopControl.resourceAvailable')
                  : t('plugins.desktopControl.resourceMissing')}
              </dd>
            </div>
            <div>
              <dt>{t('plugins.desktopControl.chromeExecutable')}</dt>
              <dd>
                {status.browser.executableAvailable
                  ? t('plugins.desktopControl.resourceAvailable')
                  : t('plugins.desktopControl.resourceMissing')}
              </dd>
            </div>
            <div>
              <dt>{t('plugins.desktopControl.browserProfile')}</dt>
              <dd>{t('plugins.desktopControl.browserProfileIsolated')}</dd>
            </div>
            <div>
              <dt>{t('plugins.desktopControl.powerShell')}</dt>
              <dd>
                {status.shell.executableAvailable
                  ? t('plugins.desktopControl.resourceAvailable')
                  : t('plugins.desktopControl.resourceMissing')}
              </dd>
            </div>
          </dl>
        </DisclosurePanel>
      </Disclosure>
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
  onShowDetails: (id: PluginId) => void
  onBack: () => void
  onOpenLlmSettings: () => void
}) {
  const { t } = useTranslation()
  const [plugins, setPlugins] = useState<PluginStatus[]>([])
  const [desktopStatus, setDesktopStatus] = useState<DesktopControlStatus>(EMPTY_DESKTOP_STATUS)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const refresh = (): void => {
    observeRendererPromise(
      window.api.plugins.list().then(async (items) => {
        setPlugins(items)
        if (detailPluginId === DESKTOP_CONTROL_PLUGIN_ID) {
          setDesktopStatus(await window.api.desktopControl.getStatus())
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
        window.api.plugins.list().then(async (items) => {
          const desktopStatus =
            detailPluginId === DESKTOP_CONTROL_PLUGIN_ID
              ? await window.api.desktopControl.getStatus()
              : null
          if (active) {
            setPlugins(items)
            if (desktopStatus) setDesktopStatus(desktopStatus)
            setError('')
            setLoaded(true)
          }
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
    const intervalId = window.setInterval(load, 3_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [detailPluginId])

  const projectPlugin = plugins.find((plugin) => plugin.manifest.id === PROJECT_AWARENESS_PLUGIN_ID)
  const desktopPlugin = plugins.find((plugin) => plugin.manifest.id === DESKTOP_CONTROL_PLUGIN_ID)
  const togglePlugin = (id: PluginId, enabled: boolean): void => {
    const target = plugins.find((plugin) => plugin.manifest.id === id)
    if (!target || target.busy) return
    setError('')
    setPlugins((items) =>
      items.map((item) => (item.manifest.id === id ? { ...item, busy: true } : item)),
    )
    observeRendererPromise(
      (enabled ? window.api.plugins.enable(id) : window.api.plugins.disable(id)).then(
        async (next) => {
          setPlugins((items) =>
            items.map((item) => (item.manifest.id === next.manifest.id ? next : item)),
          )
          if (id === DESKTOP_CONTROL_PLUGIN_ID) {
            setDesktopStatus(await window.api.desktopControl.getStatus())
          }
        },
      ),
      'toggle Plugin',
      (reason) => {
        setError(rendererError(reason))
        refresh()
      },
    )
  }

  if (!loaded) {
    return (
      <div className="plugins-loading page-container">
        <ProgressCircle isIndeterminate aria-label={t('common.loading')} />
        {error && <Text>{error}</Text>}
      </div>
    )
  }

  if (detailPluginId === PROJECT_AWARENESS_PLUGIN_ID) {
    if (!projectPlugin) {
      return (
        <section className="plugin-detail page-container">
          <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
            <ChevronLeftIcon />
            <Text>{t('plugins.backToCatalog')}</Text>
          </ActionButton>
          <InlineAlert variant="negative" fillStyle="subtleFill">
            <Heading>{t('plugins.projectAwareness.name')}</Heading>
            <Content>{t('plugins.catalog.unavailable')}</Content>
            <Button variant="secondary" onPress={refresh}>
              {t('common.retry')}
            </Button>
          </InlineAlert>
        </section>
      )
    }
    return (
      <ProjectAwarenessDetails
        plugin={projectPlugin}
        onBack={onBack}
        onPluginChange={(enabled) => togglePlugin(PROJECT_AWARENESS_PLUGIN_ID, enabled)}
      />
    )
  }

  if (detailPluginId === DESKTOP_CONTROL_PLUGIN_ID) {
    if (!desktopPlugin) {
      return (
        <section className="plugin-detail page-container">
          <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
            <ChevronLeftIcon />
            <Text>{t('plugins.backToCatalog')}</Text>
          </ActionButton>
          <InlineAlert variant="negative" fillStyle="subtleFill">
            <Heading>{t('plugins.desktopControl.name')}</Heading>
            <Content>{t('plugins.catalog.unavailable')}</Content>
            <Button variant="secondary" onPress={refresh}>
              {t('common.retry')}
            </Button>
          </InlineAlert>
        </section>
      )
    }
    return (
      <DesktopControlDetails
        plugin={desktopPlugin}
        status={desktopStatus}
        onBack={onBack}
        onPluginChange={(enabled) => togglePlugin(DESKTOP_CONTROL_PLUGIN_ID, enabled)}
        onStatusChange={setDesktopStatus}
        onOpenLlmSettings={onOpenLlmSettings}
      />
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
      </div>
      {error && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}
    </section>
  )
}
