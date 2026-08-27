import type { TranslationKey } from '../../shared/localization'
import type { RuntimePluginHealth } from '../../shared/plugins'
import type { RuntimeSupportBundle } from '../../shared/system'
import type { ControllerState } from '../controller/contracts'

export type HealthSeverity = 'healthy' | 'notice' | 'degraded' | 'error'
export type ApplicationHealth = 'healthy' | 'notice' | 'error'

export interface RuntimeHealthComponent {
  id: string
  category: 'core' | 'runtime' | 'plugin'
  severity: HealthSeverity
  enabled: boolean
  titleKey: TranslationKey
  summaryKey: TranslationKey
}

export interface RuntimeHealthProjection {
  overall: ApplicationHealth
  components: readonly RuntimeHealthComponent[]
  plugins: readonly RuntimePluginHealth[]
}

export function formatRelativeTime(
  timestamp: number,
  locale: string,
  justNow: string,
  now = Date.now(),
): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 45_000) return justNow
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  if (elapsed < 90 * 60_000) return formatter.format(-Math.round(elapsed / 60_000), 'minute')
  if (elapsed < 36 * 60 * 60_000) return formatter.format(-Math.round(elapsed / 3_600_000), 'hour')
  return formatter.format(-Math.round(elapsed / 86_400_000), 'day')
}

export function pluginHealthSeverity(plugin: RuntimePluginHealth): HealthSeverity {
  if (plugin.lifecycle === 'error' || plugin.health.state === 'error') return 'error'
  if (plugin.health.state === 'degraded') return 'degraded'
  return 'healthy'
}

export function aggregateHealth(
  components: readonly Pick<RuntimeHealthComponent, 'enabled' | 'severity'>[],
): ApplicationHealth {
  const enabled = components.filter((component) => component.enabled)
  if (enabled.some((component) => component.severity === 'error')) return 'error'
  if (enabled.some((component) => ['notice', 'degraded'].includes(component.severity))) {
    return 'notice'
  }
  return 'healthy'
}

function speechSeverity(state: ControllerState): HealthSeverity {
  switch (state.speechCapabilities.service) {
    case 'available':
      return 'healthy'
    case 'degraded':
      return 'degraded'
    case 'unavailable':
      return 'error'
    default:
      return 'notice'
  }
}

function llmSeverity(state: ControllerState): HealthSeverity {
  switch (state.llmReadiness.reason) {
    case 'ready':
      return state.llmHealth.state === 'ok' ? 'healthy' : 'notice'
    case 'auth-error':
    case 'access-error':
    case 'network-error':
      return 'error'
    default:
      return 'notice'
  }
}

function rendererSeverity(renderer: RuntimeSupportBundle['renderers']['main']): HealthSeverity {
  if (renderer.status === 'failed-to-load' || renderer.status === 'render-process-gone')
    return 'error'
  return renderer.status === 'ready' ? 'healthy' : 'notice'
}

export function buildRuntimeHealthProjection(
  state: ControllerState,
  support: RuntimeSupportBundle | null,
): RuntimeHealthProjection {
  const streamingEnabled = state.continuousListening.desired
  const components: RuntimeHealthComponent[] = [
    {
      id: 'speech',
      category: 'core',
      severity: speechSeverity(state),
      enabled: true,
      titleKey: 'health.speech.title',
      summaryKey: 'health.speech.available',
    },
    {
      id: 'llm',
      category: 'core',
      severity: llmSeverity(state),
      enabled: true,
      titleKey: 'health.llm.title',
      summaryKey: 'common.available',
    },
    {
      id: 'streaming',
      category: 'runtime',
      severity:
        streamingEnabled && state.continuousListening.transport === 'failed' ? 'error' : 'healthy',
      enabled: streamingEnabled,
      titleKey: 'health.streaming.title',
      summaryKey: streamingEnabled ? 'health.streaming.running' : 'health.streaming.off',
    },
  ]

  if (!support) {
    components.push({
      id: 'support-projection',
      category: 'runtime',
      severity: 'notice',
      enabled: true,
      titleKey: 'health.system.title',
      summaryKey: 'health.system.loading',
    })
    return { overall: aggregateHealth(components), components, plugins: [] }
  }

  components.push({
    id: 'main-renderer',
    category: 'runtime',
    severity: rendererSeverity(support.renderers.main),
    enabled: true,
    titleKey: 'health.renderer.main',
    summaryKey: 'health.renderer.unavailable',
  })
  components.push({
    id: 'overlay-renderer',
    category: 'runtime',
    severity: rendererSeverity(support.renderers.overlay),
    enabled: support.overlayVisible,
    titleKey: 'health.renderer.overlay',
    summaryKey: 'health.renderer.unavailable',
  })

  const avatar = support.avatarRuntime
  const avatarSeverity: HealthSeverity = !avatar.reportFresh
    ? 'notice'
    : avatar.health?.status === 'failed'
      ? 'error'
      : avatar.health?.operational
        ? 'healthy'
        : 'notice'
  components.push({
    id: 'avatar-runtime',
    category: 'runtime',
    severity: avatarSeverity,
    enabled: Boolean(avatar.health?.presentationAttached),
    titleKey: 'health.avatar.title',
    summaryKey: avatar.reportFresh ? 'health.avatar.unavailable' : 'health.avatar.stale',
  })

  const alive = support.aliveRuntime
  components.push({
    id: 'alive-runtime',
    category: 'runtime',
    severity: alive.health.operational ? 'healthy' : 'error',
    enabled: true,
    titleKey: 'health.alive.title',
    summaryKey: !alive.health.operational
      ? 'health.alive.unavailable'
      : alive.globallySuspended
        ? 'health.alive.suspended'
        : alive.mode === 'off'
          ? 'health.alive.off'
          : 'health.alive.running',
  })

  for (const plugin of support.plugins) {
    components.push({
      id: `plugin:${plugin.pluginId}`,
      category: 'plugin',
      severity: pluginHealthSeverity(plugin),
      enabled: true,
      titleKey: plugin.displayNameKey,
      summaryKey: plugin.health.detailKey ?? 'plugins.health.healthy',
    })
  }

  return {
    overall: aggregateHealth(components),
    components,
    plugins: support.plugins,
  }
}
