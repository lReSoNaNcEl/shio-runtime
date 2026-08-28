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
  formatRelativeTime,
  type RuntimeHealthComponent,
  type RuntimeHealthProjection,
} from '../../runtime/runtimeHealth'

const VARIANT: Record<ApplicationHealth, 'positive' | 'notice' | 'negative'> = {
  healthy: 'positive',
  notice: 'notice',
  error: 'negative',
}

const PROVIDER_NAME = {
  groq: 'Groq',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  cloudflare: 'Cloudflare',
} as const

const SUMMARY_ITEMS = [
  { id: 'llm', label: 'systemStatus.summary.llm' },
  { id: 'speech', label: 'systemStatus.summary.speech' },
  { id: 'streaming', label: 'systemStatus.summary.streaming' },
] as const

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
  const { intlLocale, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const issues = projection.components.filter(
    (component) => component.enabled && component.severity !== 'healthy',
  )
  const summaries = SUMMARY_ITEMS.flatMap((item) => {
    const component = projection.components.find((candidate) => candidate.id === item.id)
    return component ? [{ ...item, component }] : []
  })

  const componentStatus = (component: RuntimeHealthComponent): string => {
    if (!component.enabled) return t('common.disabled')
    if (component.severity === 'healthy') return t('common.ready')
    if (component.severity === 'error') return t('common.unavailable')
    return t('systemStatus.status.attention')
  }

  const relativeTime = (timestamp: number): string =>
    formatRelativeTime(timestamp, intlLocale, t('health.time.justNow'))

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
      <Popover
        placement="bottom end"
        size="S"
        padding="none"
        UNSAFE_className="system-status-popover"
      >
        <Heading level={2} UNSAFE_className="system-status-title">
          {t('systemStatus.title')}
        </Heading>
        <div className="system-status-overview">
          <StatusLight variant={VARIANT[projection.overall]}>
            {t(
              projection.recentIncidents.length > 0
                ? 'systemStatus.incident.shell'
                : projection.overall === 'healthy'
                  ? 'health.overall.ok'
                  : projection.overall === 'notice'
                    ? 'health.overall.attention'
                    : 'health.overall.problems',
            )}
          </StatusLight>
          {projection.lastCheckedAt !== null && (
            <Text UNSAFE_className="system-status-last-checked">
              {t('systemStatus.lastChecked', {
                time: relativeTime(projection.lastCheckedAt),
              })}
            </Text>
          )}
        </div>
        <fieldset className="system-status-summary">
          <legend className="visually-hidden">{t('systemStatus.summary.title')}</legend>
          {summaries.map(({ component, label }) => (
            <div className="system-status-summary-row" key={component.id}>
              <Text>{t(label)}</Text>
              <StatusLight
                variant={
                  !component.enabled
                    ? 'neutral'
                    : VARIANT[
                        component.severity === 'error'
                          ? 'error'
                          : component.severity === 'healthy'
                            ? 'healthy'
                            : 'notice'
                      ]
                }
                size="S"
              >
                {componentStatus(component)}
              </StatusLight>
            </div>
          ))}
        </fieldset>
        {projection.recentIncidents.length > 0 && (
          <div className="system-status-incidents">
            <Heading level={3}>{t('systemStatus.incident.title')}</Heading>
            {projection.recentIncidents.map((incident) => (
              <div className="system-status-issue" key={incident.id}>
                <div>
                  <StatusLight variant="notice">
                    {t(incident.titleKey, { provider: PROVIDER_NAME[incident.provider] })}
                  </StatusLight>
                  <Text>
                    {t(incident.summaryKey, { provider: PROVIDER_NAME[incident.provider] })}
                  </Text>
                  <Text UNSAFE_className="system-status-last-checked">
                    {relativeTime(incident.occurredAt)}
                  </Text>
                </div>
                <Button
                  variant="secondary"
                  onPress={() => {
                    setOpen(false)
                    actions.openLlmSettings()
                  }}
                >
                  {t('common.open')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {issues.length > 0 && (
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
