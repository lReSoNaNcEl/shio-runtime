import type { ActionRuntimeSnapshot } from '../../../shared/actions'

const DESKTOP_WORKFLOW_TOOL = 'desktop.workflow'
const PRESENTED_ACTION_TOOLS = new Set([
  DESKTOP_WORKFLOW_TOOL,
  'browser.game-session',
  'browser.game-control',
])

export type DesktopWorkflowActivity =
  | 'awaiting-confirmation'
  | 'executing'
  | 'verifying'
  | 'recovering'

export function actionRuntimeActivity(
  snapshot: ActionRuntimeSnapshot | null,
): DesktopWorkflowActivity | null {
  if (!snapshot) return null
  if (
    snapshot.pendingConfirmation &&
    PRESENTED_ACTION_TOOLS.has(snapshot.pendingConfirmation.tool)
  ) {
    return 'awaiting-confirmation'
  }

  const active = snapshot.recentActions.find(
    (action) =>
      action.actionId === snapshot.activeActionId && PRESENTED_ACTION_TOOLS.has(action.tool),
  )
  return active ? (snapshot.activeActionPhase ?? 'executing') : null
}

export function desktopWorkflowActivity(
  snapshot: ActionRuntimeSnapshot | null,
): DesktopWorkflowActivity | null {
  if (!snapshot) return null
  if (snapshot.pendingConfirmation?.tool === DESKTOP_WORKFLOW_TOOL) {
    return 'awaiting-confirmation'
  }

  const active = snapshot.recentActions.find(
    (action) =>
      action.actionId === snapshot.activeActionId && action.tool === DESKTOP_WORKFLOW_TOOL,
  )
  return active ? (snapshot.activeActionPhase ?? 'executing') : null
}

export function isDesktopWorkflowActive(snapshot: ActionRuntimeSnapshot | null): boolean {
  return desktopWorkflowActivity(snapshot) !== null
}
