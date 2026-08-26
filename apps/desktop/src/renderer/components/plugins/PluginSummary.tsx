import { StatusLight, Switch } from '@react-spectrum/s2'

import {
  type PluginHealthState,
  type PluginLifecycleState,
  type PluginStatus,
} from '../../../shared/plugins'
import { type LocalizationContextValue } from '../../localization/LocalizationProvider'
import { useTranslation } from '../../localization/useTranslation'

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
  'waiting-dependencies': 'plugins.lifecycle.waitingDependencies',
  starting: 'plugins.lifecycle.starting',
  active: 'plugins.lifecycle.active',
  stopping: 'plugins.lifecycle.stopping',
  error: 'plugins.lifecycle.error',
  disposed: 'plugins.lifecycle.disposed',
}

export function PluginSummary({ plugin }: { plugin: PluginStatus }) {
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

export function PluginToggle({
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
