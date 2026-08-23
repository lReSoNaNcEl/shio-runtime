import type {
  CapabilityAvailability,
  ShioCapabilityDescriptor,
  ShioCapabilitySnapshot,
} from '../../shared/capabilities'
import { SHIO_CAPABILITY_SNAPSHOT_SCHEMA_VERSION } from '../../shared/capabilities'
import type { AppSettings } from '../../shared/config'
import type { DesktopControlCapabilityProjection } from '../../shared/desktop-control'
import type { LlmCapabilities, LlmReadiness } from '../../shared/llm'
import type { PluginStatus } from '../../shared/plugins'
import { DESKTOP_CONTROL_PLUGIN_ID, PROJECT_AWARENESS_PLUGIN_ID } from '../../shared/plugins'
import type { AvatarRuntimeHealth } from '../../shared/runtime'
import { mainLog } from '../logging/safeLogger'
import type { SpeechCapabilitiesProbe } from '../speech/speechClient'

export interface CapabilityCatalogSources {
  settings(): AppSettings
  llmReadiness(): LlmReadiness
  llmCapabilities(): LlmCapabilities
  plugins(): Promise<readonly PluginStatus[]>
  desktopControl(): Promise<DesktopControlCapabilityProjection>
  avatarRuntimeHealth(): AvatarRuntimeHealth | null
}

export type CapabilityCatalogListener = (snapshot: ShioCapabilitySnapshot) => void

function freezeDescriptor(descriptor: ShioCapabilityDescriptor): ShioCapabilityDescriptor {
  Object.freeze(descriptor.source)
  if (descriptor.navigationTarget) Object.freeze(descriptor.navigationTarget)
  return Object.freeze(descriptor)
}

function pluginAvailability(status: PluginStatus | undefined): CapabilityAvailability {
  if (!status) return 'unavailable'
  if (!status.enabled) return 'disabled'
  if (status.lifecycle === 'error' || status.lifecycle === 'disposed') return 'unavailable'
  if (status.lifecycle !== 'active') return 'degraded'
  switch (status.health.state) {
    case 'healthy':
      return 'available'
    case 'needs-setup':
      return 'needs-setup'
    case 'degraded':
      return 'degraded'
    case 'error':
      return 'unavailable'
  }
}

function llmAvailability(readiness: LlmReadiness): CapabilityAvailability {
  switch (readiness.reason) {
    case 'ready':
      return 'available'
    case 'checking':
      return 'degraded'
    case 'missing-credential':
    case 'model-missing':
      return 'needs-setup'
    case 'auth-error':
    case 'network-error':
      return 'unavailable'
  }
}

function llmReason(readiness: LlmReadiness): ShioCapabilityDescriptor['reasonKey'] {
  switch (readiness.reason) {
    case 'ready':
      return undefined
    case 'checking':
      return 'capabilities.reason.llmChecking'
    case 'missing-credential':
      return 'capabilities.reason.llmCredential'
    case 'model-missing':
      return 'capabilities.reason.llmModel'
    case 'auth-error':
      return 'capabilities.reason.llmAuth'
    case 'network-error':
      return 'capabilities.reason.llmNetwork'
  }
}

function pluginReason(status: PluginStatus | undefined): ShioCapabilityDescriptor['reasonKey'] {
  const availability = pluginAvailability(status)
  switch (availability) {
    case 'available':
      return undefined
    case 'disabled':
      return 'capabilities.reason.pluginDisabled'
    case 'needs-setup':
      return 'capabilities.reason.pluginSetup'
    case 'degraded':
      return 'capabilities.reason.pluginDegraded'
    case 'unavailable':
      return 'capabilities.reason.pluginUnavailable'
  }
}

function desktopAvailability(
  enabled: boolean,
  state: DesktopControlCapabilityProjection['automationEngine'],
): CapabilityAvailability {
  if (!enabled) return 'disabled'
  if (state === 'ready') return 'available'
  if (state === 'needs-setup') return 'needs-setup'
  return 'unavailable'
}

export class CapabilityCatalog {
  private readonly listeners = new Set<CapabilityCatalogListener>()
  private speechProbe: SpeechCapabilitiesProbe | null = null
  private publishedSignature = ''
  private dirty = false
  private refreshTask: Promise<void> | null = null

  constructor(private readonly sources: CapabilityCatalogSources) {}

  async snapshot(): Promise<ShioCapabilitySnapshot> {
    return this.buildSnapshot()
  }

  onChanged(listener: CapabilityCatalogListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  reportSpeechCapabilities(probe: SpeechCapabilitiesProbe | null): void {
    this.speechProbe = probe ? { ...probe } : null
    this.invalidate()
  }

  invalidate(): void {
    this.dirty = true
    if (this.refreshTask) return
    this.refreshTask = this.refreshUntilClean()
      .catch((error) => {
        mainLog.warn('[CapabilityCatalog] projection refresh failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        this.refreshTask = null
        if (this.dirty) this.invalidate()
      })
  }

  dispose(): void {
    this.listeners.clear()
  }

  private async refreshUntilClean(): Promise<void> {
    while (this.dirty) {
      this.dirty = false
      const snapshot = await this.buildSnapshot()
      const signature = JSON.stringify(snapshot.capabilities)
      if (signature === this.publishedSignature) continue
      this.publishedSignature = signature
      for (const listener of this.listeners) listener(snapshot)
    }
  }

  private async buildSnapshot(): Promise<ShioCapabilitySnapshot> {
    const settings = this.sources.settings()
    const readiness = this.sources.llmReadiness()
    const llmCapabilities = this.sources.llmCapabilities()
    const plugins = await this.sources.plugins()
    const desktop = await this.sources.desktopControl()
    const avatarHealth = this.sources.avatarRuntimeHealth()
    const project = plugins.find((status) => status.manifest.id === PROJECT_AWARENESS_PLUGIN_ID)
    const llmState = llmAvailability(readiness)
    const speechState: CapabilityAvailability = !this.speechProbe
      ? 'degraded'
      : !this.speechProbe.serviceReachable
        ? 'unavailable'
        : this.speechProbe.recognition && this.speechProbe.synthesis
          ? 'available'
          : 'degraded'
    // Preview attachment is view-scoped: navigating away detaches the canvas without removing
    // Avatar Runtime's loaded capability. Runtime Health still reports that presentation fact.
    const avatarState: CapabilityAvailability = !settings.vrmAssetHandle
      ? 'needs-setup'
      : !avatarHealth ||
          avatarHealth.status === 'not-initialized' ||
          avatarHealth.status === 'loading'
        ? 'degraded'
        : avatarHealth.status === 'ready' && avatarHealth.modelLoaded
          ? 'available'
          : 'unavailable'

    const descriptors: ShioCapabilityDescriptor[] = [
      {
        id: 'text-chat',
        category: 'communication',
        source: { kind: 'core' },
        titleKey: 'capabilities.textChat.title',
        descriptionKey: 'capabilities.textChat.description',
        availability: llmState,
        navigationTarget: { kind: 'settings', id: 'llm' },
        reasonKey: llmReason(readiness),
      },
      {
        id: 'voice-conversation',
        category: 'communication',
        source: { kind: 'core' },
        titleKey: 'capabilities.voice.title',
        descriptionKey: 'capabilities.voice.description',
        availability: speechState,
        navigationTarget: { kind: 'settings', id: 'speech' },
        reasonKey: !this.speechProbe
          ? 'capabilities.reason.speechNotChecked'
          : !this.speechProbe.serviceReachable
            ? 'capabilities.reason.speechUnavailable'
            : speechState === 'degraded'
              ? 'capabilities.reason.speechDegraded'
              : undefined,
      },
      {
        id: 'screen-understanding',
        category: 'perception',
        source: { kind: 'core' },
        titleKey: 'capabilities.screen.title',
        descriptionKey: 'capabilities.screen.description',
        availability:
          llmState === 'available'
            ? llmCapabilities.supportsVision
              ? 'available'
              : 'unavailable'
            : llmState,
        authority: 'read-only',
        navigationTarget: { kind: 'settings', id: 'llm' },
        reasonKey:
          llmState === 'available' && !llmCapabilities.supportsVision
            ? 'capabilities.reason.visionUnsupported'
            : llmReason(readiness),
      },
      {
        id: PROJECT_AWARENESS_PLUGIN_ID,
        category: 'knowledge',
        source: { kind: 'plugin', pluginId: PROJECT_AWARENESS_PLUGIN_ID },
        titleKey: 'plugins.projectAwareness.name',
        descriptionKey: 'capabilities.project.description',
        availability: pluginAvailability(project),
        authority: 'read-only',
        navigationTarget: { kind: 'plugin', id: PROJECT_AWARENESS_PLUGIN_ID },
        reasonKey: pluginReason(project),
      },
      {
        id: 'avatar-presence',
        category: 'presence',
        source: { kind: 'core' },
        titleKey: 'capabilities.avatar.title',
        descriptionKey: 'capabilities.avatar.description',
        availability: avatarState,
        navigationTarget: { kind: 'settings', id: 'avatar' },
        reasonKey: !settings.vrmAssetHandle
          ? 'capabilities.reason.avatarSetup'
          : avatarState === 'degraded'
            ? 'capabilities.reason.avatarStarting'
            : avatarState === 'unavailable'
              ? 'capabilities.reason.avatarUnavailable'
              : undefined,
      },
      {
        id: 'automation-engine',
        category: 'action',
        source: { kind: 'plugin', pluginId: DESKTOP_CONTROL_PLUGIN_ID },
        titleKey: 'capabilities.automation.title',
        descriptionKey: 'capabilities.automation.description',
        availability: desktopAvailability(desktop.enabled, desktop.automationEngine),
        authority: desktop.authorityMode,
        navigationTarget: { kind: 'plugin', id: DESKTOP_CONTROL_PLUGIN_ID },
        reasonKey: !desktop.enabled
          ? 'capabilities.reason.pluginDisabled'
          : desktop.automationEngine !== 'ready'
            ? 'capabilities.reason.desktopSetup'
            : undefined,
      },
      {
        id: 'browser-control',
        category: 'action',
        source: { kind: 'plugin', pluginId: DESKTOP_CONTROL_PLUGIN_ID },
        titleKey: 'capabilities.browser.title',
        descriptionKey: 'capabilities.browser.description',
        availability: desktopAvailability(desktop.enabled, desktop.browserControl),
        authority: desktop.authorityMode,
        navigationTarget: { kind: 'plugin', id: DESKTOP_CONTROL_PLUGIN_ID },
        reasonKey: !desktop.enabled
          ? 'capabilities.reason.pluginDisabled'
          : desktop.browserControl !== 'ready'
            ? 'capabilities.reason.desktopSetup'
            : undefined,
      },
      {
        id: 'computer-control',
        category: 'action',
        source: { kind: 'plugin', pluginId: DESKTOP_CONTROL_PLUGIN_ID },
        titleKey: 'capabilities.computer.title',
        descriptionKey: 'capabilities.computer.description',
        availability: desktopAvailability(desktop.enabled, desktop.computerControl),
        authority: desktop.authorityMode,
        navigationTarget: { kind: 'plugin', id: DESKTOP_CONTROL_PLUGIN_ID },
        reasonKey: !desktop.enabled
          ? 'capabilities.reason.pluginDisabled'
          : desktop.computerControl !== 'ready'
            ? 'capabilities.reason.desktopSetup'
            : undefined,
      },
    ]

    return Object.freeze({
      schemaVersion: SHIO_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: Date.now(),
      capabilities: Object.freeze(descriptors.map(freezeDescriptor)),
    })
  }
}
