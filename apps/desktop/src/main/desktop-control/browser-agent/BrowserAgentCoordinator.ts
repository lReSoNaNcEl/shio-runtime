import type { BrowserWorkflowScopeRegistry } from './BrowserWorkflowScope'

/** Main-owned browser workflow scopes used by the unified Character Tool Loop. */
export class BrowserAgentCoordinator {
  constructor(private readonly scopes: BrowserWorkflowScopeRegistry) {}

  createAuthorizationScope(userGoal: string, signal: AbortSignal): string {
    return this.scopes.create(userGoal, signal).workflowId
  }

  releaseAuthorizationScope(workflowId: string): void {
    this.scopes.release(workflowId)
  }
}
