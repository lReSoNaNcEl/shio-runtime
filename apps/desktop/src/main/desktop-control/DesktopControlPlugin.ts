import { type DesktopAuthorityMode, desktopWorkflowRequestSchema } from '../../shared/actions'
import type {
  DesktopControlCapabilityProjection,
  DesktopControlStatus,
} from '../../shared/desktop-control'
import type { PluginCapabilityProviders, PluginHealth, PluginManifest } from '../../shared/plugins'
import { DESKTOP_CONTROL_PLUGIN_ID } from '../../shared/plugins'
import {
  ActionError,
  type DesktopWorkflowAdapterResult,
  type EffectiveDesktopWorkflowRequest,
} from '../action'
import type { BundledPlugin, PluginInitializationContext } from '../plugins/PluginRuntime'
import { DshAdapterError, type DshHarnessAdapter } from './DshHarnessAdapter'
import { ShellRiskPolicy } from './shell'

export const DESKTOP_CONTROL_MANIFEST: PluginManifest = {
  id: DESKTOP_CONTROL_PLUGIN_ID,
  version: '1.2.0',
  nameKey: 'plugins.desktopControl.name',
  descriptionKey: 'plugins.desktopControl.description',
  defaultEnabled: false,
  capabilities: ['automation-engine', 'computer-control'],
}

export interface DesktopControlPluginDependencies {
  adapter: DshHarnessAdapter
  authorityMode(): DesktopAuthorityMode
}

export class DesktopControlPlugin implements BundledPlugin {
  readonly manifest = DESKTOP_CONTROL_MANIFEST
  private active = false
  private initialized = false
  private disposed = false
  private packagedRuntimeAvailable = false
  private shellAvailability = { executableAvailable: false }
  private readonly listeners = new Set<() => void>()
  private readonly shellRiskPolicy = new ShellRiskPolicy()
  private readonly unsubscribeAdapter: () => void

  constructor(private readonly dependencies: DesktopControlPluginDependencies) {
    this.unsubscribeAdapter = dependencies.adapter.onChanged(() => this.publishChanged())
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(_context: PluginInitializationContext): Promise<void> {
    if (this.initialized) return
    await this.refreshAvailability()
    this.initialized = true
    this.publishChanged()
  }

  async start(): Promise<void> {
    this.assertInitialized()
    this.active = true
    await this.refreshAvailability()
    this.publishChanged()
  }

  async stop(): Promise<void> {
    this.active = false
    await this.dependencies.adapter.close()
    this.publishChanged()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await this.stop()
    this.unsubscribeAdapter()
    this.listeners.clear()
  }

  async getHealth(): Promise<PluginHealth> {
    if (!this.initialized) {
      return { state: 'needs-setup', detailKey: 'plugins.health.needsSetup', checkedAt: Date.now() }
    }
    await this.refreshAvailability()
    const runtime = this.dependencies.adapter.snapshot()
    const model = this.dependencies.adapter.modelSnapshot()
    if (!this.packagedRuntimeAvailable) {
      return {
        state: 'needs-setup',
        detailKey: 'plugins.desktopControl.runtimeMissing',
        checkedAt: Date.now(),
      }
    }
    if (runtime.state === 'error') {
      return { state: 'error', detail: runtime.lastError, checkedAt: Date.now() }
    }
    if (this.active && (!model.configured || !this.shellAvailability.executableAvailable)) {
      return {
        state: 'needs-setup',
        detailKey: model.configured
          ? 'plugins.desktopControl.controlNeedsSetup'
          : 'plugins.desktopControl.modelNeedsSetup',
        checkedAt: Date.now(),
      }
    }
    return {
      state: 'healthy',
      detailKey: this.active ? 'plugins.health.healthy' : 'plugins.health.disabledHealthy',
      checkedAt: Date.now(),
    }
  }

  async getStatus(): Promise<DesktopControlStatus> {
    this.assertInitialized()
    await this.refreshAvailability()
    const runtime = this.dependencies.adapter.snapshot()
    const model = this.dependencies.adapter.modelSnapshot()
    const automationEngine =
      this.active && this.packagedRuntimeAvailable && model.configured ? 'ready' : 'needs-setup'
    const computerControl =
      this.active &&
      this.packagedRuntimeAvailable &&
      this.shellAvailability.executableAvailable &&
      model.configured
        ? 'ready'
        : 'needs-setup'
    return {
      enabled: this.active,
      runtime: { ...runtime, packagedRuntimeAvailable: this.packagedRuntimeAvailable },
      automationEngine,
      computerControl,
      shell: this.shellAvailability,
      authorityMode: this.dependencies.authorityMode(),
      model,
    }
  }

  async getCapabilityProjection(): Promise<DesktopControlCapabilityProjection> {
    const status = await this.getStatus()
    return {
      enabled: status.enabled,
      automationEngine: status.automationEngine,
      computerControl: status.computerControl,
      authorityMode: status.authorityMode,
    }
  }

  async startRuntime(): Promise<DesktopControlStatus> {
    this.assertActive()
    await this.dependencies.adapter.start('shell')
    return this.getStatus()
  }

  async stopRuntime(): Promise<DesktopControlStatus> {
    await this.dependencies.adapter.close()
    return this.getStatus()
  }

  getCapabilityProviders(): PluginCapabilityProviders {
    return {}
  }

  validateWorkflowRequest(payload: unknown): EffectiveDesktopWorkflowRequest {
    const request = desktopWorkflowRequestSchema.parse(payload)
    if (
      request.requestedCapabilities.length === 1 &&
      request.requestedCapabilities[0] === 'shell' &&
      request.shellCommand
    ) {
      const shellRisk = this.shellRiskPolicy.classify(request.shellCommand)
      return { ...request, risk: shellRisk.effectiveRisk, shellRisk }
    }
    return request
  }

  async executeWorkflow(
    request: EffectiveDesktopWorkflowRequest,
    signal: AbortSignal,
  ): Promise<DesktopWorkflowAdapterResult> {
    this.assertActive()
    if (
      request.requestedCapabilities.length !== 1 ||
      request.requestedCapabilities[0] !== 'shell'
    ) {
      throw new ActionError(
        'DESKTOP_CAPABILITY_UNAVAILABLE',
        'Desktop Control accepts only the shell capability',
        'failure',
        true,
        'desktop-control',
      )
    }
    try {
      return await this.dependencies.adapter.execute(
        request.goal,
        signal,
        'shell',
        request.shellCommand,
      )
    } catch (error) {
      if (signal.aborted) {
        throw new ActionError(
          'ACTION_CANCELLED',
          'Desktop action was cancelled',
          'cancelled',
          true,
          'desktop-control',
        )
      }
      if (error instanceof ActionError) throw error
      throw mapDshAdapterError(error)
    }
  }

  emergencyStop(): Promise<void> {
    return this.dependencies.adapter.close()
  }

  private async refreshAvailability(): Promise<void> {
    ;[this.packagedRuntimeAvailable, this.shellAvailability] = await Promise.all([
      this.dependencies.adapter.checkAvailability(),
      this.dependencies.adapter.checkShellAvailability(),
    ])
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Desktop Control plugin is not initialized')
  }

  private assertActive(): void {
    this.assertInitialized()
    if (!this.active) {
      throw new ActionError(
        'DESKTOP_CONTROL_DISABLED',
        'Desktop Control plugin is disabled',
        'failure',
        true,
        'desktop-control',
      )
    }
  }

  private publishChanged(): void {
    for (const listener of this.listeners) listener()
  }
}

export function mapDshAdapterError(error: unknown): ActionError {
  if (!(error instanceof DshAdapterError)) {
    return new ActionError('DESKTOP_CONTROL_FAILED', 'Desktop Control failed', 'failure', true)
  }
  return new ActionError(
    error.code,
    error.message,
    error.code === 'DSH_REQUEST_TIMEOUT'
      ? 'timeout'
      : error.code === 'DSH_CANCELLED'
        ? 'cancelled'
        : 'failure',
    error.recoverable,
    'desktop-control',
    error.evidence,
  )
}
