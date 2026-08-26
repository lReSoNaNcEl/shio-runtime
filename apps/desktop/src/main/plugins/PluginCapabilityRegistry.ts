import type {
  PluginCapabilityKind,
  PluginId,
  PluginProviderCapability,
  PluginProviderMap,
} from '../../shared/plugins'

interface ProviderRegistration {
  owner: PluginId
  provider: unknown
}

/** Typed provider lookup. It does not expose arbitrary Plugin method dispatch. */
export class PluginCapabilityRegistry {
  private readonly owners = new Map<PluginCapabilityKind, PluginId>()
  private readonly providers = new Map<PluginProviderCapability, ProviderRegistration>()

  register<Capability extends PluginProviderCapability>(
    owner: PluginId,
    capability: Capability,
    provider: PluginProviderMap[Capability],
  ): void {
    this.claim(owner, capability)
    this.providers.set(capability, { owner, provider })
  }

  get<Capability extends PluginProviderCapability>(
    capability: Capability,
  ): PluginProviderMap[Capability] | undefined {
    return this.providers.get(capability)?.provider as PluginProviderMap[Capability] | undefined
  }

  hasProvider(owner: PluginId, capability: PluginProviderCapability): boolean {
    return this.providers.get(capability)?.owner === owner
  }

  registerOwnedCapability(owner: PluginId, capability: PluginCapabilityKind): void {
    this.claim(owner, capability)
  }

  hasCapability(capability: PluginCapabilityKind): boolean {
    return this.owners.has(capability)
  }

  ownerOf(capability: PluginCapabilityKind): PluginId | undefined {
    return this.owners.get(capability)
  }

  unregisterOwner(owner: PluginId): void {
    for (const [capability, currentOwner] of this.owners) {
      if (currentOwner === owner) this.owners.delete(capability)
    }
    for (const [capability, registration] of this.providers) {
      if (registration.owner === owner) this.providers.delete(capability)
    }
  }

  private claim(owner: PluginId, capability: PluginCapabilityKind): void {
    const currentOwner = this.owners.get(capability)
    if (currentOwner && currentOwner !== owner) {
      throw new Error(`${capability} capability is already owned by ${currentOwner}`)
    }
    this.owners.set(capability, owner)
  }
}
