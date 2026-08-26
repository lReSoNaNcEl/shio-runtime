import {
  ActionButton,
  Button,
  Content,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Divider,
  Heading,
  InlineAlert,
  StatusLight,
  Switch,
  Text,
} from '@react-spectrum/s2'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'
import DeviceDesktopIcon from '@react-spectrum/s2/icons/DeviceDesktop'
import { useState } from 'react'

import { type DesktopControlStatus } from '../../../../shared/desktop-control'
import { type PluginStatus } from '../../../../shared/plugins'
import { type LocalizationContextValue } from '../../../localization/LocalizationProvider'
import { useTranslation } from '../../../localization/useTranslation'
import { observeRendererPromise } from '../../../reliability/observePromise'
import { PluginSummary, PluginToggle } from '../PluginSummary'

type Tone = 'positive' | 'informative' | 'neutral' | 'notice' | 'negative'
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
  DesktopControlStatus['computerControl'],
  Parameters<LocalizationContextValue['t']>[0]
> = {
  ready: 'plugins.desktopControl.capability.ready',
  'needs-setup': 'plugins.desktopControl.capability.needsSetup',
  unavailable: 'plugins.desktopControl.capability.unavailable',
}
function rendererError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function DesktopControlPluginView({
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
