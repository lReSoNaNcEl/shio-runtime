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
  ProgressBar,
  StatusLight,
  Text,
  TextField,
} from '@react-spectrum/s2'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'
import ProjectIcon from '@react-spectrum/s2/icons/Project'
import { useEffect, useState } from 'react'

import { type PluginStatus } from '../../../../shared/plugins'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectAwarenessPublicConfig,
  type ProjectAwarenessStatus,
  type ProjectFreshnessFailureReason,
  type ProjectFreshnessState,
  type ProjectSnapshotDelta,
  type ProjectSyncStage,
} from '../../../../shared/project-awareness'
import { type LocalizationContextValue } from '../../../localization/LocalizationProvider'
import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
import { formatRelativeTime } from '../../../runtime/runtimeHealth'
import { PluginSummary, PluginToggle } from '../PluginSummary'

type Tone = 'positive' | 'informative' | 'neutral' | 'notice' | 'negative'

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
const PROJECT_FRESHNESS: Record<
  ProjectFreshnessState,
  { key: Parameters<LocalizationContextValue['t']>[0]; tone: Tone }
> = {
  unknown: { key: 'plugins.project.freshness.unknown', tone: 'neutral' },
  checking: { key: 'plugins.project.freshness.checking', tone: 'informative' },
  current: { key: 'plugins.project.freshness.fresh', tone: 'positive' },
  stale: { key: 'plugins.project.freshness.stale', tone: 'notice' },
  'check-failed': { key: 'plugins.project.freshness.checkFailed', tone: 'notice' },
}
const PROJECT_SYNC_STAGE_KEY: Record<
  ProjectSyncStage,
  Parameters<LocalizationContextValue['t']>[0]
> = {
  fetching: 'plugins.project.syncStage.fetching',
  indexing: 'plugins.project.syncStage.indexing',
  validating: 'plugins.project.syncStage.validating',
}
const PROJECT_FRESHNESS_REASON_KEY: Record<
  ProjectFreshnessFailureReason,
  Parameters<LocalizationContextValue['t']>[0]
> = {
  credential: 'plugins.project.freshness.reason.credential',
  network: 'plugins.project.freshness.reason.network',
  'rate-limit': 'plugins.project.freshness.reason.rateLimit',
  'github-unavailable': 'plugins.project.freshness.reason.githubUnavailable',
  unknown: 'plugins.project.freshness.reason.unknown',
}
const EMPTY_PROJECT_STATUS: ProjectAwarenessStatus = {
  enabled: false,
  state: 'disconnected',
  provider: 'github',
  repository: '',
  branch: 'main',
  freshness: { state: 'unknown' },
  sync: { state: 'idle' },
  indexState: 'not_built',
  access: 'read-only',
  credential: {
    configured: false,
    source: 'none',
    secureStorageAvailable: false,
  },
}
function rendererError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    <Disclosure UNSAFE_className="plugin-project-delta">
      <DisclosureTitle level={4}>
        {t('plugins.project.delta.total', { count: delta.total })}
      </DisclosureTitle>
      <DisclosurePanel>
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
      </DisclosurePanel>
    </Disclosure>
  )
}

function ProjectFreshnessPanel({
  status,
  busy,
  onSync,
  onRefresh,
  disabledReason,
}: {
  status: ProjectAwarenessStatus
  busy: boolean
  onSync: () => void
  onRefresh?: () => void
  disabledReason?: string
}) {
  const { intlLocale, t } = useTranslation()
  const freshness = PROJECT_FRESHNESS[status.freshness.state]
  const justNow = t('health.time.justNow')
  const syncStage = status.sync.stage
    ? t(PROJECT_SYNC_STAGE_KEY[status.sync.stage])
    : t('plugins.project.syncStage.fetching')
  return (
    <section className="plugin-project-knowledge">
      <Heading level={3}>{t('plugins.project.freshnessTitle')}</Heading>
      <StatusLight variant={freshness.tone} size="S">
        {status.snapshot ? t(freshness.key) : t('plugins.project.freshness.notApplicable')}
      </StatusLight>
      {status.freshness.state === 'check-failed' && (
        <InlineAlert variant="notice" fillStyle="subtleFill">
          <Heading>{t('plugins.project.freshness.checkFailed')}</Heading>
          <Content>
            {`${t(PROJECT_FRESHNESS_REASON_KEY[status.freshness.reasonCode ?? 'unknown'])} ${t(
              status.snapshot
                ? 'plugins.project.freshness.checkFailedDescription'
                : 'plugins.project.freshness.checkFailedNoSnapshot',
            )}`}
          </Content>
        </InlineAlert>
      )}
      <dl className="plugin-status-list plugin-project-knowledge-grid">
        {status.freshness.state === 'stale' ? (
          <>
            <div>
              <dt>{t('plugins.project.indexedRevision')}</dt>
              <dd className="plugin-project-code">{status.freshness.indexedRevision ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('plugins.project.remoteRevision')}</dt>
              <dd className="plugin-project-code">{status.freshness.remoteRevision ?? '—'}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>{t('plugins.project.snapshot')}</dt>
            <dd className="plugin-project-code">{status.snapshot?.revision ?? '—'}</dd>
          </div>
        )}
        {(status.freshness.state === 'unknown' || status.freshness.state === 'check-failed') &&
          status.freshness.lastKnownRemoteRevision && (
            <div>
              <dt>{t('plugins.project.lastKnownRemoteRevision')}</dt>
              <dd className="plugin-project-code">{status.freshness.lastKnownRemoteRevision}</dd>
            </div>
          )}
        <div>
          <dt>{t('plugins.project.lastCheckLabel')}</dt>
          <dd>
            {relativeTime(
              status.freshness.checkedAt ?? status.freshness.lastKnownRemoteCheckedAt,
              intlLocale,
              justNow,
            )}
          </dd>
        </div>
      </dl>
      {status.sync.state === 'syncing' && (
        <ProgressBar isIndeterminate label={syncStage} valueLabel={syncStage} />
      )}
      {status.sync.state === 'failed' && (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('plugins.project.syncFailed')}</Heading>
          <Content>
            {status.snapshot
              ? t('plugins.project.syncFailedPreserved')
              : status.sync.lastError || t('plugins.project.syncFailedNoSnapshot')}
          </Content>
        </InlineAlert>
      )}
      <div className="plugin-action-row">
        <Button variant="secondary" onPress={onSync} isDisabled={busy}>
          {status.snapshot ? t('plugins.project.sync') : t('plugins.project.createIndex')}
        </Button>
        {onRefresh && (
          <ActionButton onPress={onRefresh} isDisabled={busy}>
            {t('plugins.project.refreshFreshness')}
          </ActionButton>
        )}
      </div>
      {busy && disabledReason ? (
        <Text UNSAFE_className="plugin-action-hint">{disabledReason}</Text>
      ) : null}
      {status.freshness.state === 'stale' && status.changedFiles && (
        <ChangedFilesSummary delta={status.changedFiles} />
      )}
      {status.freshness.state === 'stale' && !status.changedFiles && (
        <Text>{t('plugins.project.delta.unavailable')}</Text>
      )}
    </section>
  )
}

function ProjectIndexPanel({
  status,
  busy,
  onRebuild,
}: {
  status: ProjectAwarenessStatus
  busy: boolean
  onRebuild: () => void
}) {
  const { intlLocale, t } = useTranslation()
  const justNow = t('health.time.justNow')
  return (
    <section className="plugin-detail-section">
      <Heading level={3}>{t('plugins.project.indexTitle')}</Heading>
      {status.snapshot ? (
        <>
          <dl className="plugin-status-list plugin-project-knowledge-grid">
            <div>
              <dt>{t('plugins.project.snapshot')}</dt>
              <dd className="plugin-project-code">{status.snapshot.revision}</dd>
            </div>
            <div>
              <dt>{t('plugins.project.indexedFiles')}</dt>
              <dd>{status.snapshot.fileCount}</dd>
            </div>
            <div>
              <dt>{t('plugins.project.indexedAt')}</dt>
              <dd>{relativeTime(status.snapshot.indexedAt, intlLocale, justNow)}</dd>
            </div>
            <div>
              <dt>{t('plugins.project.lastSyncLabel')}</dt>
              <dd>{relativeTime(status.lastSyncAt, intlLocale, justNow)}</dd>
            </div>
          </dl>
          <ActionButton onPress={onRebuild} isDisabled={busy}>
            {t('plugins.project.rebuild')}
          </ActionButton>
        </>
      ) : (
        <Text>{t('plugins.project.indexEmpty')}</Text>
      )}
    </section>
  )
}

export function ProjectAwarenessPluginView({
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

  const run = async (
    operation: () => Promise<unknown>,
    successMessage = '',
    surfaceError = true,
  ): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await operation()
      setStatus(await window.api.projectAwareness.getStatus())
      setMessage(successMessage)
    } catch (reason) {
      const nextStatus = await window.api.projectAwareness.getStatus().catch(() => null)
      if (nextStatus) setStatus(nextStatus)
      if (surfaceError) setError(rendererError(reason))
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

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.project.projectTitle')}</Heading>
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
        {!plugin.enabled && <Text>{t('plugins.project.disabledDataAvailable')}</Text>}
        {!savedTarget && <Text>{t('plugins.project.projectNotConfigured')}</Text>}
      </section>

      <ProjectFreshnessPanel
        status={status}
        busy={projectActionsDisabled}
        disabledReason={projectActionDisabledReason}
        onSync={() => void run(() => window.api.projectAwareness.sync(), '', false)}
        onRefresh={() => void run(() => window.api.projectAwareness.refreshSnapshotStatus(true))}
      />

      <ProjectIndexPanel
        status={status}
        busy={projectActionsDisabled || !status.snapshot}
        onRebuild={() => void run(() => window.api.projectAwareness.rebuildIndex(), '', false)}
      />

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.project.connectionTitle')}</Heading>
        {!plugin.enabled && <Text>{t('plugins.project.disabledHint')}</Text>}
        <dl className="plugin-status-list plugin-runtime-status">
          <div>
            <dt>{t('plugins.lifecycle.label')}</dt>
            <dd>{t(PROJECT_STATE_KEY[status.state])}</dd>
          </div>
          <div>
            <dt>{t('plugins.project.credentialTitle')}</dt>
            <dd>{status.credential.configured ? t('common.saved') : t('common.notConfigured')}</dd>
          </div>
          <div>
            <dt>{t('health.project.access')}</dt>
            <dd>{t('common.readOnly')}</dd>
          </div>
        </dl>
        <Text>{t('plugins.project.credentialDescription')}</Text>
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
        </div>
        {projectActionDisabledReason ? (
          <Text UNSAFE_className="plugin-action-hint">{projectActionDisabledReason}</Text>
        ) : null}
      </section>

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
