import {
  ActionButton,
  Button,
  ButtonGroup,
  DialogTrigger,
  Heading,
  Popover,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import { useState } from 'react'

import { PLUGIN_IDS, type PluginId } from '../../../shared/plugins'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import {
  type ApplicationHealth,
  type RuntimeHealthComponent,
  type RuntimeHealthProjection,
} from '../../runtime/runtimeHealth'

const VARIANT: Record<ApplicationHealth, 'positive' | 'notice' | 'negative'> = {
  healthy: 'positive',
  notice: 'notice',
  error: 'negative',
}

export interface SystemStatusActions {
  openDiagnostics(): void
  openSpeechSettings(): void
  openLlmSettings(): void
  openPlugin(pluginId: PluginId): void
  copyReport(): Promise<void>
}

function componentPluginId(component: RuntimeHealthComponent): PluginId | undefined {
  const candidate = component.id.startsWith('plugin:') ? component.id.slice('plugin:'.length) : ''
  return PLUGIN_IDS.find((id) => id === candidate)
}

/** Compact application status and issue-only support entry point. */
export function RuntimeStatusIndicator({
  health,
  projection,
  actions,
}: {
  health: { state: ApplicationHealth; text: string }
  projection: RuntimeHealthProjection
  actions: SystemStatusActions
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const issues = projection.components.filter(
    (component) => component.enabled && component.severity !== 'healthy',
  )

  const runAction = (component: RuntimeHealthComponent): void => {
    setOpen(false)
    if (component.id === 'speech' || component.id === 'streaming') {
      actions.openSpeechSettings()
      return
    }
    if (component.id === 'llm') {
      actions.openLlmSettings()
      return
    }
    const pluginId = componentPluginId(component)
    if (pluginId) {
      actions.openPlugin(pluginId)
      return
    }
    actions.openDiagnostics()
  }

  const copyReport = async (): Promise<void> => {
    if (copying) return
    setCopying(true)
    try {
      await actions.copyReport()
    } finally {
      setCopying(false)
    }
  }

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <ActionButton isQuiet UNSAFE_className="runtime-status-trigger" aria-label={health.text}>
        <StatusLight variant={VARIANT[health.state]} size="S">
          <span className="runtime-status-label">{health.text}</span>
        </StatusLight>
      </ActionButton>
      <Popover placement="bottom end" size="S" UNSAFE_className="system-status-popover">
        <Heading level={2}>{t('systemStatus.title')}</Heading>
        {issues.length === 0 ? (
          <div className="system-status-healthy">
            <StatusLight variant="positive">{t('health.overall.ok')}</StatusLight>
            <Text>{t('systemStatus.healthyDescription')}</Text>
          </div>
        ) : (
          <div className="system-status-issues">
            <Heading level={3}>{t('health.overall.problems')}</Heading>
            {issues.map((component) => (
              <div className="system-status-issue" key={component.id}>
                <div>
                  <StatusLight
                    variant={VARIANT[component.severity === 'error' ? 'error' : 'notice']}
                  >
                    {t(component.titleKey)}
                  </StatusLight>
                  <Text>{t(component.summaryKey)}</Text>
                </div>
                <Button variant="secondary" onPress={() => runAction(component)}>
                  {t('common.open')}
                </Button>
              </div>
            ))}
          </div>
        )}
        <ButtonGroup UNSAFE_className="system-status-actions">
          <Button
            variant="secondary"
            onPress={() => {
              setOpen(false)
              actions.openDiagnostics()
            }}
          >
            {t('app.nav.diagnostics')}
          </Button>
          <Button
            variant="secondary"
            isPending={copying}
            onPress={() => observeRendererPromise(copyReport(), 'copy System Status report')}
          >
            {t('health.support.copyReport')}
          </Button>
        </ButtonGroup>
      </Popover>
    </DialogTrigger>
  )
}
