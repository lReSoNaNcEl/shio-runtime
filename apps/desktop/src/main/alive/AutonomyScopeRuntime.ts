import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'

import type { AutonomyRiskClass, AutonomyScope } from '../../shared/alive'
import type { AliveStore } from './AliveStore'

export interface ScopedActionProposal {
  application?: string
  filesystemPath?: string
  origin?: string
  risk: AutonomyRiskClass
}

/** User-policy-owned scope. Evidence, Behavior, Goals, and models can only consume it. */
export class AutonomyScopeRuntime {
  constructor(private readonly store: AliveStore) {}

  approve(
    input: Omit<AutonomyScope, 'id' | 'actionsUsed' | 'approvedAt'>,
    authority: 'explicit-user-approval',
    now = Date.now(),
  ): AutonomyScope {
    if (authority !== 'explicit-user-approval') throw new Error('AUTONOMY_SCOPE_AUTHORITY_REQUIRED')
    if (!input.goalId) throw new Error('AUTONOMY_SCOPE_GOAL_REQUIRED')
    const scope: AutonomyScope = Object.freeze({
      id: randomUUID(),
      ...normalizeScope(input),
      actionsUsed: 0,
      approvedAt: now,
    })
    this.store.saveAutonomyScope(scope)
    this.store.audit('autonomy', 'scope_approved', 'success', input.goalId)
    return scope
  }

  get(goalId: string): AutonomyScope | null {
    return this.store.autonomyScope(goalId)
  }

  authorizeAndConsume(goalId: string, proposal: ScopedActionProposal, now = Date.now()): boolean {
    const scope = this.get(goalId)
    if (!scope || (scope.expiresAt !== undefined && scope.expiresAt <= now)) return false
    if (scope.maxActions !== undefined && scope.actionsUsed >= scope.maxActions) return false
    if (scope.allowedRiskClasses && !scope.allowedRiskClasses.includes(proposal.risk)) return false
    if (
      proposal.application &&
      scope.allowedApplications &&
      !scope.allowedApplications.some(
        (allowed) => allowed.toLocaleLowerCase() === proposal.application?.toLocaleLowerCase(),
      )
    )
      return false
    if (
      proposal.origin &&
      scope.allowedOrigins &&
      !scope.allowedOrigins.some((allowed) => sameOrigin(allowed, proposal.origin as string))
    )
      return false
    if (
      proposal.filesystemPath &&
      scope.allowedFilesystemRoots &&
      !scope.allowedFilesystemRoots.some((root) => inside(root, proposal.filesystemPath as string))
    )
      return false
    this.store.saveAutonomyScope(Object.freeze({ ...scope, actionsUsed: scope.actionsUsed + 1 }))
    return true
  }
}

function normalizeScope(
  input: Omit<AutonomyScope, 'id' | 'actionsUsed' | 'approvedAt'>,
): Omit<AutonomyScope, 'id' | 'actionsUsed' | 'approvedAt'> {
  return {
    goalId: input.goalId,
    allowedApplications: boundedStrings(input.allowedApplications),
    allowedFilesystemRoots: boundedStrings(input.allowedFilesystemRoots)?.map((path) =>
      resolve(path),
    ),
    allowedOrigins: boundedStrings(input.allowedOrigins)?.map((origin) => new URL(origin).origin),
    maxActions:
      input.maxActions === undefined ? undefined : Math.max(1, Math.min(100, input.maxActions)),
    expiresAt: input.expiresAt,
    allowedRiskClasses: input.allowedRiskClasses
      ? Object.freeze([...new Set(input.allowedRiskClasses)])
      : undefined,
  }
}

function boundedStrings(values?: readonly string[]): readonly string[] | undefined {
  return values
    ? Object.freeze([...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 20))
    : undefined
}

function inside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}
