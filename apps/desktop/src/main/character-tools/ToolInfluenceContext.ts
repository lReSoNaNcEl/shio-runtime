import type { CharacterToolId } from '../../shared/character-tools'

export type ToolCapability = 'project' | 'browser' | 'shell' | 'memory' | 'goal' | 'thread' | 'web'
export type ToolAuthorityOrigin = 'explicit-user-turn' | 'approved-workflow' | 'autonomous-scope'
export type ToolEvidenceOrigin = 'project' | 'browser' | 'memory' | 'goal' | 'web-search'

export interface ToolAuthorityProvenance {
  origin: ToolAuthorityOrigin
  capabilities: readonly ToolCapability[]
}

export interface ToolEvidenceProvenance {
  origin: ToolEvidenceOrigin
  observedAfterCapabilities: readonly ToolCapability[]
}

export interface ToolInfluenceSnapshot {
  originalUserGoal: string
  authority: ToolAuthorityProvenance
  evidence: readonly ToolEvidenceProvenance[]
  selectedCapabilities: readonly ToolCapability[]
  /** @deprecated Read `evidence` when provenance ordering matters. */
  evidenceOrigins: readonly ToolEvidenceOrigin[]
  authorizationScopes: readonly string[]
}

function capabilityFor(id: CharacterToolId): ToolCapability {
  if (id === 'web.search') return 'web'
  if (id.startsWith('browser.')) return 'browser'
  if (id.startsWith('memory.')) return 'memory'
  if (id.startsWith('goal.')) return 'goal'
  if (id.startsWith('thread.')) return 'thread'
  if (id === 'project.search') return 'project'
  return 'shell'
}

/**
 * Main-owned, turn-local provenance ledger. Evidence may inform typed values, while authority
 * must originate independently from the original user turn or an approved Runtime scope.
 */
export class ToolInfluenceContext {
  private readonly selected = new Set<ToolCapability>()
  private readonly authorityCapabilities = new Set<ToolCapability>()
  private readonly plannedTools = new Set<CharacterToolId>()
  private readonly evidenceEntries: ToolEvidenceProvenance[] = []
  private readonly scopes = new Set<string>()

  constructor(
    private readonly originalUserGoal: string,
    private readonly authorityOrigin: ToolAuthorityOrigin = 'explicit-user-turn',
  ) {}

  registerPlannedTools(ids: readonly CharacterToolId[]): void {
    if (this.evidenceEntries.length > 0) return
    for (const id of ids) {
      this.authorityCapabilities.add(capabilityFor(id))
      this.plannedTools.add(id)
    }
  }

  canInvoke(id: CharacterToolId): boolean {
    const capability = capabilityFor(id)
    if (this.evidenceEntries.length === 0) return true
    if (id === 'browser.use') return this.plannedTools.has(id)
    return this.authorityCapabilities.has(capability)
  }

  select(id: CharacterToolId): void {
    const capability = capabilityFor(id)
    if (this.evidenceEntries.length === 0) this.authorityCapabilities.add(capability)
    this.selected.add(capability)
  }

  observeEvidence(origin: ToolEvidenceOrigin): void {
    if (this.evidenceEntries.some((entry) => entry.origin === origin)) return
    this.evidenceEntries.push(
      Object.freeze({
        origin,
        observedAfterCapabilities: Object.freeze([...this.selected]),
      }),
    )
  }

  addAuthorizationScope(scopeId: string): void {
    this.scopes.add(scopeId)
  }

  snapshot(): ToolInfluenceSnapshot {
    return Object.freeze({
      originalUserGoal: this.originalUserGoal,
      authority: Object.freeze({
        origin: this.authorityOrigin,
        capabilities: Object.freeze([...this.authorityCapabilities]),
      }),
      evidence: Object.freeze([...this.evidenceEntries]),
      selectedCapabilities: Object.freeze([...this.selected]),
      evidenceOrigins: Object.freeze(this.evidenceEntries.map((entry) => entry.origin)),
      authorizationScopes: Object.freeze([...this.scopes]),
    })
  }
}
