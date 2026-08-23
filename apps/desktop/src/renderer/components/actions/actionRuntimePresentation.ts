import type { ActionRuntimeSnapshot } from '../../../shared/actions'

const DESKTOP_WORKFLOW_TOOL = 'desktop.workflow'

export type DesktopWorkflowActivity = 'awaiting-confirmation' | 'running'

export function desktopWorkflowActivity(
  snapshot: ActionRuntimeSnapshot | null,
): DesktopWorkflowActivity | null {
  if (!snapshot) return null
  if (snapshot.pendingConfirmation?.tool === DESKTOP_WORKFLOW_TOOL) {
    return 'awaiting-confirmation'
  }

  return snapshot.recentActions.some(
    (action) =>
      action.tool === DESKTOP_WORKFLOW_TOOL &&
      action.lifecycle.includes('executed') &&
      !action.lifecycle.includes('completed'),
  )
    ? 'running'
    : null
}

export function isDesktopWorkflowActive(snapshot: ActionRuntimeSnapshot | null): boolean {
  return desktopWorkflowActivity(snapshot) !== null
}
