import type { CharacterToolId } from '../../shared/character-tools'

export type ToolCapability = 'project' | 'browser' | 'game' | 'shell' | 'memory' | 'goal' | 'web'
export type ToolEvidenceOrigin = 'project' | 'browser' | 'memory' | 'goal' | 'web'

export interface ToolInfluenceSnapshot {
  originalUserGoal: string
  selectedCapabilities: readonly ToolCapability[]
  evidenceOrigins: readonly ToolEvidenceOrigin[]
  authorizationScopes: readonly string[]
}

function capabilityFor(id: CharacterToolId): ToolCapability {
  if (id === 'web.search') return 'web'
  if (id.startsWith('browser.')) return 'browser'
  if (id.startsWith('game.')) return 'game'
  if (id.startsWith('memory.')) return 'memory'
  if (id.startsWith('goal.')) return 'goal'
  if (id === 'project.search') return 'project'
  return 'shell'
}

/**
 * Main-owned, turn-local taint ledger. Evidence can inform values but cannot introduce a new
 * authority-bearing capability after untrusted browser evidence has entered the turn.
 */
export class ToolInfluenceContext {
  private readonly selected = new Set<ToolCapability>()
  private readonly plannedBeforeEvidence = new Set<ToolCapability>()
  private readonly origins = new Set<ToolEvidenceOrigin>()
  private readonly scopes = new Set<string>()

  constructor(private readonly originalUserGoal: string) {}

  registerPlannedTools(ids: readonly CharacterToolId[]): void {
    if (this.origins.size > 0) return
    for (const id of ids) this.plannedBeforeEvidence.add(capabilityFor(id))
  }

  canInvoke(id: CharacterToolId): boolean {
    const capability = capabilityFor(id)
    if (!this.origins.has('browser') && !this.origins.has('web')) return true
    if (capability !== 'shell' && capability !== 'memory' && capability !== 'game') return true
    return this.plannedBeforeEvidence.has(capability)
  }

  select(id: CharacterToolId): void {
    const capability = capabilityFor(id)
    if (this.origins.size === 0) this.plannedBeforeEvidence.add(capability)
    this.selected.add(capability)
  }

  observeEvidence(origin: ToolEvidenceOrigin): void {
    this.origins.add(origin)
  }

  addAuthorizationScope(scopeId: string): void {
    this.scopes.add(scopeId)
  }

  snapshot(): ToolInfluenceSnapshot {
    return Object.freeze({
      originalUserGoal: this.originalUserGoal,
      selectedCapabilities: Object.freeze([...this.selected]),
      evidenceOrigins: Object.freeze([...this.origins]),
      authorizationScopes: Object.freeze([...this.scopes]),
    })
  }
}
